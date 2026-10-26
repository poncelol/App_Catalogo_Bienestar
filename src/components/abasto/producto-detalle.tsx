import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArticuloDetalle } from '@/components/abasto/articulo-detalle';
import { RejillaArticulos, Seccion } from '@/components/abasto/catalogo';
import { IlustracionProducto } from '@/components/abasto/ilustracion-producto';
import { Chip, Icono, s as ui } from '@/components/abasto/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { contar, dinero, entero, nArt, type Articulo } from '@/data/abasto';
import { filtrarArticulos } from '@/data/busqueda';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  prod: string | null;
  articulos: Articulo[];
  onClose: () => void;
  onVerProveedor: (a: Articulo) => void;
};

/** Ficha de un producto del catálogo: rango de costos, proveedores, marcas y sus artículos en cuadrícula. */
export function ProductoDetalle({ prod, articulos, onClose, onVerProveedor }: Props) {
  const t = useTheme();
  const [sel, setSel] = useState<Articulo | null>(null);
  const [proveedor, setProveedor] = useState<string | null>(null);
  const [marca, setMarca] = useState<string | null>(null);

  const d = useMemo(() => {
    const arts = articulos.filter((a) => a.prod === prod);
    const costos = arts.map((a) => a.costoUnit).filter((c): c is number => c !== null);
    return {
      arts,
      nombre: arts[0]?.producto ?? '',
      proveedores: contar(arts, (a) => a.cve, (a) => a.provCorto),
      marcas: contar(arts, (a) => a.marca),
      min: costos.length ? Math.min(...costos) : null,
      max: costos.length ? Math.max(...costos) : null,
    };
  }, [articulos, prod]);

  if (!prod || !d.arts.length) return null;
  const lista = filtrarArticulos(d.arts, { proveedor: proveedor ?? undefined, marca: marca ?? undefined });
  const cerrar = () => {
    setProveedor(null);
    setMarca(null);
    onClose();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={cerrar}>
      <SafeAreaView style={[styles.hoja, { backgroundColor: t.background }]} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.cuerpo}>
          <View>
            <IlustracionProducto nombre={d.nombre} tamIcono={52} style={styles.foto} />
            <Pressable onPress={cerrar} hitSlop={12} accessibilityLabel="Cerrar"
              style={({ pressed }) => [styles.cerrar, { backgroundColor: t.backgroundElement }, pressed && ui.presionado]}>
              <Icono nombre="cerrar" color={t.text} tam={16} />
            </Pressable>
          </View>

          <View style={{ gap: 4 }}>
            <Text style={[styles.clave, { color: t.muted }]}>PROD. {prod}</Text>
            <Text style={[styles.nombre, { color: t.text }]}>{d.nombre}</Text>
            {d.min !== null ? (
              <Text style={[styles.rango, { color: t.accent }]}>
                {d.min === d.max ? dinero(d.min) : `${dinero(d.min)} – ${dinero(d.max)}`}
                <Text style={[styles.cu, { color: t.muted }]}>  costo unitario</Text>
              </Text>
            ) : null}
            <Text style={[styles.resumen, { color: t.textSecondary }]}>
              {entero(nArt(d.arts))} artículos · {entero(d.proveedores.length)} proveedores · {entero(d.marcas.length)} marcas
            </Text>
          </View>

          <Seccion titulo="Proveedores">
            <View style={styles.chips}>
              {d.proveedores.map((p) => (
                <Chip key={p.clave} texto={`${p.etiqueta} · ${entero(p.valor)}`} activo={proveedor === p.clave}
                  onPress={() => setProveedor(proveedor === p.clave ? null : p.clave)} />
              ))}
            </View>
          </Seccion>

          {d.marcas.length > 1 ? (
            <Seccion titulo="Marcas">
              <View style={styles.chips}>
                {d.marcas.map((m) => (
                  <Chip key={m.clave} texto={`${m.etiqueta} · ${entero(m.valor)}`} activo={marca === m.clave}
                    onPress={() => setMarca(marca === m.clave ? null : m.clave)} />
                ))}
              </View>
            </Seccion>
          ) : null}

          <Seccion titulo={`Artículos (${entero(nArt(lista))})`}>
            <RejillaArticulos key={`${proveedor}-${marca}`} articulos={lista} onPress={setSel} />
          </Seccion>
        </ScrollView>

        <ArticuloDetalle
          articulo={sel}
          onClose={() => setSel(null)}
          onVerProveedor={(a) => {
            setSel(null);
            cerrar();
            onVerProveedor(a);
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hoja: { flex: 1 },
  cuerpo: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  foto: { aspectRatio: undefined, height: 200, borderRadius: 16 },
  cerrar: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  clave: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  nombre: { fontSize: 24, fontWeight: '700' },
  rango: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  cu: { fontSize: 13, fontWeight: '400' },
  resumen: { fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
