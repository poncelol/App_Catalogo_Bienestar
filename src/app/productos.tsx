import { router } from 'expo-router';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BarraBusqueda, EncabezadoBusqueda } from '@/components/abasto/busqueda';
import { agruparProductos, Esqueleto, TarjetaProducto, useRejilla, Vacio, type ResumenProducto } from '@/components/abasto/catalogo';
import { ProductoDetalle } from '@/components/abasto/producto-detalle';
import { Chip, EstadoDatos } from '@/components/abasto/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { contar, entero, sinAcentos } from '@/data/abasto';
import { useAbasto } from '@/data/abasto-context';
import { palabras } from '@/data/busqueda';
import { useTheme } from '@/hooks/use-theme';

export default function Productos() {
  const t = useTheme();
  const { datos, cargando, actualizar, productoAbierto, setProductoAbierto, setFiltrosArticulos } = useAbasto();
  const { columnas, ancho, espacio } = useRejilla();
  // Filtros propios de esta pestaña (no se comparten con Artículos)
  const [texto, setTexto] = useState('');
  const abrir = useCallback((p: ResumenProducto) => setProductoAbierto(p.prod), [setProductoAbierto]);
  const [inventario, setInventario] = useState<string | null>(null);
  const consulta = useDeferredValue(texto);
  const arts = useMemo(() => datos?.articulos ?? [], [datos]);

  const todos = useMemo(() => agruparProductos(arts), [arts]);
  const tipos = useMemo(() => contar(arts, (a) => a.inventario), [arts]);
  // Por relevancia: primero los que empiezan con lo buscado, luego los que lo contienen en otra palabra.
  // En useMemo: si la lista se rehiciera en cada dibujo, la cuadrícula redibujaría todas sus tarjetas.
  const lista = useMemo(() => {
    const ps = palabras(consulta);
    return todos
      .map((p) => {
        const n = sinAcentos(`${p.nombre} ${p.prod}`);
        const pts = ps.reduce((s, w) => (s < 0 ? s : n.startsWith(w) ? s + 3 : n.includes(` ${w}`) ? s + 2 : n.includes(w) ? s + 1 : -1), 0);
        return { p, pts };
      })
      .filter(({ p, pts }) => pts >= 0 && (!inventario || p.inventarios.has(inventario)))
      .sort((x, y) => (ps.length ? y.pts - x.pts : 0))
      .map(({ p }) => p);
  }, [todos, consulta, inventario]);

  return (
    <View style={[styles.fondo, { backgroundColor: t.background }]}>
      <EncabezadoBusqueda titulo="Productos">
        <BarraBusqueda valor={texto} onCambiar={setTexto} placeholder="Buscar producto o clave PROD." />
      </EncabezadoBusqueda>

      <FlatList
        key={`rejilla-${columnas}`}
        data={lista}
        numColumns={columnas}
        keyExtractor={(p) => p.prod}
        contentContainerStyle={[styles.lista, { gap: espacio }]}
        columnWrapperStyle={{ gap: espacio }}
        initialNumToRender={12}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={actualizar} tintColor={t.accent} colors={[t.accent]} />}
        ListHeaderComponent={
          <View style={styles.encabezadoLista}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip texto="Todos" activo={!inventario} onPress={() => setInventario(null)} />
              {tipos.map((c) => (
                <Chip key={c.clave} texto={c.etiqueta} activo={inventario === c.clave}
                  onPress={() => setInventario(inventario === c.clave ? null : c.clave)} />
              ))}
            </ScrollView>
            <Text style={[styles.cuenta, { color: t.textSecondary }]}>
              <Text style={{ fontWeight: '700', color: t.text }}>{entero(lista.length)}</Text> productos
            </Text>
            <EstadoDatos />
          </View>
        }
        ListEmptyComponent={
          datos ? (
            <Vacio titulo="No encontramos productos" texto={texto ? `Nada coincide con «${texto.trim()}».` : undefined}
              accion="Quitar búsqueda" onAccion={() => {
                setTexto('');
                setInventario(null);
              }} />
          ) : (
            <Esqueleto ancho={ancho} columnas={columnas} />
          )
        }
        renderItem={({ item: p }) => <TarjetaProducto p={p} ancho={ancho} onPress={abrir} />}
      />

      <ProductoDetalle
        prod={productoAbierto}
        articulos={arts}
        onClose={() => setProductoAbierto(null)}
        onVerProveedor={(a) => {
          setFiltrosArticulos({ proveedor: a.cve });
          router.navigate('/articulos');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1 },
  lista: { paddingHorizontal: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  encabezadoLista: { paddingTop: Spacing.three, gap: Spacing.two, marginBottom: Spacing.one },
  chips: { gap: 6, paddingRight: Spacing.three },
  cuenta: { fontSize: 13 },
});
