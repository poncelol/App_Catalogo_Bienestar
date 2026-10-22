/**
 * Vínculos de los Excel en OneDrive/SharePoint y cómo se descargan en cada plataforma.
 *
 * iOS y Android descargan directo de SharePoint. En el navegador no se puede: SharePoint no permite que otra página
 * lea sus archivos (CORS), así que la versión web los pide al servidor de la propia app (src/app/api/excel+api.ts),
 * que los descarga y se los entrega. Este archivo no usa nada de React Native para que también lo use ese servidor.
 */

/** Catálogo (hoja VIGENTES). Debe estar compartido como "Cualquier persona con el vínculo puede ver". */
export const LINK_EXCEL =
  'https://sdldiconsa1-my.sharepoint.com/:x:/g/personal/jgil_alimentacionbienestar_gob_mx/IQAMMYIoAdV3R64jYKkkxY-dAa80op6GuFgIqRefBMflTcw?e=DJUBs9';

/**
 * Excel interno de imágenes (hojas PROVEEDORES, PRODUCTOS y ARTICULOS con su columna IMAGEN), en OneDrive.
 * Es el que manda: la app lo descarga al abrirse y `npm run imagenes` parte de él. Vacío: se usan las fotos que
 * trae la app.
 */
export const LINK_IMAGENES =
  'https://sdldiconsa1-my.sharepoint.com/:x:/g/personal/emponce_alimentacionbienestar_gob_mx/IQBR3sFMsgrnQLIP0OX6Uu0BAT0miz7AJ7BSBkPOmJo15sE?e=uSyb3x';

export type Archivo = 'catalogo' | 'imagenes';
export const VINCULOS: Record<Archivo, string> = { catalogo: LINK_EXCEL, imagenes: LINK_IMAGENES };

/**
 * Vínculo para compartir de SharePoint -> descarga directa del archivo.
 *
 * Se usa _layouts/15/download.aspx?share=<token>: entrega el archivo en una sola petición. Con «?download=1»
 * SharePoint primero redirige y pone una cookie de invitado; si quien descarga no conserva esa cookie entre
 * redirecciones (Node.js, algunos navegadores) termina en la página de inicio de sesión aunque el vínculo sea público.
 */
export function urlDescarga(link: string) {
  const limpio = link.trim();
  const m = limpio.match(/^(https:\/\/[^/]+\.sharepoint\.com)\/:[a-z]:\/[a-z]\/(personal|sites)\/([^/]+)\/([A-Za-z0-9_-]+)/i);
  if (m) return `${m[1]}/${m[2]}/${m[3]}/_layouts/15/download.aspx?share=${m[4]}`;
  const base = limpio.replace(/([?&])download=[^&]*/g, '$1').replace(/[?&]+$/, '').replace(/&&+/g, '&');
  return base + (base.includes('?') ? '&' : '?') + 'download=1';
}
