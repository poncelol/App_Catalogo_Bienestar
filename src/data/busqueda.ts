/**
 * Búsqueda del catálogo: sin acentos ni mayúsculas, por palabras, con tolerancia a plurales y ordenada por
 * relevancia (un código de barras o clave exacta va primero; luego coincidencias al inicio del nombre, de la
 * marca, del producto y del proveedor).
 */
import { REGIONES, SIGLAS, contar, sinAcentos, type Articulo, type Conteo } from '@/data/abasto';

export type Orden = 'relevancia' | 'nombre' | 'menor' | 'mayor';

export type FiltrosCatalogo = {
  texto?: string;
  proveedor?: string;
  marca?: string;
  inventario?: string;
  /** Sin valor: por relevancia si hay texto, por nombre si no. */
  orden?: Orden;
};

export function palabras(consulta: string) {
  return sinAcentos(consulta).split(/\s+/).map((p) => p.replace(/^[^a-z0-9ñ]+|[^a-z0-9ñ]+$/g, '')).filter(Boolean);
}

type Campos = { nombre: string; marca: string; producto: string; proveedor: string };
const cache = new WeakMap<Articulo, Campos>();
function campos(a: Articulo): Campos {
  let c = cache.get(a);
  if (!c) {
    c = { nombre: sinAcentos(a.articulo), marca: sinAcentos(a.marca), producto: sinAcentos(a.producto), proveedor: sinAcentos(a.provCorto) };
    cache.set(a, c);
  }
  return c;
}

/** ¿Alguna palabra del texto empieza con p? */
function iniciaPalabra(texto: string, p: string) {
  return texto.startsWith(p) || texto.includes(` ${p}`);
}

/** Variantes de una palabra para tolerar plurales: «galletas» también busca «galleta», «jabones» busca «jabon». */
function variantes(p: string) {
  const v = [p];
  if (p.length > 4 && p.endsWith('es')) v.push(p.slice(0, -2));
  if (p.length > 3 && p.endsWith('s')) v.push(p.slice(0, -1));
  return v;
}

function puntosPalabra(a: Articulo, p: string): number {
  if (a.codigoBarras === p || a.artId === p) return 100;
  if (p.length >= 4 && /^\d+$/.test(p) && (a.codigoBarras.startsWith(p) || a.artId.startsWith(p))) return 40;
  const c = campos(a);
  let mejor = 0;
  for (const v of variantes(p)) {
    const pts =
      (c.nombre.startsWith(v) ? 15 : iniciaPalabra(c.nombre, v) ? 10 : c.nombre.includes(v) ? 4 : 0) +
      (c.marca.startsWith(v) ? 8 : c.marca.includes(v) ? 3 : 0) +
      (iniciaPalabra(c.producto, v) ? 6 : c.producto.includes(v) ? 2 : 0) +
      (iniciaPalabra(c.proveedor, v) ? 4 : c.proveedor.includes(v) ? 1 : 0);
    mejor = Math.max(mejor, pts);
  }
  return mejor;
}

/** Puntos de relevancia; 0 si alguna palabra no aparece en el artículo. */
export function puntuar(a: Articulo, ps: string[]) {
  let total = 0;
  for (const p of ps) {
    const pts = puntosPalabra(a, p);
    if (!pts) return 0;
    total += pts;
  }
  return total;
}

/** Aplica filtros, búsqueda y orden al catálogo. Un artículo que está en varias negociaciones (p. ej. PAR y
 * Oferta, con costos distintos) sale una sola vez: la que queda primero según el orden; su ficha muestra todas. */
export function filtrarArticulos(arts: Articulo[], f: FiltrosCatalogo): Articulo[] {
  const vistos = new Set<string>();
  return ordenar(arts, f).filter((a) => !vistos.has(a.artId) && vistos.add(a.artId));
}

