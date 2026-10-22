/**
 * Excel interno de imágenes: datos/imagenes.xlsx
 *
 *   npm run imagenes           Crea o actualiza el Excel con los proveedores, productos y artículos del catálogo
 *                              (descargado de SharePoint) y genera src/data/imagenes.json, que lee la app.
 *   npm run imagenes:buscar    Además busca la foto de cada artículo sin imagen por su código de barras en
 *                              Open Food Facts / Open Products Facts (bases públicas, licencia abierta).
 *
 * Opciones: --excel <ruta>  usa un Excel del catálogo local en vez de descargarlo.
 *           --reintentar    vuelve a consultar los códigos que antes no tenían foto.
 *
 * Lo que se escribe a mano en el Excel (IMAGEN, SITIO WEB) nunca se sobrescribe. La columna IMAGEN acepta un
 * vínculo para compartir de OneDrive/SharePoint ("cualquier persona con el vínculo") o una URL de imagen.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINK_EXCEL, LINK_IMAGENES, urlDescarga } from '../src/data/vinculos.ts';
import { buscarSugerencias } from './sugerencias.mjs';

const XLSX = createRequire(import.meta.url)('xlsx');
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
// datos/config.json puede indicar otra ubicación para el Excel, p. ej. la carpeta de OneDrive sincronizada, para que
// la app lo descargue al abrirse: { "excelImagenes": "C:\\Users\\...\\OneDrive - ...\\imagenes.xlsx" }
const CONFIG = join(RAIZ, 'datos', 'config.json');
const EXCEL = (existsSync(CONFIG) && JSON.parse(readFileSync(CONFIG, 'utf8')).excelImagenes) || join(RAIZ, 'datos', 'imagenes.xlsx');
const CACHE = join(RAIZ, 'datos', '.cache-fotos.json');
const SALIDA = join(RAIZ, 'src', 'data', 'imagenes.json');
const CACHE_SUGERENCIAS = join(RAIZ, 'datos', '.cache-sugerencias.json');
const REVISION = join(RAIZ, 'datos', 'revisar-sugerencias.html');

const args = process.argv.slice(2);
const BUSCAR = args.includes('--buscar');
const SUGERIR = args.includes('--sugerencias');
const REINTENTAR = args.includes('--reintentar');
const EXCEL_CATALOGO = args.includes('--excel') ? args[args.indexOf('--excel') + 1] : null;

const AUTO_PRODUCTO = 'Artículo ART. ';   // FUENTE de las fotos de producto que se toman de un artículo (se recalculan)
const OFF = 'Open Food Facts';

// ── Catálogo ──────────────────────────────────────────────────────────
const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const clave = (v) => (v === null || v === undefined ? '' : String(v).trim().replace(/\.0$/, ''));

const COPIA_CATALOGO = join(RAIZ, 'datos', 'catalogo.xlsx');

/** Catálogo: el de --excel, o el de SharePoint (y se guarda copia); si SharePoint falla, la última copia guardada. */
async function contenidoCatalogo() {
  if (EXCEL_CATALOGO) return readFileSync(EXCEL_CATALOGO);
  // El vínculo y la forma de descargarlo son los mismos que usa la app (src/data/vinculos.ts)
  const url = urlDescarga(LINK_EXCEL);
  console.log('Descargando el catálogo de SharePoint…');
  try {
    // Sin un User-Agent de navegador SharePoint responde 403 aunque el vínculo sea público
    // Un reintento: a veces la red de la oficina corta la primera conexión
    const bajar = () => fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    const r = await bajar().catch(() => espera(3000).then(bajar));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('el vínculo pide iniciar sesión');
    writeFileSync(COPIA_CATALOGO, buf);
    return buf;
  } catch (e) {
    if (!existsSync(COPIA_CATALOGO)) {
      throw new Error(`No pude descargar el catálogo de SharePoint (${e.message}) y no hay copia en ${COPIA_CATALOGO}. ` +
        'Revisa que el vínculo permita ver el archivo sin iniciar sesión, o usa --excel <ruta del catálogo>.');
    }
    console.log(`No pude descargarlo (${e.message}); uso la copia guardada en datos\\catalogo.xlsx.`);
    return readFileSync(COPIA_CATALOGO);
  }
}

