import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, Icono, s as ui } from '@/components/abasto/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { contar, entero, nArt, sinAcentos, type Articulo, type Conteo } from '@/data/abasto';
import { filtrarArticulos, type FiltrosCatalogo, type Orden } from '@/data/busqueda';
import { useTheme } from '@/hooks/use-theme';

const ORDENES: { valor: Orden; texto: string }[] = [
  { valor: 'relevancia', texto: 'Relevancia' },
  { valor: 'nombre', texto: 'Nombre A–Z' },
  { valor: 'menor', texto: 'Menor costo' },
  { valor: 'mayor', texto: 'Mayor costo' },
];

type Props = {
  articulos: Articulo[];
  filtros: FiltrosCatalogo;
  onAplicar: (f: FiltrosCatalogo) => void;
  onClose: () => void;
};

/** Hoja de filtros y orden. Los cambios se aplican al tocar «Ver N artículos». Montar con `key` al abrirla. */
export function FiltrosHoja({ articulos, filtros, onAplicar, onClose }: Props) {
  const t = useTheme();
  const [b, setB] = useState<FiltrosCatalogo>(filtros);
  const cambiar = (c: Partial<FiltrosCatalogo>) => setB({ ...b, ...c });

  // Opciones de cada filtro según lo que se buscó (no según los otros filtros, para poder cambiarlos libremente)
  const facetas = useMemo(() => {
    const base = filtrarArticulos(articulos, { texto: b.texto });
    return {
      inventario: contar(base, (a) => a.inventario),
      marcas: contar(base, (a) => a.marca),
      proveedores: contar(base, (a) => a.cve, (a) => a.provCorto),
    };
  }, [articulos, b.texto]);
  const resultado = useMemo(() => nArt(filtrarArticulos(articulos, b)), [articulos, b]);
  const ordenActual = b.orden ?? (b.texto?.trim() ? 'relevancia' : 'nombre');

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.hoja, { backgroundColor: t.background }]} edges={['top', 'bottom']}>
        <View style={[styles.cabeza, { borderBottomColor: t.border }]}>
          <Pressable onPress={onClose} hitSlop={10}><Text style={[styles.accion, { color: t.textSecondary }]}>Cerrar</Text></Pressable>
          <Text style={[styles.titulo, { color: t.text }]}>Filtros</Text>
          <Pressable onPress={() => setB({ texto: b.texto })} hitSlop={10}>
            <Text style={[styles.accion, { color: t.accent }]}>Limpiar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.cuerpo} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Bloque titulo="Ordenar por">
            <View style={styles.chips}>
              {ORDENES.filter((o) => o.valor !== 'relevancia' || b.texto?.trim()).map((o) => (
                <Chip key={o.valor} texto={o.texto} activo={ordenActual === o.valor} onPress={() => cambiar({ orden: o.valor })} />
              ))}
            </View>
          </Bloque>

          <Bloque titulo="Tipo de inventario">
            <View style={styles.chips}>
              <Chip texto="Todos" activo={!b.inventario} onPress={() => cambiar({ inventario: undefined })} />
              {facetas.inventario.map((c) => (
                <Chip key={c.clave} texto={`${c.etiqueta} · ${entero(c.valor)}`} activo={b.inventario === c.clave}
                  onPress={() => cambiar({ inventario: b.inventario === c.clave ? undefined : c.clave })} />
              ))}
            </View>
          </Bloque>

          <Lista titulo="Marca" opciones={facetas.marcas} elegido={b.marca} placeholder="Buscar marca…"
            onElegir={(m) => cambiar({ marca: m })} />
          <Lista titulo="Proveedor" opciones={facetas.proveedores} elegido={b.proveedor} placeholder="Buscar proveedor…"
            onElegir={(p) => cambiar({ proveedor: p })} />
        </ScrollView>

        <View style={[styles.pie, { borderTopColor: t.border, backgroundColor: t.background }]}>
          <Pressable onPress={() => onAplicar(b)} disabled={!resultado}
            style={({ pressed }) => [styles.boton, { backgroundColor: resultado ? t.accent : t.muted }, pressed && ui.presionado]}>
            <Text style={styles.botonTexto}>{resultado ? `Ver ${entero(resultado)} artículos` : 'Sin artículos con estos filtros'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: Spacing.two }}>
      <Text style={[styles.bloqueTitulo, { color: t.text }]}>{titulo}</Text>
      {children}
    </View>
  );
}

