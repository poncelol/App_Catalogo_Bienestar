/**
 * Datos del Programa de Abasto Rural 2026 (hoja VIGENTES).
 *
 * El Excel se descarga del vínculo de SharePoint/OneDrive, se lee con SheetJS y se guarda una copia
 * en el teléfono para poder consultarlo sin conexión. Las reglas de limpieza son las mismas que usa
 * el tablero (app_mosaic.py): la fila de encabezados se busca sola, los artículos se cuentan por ART.
 * y la cobertura NAL equivale a todas las regiones.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as XLSX from 'xlsx';

import { descargarExcel } from '@/data/descarga';
import { urlDescarga } from '@/data/vinculos';

export { LINK_EXCEL, urlDescarga } from '@/data/vinculos';

const CLAVE_CACHE = 'abasto-rural-2026:v2';

export type Alcance = 'Nacional' | 'Regional' | 'Sin dato';

export type Articulo = {
  negociacion: string;
  cve: string;
  proveedor: string;
  provCorto: string;
  prod: string;
  producto: string;
  artId: string;
  articulo: string;
  marca: string;
  presentacion: string;
  um: string;
  gram: number | null;
  costoCaja: number | null;
  costoUnit: number | null;
  impuesto: string;
  codigoBarras: string;
  inventario: string;
  cobertura: string;
  alcance: Alcance;
  regiones: string[];
  /** Fecha de vigencia como AAAA-MM-DD, o null si no tiene. */
  vigencia: string | null;
  /** URL de descarga directa de la foto (columna IMAGEN), o null si no tiene. */
  imagen: string | null;
  /** Texto en minúsculas y sin acentos para la búsqueda. */
  busqueda: string;
};

export type Datos = { articulos: Articulo[]; descargado: string; origen: 'red' | 'copia' };

// Estructura operativa (Gerencias Regionales): sigla de COBERTURA -> nombre, clave, estados que cubre
// (como se llaman en el mapa) y unidades operativas
type Region = { nombre: string; clave: number; estados: string[]; unidades: string[] };
export const REGIONES: Record<string, Region> = {
  NOE: { nombre: 'Noroeste', clave: 41, estados: ['Sinaloa', 'Baja California', 'Baja California Sur', 'Sonora'],
    unidades: ['Sinaloa', 'Baja California', 'Baja California Sur', 'Sonora'] },
  NOR: { nombre: 'Norte', clave: 42, estados: ['Chihuahua', 'Durango', 'Coahuila'], unidades: ['Chihuahua', 'Durango', 'Coahuila'] },
  NC: { nombre: 'Norte Centro', clave: 43, estados: ['Zacatecas', 'San Luis Potosí', 'Aguascalientes', 'Nuevo León'],
    unidades: ['Zacatecas', 'San Luis Potosí', 'Aguascalientes', 'Nuevo León'] },
  GLF: { nombre: 'Golfo', clave: 44, estados: ['Veracruz', 'Tamaulipas'],
    unidades: ['Oficina Central Xalapa', 'Acayucan', 'Orizaba', 'Poza Rica', 'Tamaulipas'] },
  OCC: { nombre: 'Occidente', clave: 45, estados: ['Jalisco', 'Nayarit', 'Colima'], unidades: ['Jalisco', 'Nayarit', 'Colima'] },
  CEN: { nombre: 'Centro', clave: 46, estados: ['Hidalgo', 'Querétaro', 'Guanajuato'], unidades: ['Hidalgo', 'Querétaro', 'Guanajuato'] },
  OAX: { nombre: 'Oaxaca', clave: 47, estados: ['Oaxaca'], unidades: ['Oaxaca', 'Istmo', 'Mixteca'] },
  MET: { nombre: 'Metropolitana', clave: 48, estados: ['México', 'Morelos'], unidades: ['Estado de México', 'Morelos'] },
  PEN: { nombre: 'Peninsular', clave: 49, estados: ['Yucatán', 'Campeche', 'Quintana Roo'], unidades: ['Yucatán', 'Campeche', 'Quintana Roo'] },
  STE: { nombre: 'Sureste', clave: 50, estados: ['Tabasco', 'Chiapas'], unidades: ['Tabasco', 'Tuxtla Gutiérrez', 'Tapachula'] },
  PSR: { nombre: 'Pacífico Sur', clave: 51, estados: ['Michoacán', 'Guerrero'], unidades: ['Michoacán', 'Guerrero'] },
  PUE: { nombre: 'Puebla', clave: 52, estados: ['Puebla', 'Tlaxcala'], unidades: ['Puebla', 'Tlaxcala'] },
};
export const SIGLAS = Object.keys(REGIONES);
/** Estado del mapa -> sigla de su región (la Ciudad de México no tiene unidad operativa). */
export const ESTADO_REGION: Record<string, string> = Object.fromEntries(
  SIGLAS.flatMap((sig) => REGIONES[sig].estados.map((e) => [e, sig])),
);