function leerCatalogo(buf) {
  const libro = XLSX.read(buf, { type: 'buffer' });
  const hoja = libro.SheetNames.includes('VIGENTES') ? 'VIGENTES' : libro.SheetNames[0];
  const filas = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: true, defval: null });
  const iEnc = filas.slice(0, 30).findIndex((f) => f.some((c) => ['NEGOCIACION', 'CVE'].includes(norm(c))));
  if (iEnc < 0) throw new Error('No encontré la fila de encabezados del catálogo.');
  const col = {};
  filas[iEnc].forEach((c, i) => { const n = norm(c); if (!(n in col)) col[n] = i; });
  const v = (f, n) => (col[n] === undefined ? null : f[col[n]]);
  return filas.slice(iEnc + 1)
    .map((f) => ({
      cve: clave(v(f, 'CVE')), proveedor: norm(v(f, 'PROVEEDOR')),
      prod: clave(v(f, 'PROD.')), producto: norm(v(f, 'PRODUCTOS')),
      art: clave(v(f, 'ART.')), articulo: norm(v(f, 'ARTICULOS')), marca: norm(v(f, 'MARCA')),
      codigo: clave(v(f, 'CODIGO BARRAS')),
    }))
    .filter((a) => a.art);
}

// ── Excel de imágenes ─────────────────────────────────────────────────
const HOJAS = {
  PROVEEDORES: { llave: 'CVE', columnas: ['CVE', 'PROVEEDOR', 'ARTÍCULOS', 'IMAGEN', 'SITIO WEB', 'FUENTE'], anchos: [8, 45, 10, 60, 30, 22] },
  PRODUCTOS: { llave: 'PROD.', columnas: ['PROD.', 'PRODUCTO', 'ARTÍCULOS', 'IMAGEN', 'FUENTE'], anchos: [8, 40, 10, 60, 22] },
  ARTICULOS: { llave: 'ART.', columnas: ['ART.', 'ARTICULO', 'MARCA', 'PRODUCTO', 'PROVEEDOR', 'CODIGO BARRAS', 'IMAGEN', 'FUENTE',
    'APROBAR', 'SUGERENCIA', 'SUGERENCIA DE', 'COINCIDENCIA'], anchos: [10, 45, 18, 30, 35, 16, 60, 22, 10, 60, 50, 13] },
};

/** Renglones ya existentes del Excel de imágenes, por hoja y llave. */
function leerExistente() {
  const salida = { PROVEEDORES: new Map(), PRODUCTOS: new Map(), ARTICULOS: new Map() };
  if (!existsSync(EXCEL)) return salida;
  const libro = XLSX.read(readFileSync(EXCEL), { type: 'buffer' });
  for (const [hoja, { llave }] of Object.entries(HOJAS)) {
    if (!libro.Sheets[hoja]) continue;
    for (const r of XLSX.utils.sheet_to_json(libro.Sheets[hoja], { defval: '' })) {
      const k = clave(r[llave]);
      if (k) salida[hoja].set(k, r);
    }
  }
  return salida;
}

const texto = (v) => String(v ?? '').trim();

// ── Búsqueda de fotos por código de barras ────────────────────────────
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultar(base, codigo) {
  for (let intento = 0; intento < 4; intento++) {
    try {
      const r = await fetch(`https://${base}/api/v2/product/${codigo}.json?fields=image_front_url,image_url`, {
        headers: { 'User-Agent': 'AbastoRural2026-catalogo/1.0' },
      });
      if (r.status === 404) return null;
      const tipo = r.headers.get('content-type') ?? '';
      if (!r.ok || !tipo.includes('json')) throw new Error(`HTTP ${r.status}`);   // límite de consultas: esperar
      const j = await r.json();
      return j.product?.image_front_url || j.product?.image_url || null;
    } catch {
      await espera(10000 * (intento + 1));
    }
  }
  return undefined;   // no se pudo consultar: se reintenta en la siguiente ejecución
}