/** Lista de opciones con buscador propio; muestra 6 y se puede ampliar. Un toque elige, otro quita. */
function Lista({ titulo, opciones, elegido, placeholder, onElegir }: {
  titulo: string;
  opciones: Conteo[];
  elegido?: string;
  placeholder: string;
  onElegir: (clave: string | undefined) => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [todas, setTodas] = useState(false);
  const qn = sinAcentos(q.trim());
  const filtradas = qn ? opciones.filter((o) => sinAcentos(o.etiqueta).includes(qn)) : opciones;
  // La opción elegida siempre a la vista, aunque no esté entre las primeras
  const visibles = todas || qn ? filtradas : filtradas.slice(0, 6);
  const sel = opciones.find((o) => o.clave === elegido);
  const lista = sel && !visibles.includes(sel) ? [sel, ...visibles] : visibles;
  return (
    <Bloque titulo={`${titulo}${sel ? ` · ${sel.etiqueta}` : ''}`}>
      {opciones.length > 6 ? (
        <View style={[styles.buscar, { backgroundColor: t.backgroundElement, borderColor: t.border }]}>
          <Icono nombre="buscar" color={t.muted} tam={15} />
          <TextInput value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={t.muted}
            style={[styles.input, { color: t.text }]} autoCorrect={false} />
        </View>
      ) : null}
      <View style={[styles.opciones, { backgroundColor: t.backgroundElement }]}>
        {lista.map((o, i) => {
          const activo = o.clave === elegido;
          return (
            <Pressable key={o.clave} onPress={() => onElegir(activo ? undefined : o.clave)}
              style={({ pressed }) => [styles.opcion, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && ui.presionado]}>
              <View style={[styles.radio, { borderColor: activo ? t.accent : t.border }]}>
                {activo ? <View style={[styles.radioPunto, { backgroundColor: t.accent }]} /> : null}
              </View>
              <Text style={[styles.opcionTexto, { color: activo ? t.accent : t.text }]} numberOfLines={1}>{o.etiqueta}</Text>
              <Text style={[styles.opcionN, { color: t.muted }]}>{entero(o.valor)}</Text>
            </Pressable>
          );
        })}
        {!lista.length ? <Text style={[styles.opcionN, { color: t.muted, padding: Spacing.three }]}>Sin coincidencias.</Text> : null}
      </View>
      {!qn && filtradas.length > 6 ? (
        <Pressable onPress={() => setTodas(!todas)} hitSlop={8}>
          <Text style={[styles.mas, { color: t.accent }]}>{todas ? 'Ver menos' : `Ver las ${entero(filtradas.length)}`}</Text>
        </Pressable>
      ) : null}
    </Bloque>
  );
}

const styles = StyleSheet.create({
  hoja: { flex: 1 },
  cabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  titulo: { fontSize: 17, fontWeight: '700' },
  accion: { fontSize: 16 },
  cuerpo: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  bloqueTitulo: { fontSize: 15, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  buscar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10 },
  input: { flex: 1, fontSize: 15, paddingVertical: 8 },
  opciones: { borderRadius: 12, overflow: 'hidden' },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioPunto: { width: 10, height: 10, borderRadius: 5 },
  opcionTexto: { flex: 1, fontSize: 15 },
  opcionN: { fontSize: 13 },
  mas: { fontSize: 14, fontWeight: '600' },
  pie: { padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  boton: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  botonTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
