import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { SERVIDOR, urlDescarga, VINCULOS, type Archivo } from '@/data/vinculos';

const PISTAS: Record<number, string> = { 401: 'sin autorización', 403: 'acceso denegado', 404: 'no se encontró el archivo' };

/*
 * «¿Cambió?» antes de descargar: el servidor da a cada respuesta una versión (ETag). La app guarda la de lo último que
 * descargó y la manda en If-None-Match; si no cambió, el servidor responde 304 sin cuerpo y la app usa su copia.
 * Así no se vuelven a bajar los ~300 KB del catálogo ni las imágenes cada vez que se abre la app.
 */
const CLAVE_VERSIONES = 'versiones-servidor:v1';
let versiones: Record<string, string> | null = null;

async function leerVersiones() {
  if (!versiones) {
    try {
      versiones = JSON.parse((await AsyncStorage.getItem(CLAVE_VERSIONES)) ?? '{}') as Record<string, string>;
    } catch {
      versiones = {};
    }
  }
  return versiones;
}

/** Guarda la versión de una ruta. Se llama después de guardar la copia, para que nunca haya versión sin copia. */
async function recordarVersion(ruta: string, etag: string | null) {
  const v = await leerVersiones();
  if (etag) v[ruta] = etag;
  else delete v[ruta];
  await AsyncStorage.setItem(CLAVE_VERSIONES, JSON.stringify(v)).catch(() => undefined);
}

/**
 * GET al servidor. Con `tengoCopia`, pregunta si cambió desde la última vez: devuelve null si no cambió (304).
 * `guardarVersion()` se llama cuando la app ya guardó lo que descargó.
 */
async function pedir(ruta: string, tengoCopia: boolean) {
  const encabezados: Record<string, string> = { 'Cache-Control': 'no-cache' };
  const version = tengoCopia ? (await leerVersiones())[ruta] : undefined;
  if (version) encabezados['If-None-Match'] = version;
  const r = await fetch(SERVIDOR + ruta, { headers: encabezados });
  if (r.status === 304 && version) return null;
  return { r, guardarVersion: () => recordarVersion(ruta, r.headers.get('ETag')) };
}

/**
 * JSON del servidor de Cloudflare (SERVIDOR), p. ej. '/api/imagenes'. Con `tengoCopia`, devuelve null si no cambió
 * desde la última descarga; en ese caso la app sigue con su copia. `listo()` se llama después de guardarla.
 */
export async function pedirServidor<T>(ruta: string, tengoCopia = false): Promise<{ datos: T; listo: () => Promise<void> } | null> {
  const respuesta = await pedir(ruta, tengoCopia);
  if (!respuesta) return null;
  if (!respuesta.r.ok) throw new Error(`El servidor respondió HTTP ${respuesta.r.status}`);
  return { datos: (await respuesta.r.json()) as T, listo: respuesta.guardarVersion };
}

/** Catálogo descargado del servidor y de qué versión es. */
export type CatalogoServidor = {
  contenido: ArrayBuffer;
  /** Cuándo apareció esta versión en el servidor (ISO). */
  actualizado: string | null;
  /** Huella (ETag) de la versión inmediata anterior, y cuándo apareció; null si el servidor aún no tiene anterior. */
  anterior: string | null;
  anteriorFecha: string | null;
  /** La copia que ya tiene el teléfono es justo la versión anterior (se puede comparar sin descargarla). */
  copiaEsAnterior: boolean;
  listo: () => Promise<void>;
};

/**
 * Catálogo del servidor. Con `tengoCopia`, null si no cambió desde la última descarga.
 * `listo()` se llama después de guardar la copia.
 */
export async function catalogoServidor(tengoCopia: boolean): Promise<CatalogoServidor | null> {
  const versionCopia = tengoCopia ? (await leerVersiones())['/api/catalogo'] : undefined;
  const respuesta = await pedir('/api/catalogo', tengoCopia);
  if (!respuesta) return null;
  const h = respuesta.r.headers;
  const anterior = h.get('X-Anterior') || null;
  return {
    contenido: await revisarExcel(respuesta.r),
    actualizado: h.get('X-Actualizado') || null,
    anterior,
    anteriorFecha: h.get('X-Anterior-Fecha') || null,
    copiaEsAnterior: !!anterior && anterior === versionCopia,
    listo: respuesta.guardarVersion,
  };
}

/** Versión inmediata anterior del catálogo (la que había antes del último cambio), para calcular las novedades. */
export async function catalogoAnteriorServidor(): Promise<ArrayBuffer> {
  return revisarExcel(await fetch(`${SERVIDOR}/api/catalogo/anterior`, { headers: { 'Cache-Control': 'no-cache' } }));
}

/**
 * Descarga un Excel y comprueba que de verdad sea un Excel.
 * El catálogo se pide al servidor de Cloudflare (SERVIDOR); si no hay o falla, a OneDrive como antes: en el teléfono
 * directo a SharePoint y en el navegador por el servidor web de la app (src/app/api/excel+api.ts), porque
 * SharePoint no deja que otra página lea sus archivos.
 */
export async function descargarExcel(archivo: Archivo): Promise<ArrayBuffer> {
  if (!VINCULOS[archivo]) throw new Error('La app no tiene el vínculo de este Excel: configure SERVIDOR en vinculos.ts.');
  return bajarExcel(Platform.OS === 'web' ? `/api/excel?archivo=${archivo}` : urlDescarga(VINCULOS[archivo]));
}

async function bajarExcel(url: string): Promise<ArrayBuffer> {
  return revisarExcel(await fetch(url, { headers: { 'Cache-Control': 'no-cache' } }));
}

async function revisarExcel(r: Response): Promise<ArrayBuffer> {
  if (!r.ok) {
    // El servidor de la app explica el error en JSON; SharePoint solo da el código
    const detalle = await r.json().then((j: { error?: string }) => j.error).catch(() => null);
    throw new Error(detalle ?? `HTTP ${r.status}, ${PISTAS[r.status] ?? 'error del servidor'}`);
  }
  const contenido = await r.arrayBuffer();
  const inicio = new Uint8Array(contenido, 0, 2);
  if (inicio[0] !== 0x50 || inicio[1] !== 0x4b) {
    // Un .xlsx es un zip (empieza con "PK"); si no, SharePoint devolvió una página de inicio de sesión
    throw new Error('El vínculo no devolvió un Excel: revisa que permita ver el archivo sin iniciar sesión.');
  }
  return contenido;
}
