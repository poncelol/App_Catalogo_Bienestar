import { router } from 'expo-router';
import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { BarraBusqueda, EncabezadoBusqueda } from '@/components/abasto/busqueda';
import { Foto, Vacio } from '@/components/abasto/catalogo';
import { EstadoDatos, Icono, s as ui } from '@/components/abasto/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { entero, sinAcentos, type Alcance, type Articulo } from '@/data/abasto';
import { useAbasto } from '@/data/abasto-context';
import { palabras } from '@/data/busqueda';
import { imagenProveedor } from '@/data/imagenes';
import { useTheme } from '@/hooks/use-theme';

type Proveedor = {
  cve: string;
  nombre: string;
  razonSocial: string;
  articulos: number;
  productos: number;
  marcas: number;
  alcances: Alcance[];
  busqueda: string;
  logo: string | null;
};

function agrupar(arts: Articulo[]): Proveedor[] {
  const grupos = new Map<string, Articulo[]>();
  for (const a of arts) (grupos.get(a.cve) ?? grupos.set(a.cve, []).get(a.cve)!).push(a);
  return [...grupos]
    .map(([cve, g]) => ({
      cve,
      nombre: g[0].provCorto,
      razonSocial: g[0].proveedor,
      articulos: new Set(g.map((a) => a.artId)).size,
      productos: new Set(g.map((a) => a.prod)).size,
      marcas: new Set(g.map((a) => a.marca)).size,
      alcances: (['Nacional', 'Regional'] as const).filter((x) => g.some((a) => a.alcance === x)),
      busqueda: sinAcentos(`${g[0].proveedor} ${cve}`),
      logo: imagenProveedor(cve),
    }))
    .sort((x, y) => y.articulos - x.articulos || x.nombre.localeCompare(y.nombre));
}

export default function Proveedores() {
  const t = useTheme();
  const { datos, cargando, actualizar, setFiltrosArticulos } = useAbasto();
  const [texto, setTexto] = useState('');
  const consulta = useDeferredValue(texto);
  const todos = useMemo(() => agrupar(datos?.articulos ?? []), [datos]);
  // Todas las palabras deben aparecer; primero los que empiezan con lo buscado
  const lista = useMemo(() => {
    const ps = palabras(consulta);
    return ps.length
      ? todos
          .filter((p) => ps.every((w) => p.busqueda.includes(w)))
          .sort((x, y) => Number(y.busqueda.startsWith(ps[0])) - Number(x.busqueda.startsWith(ps[0])))
      : todos;
  }, [todos, consulta]);

  const abrir = useCallback((p: Proveedor) => {
    setFiltrosArticulos({ proveedor: p.cve });
    router.navigate('/articulos');
  }, [setFiltrosArticulos]);

  return (
    <View style={[styles.fondo, { backgroundColor: t.background }]}>
      <EncabezadoBusqueda titulo="Proveedores">
        <BarraBusqueda valor={texto} onCambiar={setTexto} placeholder="Buscar proveedor o CVE" />
      </EncabezadoBusqueda>

      <FlatList
        data={lista}
        keyExtractor={(p) => p.cve}
        contentContainerStyle={styles.lista}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View style={{ gap: Spacing.two }}>
            <Text style={[styles.cuenta, { color: t.textSecondary }]}>
              <Text style={{ fontWeight: '700', color: t.text }}>{entero(lista.length)}</Text> proveedores · toca uno para ver su catálogo
            </Text>
            <EstadoDatos />
          </View>
        }
        ListEmptyComponent={
          datos ? <Vacio titulo="No encontramos proveedores" texto={`Nada coincide con «${texto.trim()}».`} accion="Quitar búsqueda" onAccion={() => setTexto('')} /> : undefined
        }
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={actualizar} tintColor={t.accent} colors={[t.accent]} />}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        renderItem={({ item: p }) => <FilaProveedor p={p} onPress={abrir} />}
      />
    </View>
  );
}

/** Renglón de proveedor. memo + onPress(p): al buscar solo se vuelven a dibujar los renglones que cambian. */
const FilaProveedor = memo(function FilaProveedor({ p, onPress }: { p: Proveedor; onPress: (p: Proveedor) => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onPress(p)} style={({ pressed }) => [styles.fila, { backgroundColor: t.backgroundElement }, pressed && ui.presionado]}>
      {p.logo ? (
        <Foto uri={p.logo} clave={p.cve} icono="proveedor" tamIcono={20} style={styles.logo} />
      ) : (
        <View style={[styles.ico, { backgroundColor: t.accentSoft }]}>
          <Icono nombre="proveedor" color={t.accent} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.nombre, { color: t.text }]} numberOfLines={2}>{p.nombre}</Text>
        <Text style={[styles.detalle, { color: t.muted }]} numberOfLines={1}>CVE {p.cve} · {p.razonSocial}</Text>
        <View style={styles.datos}>
          <Dato n={p.articulos} texto="artículos" />
          <Dato n={p.productos} texto="productos" />
          <Dato n={p.marcas} texto="marcas" />
        </View>
        <View style={styles.datos}>
          {p.alcances.map((x) => (
            <Text key={x} style={[styles.etiqueta, { color: x === 'Nacional' ? t.green : t.gold, borderColor: x === 'Nacional' ? t.green : t.gold }]}>
              {x}
            </Text>
          ))}
        </View>
      </View>
      <Icono nombre="flecha" color={t.muted} />
    </Pressable>
  );
});

function Dato({ n, texto }: { n: number; texto: string }) {
  const t = useTheme();
  return (
    <Text style={[styles.detalle, { color: t.textSecondary }]}>
      <Text style={{ fontWeight: '700', color: t.text }}>{entero(n)}</Text> {texto}
    </Text>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1 },
  controles: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  buscar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  cuenta: { fontSize: 13 },
  lista: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 12, padding: Spacing.three },
  ico: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 48, height: 48, aspectRatio: undefined, borderRadius: 10 },
  nombre: { fontSize: 15, fontWeight: '600' },
  detalle: { fontSize: 12 },
  datos: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  etiqueta: { fontSize: 10, fontWeight: '700', borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
});
