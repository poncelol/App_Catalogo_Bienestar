import { Platform } from 'react-native';

import { urlDescarga, VINCULOS, type Archivo } from '@/data/vinculos';

const PISTAS: Record<number, string> = { 401: 'sin autorización', 403: 'acceso denegado', 404: 'no se encontró el archivo' };

/**
 * Descarga un Excel de OneDrive y comprueba que de verdad sea un Excel.
 * En el teléfono va directo a SharePoint; en el navegador lo pide al servidor de la app (src/app/api/excel+api.ts),
 * porque SharePoint no deja que otra página lea sus archivos.
 */
export async function descargarExcel(archivo: Archivo): Promise<ArrayBuffer> {
  const url = Platform.OS === 'web' ? `/api/excel?archivo=${archivo}` : urlDescarga(VINCULOS[archivo]);
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
