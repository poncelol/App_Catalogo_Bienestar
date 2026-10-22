import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, RefreshControl, StyleSheet, Text, View, type TextInput } from 'react-native';

import { ArticuloDetalle } from '@/components/abasto/articulo-detalle';
import { BarraBusqueda, EncabezadoBusqueda, PanelSugerencias, useRecientes } from '@/components/abasto/busqueda';
import { Esqueleto, FilaArticulo, TarjetaArticulo, useRejilla, Vacio } from '@/components/abasto/catalogo';
import { FiltrosHoja } from '@/components/abasto/filtros-hoja';
import { EstadoDatos, Icono, s as ui } from '@/components/abasto/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { entero, nArt, type Articulo } from '@/data/abasto';
import { useAbasto, type FiltrosArticulos } from '@/data/abasto-context';
import { filtrarArticulos, sugerir } from '@/data/busqueda';
import { useTheme } from '@/hooks/use-theme';

const ORDEN_LABEL = { relevancia: 'Relevancia', nombre: 'A–Z', menor: 'Menor costo', mayor: 'Mayor costo' } as const;

export default function Articulos() {
  const t = useTheme();
  const { datos, cargando, actualizar, filtrosArticulos: f, setFiltrosArticulos: setFiltros, pedidoBusqueda } = useAbasto();
  const { columnas, ancho, espacio } = useRejilla();
  const { recientes, agregar, borrar } = useRecientes();
  const input = useRef<TextInput>(null);
  const [sel, setSel] = useState<Articulo | null>(null);
  const [vista, setVista] = useState<'cuadricula' | 'lista'>('cuadricula');
  const [hoja, setHoja] = useState(0);   // > 0: hoja de filtros abierta (la clave la reinicia en cada apertura)
  const [enfocado, setEnfocado] = useState(false);
  const [borrador, setBorrador] = useState('');
  const consulta = useDeferredValue(borrador);
  const arts = useMemo(() => datos?.articulos ?? [], [datos]);

  // Inicio pide abrir el buscador: se enfoca la caja y aparece el teclado
  useEffect(() => {
    if (pedidoBusqueda) input.current?.focus();
  }, [pedidoBusqueda]);

  const lista = useMemo(() => filtrarArticulos(arts, f), [arts, f]);
  const sugerencias = useMemo(() => sugerir(arts, enfocado ? consulta : ''), [arts, consulta, enfocado]);
  const proveedores = useMemo(() => new Map(arts.map((a) => [a.cve, a.provCorto])), [arts]);

  const salir = () => {
    setEnfocado(false);
    Keyboard.dismiss();
  };
  const buscar = (q: string, extra: Partial<FiltrosArticulos> = {}) => {
    agregar(q);
    setFiltros({ ...f, texto: q.trim() || undefined, orden: undefined, ...extra });
    salir();
  };
  const cambiar = (c: Partial<FiltrosArticulos>) => setFiltros({ ...f, ...c });

  const activos: { texto: string; quitar: Partial<FiltrosArticulos> }[] = [
    f.texto ? { texto: `«${f.texto}»`, quitar: { texto: undefined, orden: undefined } } : null,
    f.inventario ? { texto: f.inventario, quitar: { inventario: undefined } } : null,
    f.marca ? { texto: f.marca, quitar: { marca: undefined } } : null,
    f.proveedor ? { texto: proveedores.get(f.proveedor) ?? f.proveedor, quitar: { proveedor: undefined } } : null,
  ].filter((x) => x !== null);
  const nFiltros = [f.inventario, f.marca, f.proveedor].filter(Boolean).length;
  const orden = f.orden ?? (f.texto ? 'relevancia' : 'nombre');

  const encabezadoLista = (
    <View style={styles.encabezadoLista}>
      <View style={styles.barraResultados}>
        <Text style={[styles.cuenta, { color: t.textSecondary }]}>
          <Text style={{ fontWeight: '700', color: t.text }}>{entero(nArt(lista))}</Text> artículos · {ORDEN_LABEL[orden]}
        </Text>
        <Pressable onPress={() => setHoja((n) => n + 1)} hitSlop={6}
          style={({ pressed }) => [styles.botonFiltros, { borderColor: nFiltros ? t.accent : t.border, backgroundColor: t.backgroundElement }, pressed && ui.presionado]}>
          <Icono nombre="filtros" color={nFiltros ? t.accent : t.textSecondary} tam={16} />
          <Text style={[styles.botonFiltrosTexto, { color: nFiltros ? t.accent : t.textSecondary }]}>
            Filtros{nFiltros ? ` (${nFiltros})` : ''}
          </Text>
        </Pressable>
      </View>
      {activos.length ? (
        <View style={styles.activos}>
          {activos.map((q) => (
            <Pressable key={q.texto} onPress={() => cambiar(q.quitar)}
              style={({ pressed }) => [styles.activo, { backgroundColor: t.accentSoft }, pressed && ui.presionado]}>
              <Text style={[styles.activoTexto, { color: t.accent }]} numberOfLines={1}>{q.texto}</Text>
              <Icono nombre="cerrar" color={t.accent} tam={11} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <EstadoDatos />
    </View>
  );

  return (
    <View style={[styles.fondo, { backgroundColor: t.background }]}>
      <EncabezadoBusqueda
        titulo="Artículos"
        derecha={
          enfocado ? null : (
            <Pressable onPress={() => setVista(vista === 'cuadricula' ? 'lista' : 'cuadricula')} hitSlop={10}
              accessibilityLabel={vista === 'cuadricula' ? 'Ver como lista' : 'Ver como cuadrícula'}>
              <Icono nombre={vista === 'cuadricula' ? 'lista' : 'cuadricula'} color="#ffffff" tam={22} />
            </Pressable>
          )
        }>
        <BarraBusqueda
          inputRef={input}
          valor={enfocado ? borrador : (f.texto ?? '')}
          onCambiar={(v) => (enfocado ? setBorrador(v) : cambiar({ texto: v || undefined, orden: undefined }))}
          onFoco={() => {
            setBorrador(f.texto ?? '');
            setEnfocado(true);
          }}
          onEnviar={() => buscar(borrador)}
          placeholder="Buscar en el catálogo"
          activo={enfocado}
          onCancelar={salir}
        />
      </EncabezadoBusqueda>

      {enfocado ? (
        <PanelSugerencias
          consulta={borrador}
          sugerencias={sugerencias}
          recientes={recientes}
          onBorrarRecientes={borrar}
          onTexto={(q) => buscar(q)}
          onCompletar={(q) => {
            setBorrador(q);
            input.current?.focus();
          }}
          onMarca={(m) => buscar('', { marca: m })}
          onProveedor={(cve) => buscar('', { proveedor: cve })}
          onArticulo={(a) => {
            agregar(borrador);
            salir();
            setSel(a);
          }}
        />
      ) : (
        <FlatList
          key={vista === 'lista' ? 'lista' : `rejilla-${columnas}`}
          data={lista}
          numColumns={vista === 'lista' ? 1 : columnas}
          keyExtractor={(a, i) => `${a.negociacion}-${a.artId}-${i}`}
          contentContainerStyle={[styles.lista, { gap: vista === 'lista' ? Spacing.two : espacio }]}
          columnWrapperStyle={vista === 'lista' ? undefined : { gap: espacio }}
          ListHeaderComponent={encabezadoLista}
          // Pocas tarjetas por tanda: con fotos, dibujar muchas a la vez es lo que hacía lenta la lista
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          updateCellsBatchingPeriod={40}
          windowSize={7}
          removeClippedSubviews
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={cargando} onRefresh={actualizar} tintColor={t.accent} colors={[t.accent]} />}
          ListEmptyComponent={
            datos ? (
              <Vacio titulo="No encontramos artículos"
                texto={f.texto ? `Nada coincide con «${f.texto}»${nFiltros ? ' y los filtros elegidos' : ''}.` : 'Prueba con otros filtros.'}
                accion="Quitar búsqueda y filtros" onAccion={() => setFiltros({})} />
            ) : (
              <Esqueleto ancho={ancho} columnas={columnas} />
            )
          }
          renderItem={({ item: a }) =>
            vista === 'lista'
              ? <FilaArticulo a={a} consulta={f.texto} onPress={setSel} />
              : <TarjetaArticulo a={a} ancho={ancho} consulta={f.texto} onPress={setSel} />
          }
        />
      )}

      {hoja ? (
        <FiltrosHoja key={hoja} articulos={arts} filtros={f} onClose={() => setHoja(0)}
          onAplicar={(nuevos) => {
            setFiltros(nuevos);
            setHoja(0);
          }} />
      ) : null}

      <ArticuloDetalle
        articulo={sel}
        onClose={() => setSel(null)}
        onVerProveedor={(a) => {
          setSel(null);
          setFiltros({ proveedor: a.cve });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1 },
  lista: { paddingHorizontal: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  encabezadoLista: { paddingTop: Spacing.three, gap: Spacing.two, marginBottom: Spacing.one },
  barraResultados: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  cuenta: { fontSize: 13, flexShrink: 1 },
  botonFiltros: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  botonFiltrosTexto: { fontSize: 13, fontWeight: '600' },
  activos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  activo: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%' },
  activoTexto: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
});
