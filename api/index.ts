/**
 * Función de Vercel: atiende todas las peticiones de la versión web con el servidor que genera `expo export -p web`
 * (dist/server): las páginas y la API que descarga los Excel de SharePoint (src/app/api/excel+api.ts).
 * Los archivos estáticos (JS, imágenes, íconos) los sirve Vercel directo desde dist/client. Ver vercel.json.
 */
// Corre en Node (Vercel); el proyecto no incluye los tipos de Node
declare const __dirname: string;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRequestHandler } = require('expo-server/adapter/vercel');

module.exports = createRequestHandler({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  build: require('path').join(__dirname, '../dist/server'),
});