function ordenar(arts: Articulo[], f: FiltrosCatalogo): Articulo[] {
  const ps = palabras(f.texto ?? '');
  const orden = f.orden ?? (ps.length ? 'relevancia' : 'nombre');
  const puntos = new Map<Articulo, number>();
  const lista = arts.filter((a) => {
    if ((f.proveedor && a.cve !== f.proveedor) || (f.marca && a.marca !== f.marca) || (f.inventario && a.inventario !== f.inventario)) {
      return false;
    }
    if (!ps.length) return true;
    const pts = puntuar(a, ps);
    puntos.set(a, pts);
    return pts > 0;
  });
  const costo = (a: Articulo) => a.costoUnit ?? (orden === 'menor' ? Infinity : -Infinity);
  const porNombre = (x: Articulo, y: Articulo) => x.articulo.localeCompare(y.articulo) || x.artId.localeCompare(y.artId);
  return lista.sort((x, y) => {
    if (orden === 'menor') return costo(x) - costo(y) || porNombre(x, y);
    if (orden === 'mayor') return costo(y) - costo(x) || porNombre(x, y);
    if (orden === 'relevancia') return (puntos.get(y) ?? 0) - (puntos.get(x) ?? 0) || porNombre(x, y);
    return porNombre(x, y);
  });
}

export type Sugerencias = { marcas: Conteo[]; proveedores: Conteo[]; articulos: Articulo[] };

/** Sugerencias mientras se escribe: marcas, proveedores y artículos que coinciden. */
export function sugerir(arts: Articulo[], consulta: string, n = { marcas: 3, proveedores: 3, articulos: 6 }): Sugerencias {
  const ps = palabras(consulta);
  if (!ps.length) return { marcas: [], proveedores: [], articulos: [] };
  const coincide = (texto: string) => ps.every((p) => variantes(p).some((v) => iniciaPalabra(sinAcentos(texto), v)));
  return {
    marcas: contar(arts.filter((a) => coincide(a.marca)), (a) => a.marca).slice(0, n.marcas),
    proveedores: contar(arts.filter((a) => coincide(a.provCorto)), (a) => a.cve, (a) => a.provCorto).slice(0, n.proveedores),
    articulos: filtrarArticulos(arts, { texto: consulta }).slice(0, n.articulos),
  };
}

export type RegionEncontrada = {
  /** Sigla de la región, o 'NAL' para la cobertura nacional. */
  sig: string;
  /** Estado o unidad operativa que coincidió, si la búsqueda no fue por la sigla o el nombre de la región. */
  por: string | null;
};

/** Regiones que coinciden con la búsqueda por sigla, nombre, clave, estado o unidad operativa. */
export function buscarRegiones(consulta: string): RegionEncontrada[] {
  const ps = palabras(consulta);
  if (!ps.length) return [];
  const salida: (RegionEncontrada & { pts: number })[] = [];
  if (ps.every((p) => 'nacional nal todo el pais'.includes(p))) salida.push({ sig: 'NAL', por: null, pts: 3 });
  for (const sig of SIGLAS) {
    const r = REGIONES[sig];
    const lugares = [...new Set([...r.estados, ...r.unidades])];
    if (!ps.every((p) => sinAcentos([sig, r.nombre, r.clave, ...lugares].join(' | ')).includes(p))) continue;
    const propio = sinAcentos(`${sig} ${r.nombre} ${r.clave}`);
    const enNombre = ps.every((p) => propio.includes(p));
    const por = enNombre ? null : lugares.find((l) => ps.every((p) => sinAcentos(l).includes(p))) ?? null;
    salida.push({ sig, por, pts: enNombre ? (propio.startsWith(ps[0]) ? 3 : 2) : 1 });
  }
  return salida.sort((x, y) => y.pts - x.pts).map(({ sig, por }) => ({ sig, por }));
}

/** Parte un texto en tramos resaltados donde aparece alguna de las palabras buscadas. */
export function resaltar(texto: string, ps: string[]): { t: string; on: boolean }[] {
  if (!ps.length) return [{ t: texto, on: false }];
  const base = sinAcentos(texto);   // misma longitud que el texto: cada letra con acento se cambia por una sola letra
  const marca = new Array<boolean>(texto.length).fill(false);
  for (const p of ps) {
    for (const v of variantes(p)) {
      let i = base.indexOf(v);
      while (i >= 0) {
        marca.fill(true, i, i + v.length);
        i = base.indexOf(v, i + v.length);
      }
    }
  }
  const tramos: { t: string; on: boolean }[] = [];
  for (let i = 0; i < texto.length; i++) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.on === marca[i]) ultimo.t += texto[i];
    else tramos.push({ t: texto[i], on: marca[i] });
  }
  return tramos;
}
