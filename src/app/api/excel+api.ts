/**
 * GET /api/excel?archivo=catalogo|imagenes
 *
 * Solo para la versión web: el navegador no puede leer archivos de SharePoint (CORS), así que este servidor de la
 * app los descarga y se los entrega a la página. iOS y Android no lo usan: descargan directo de SharePoint.
 */
import { urlDescarga, VINCULOS, type Archivo } from '@/data/vinculos';

const error = (status: number, mensaje: string) =>
  Response.json({ error: mensaje }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const archivo = new URL(request.url).searchParams.get('archivo') as Archivo | null;
  const link = archivo ? VINCULOS[archivo] : undefined;
  if (link === undefined) return error(400, 'Archivo desconocido: usa ?archivo=catalogo o ?archivo=imagenes.');
  if (!link) return error(404, `No hay vínculo configurado para el Excel de ${archivo}.`);

  let r: Response;
  try {
    // Sin un User-Agent de navegador SharePoint responde 403 aunque el vínculo sea público
    r = await fetch(urlDescarga(link), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  } catch {
    return error(502, 'El servidor de la app no pudo conectarse con SharePoint.');
  }
  if (!r.ok) return error(502, `SharePoint respondió HTTP ${r.status}.`);
  const contenido = await r.arrayBuffer();
  const inicio = new Uint8Array(contenido, 0, 2);
  if (inicio[0] !== 0x50 || inicio[1] !== 0x4b) {
    return error(502, 'El vínculo no devolvió un Excel: revisa que permita ver el archivo sin iniciar sesión.');
  }
  return new Response(contenido, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Cache-Control': 'no-store',
    },
  });
}
