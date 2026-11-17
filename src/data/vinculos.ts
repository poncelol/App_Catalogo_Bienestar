/**
 * Vínculos de los Excel en OneDrive/SharePoint y cómo se descargan en cada plataforma.
 *
 * iOS y Android descargan directo de SharePoint. En el navegador no se puede: SharePoint no permite que otra página
 * lea sus archivos (CORS), así que la versión web los pide al servidor de la propia app (src/app/api/excel+api.ts),
 * que los descarga y se los entrega. Este archivo no usa nada de React Native para que también lo use ese servidor.
 */

/*
 * Los vínculos de los Excel NO van en el código (se sube a git y viaja dentro de la app):
 *   · El servidor tiene el del catálogo como secreto (LINK_CATALOGO en Cloudflare).
 *   · Los scripts de esta computadora (npm run imagenes, admin_bienestar.py) los leen de datos/config.json
 *     ({ "linkCatalogo": "…", "linkImagenes": "…" }), que git ignora.
 * Vacíos, la app toma todo del SERVIDOR. Solo para pruebas sin servidor se pueden poner aquí, sin subirlos a git.
 */

/** Catálogo (hoja VIGENTES), compartido como "Cualquier persona con el vínculo puede ver". */
export const LINK_EXCEL = '';

/** Excel interno de imágenes (hojas PROVEEDORES, PRODUCTOS y ARTICULOS con su columna IMAGEN), en OneDrive. */
export const LINK_IMAGENES = '';

/**
 * Servidor de la app en Cloudflare (repositorio aparte: App Movil/BienestarBackend), p. ej. 'https://abasto-bienestar.<cuenta>.workers.dev'.
 * Guarda una copia del Excel del catálogo (la renueva cada 15 minutos), las imágenes y las regiones.
 * Vacío: la app descarga los Excel directo de OneDrive, como antes. Si el servidor falla, también.
 */
export const SERVIDOR = 'https://abasto-bienestar.abasto-bienestar-servidor.workers.dev';

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
