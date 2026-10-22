/**
 * Fotos del catálogo, tomadas del Excel interno de imágenes (no del Excel del catálogo).
 *
 * Orden de prioridad:
 *  1. El Excel de imágenes publicado en OneDrive (LINK_IMAGENES): se descarga cada vez que se abre la app.
 *  2. La última copia de ese Excel guardada en el teléfono.
 *  3. imagenes.json, que va dentro de la app (lo genera `npm run imagenes`; no se edita a mano).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import * as XLSX from 'xlsx';

import { urlImagen, type Articulo } from '@/data/abasto';
import { descargarExcel } from '@/data/descarga';
import IMAGENES from '@/data/imagenes.json';
import { LINK_IMAGENES } from '@/data/vinculos';

const CLAVE_CACHE = 'imagenes-catalogo:v1';

export type MapaImagenes = {
  proveedores: Record<string, string>;
  productos: Record<string, string>;
  articulos: Record<string, string>;
};

let mapa: MapaImagenes = IMAGENES as MapaImagenes;

/** Pone a cada artículo su foto del Excel de imágenes; si no tiene, conserva la de la columna IMAGEN del catálogo. */
export function conImagenes(arts: Articulo[]): Articulo[] {
  return arts.map((a) => {
    const imagen = urlImagen(mapa.articulos[a.artId]) ?? a.imagen;
    return imagen === a.imagen ? a : { ...a, imagen };
  });
}

/** Foto del producto: la del Excel de imágenes o, si no hay, la del primer artículo que tenga. */
export function imagenProducto(prod: string, arts: Articulo[]): string | null {
  return urlImagen(mapa.productos[prod]) ?? arts.find((a) => a.prod === prod && a.imagen)?.imagen ?? null;
}

/** Logotipo del proveedor (por CVE), o null. */
export function imagenProveedor(cve: string): string | null {
  return urlImagen(mapa.proveedores[cve]);
}

/** Ancho en pixeles de las fotos en listas y tarjetas, y en la ficha de un artículo o producto. */
export const MINIATURA = 400;
export const GRANDE = 800;

/**
 * La misma foto en el tamaño que se va a mostrar, en las tiendas que lo permiten desde la URL. Muchas fotos vienen
 * de 1000 a 2000 px y pesan de 5 a 30 veces más que una de 400 px, que es lo que ocupa una tarjeta.
 * Las URLs que no se reconocen se dejan igual.
 */
export function tamano(url: string, px: number): string {
  // VTEX (Chedraui, HEB, La Gran Bodega…): /arquivos/ids/<id>[-ancho-alto]/ y, a veces, ?width=&height=
  if (/\.vtex(assets|img)\.com/i.test(url)) {
    return url
      .replace(/(\/arquivos\/ids\/\d+)(-[\dauto]+-[\dauto]+)?(?=[/?]|$)/i, `$1-${px}-${px}`)
      .replace(/([?&])(width|height)=[^&]*/gi, `$1$2=${px}`);
  }
  // Walmart: el tamaño va en odnWidth/odnHeight
  if (/walmartimages\.com/i.test(url)) {
    const [base, query = ''] = url.split('?');
    const resto = query.split('&').filter((p) => p && !/^odn(width|height|bg)=/i.test(p));
    return `${base}?${[...resto, `odnHeight=${px}`, `odnWidth=${px}`, 'odnBg=FFFFFF'].join('&')}`;
  }
  // Amazon: <id>[._AC_SL1500_].jpg
  if (/media-amazon\.com\/images\/I\//i.test(url)) {
    return url.replace(/(\/I\/[^./?]+)(\.[^/?]*?)?\.(jpg|jpeg|png)$/i, `$1._AC_SL${px}_.$3`);
  }
  // Cloudinary: w_<n> en la ruta
  if (/res\.cloudinary\.com/i.test(url)) {
    return url.replace(/\bw_\d+/, `w_${px}`).replace(/\bh_\d+/, `h_${px}`);
  }
  return url;
}

const precargadas = new Set<string>();

/**
 * Descarga en segundo plano las miniaturas de los productos y los logotipos de los proveedores (unas 200 fotos
 * chicas), para que esas pestañas abran con las fotos listas. Las de artículos se cargan al verlas.
 */
export function precargar(arts: Articulo[]) {
  const prods = new Set(arts.map((a) => a.prod));
  const urls = [
    ...[...prods].map((p) => imagenProducto(p, arts)),
    ...[...new Set(arts.map((a) => a.cve))].map(imagenProveedor),
  ]
    .filter((u): u is string => !!u)
    .map((u) => tamano(u, MINIATURA))
    .filter((u) => !precargadas.has(u));
  if (!urls.length) return;
  urls.forEach((u) => precargadas.add(u));
  Image.prefetch(urls, 'memory-disk').catch(() => undefined);
}

/** Las fotos de bases públicas y tiendas llevan crédito de su origen. */
export function creditoImagen(url: string | null): string | null {
  if (!url) return null;
  if (/openfoodfacts\.org/i.test(url)) return 'Imagen: Open Food Facts (CC BY-SA)';
  if (/openproductsfacts\.org/i.test(url)) return 'Imagen: Open Products Facts (CC BY-SA)';
  if (/chedraui|vteximg|vtexassets/i.test(url)) return 'Imagen: Chedraui';
  return null;
}

/** Lee las hojas PROVEEDORES (CVE), PRODUCTOS (PROD.) y ARTICULOS (ART.) del Excel de imágenes. */
function leerExcelImagenes(contenido: ArrayBuffer): MapaImagenes {
  const libro = XLSX.read(new Uint8Array(contenido), { type: 'array' });
  const hoja = (nombre: string, llave: string) => {
    const ws = libro.Sheets[nombre];
    const salida: Record<string, string> = {};
    if (!ws) return salida;
    for (const r of XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })) {
      const k = String(r[llave] ?? '').trim().replace(/\.0$/, '');
      const v = String(r.IMAGEN ?? '').trim();
      if (k && v) salida[k] = v;
    }
    return salida;
  };
  return { proveedores: hoja('PROVEEDORES', 'CVE'), productos: hoja('PRODUCTOS', 'PROD.'), articulos: hoja('ARTICULOS', 'ART.') };
}

/** Usa la copia del Excel de imágenes guardada en el teléfono, si existe. */
export async function cargarImagenesGuardadas(): Promise<boolean> {
  try {
    const texto = await AsyncStorage.getItem(CLAVE_CACHE);
    if (!texto) return false;
    mapa = JSON.parse(texto) as MapaImagenes;
    return true;
  } catch {
    return false;
  }
}

/** Descarga el Excel de imágenes de OneDrive y lo guarda. Devuelve false si no hay vínculo configurado. */
export async function descargarImagenes(): Promise<boolean> {
  if (!LINK_IMAGENES) return false;
  mapa = leerExcelImagenes(await descargarExcel('imagenes'));
  await AsyncStorage.setItem(CLAVE_CACHE, JSON.stringify(mapa)).catch(() => undefined);
  return true;
}