async function buscarFotos(codigos, cache) {
  const pendientes = codigos.filter((c) => !(c in cache) || (REINTENTAR && cache[c] === null));
  console.log(`Buscando ${pendientes.length} códigos de barras en ${OFF} (unos ${Math.ceil(pendientes.length * 1.3 / 60)} min)…`);
  let encontradas = 0;
  for (const [i, codigo] of pendientes.entries()) {
    let url = await consultar('world.openfoodfacts.org', codigo);
    await espera(700);   // menos de 100 consultas por minuto, el límite del servicio
    if (url === null) {
      // Artículos que no son alimentos (veladoras, detergentes…) están en la base hermana
      url = await consultar('world.openproductsfacts.org', codigo);
      await espera(700);
    }
    if (url !== undefined) cache[codigo] = url;
    if (url) encontradas++;
    if ((i + 1) % 25 === 0 || i === pendientes.length - 1) {
      writeFileSync(CACHE, JSON.stringify(cache, null, 1));
      process.stdout.write(`  ${i + 1}/${pendientes.length} consultados · ${encontradas} con foto\n`);
    }
  }
}

// ── Búsqueda en la tienda en línea de Chedraui ────────────────────────
// Se busca por nombre y solo se acepta un producto cuyo código de barras coincide (Chedraui lo guarda sin dígito
// verificador), para no poner la foto de otro artículo parecido.
const CACHE_CHEDRAUI = join(RAIZ, 'datos', '.cache-chedraui.json');
const CHEDRAUI = 'Chedraui';

function nucleoEan(e) {
  e = String(e).replace(/\D/g, '').replace(/^0+/, '');
  if (e.length === 14 && e[0] === '1') e = e.slice(1);
  if (e.length === 13) e = e.slice(0, 12);
  return e;
}