// ──────────────────────────────────────────────────────────────
// Lectura del Excel
// ──────────────────────────────────────────────────────────────
type Campo =
  | 'negociacion' | 'cve' | 'proveedor' | 'prod' | 'producto' | 'artId' | 'articulo' | 'marca' | 'cap' | 'gram'
  | 'um' | 'costoCaja' | 'costoUnit' | 'impuesto' | 'codigoBarras' | 'inventario' | 'cobertura' | 'vigencia' | 'imagen';

const ENCABEZADOS: Record<string, Campo> = {
  NEGOCIACION: 'negociacion', CVE: 'cve', PROVEEDOR: 'proveedor', 'PROD.': 'prod', PRODUCTOS: 'producto',
  'ART.': 'artId', ARTICULOS: 'articulo', MARCA: 'marca', CAP: 'cap', GRAM: 'gram', 'U/M': 'um',
  IMPUESTO: 'impuesto', 'CODIGO BARRAS': 'codigoBarras', 'TIPO DE INVENTARIO': 'inventario',
  COBERTURA: 'cobertura', VIGENCIA: 'vigencia',
  // Columna opcional con el vínculo de OneDrive/SharePoint de la foto del artículo
  IMAGEN: 'imagen', IMAGENES: 'imagen', 'IMÁGENES': 'imagen', 'IMÁGEN': 'imagen', FOTO: 'imagen', FOTOS: 'imagen',
};
const OBLIGATORIOS: Campo[] = ['cve', 'proveedor', 'producto', 'artId', 'articulo'];
const INVENTARIO_LABEL: Record<string, string> = { PAR: 'PAR', OFERTA: 'Oferta' };

function norm(v: unknown) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function campoDe(encabezado: string): Campo | undefined {
  if (encabezado.startsWith('COSTO UNITARIO')) return 'costoUnit';
  if (encabezado.startsWith('COSTO DE ADQUISI')) return 'costoCaja';
  return ENCABEZADOS[encabezado];
}

/** Claves numéricas como texto, sin el ".0" que agrega Excel (653.0 -> "653"). */
function clave(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim().replace(/\.0$/, '');
  return ['NAN', 'NONE', '<NA>'].includes(s.toUpperCase()) ? '' : s;
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function fecha(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Número de serie de Excel (días desde 1899-12-30)
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return ymd ? ymd[0] : null;
}

const ACENTOS: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };

export function sinAcentos(s: string) {
  return s.toLowerCase().replace(/[áéíóúüñ]/g, (c) => ACENTOS[c]);
}

