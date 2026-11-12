/**
 * Novedades del catálogo: cada vez que se descarga el Excel se compara con la copia anterior guardada en el
 * teléfono. Si algo cambió (artículos nuevos o dados de baja, precios, hojas de negociación) se guarda el
 * resumen; se sigue mostrando hasta que el Excel vuelva a cambiar.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Articulo } from '@/data/abasto';

const CLAVE = 'abasto-novedades:v1';
/** Cuántos de cada cosa se guardan para la lista (las cuentas sí son completas). */
const MAX_LISTA = 300;

export type ArticuloNovedad = { artId: string; articulo: string; marca: string; proveedor: string; negociacion: string };
export type CambioPrecio = ArticuloNovedad & { antes: number | null; despues: number | null };

export type Novedades = {
  /** Cuándo se detectaron los cambios (ISO). */
  detectado: string;
  /** Fecha de la descarga anterior, con la que se comparó (ISO). */
  anterior: string;
  nuevos: { total: number; lista: ArticuloNovedad[] };
  bajas: { total: number; lista: ArticuloNovedad[] };
  /** Artículos con otro costo unitario en la misma hoja de negociación. */
  precios: { total: number; lista: CambioPrecio[] };
  hojasNuevas: string[];
  hojasBaja: string[];
};

const corto = (a: Articulo): ArticuloNovedad => ({
  artId: a.artId, articulo: a.articulo, marca: a.marca, proveedor: a.provCorto, negociacion: a.negociacion,
});

/** Un renglón por artículo (el primero que aparece). */
function porArticulo(arts: Articulo[]) {
  const m = new Map<string, Articulo>();
  for (const a of arts) if (!m.has(a.artId)) m.set(a.artId, a);
  return m;
}

/** Compara dos versiones del catálogo; null si no cambió nada de lo que se sigue. */
export function comparar(antes: Articulo[], ahora: Articulo[], fechaAnterior: string, detectado = new Date().toISOString()): Novedades | null {
  const [a, b] = [porArticulo(antes), porArticulo(ahora)];
  const nuevos = [...b.values()].filter((x) => !a.has(x.artId));
  const bajas = [...a.values()].filter((x) => !b.has(x.artId));

  // El precio se compara en la misma hoja: un artículo puede estar en PAR y en Oferta con costos distintos
  const previo = new Map(antes.map((x) => [`${x.negociacion}|${x.artId}`, x.costoUnit]));
  const vistos = new Set<string>();
  const precios: CambioPrecio[] = [];
  for (const x of ahora) {
    const k = `${x.negociacion}|${x.artId}`;
    if (!previo.has(k) || vistos.has(k)) continue;
    vistos.add(k);
    const p = previo.get(k) ?? null;
    if (p === x.costoUnit || (p !== null && x.costoUnit !== null && Math.abs(p - x.costoUnit) < 0.005)) continue;
    precios.push({ ...corto(x), antes: p, despues: x.costoUnit });
  }

  const hojasA = new Set(antes.map((x) => x.negociacion).filter(Boolean));
  const hojasB = new Set(ahora.map((x) => x.negociacion).filter(Boolean));
  const hojasNuevas = [...hojasB].filter((h) => !hojasA.has(h)).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const hojasBaja = [...hojasA].filter((h) => !hojasB.has(h)).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));

  if (!nuevos.length && !bajas.length && !precios.length && !hojasNuevas.length && !hojasBaja.length) return null;
  const orden = (x: ArticuloNovedad, y: ArticuloNovedad) => x.articulo.localeCompare(y.articulo);
  return {
    detectado,
    anterior: fechaAnterior,
    nuevos: { total: nuevos.length, lista: nuevos.map(corto).sort(orden).slice(0, MAX_LISTA) },
    bajas: { total: bajas.length, lista: bajas.map(corto).sort(orden).slice(0, MAX_LISTA) },
    precios: { total: new Set(precios.map((p) => p.artId)).size, lista: precios.sort(orden).slice(0, MAX_LISTA) },
    hojasNuevas,
    hojasBaja,
  };
}

/** Compara la descarga nueva con la anterior y, si hubo cambios, los guarda. */
export async function registrarCambios(antes: Articulo[], ahora: Articulo[], fechaAnterior: string) {
  const n = comparar(antes, ahora, fechaAnterior);
  if (n) await AsyncStorage.setItem(CLAVE, JSON.stringify(n)).catch(() => undefined);
}

export async function leerNovedades(): Promise<Novedades | null> {
  try {
    const texto = await AsyncStorage.getItem(CLAVE);
    return texto ? (JSON.parse(texto) as Novedades) : null;
  } catch {
    return null;
  }
}
