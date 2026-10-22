/**
 * Sugerencias de foto por nombre, para artículos que no se encontraron por código de barras.
 *
 * Se busca el artículo por nombre en Chedraui y, si no aparece, en Open Food Facts. Cada resultado se califica
 * (0 a 1) por cuántas palabras del nombre comparte, si trae la marca y si coincide el tamaño. Como no hay código
 * de barras que lo confirme, nunca se pone directo en IMAGEN: queda como SUGERENCIA para que alguien la apruebe.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const MINIMO = 0.75;   // calificación mínima para sugerir

const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'en', 'para', 'por', 'y', 'a', 'al', 'c', 'pz', 'pza',
  'pzs', 'piezas', 'pieza', 'paquet', 'paquete', 'caja', 'cajita', 'bote', 'frasco', 'lata', 'sobre', 'unidad', 'unidade', 'cja', 'bolsa', 'paquete', 'paq', 'sabor', 'tipo', 'marca', 'mx', 'cj', 'emp', 'env', 'gde', 'med', 'ch']);
const sinAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const singular = (w) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/** Palabras significativas de un nombre (sin acentos, en singular, sin números ni palabras vacías). */
export function palabras(nombre) {
  return new Set(sinAcento(nombre).replace(/[^a-z0-9ñ]+/g, ' ').split(' ')
    .filter((w) => w.length > 1 && !/^\d/.test(w)).map(singular).filter((w) => !VACIAS.has(w)));
}

/** Tamaños del nombre normalizados a gramos o mililitros: "450 G" -> "g450", "1 LT" -> "ml1000". */
export function tamanos(nombre) {
  const t = new Set();
  for (const m of sinAcento(nombre).matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|kgs|g|gr|grs|grm|ml|l|lt|lts|litro|litros)\b/g)) {
    const n = parseFloat(m[1].replace(',', '.'));
    const u = m[2];
    if (/^kg/.test(u)) t.add(`g${Math.round(n * 1000)}`);
    else if (/^g/.test(u)) t.add(`g${Math.round(n)}`);
    else if (u === 'ml') t.add(`ml${Math.round(n)}`);
    else t.add(`ml${Math.round(n * 1000)}`);
  }
  return t;
}

/** Calificación de 0 a 1 de qué tan probable es que el candidato sea el mismo artículo. */
export function calificar(articulo, marca, candidato) {
  const nuestras = palabras(articulo);
  const suyas = palabras(candidato);
  const pegado = sinAcento(candidato).replace(/[^a-z0-9ñ]/g, '');
  // La marca es obligatoria: sin ella, un "Fideo" de otra marca no sirve
  const deMarca = [...palabras(marca)].filter((w) => w !== 'sin');
  if (deMarca.length && !deMarca.every((w) => suyas.has(w) || pegado.includes(w))) return 0;
  for (const w of deMarca) nuestras.delete(w);
  if (!nuestras.size) return 0;
  const comunes = [...nuestras].filter((w) => suyas.has(w) || (w.length >= 5 && pegado.includes(w))).length;
  let puntos = comunes / nuestras.size;
  const t1 = tamanos(articulo);
  const t2 = tamanos(candidato);
  if (t1.size && t2.size) puntos = [...t1].some((x) => t2.has(x)) ? Math.min(1, puntos + 0.15) : puntos * 0.5;
  return Math.round(puntos * 100) / 100;
}

/** Texto de búsqueda: el nombre sin tamaños ni empaques, más la marca si no viene en el nombre. */
export function consultaDe(articulo, marca) {
  const base = String(articulo)
    .replace(/\d+\s*\/\s*\d+.*$|\bC\/\s*\d+.*$|\(\s*\d.*$|\b\d+(\.\d+)?\s*(G|GR|GRS|KG|ML|LT|L|PZ|PZS)\b.*$/i, '')
    .replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = String(marca ?? '').trim();
  return m && !sinAcento(base).includes(sinAcento(m)) && !/sin marca/i.test(m) ? `${base} ${m}` : base;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, cabeceras) {
  const r = await fetch(url, { headers: cabeceras });
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function enChedraui(q) {
  const j = await json(`https://www.chedraui.com.mx/api/io/_v/api/intelligent-search/product_search/?query=${encodeURIComponent(q)}&count=20`,
    { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' });
  return (j.products ?? []).map((p) => ({ nombre: p.productName ?? '', url: p.items?.[0]?.images?.[0]?.imageUrl ?? null, fuente: 'Chedraui' }));
}

async function enOpenFoodFacts(q) {
  const campos = 'product_name,product_name_es,brands,quantity,image_front_url';
  const j = await json(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&json=1&page_size=20&fields=${campos}`,
    { 'User-Agent': 'AbastoRural2026-catalogo/1.0' });
  return (j.products ?? []).map((p) => ({
    nombre: [p.product_name_es || p.product_name, p.brands, p.quantity].filter(Boolean).join(' '),
    url: p.image_front_url ?? null, fuente: 'Open Food Facts',
  }));
}

/**
 * Busca sugerencias para los artículos pendientes ({ art, articulo, marca }) y las guarda en el archivo de caché.
 * Cada artículo queda como { url, nombre, fuente, puntos } o null si no hubo nada suficientemente parecido.
 */
export async function buscarSugerencias(pendientes, archivoCache, reintentar = false, conOpenFoodFacts = false) {
  const cache = existsSync(archivoCache) ? JSON.parse(readFileSync(archivoCache, 'utf8')) : {};
  const faltan = pendientes.filter((p) => !(p.art in cache) || (reintentar && cache[p.art] === null));
  const tiempo = conOpenFoodFacts ? 'Chedraui y Open Food Facts; más de una hora' : `Chedraui; unos ${Math.ceil(faltan.length / 50)} min`;
  console.log(`Buscando sugerencias por nombre para ${faltan.length} artículos (${tiempo})…`);
  let halladas = 0;
  for (const [i, p] of faltan.entries()) {
    const q = consultaDe(p.articulo, p.marca);
    let mejor = null;
    let fallo = false;
    const evaluar = (lista) => {
      for (const c of lista) {
        if (!c.url) continue;
        const puntos = calificar(p.articulo, p.marca, c.nombre);
        if (puntos >= MINIMO && (!mejor || puntos > mejor.puntos)) mejor = { ...c, puntos };
      }
    };
    try {
      evaluar(await enChedraui(q));
    } catch { fallo = true; }
    await espera(1000);
    if (conOpenFoodFacts && (!mejor || mejor.puntos < 0.9)) {
      try {
        evaluar(await enOpenFoodFacts(q));
      } catch { fallo = true; }
      await espera(6500);   // Open Food Facts permite 10 búsquedas por minuto
    }
    if (mejor || !fallo) cache[p.art] = mejor;   // si una fuente falló y no hubo nada, se reintenta la próxima vez
    if (mejor) halladas++;
    if ((i + 1) % 10 === 0 || i === faltan.length - 1) {
      writeFileSync(archivoCache, JSON.stringify(cache, null, 1));
      process.stdout.write(`  ${i + 1}/${faltan.length} buscados · ${halladas} sugerencias\n`);
    }
  }
  return cache;
}
