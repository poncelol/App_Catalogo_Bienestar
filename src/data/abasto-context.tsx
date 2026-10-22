import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { descargar, leerCopia, type Datos } from '@/data/abasto';
import type { FiltrosCatalogo } from '@/data/busqueda';
import { cargarImagenesGuardadas, conImagenes, descargarImagenes, precargar } from '@/data/imagenes';

/** Al volver a la app después de este tiempo se descargan de nuevo el catálogo y las imágenes. */
const MINUTOS_PARA_ACTUALIZAR = 5;

/** Filtros de la pestaña Artículos. Inicio y Proveedores los fijan para abrirla ya filtrada. */
export type FiltrosArticulos = FiltrosCatalogo;

/** Sigla de región, o NAL para los artículos con cobertura nacional. */
export const NAL = 'NAL';

type Estado = {
  datos: Datos | null;
  cargando: boolean;
  error: string | null;
  actualizar: () => Promise<void>;
  // Cada pestaña guarda su propio estado: Artículos y Productos no dependen una de la otra
  filtrosArticulos: FiltrosArticulos;
  setFiltrosArticulos: (f: FiltrosArticulos) => void;
  /** Cambia cada vez que otra pantalla pide abrir el buscador de Artículos con el teclado listo. */
  pedidoBusqueda: number;
  pedirBusqueda: () => void;
  /** PROD. del producto cuya ficha está abierta en la pestaña Productos. */
  productoAbierto: string | null;
  setProductoAbierto: (prod: string | null) => void;
  /** Región elegida en la pestaña Regiones (sigla o NAL). */
  region: string | null;
  setRegion: (r: string | null) => void;
};

const Contexto = createContext<Estado | null>(null);

/** Las fotos del Excel interno se aplican al cargar, así también llegan a la copia guardada en el teléfono. */
const fotos = (d: Datos): Datos => {
  const articulos = conImagenes(d.articulos);
  precargar(articulos);
  return { ...d, articulos };
};

function motivo(e: unknown) {
  if (e instanceof TypeError) {
    // fetch solo lanza TypeError cuando no hubo respuesta (sin red, o en web el servidor de la app no responde)
    return Platform.OS === 'web' ? 'Sin conexión con el servidor de la app.' : 'Sin conexión con SharePoint.';
  }
  return e instanceof Error ? e.message : String(e);
}

export function AbastoProvider({ children }: { children: ReactNode }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtrosArticulos, setFiltrosArticulos] = useState<FiltrosArticulos>({});
  const [productoAbierto, setProductoAbierto] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [pedidoBusqueda, setPedidoBusqueda] = useState(0);
  const pedirBusqueda = useCallback(() => setPedidoBusqueda((n) => n + 1), []);

  // Datos tal como vienen del catálogo; las fotos se aplican encima para poder cambiarlas sin volver a descargar
  const crudos = useRef<Datos | null>(null);
  const ultima = useRef(0);
  const mostrar = useCallback((d: Datos) => {
    crudos.current = d;
    setDatos(fotos(d));
  }, []);
  const refrescarFotos = useCallback(() => {
    if (crudos.current) setDatos(fotos(crudos.current));
  }, []);

  /** Descarga a la vez el catálogo y el Excel de imágenes de OneDrive. */
  const bajar = useCallback(async () => {
    ultima.current = Date.now();
    const [catalogo, imagenes] = await Promise.allSettled([descargar(), descargarImagenes()]);
    if (imagenes.status === 'fulfilled' && imagenes.value) refrescarFotos();
    if (catalogo.status === 'fulfilled') {
      mostrar(catalogo.value);
      setError(null);
    } else {
      setError(motivo(catalogo.reason));
    }
    setCargando(false);
  }, [mostrar, refrescarFotos]);

  const actualizar = useCallback(async () => {
    setCargando(true);
    await bajar();
  }, [bajar]);

  useEffect(() => {
    // Primero las copias guardadas (se ven al instante y sirven sin red); luego las versiones de OneDrive
    let vivo = true;
    Promise.all([leerCopia(), cargarImagenesGuardadas()]).then(([copia]) => {
      if (vivo && copia && !crudos.current) mostrar(copia);
      else if (vivo) refrescarFotos();
    });
    // En la siguiente vuelta del ciclo de eventos, para no cambiar el estado dentro del efecto
    void Promise.resolve().then(bajar);
    // Al volver a la app después de un rato, se vuelve a descargar todo
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && Date.now() - ultima.current > MINUTOS_PARA_ACTUALIZAR * 60000) {
        setCargando(true);
        bajar();
      }
    });
    return () => {
      vivo = false;
      sub.remove();
    };
  }, [bajar, mostrar, refrescarFotos]);

  return (
    <Contexto.Provider
      value={{
        datos, cargando, error, actualizar,
        filtrosArticulos, setFiltrosArticulos, pedidoBusqueda, pedirBusqueda, productoAbierto, setProductoAbierto, region, setRegion,
      }}>
      {children}
    </Contexto.Provider>
  );
}

export function useAbasto() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useAbasto debe usarse dentro de AbastoProvider');
  return ctx;
}