/** Nombre sin tamaños ni empaques ("16/101 GR", "C/12 PZ"), para que la búsqueda encuentre el producto. */
const consultaNombre = (n) => String(n)
  .replace(/\d+\s*\/\s*\d+.*$|\bC\/\d+.*$|\(\s*\d.*$|\b\d+(\.\d+)?\s*(G|GR|KG|ML|LT|L|PZ|PZS)\b.*$/i, '')
  .replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function buscarChedraui(pendientes, cacheCh) {
  const faltan = pendientes.filter((p) => !(p.codigo in cacheCh) || (REINTENTAR && cacheCh[p.codigo] === null));
  console.log(`Buscando ${faltan.length} artículos en ${CHEDRAUI} (unos ${Math.ceil(faltan.length / 50)} min)…`);
  let encontradas = 0;
  for (const [i, p] of faltan.entries()) {
    const q = consultaNombre(p.articulo);
    let foto;
    try {
      const r = await fetch(`https://www.chedraui.com.mx/api/io/_v/api/intelligent-search/product_search/?query=${encodeURIComponent(q)}&count=20`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      foto = null;
      for (const prod of j.products ?? []) for (const it of prod.items ?? []) {
        if (!foto && it.ean && nucleoEan(it.ean) === nucleoEan(p.codigo)) foto = it.images?.[0]?.imageUrl ?? null;
      }
    } catch {
      await espera(10000);   // sin respuesta: se reintenta en la siguiente ejecución
    }
    if (foto !== undefined) cacheCh[p.codigo] = foto;
    if (foto) encontradas++;
    await espera(1000);
    if ((i + 1) % 25 === 0 || i === faltan.length - 1) {
      writeFileSync(CACHE_CHEDRAUI, JSON.stringify(cacheCh, null, 1));
      process.stdout.write(`  ${i + 1}/${faltan.length} consultados · ${encontradas} con foto\n`);
    }
  }
}

// ── Principal ─────────────────────────────────────────────────────────
// Candado: dos ejecuciones a la vez se pisarían el Excel. Si el proceso del candado ya no existe, se ignora.
const CANDADO = join(RAIZ, 'datos', '.imagenes.lock');
if (existsSync(CANDADO)) {
  const pid = Number(readFileSync(CANDADO, 'utf8'));
  let vivo = false;
  try { process.kill(pid, 0); vivo = true; } catch {}
  if (vivo) {
    console.error(`Ya hay otra ejecución en curso (proceso ${pid}). Espera a que termine y vuelve a intentar.`);
    process.exit(1);
  }
}
mkdirSync(dirname(CANDADO), { recursive: true });
writeFileSync(CANDADO, String(process.pid));
process.on('exit', () => { try { if (readFileSync(CANDADO, 'utf8') === String(process.pid)) unlinkSync(CANDADO); } catch {} });
process.on('SIGINT', () => process.exit(130));

const catalogo = leerCatalogo(await contenidoCatalogo());

// El Excel de imágenes de OneDrive es el que manda (ahí se aprueban sugerencias y se capturan fotos): se descarga y
// se usa como base. La copia local anterior queda como respaldo en datos\imagenes.anterior.xlsx.
if (LINK_IMAGENES) {
  try {
    const r = await fetch(urlDescarga(LINK_IMAGENES));
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || buf.subarray(0, 2).toString() !== 'PK') throw new Error(r.ok ? 'el vínculo pide iniciar sesión' : `HTTP ${r.status}`);
    if (existsSync(EXCEL)) writeFileSync(join(dirname(EXCEL), 'imagenes.anterior.xlsx'), readFileSync(EXCEL));
    writeFileSync(EXCEL, buf);
    console.log('Usando el Excel de imágenes de OneDrive como base.');
  } catch (e) {
    console.log(`No pude descargar el Excel de imágenes de OneDrive (${e.message}); uso la copia local.`);
  }
}
const previo = leerExistente();
mkdirSync(dirname(EXCEL), { recursive: true });
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const cacheCh = existsSync(CACHE_CHEDRAUI) ? JSON.parse(readFileSync(CACHE_CHEDRAUI, 'utf8')) : {};

const agrupar = (llave) => {
  const m = new Map();
  for (const a of catalogo) (m.get(a[llave]) ?? m.set(a[llave], []).get(a[llave])).push(a);
  return m;
};
const porArt = agrupar('art');
const porProd = agrupar('prod');
const porCve = agrupar('cve');
const nArt = (g) => new Set(g.map((a) => a.art)).size;

if (BUSCAR) {
  const sinFoto = [...porArt.values()]
    .filter((g) => !texto(previo.ARTICULOS.get(g[0].art)?.IMAGEN))
    .map((g) => g.find((a) => /^\d{8,14}$/.test(a.codigo))?.codigo)
    .filter(Boolean);
  await buscarFotos([...new Set(sinFoto)], cache);
  // Los que Open Food Facts no tiene se buscan en Chedraui
  const restantes = [...porArt.values()]
    .filter((g) => !texto(previo.ARTICULOS.get(g[0].art)?.IMAGEN) && !g.some((a) => cache[a.codigo]))
    .map((g) => g.find((a) => /^\d{12,14}$/.test(a.codigo)))
    .filter(Boolean);
  await buscarChedraui([...new Map(restantes.map((a) => [a.codigo, a])).values()], cacheCh);
}

// Sugerencias por nombre para los que siguen sin foto
if (SUGERIR) {
  const pendientes = [...porArt.values()]
    .filter((g) => !texto(previo.ARTICULOS.get(g[0].art)?.IMAGEN) && !g.some((a) => cache[a.codigo] || cacheCh[a.codigo]))
    .map((g) => ({ art: g[0].art, articulo: g[0].articulo, marca: g[0].marca }));
  await buscarSugerencias(pendientes, CACHE_SUGERENCIAS, REINTENTAR, args.includes('--con-openfoodfacts'));
}
const cacheSug = existsSync(CACHE_SUGERENCIAS) ? JSON.parse(readFileSync(CACHE_SUGERENCIAS, 'utf8')) : {};
const APROBADA = /^(s[ií]|x|ok|1)$/i;

// Artículos: lo escrito a mano manda; si no, la foto encontrada por código de barras
const articulos = [...porArt.values()].map((g) => {
  const a = g[0];
  const p = previo.ARTICULOS.get(a.art) ?? {};
  let imagen = texto(p.IMAGEN);
  let fuente = texto(p.FUENTE);
  if (!imagen) {
    const codigo = g.find((x) => cache[x.codigo])?.codigo;
    const codigoCh = g.find((x) => cacheCh[x.codigo])?.codigo;
    if (codigo) { imagen = cache[codigo]; fuente = OFF; }
    else if (codigoCh) { imagen = cacheCh[codigoCh]; fuente = CHEDRAUI; }
    else fuente = '';
  } else if (!fuente) fuente = 'Manual';
  // Sugerencia por nombre: pasa a IMAGEN solo si alguien escribió SI en la columna APROBAR
  const aprobar = texto(p.APROBAR);
  const anterior = texto(p.SUGERENCIA) ? { url: texto(p.SUGERENCIA), nombre: texto(p['SUGERENCIA DE']), fuente: '', puntos: null } : null;
  const sug = imagen ? null : (cacheSug[a.art] ?? anterior);
  if (!imagen && sug && APROBADA.test(aprobar)) {
    imagen = sug.url;
    fuente = `Sugerencia aprobada${sug.fuente ? ` (${sug.fuente})` : ''}`;
  }
  const pendiente = !imagen && sug;
  return { 'ART.': a.art, ARTICULO: a.articulo, MARCA: a.marca, PRODUCTO: a.producto, PROVEEDOR: a.proveedor,
    'CODIGO BARRAS': a.codigo, IMAGEN: imagen, FUENTE: fuente, APROBAR: aprobar,
    SUGERENCIA: pendiente ? sug.url : '',
    'SUGERENCIA DE': pendiente ? [sug.fuente, sug.nombre].filter(Boolean).join(': ') : '',
    COINCIDENCIA: pendiente && sug.puntos !== null ? `${Math.round(sug.puntos * 100)}%` : '' };
}).sort((x, y) => x.PRODUCTO.localeCompare(y.PRODUCTO) || x.ARTICULO.localeCompare(y.ARTICULO));
const fotoArt = new Map(articulos.filter((a) => a.IMAGEN).map((a) => [a['ART.'], a]));

// Productos: lo escrito a mano manda; si no, la foto de su artículo con más negociaciones (prefiere las manuales)
const productos = [...porProd].map(([prod, g]) => {
  const p = previo.PRODUCTOS.get(prod) ?? {};
  let imagen = texto(p.IMAGEN);
  let fuente = texto(p.FUENTE);
  if (!imagen || fuente.startsWith(AUTO_PRODUCTO)) {
    const veces = new Map();
    for (const a of g) if (fotoArt.has(a.art)) veces.set(a.art, (veces.get(a.art) ?? 0) + 1);
    const elegido = [...veces].sort((x, y) =>
      Number(fotoArt.get(y[0]).FUENTE !== OFF) - Number(fotoArt.get(x[0]).FUENTE !== OFF) || y[1] - x[1])[0]?.[0];
    imagen = elegido ? fotoArt.get(elegido).IMAGEN : '';
    fuente = elegido ? AUTO_PRODUCTO + elegido : '';
  } else if (!fuente) fuente = 'Manual';
  return { 'PROD.': prod, PRODUCTO: g[0].producto, 'ARTÍCULOS': nArt(g), IMAGEN: imagen, FUENTE: fuente };
}).sort((x, y) => x.PRODUCTO.localeCompare(y.PRODUCTO));

// Proveedores: logotipo escrito a mano, o el ícono de su sitio web si se capturó SITIO WEB
const proveedores = [...porCve].map(([cve, g]) => {
  const p = previo.PROVEEDORES.get(cve) ?? {};
  const sitio = texto(p['SITIO WEB']);
  let imagen = texto(p.IMAGEN);
  let fuente = texto(p.FUENTE);
  const dominio = sitio.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  if ((!imagen || fuente === 'Sitio web') && dominio) {
    imagen = `https://www.google.com/s2/favicons?domain=${dominio}&sz=256`;
    fuente = 'Sitio web';
  } else if (imagen && !fuente) fuente = 'Manual';
  return { CVE: cve, PROVEEDOR: g[0].proveedor, 'ARTÍCULOS': nArt(g), IMAGEN: imagen, 'SITIO WEB': sitio, FUENTE: imagen ? fuente : '' };
}).sort((x, y) => x.PROVEEDOR.localeCompare(y.PROVEEDOR));

// Renglones del Excel que ya no están en el catálogo: se conservan al final para no perder lo capturado
const conservar = (hoja, filas) => {
  const { llave } = HOJAS[hoja];
  const vigentes = new Set(filas.map((f) => f[llave]));
  return [...filas, ...[...previo[hoja].values()].filter((r) => !vigentes.has(clave(r[llave])) && texto(r.IMAGEN))];
};

const libro = XLSX.utils.book_new();
const instrucciones = [
  ['IMÁGENES DEL CATÁLOGO · Programa de Abasto Rural 2026'],
  [''],
  ['Cada hoja tiene una fila por proveedor (CVE), producto (PROD.) o artículo (ART.). Escriba en la columna IMAGEN'],
  ['el vínculo de la foto: un vínculo para compartir de OneDrive/SharePoint ("Cualquier persona con el vínculo")'],
  ['o una URL de imagen. Lo que se escriba a mano nunca se reemplaza.'],
  [''],
  ['PROVEEDORES: capture IMAGEN (logotipo) o SITIO WEB; con el sitio web se usa el ícono de la empresa.'],
  ['PRODUCTOS: si IMAGEN queda vacía se usa la foto de uno de sus artículos (FUENTE "Artículo ART. …").'],
  ['ARTICULOS: las fotos con FUENTE "Open Food Facts" o "Chedraui" se encontraron por código de barras.'],
  [''],
  ['SUGERENCIAS: para artículos sin foto se buscó por nombre. Como no hay código de barras que lo confirme, la foto'],
  ['queda en SUGERENCIA (con el nombre encontrado en SUGERENCIA DE y qué tanto se parece en COINCIDENCIA).'],
  ['Para aceptarla escriba SI en la columna APROBAR. Para verlas con foto abra datos\\revisar-sugerencias.html.'],
  [''],
  ['Después de editar, ejecute en la carpeta BienestarApp:   npm run imagenes'],
  ['Para buscar fotos de artículos nuevos:                   npm run imagenes:buscar'],
  ['Para buscar sugerencias por nombre:                      npm run imagenes:sugerencias'],
];
const wsI = XLSX.utils.aoa_to_sheet(instrucciones);
wsI['!cols'] = [{ wch: 110 }];
XLSX.utils.book_append_sheet(libro, wsI, 'INSTRUCCIONES');
for (const [hoja, filas] of [['PROVEEDORES', proveedores], ['PRODUCTOS', productos], ['ARTICULOS', articulos]]) {
  const { columnas, anchos } = HOJAS[hoja];
  const ws = XLSX.utils.json_to_sheet(conservar(hoja, filas), { header: columnas });
  ws['!cols'] = anchos.map((wch) => ({ wch }));
  // IMAGEN y SUGERENCIA como vínculos: un clic abre la foto en el navegador
  const rango = XLSX.utils.decode_range(ws['!ref']);
  for (const col of ['IMAGEN', 'SUGERENCIA'].map((n) => columnas.indexOf(n)).filter((i) => i >= 0)) {
    for (let r = 1; r <= rango.e.r; r++) {
      const celda = ws[XLSX.utils.encode_cell({ r, c: col })];
      if (celda && /^https?:\/\//i.test(String(celda.v))) celda.l = { Target: String(celda.v) };
    }
  }
  ws['!autofilter'] = { ref: ws['!ref'] };
  XLSX.utils.book_append_sheet(libro, ws, hoja);
}
try {
  XLSX.writeFile(libro, EXCEL);
} catch (e) {
  throw new Error(`No pude guardar ${EXCEL}. ¿Está abierto en Excel? Ciérrelo y vuelva a intentar. (${e.message})`);
}

// Archivo que lee la app: solo las llaves con imagen
const mapa = (filas, llave) => Object.fromEntries(filas.filter((f) => f.IMAGEN).map((f) => [f[llave], f.IMAGEN]));
writeFileSync(SALIDA, JSON.stringify({
  generado: new Date().toISOString(),
  proveedores: mapa(proveedores, 'CVE'),
  productos: mapa(productos, 'PROD.'),
  articulos: mapa(articulos, 'ART.'),
}) + '\n');

// Página para revisar las sugerencias con su foto (se abre con doble clic; no sale de la computadora)
const porRevisar = articulos.filter((a) => a.SUGERENCIA).sort((x, y) => parseInt(y.COINCIDENCIA) - parseInt(x.COINCIDENCIA));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
writeFileSync(REVISION, `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sugerencias de fotos</title>
<style>
body{font-family:system-ui,Segoe UI,sans-serif;margin:0;background:#f3f4f6;color:#1f2937}
header{background:#611232;color:#fff;padding:20px 24px;border-bottom:4px solid #BC955C}
header h1{margin:0;font-size:22px}header p{margin:6px 0 0;opacity:.85;font-size:14px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;padding:20px}
.t{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgb(0 0 0/.08)}
.t img{width:100%;height:200px;object-fit:contain;background:#fff;border-bottom:1px solid #e5e7eb}
.c{padding:10px 12px;font-size:13px;line-height:1.4}.art{font-weight:700;font-size:14px}
.k{color:#6b7280;font-size:12px}.s{margin-top:6px;color:#374151}.p{float:right;font-weight:700;color:#235B4E}
</style></head><body><header><h1>Sugerencias de fotos por nombre · ${porRevisar.length} artículos</h1>
<p>Compare el artículo con la foto. Si es el mismo, escriba SI en la columna APROBAR del Excel y ejecute: npm run imagenes</p></header><main>
${porRevisar.map((a) => `<div class="t"><img loading="lazy" src="${esc(a.SUGERENCIA)}" alt=""><div class="c">
<span class="p">${esc(a.COINCIDENCIA)}</span><div class="art">${esc(a.ARTICULO)}</div>
<div class="k">ART. ${esc(a['ART.'])} · ${esc(a.MARCA)}${a['CODIGO BARRAS'] ? ` · ${esc(a['CODIGO BARRAS'])}` : ''}</div>
<div class="s">Encontrado: ${esc(a['SUGERENCIA DE'])}</div></div></div>`).join('\n')}
</main></body></html>`);

const conFoto = (f) => f.filter((x) => x.IMAGEN).length;
console.log(`\nListo: ${EXCEL}`);
console.log(`  Proveedores: ${conFoto(proveedores)} de ${proveedores.length} con imagen`);
console.log(`  Productos:   ${conFoto(productos)} de ${productos.length} con imagen`);
console.log(`  Artículos:   ${conFoto(articulos)} de ${articulos.length} con imagen` +
  ` (${articulos.filter((a) => a.FUENTE === OFF).length} de ${OFF}, ${articulos.filter((a) => a.FUENTE === CHEDRAUI).length} de ${CHEDRAUI})`);
console.log(`  Sugerencias: ${porRevisar.length} por revisar (columna APROBAR) · ${REVISION}`);
console.log(`  App:         ${SALIDA}`);
if (LINK_IMAGENES) {
  console.log('\nPara que la app lo use, sube este archivo a OneDrive reemplazando el Excel de imágenes (mismo nombre),');
  console.log('así se conserva el vínculo. Si solo editaste en OneDrive, no hace falta: la app ya lo lee de ahí.');
}
