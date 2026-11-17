import { Platform } from 'react-native';

import { SERVIDOR, urlDescarga, VINCULOS, type Archivo } from '@/data/vinculos';

const PISTAS: Record<number, string> = { 401: 'sin autorización', 403: 'acceso denegado', 404: 'no se encontró el archivo' };

/** JSON del servidor de Cloudflare (SERVIDOR), p. ej. '/api/imagenes'. */
export async function pedirServidor<T>(ruta: string): Promise<T> {
  const r = await fetch(SERVIDOR + ruta, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`El servidor respondió HTTP ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Descarga un Excel y comprueba que de verdad sea un Excel.
 * El catálogo se pide al servidor de Cloudflare (SERVIDOR); si no hay o falla, a OneDrive como antes: en el teléfono
 * directo a SharePoint y en el navegador por el servidor web de la app (src/app/api/excel+api.ts), porque
 * SharePoint no deja que otra página lea sus archivos.
 */
export async function descargarExcel(archivo: Archivo): Promise<ArrayBuffer> {
  if (archivo === 'catalogo' && SERVIDOR) {
    try {
      return await bajarExcel(`${SERVIDOR}/api/catalogo`);
    } catch (e) {
      // Respaldo: OneDrive, solo si la app todavía trae el vínculo (sin él, el vínculo queda oculto en el servidor)
      if (!VINCULOS.catalogo) throw e;
    }
  }
  if (!VINCULOS[archivo]) throw new Error('La app no tiene el vínculo de este Excel: configure SERVIDOR en vinculos.ts.');
  return bajarExcel(Platform.OS === 'web' ? `/api/excel?archivo=${archivo}` : urlDescarga(VINCULOS[archivo]));
}

async function bajarExcel(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
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