/** Formato título. Tras un apóstrofo solo si sigue una palabra: «D'Gari», pero «Kellog's». */
function titulo(s: string) {
  return s.toLowerCase()
    .replace(/(^|[\s(\-/.&]|['´’](?=[a-záéíóúüñ]{2}))([a-záéíóúüñ])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

function capital(s: string) {
  const l = s.toLowerCase();
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/** Quita la razón social (S.A. de C.V., S. de R.L., S.C.…) y pasa a formato título. */
export function nombreCorto(nombre: string) {
  const corto = nombre
    .trim()
    .replace(/[,.\s]+(S\.?\s?A\.?|S\.?\s?DE\s?R\.?\s?L\.?|S\.?\s?C\.?|S\.?\s?P\.?\s?R\.?)(?![A-Z]).*$/i, '')
    .replace(/^[\s,.]+|[\s,.]+$/g, '');
  return titulo(corto) || nombre;
}

function presentacion(cap: number | null, gram: number | null, um: string) {
  if (cap === null || gram === null) return '–';
  return `${cap} × ${gram} ${um}`.trim();
}

export function leerExcel(contenido: ArrayBuffer): Articulo[] {
  const libro = XLSX.read(new Uint8Array(contenido), { type: 'array' });
  const hoja = libro.SheetNames.includes('VIGENTES') ? 'VIGENTES' : libro.SheetNames[0];
  const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[hoja], { header: 1, raw: true, defval: null });

  // El encabezado no siempre está en la misma fila: se usa la primera que diga NEGOCIACION o CVE
  const iEnc = filas.slice(0, 30).findIndex((f) => f.some((c) => ['NEGOCIACION', 'CVE'].includes(norm(c))));
  if (iEnc < 0) throw new Error(`No encontré la fila de encabezados en la hoja ${hoja}.`);
  const col: Partial<Record<Campo, number>> = {};
  filas[iEnc].forEach((c, i) => {
    const campo = campoDe(norm(c));
    if (campo && col[campo] === undefined) col[campo] = i;
  });
  const faltan = OBLIGATORIOS.filter((c) => col[c] === undefined);
  if (faltan.length) throw new Error(`Al Excel le faltan las columnas: ${faltan.join(', ')}.`);
  const val = (f: unknown[], c: Campo) => (col[c] === undefined ? null : f[col[c]!]);
  const texto = (f: unknown[], c: Campo) => norm(val(f, c));

  const articulos: Articulo[] = [];
  for (const f of filas.slice(iEnc + 1)) {
    const artId = clave(val(f, 'artId'));
    if (!artId) continue;   // renglones de encabezado de negociación o vacíos
    const proveedor = texto(f, 'proveedor');
    const producto = capital(texto(f, 'producto') || 'SIN CLASIFICAR');
    const articulo = texto(f, 'articulo') || 'SIN NOMBRE';
    const marca = titulo(texto(f, 'marca') || 'SIN MARCA');
    const um = texto(f, 'um');
    const inv = clave(val(f, 'inventario')).toUpperCase();
    // COBERTURA: NAL = todo el país; si no, la lista de siglas de región (NOE NOR NC …)
    const fichas = norm(val(f, 'cobertura')).replace(/[^A-Z]+/g, ' ').trim().split(' ').filter((x) => x && x !== 'NAN' && x !== 'NA');
    const nacional = fichas.includes('NAL');
    const provCorto = nombreCorto(proveedor);
    const codigoBarras = clave(val(f, 'codigoBarras'));
    articulos.push({
      negociacion: clave(val(f, 'negociacion')),
      cve: clave(val(f, 'cve')),
      proveedor,
      provCorto,
      prod: clave(val(f, 'prod')) || producto,
      producto,
      artId,
      articulo,
      marca,
      presentacion: presentacion(numero(val(f, 'cap')), numero(val(f, 'gram')), um),
      um,
      gram: numero(val(f, 'gram')),
      costoCaja: numero(val(f, 'costoCaja')),
      costoUnit: numero(val(f, 'costoUnit')),
      impuesto: texto(f, 'impuesto') || 'Sin dato',
      codigoBarras,
      inventario: inv ? (INVENTARIO_LABEL[inv] ?? inv) : 'Sin dato',
      cobertura: fichas.length ? fichas.join(' ') : 'Sin dato',
      alcance: nacional ? 'Nacional' : fichas.length ? 'Regional' : 'Sin dato',
      regiones: nacional ? SIGLAS : SIGLAS.filter((s) => fichas.includes(s)),
      vigencia: fecha(val(f, 'vigencia')),
      imagen: urlImagen(val(f, 'imagen')),
      busqueda: sinAcentos([articulo, marca, provCorto, producto, artId, codigoBarras].join(' ')),
    });
  }

  // Los productos se identifican por PROD.; si una clave trae varios nombres se usa el más frecuente y, si empatan,
  // el primero en orden alfabético, igual que el tablero (pandas mode)
  const nombres = new Map<string, Map<string, number>>();
  for (const a of articulos) {
    const m = nombres.get(a.prod) ?? new Map<string, number>();
    m.set(a.producto, (m.get(a.producto) ?? 0) + 1);
    nombres.set(a.prod, m);
  }
  const elegido = new Map([...nombres].map(([k, m]) =>
    [k, [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))[0][0]]));
  for (const a of articulos) a.producto = elegido.get(a.prod) ?? a.producto;
  return articulos;
}

// ──────────────────────────────────────────────────────────────
// Descarga y copia local
// ──────────────────────────────────────────────────────────────
/** Vínculo de la columna IMAGEN -> URL que se puede mostrar. Acepta vínculos para compartir de SharePoint (OneDrive
 * de trabajo), de OneDrive personal (1drv.ms / onedrive.live.com) o una URL directa de imagen. */
export function urlImagen(v: unknown): string | null {
  const link = String(v ?? '').trim();
  if (!/^https?:\/\//i.test(link)) return null;
  if (/sharepoint\.com/i.test(link)) return urlDescarga(link);
  if (/1drv\.ms|onedrive\.live\.com/i.test(link)) {
    // Formato de la API «shares» de OneDrive: "u!" + base64url del vínculo (los vínculos son ASCII)
    const codigo = btoa(link).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    return `https://api.onedrive.com/v1.0/shares/u!${codigo}/root/content`;
  }
  // URLs copiadas del navegador con espacios, corchetes o acentos ("…/k-che naranja 1.png"): las apps no las cargan
  // si no van codificadas. Los %XX que ya traen se respetan. iOS y Android bloquean http://, así que se pide por https.
  return link.replace(/^http:\/\//i, 'https://').replace(/[\s"<>[\\\]^`{|}]|[^\x00-\x7F]/gu, encodeURIComponent);
}

export async function descargar(): Promise<Datos> {
  const contenido = await descargarExcel('catalogo');
  const datos: Datos = { articulos: leerExcel(contenido), descargado: new Date().toISOString(), origen: 'red' };
  await AsyncStorage.setItem(CLAVE_CACHE, JSON.stringify(datos)).catch(() => undefined);
  return datos;
}

export async function leerCopia(): Promise<Datos | null> {
  try {
    const texto = await AsyncStorage.getItem(CLAVE_CACHE);
    return texto ? { ...(JSON.parse(texto) as Datos), origen: 'copia' } : null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Conteos (los artículos se cuentan por ART. distinto: se repite si está en varias negociaciones)
// ──────────────────────────────────────────────────────────────
export function nArt(arts: Articulo[]) {
  return new Set(arts.map((a) => a.artId)).size;
}

export type Conteo = { clave: string; etiqueta: string; valor: number };

/** Artículos distintos por grupo, de mayor a menor. */
export function contar(arts: Articulo[], grupo: (a: Articulo) => string | string[], etiqueta?: (a: Articulo) => string): Conteo[] {
  const ids = new Map<string, Set<string>>();
  const nombres = new Map<string, string>();
  for (const a of arts) {
    const g = grupo(a);
    for (const k of Array.isArray(g) ? g : [g]) {
      (ids.get(k) ?? ids.set(k, new Set()).get(k)!).add(a.artId);
      if (!nombres.has(k)) nombres.set(k, etiqueta ? etiqueta(a) : k);
    }
  }
  return [...ids]
    .map(([k, s]) => ({ clave: k, etiqueta: nombres.get(k)!, valor: s.size }))
    .sort((x, y) => y.valor - x.valor || x.etiqueta.localeCompare(y.etiqueta));
}

/** Fecha local como AAAA-MM-DD. */
export function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function hoyISO() {
  return isoLocal(new Date());
}

/** Días que faltan para la vigencia (negativo si ya pasó). */
export function diasVigencia(a: Articulo, hoy = hoyISO()) {
  return a.vigencia === null ? null : Math.round((Date.parse(a.vigencia) - Date.parse(hoy)) / 86400000);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaLarga(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

export function fechaCorta(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function dinero(x: number | null) {
  return x === null ? '–' : `$${x.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function entero(x: number) {
  return x.toLocaleString('es-MX');
}
