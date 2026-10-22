import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icono, s as ui, type ICONOS } from '@/components/abasto/ui';
import { Spacing } from '@/constants/theme';
import { useTema, type Tema } from '@/data/tema';
import { useTheme } from '@/hooks/use-theme';

const OPCIONES: { tema: Tema; texto: string; detalle: string; icono: keyof typeof ICONOS }[] = [
  { tema: 'auto', texto: 'Automático', detalle: 'Igual que el teléfono', icono: 'temaAuto' },
  { tema: 'claro', texto: 'Claro', detalle: 'Fondo blanco', icono: 'temaClaro' },
  { tema: 'oscuro', texto: 'Oscuro', detalle: 'Fondo oscuro, descansa la vista', icono: 'temaOscuro' },
];

/** Botón del encabezado (va sobre el guinda) que abre la elección de apariencia: automático, claro u oscuro. */
export function SelectorTema() {
  const t = useTheme();
  const { tema, setTema } = useTema();
  const [abierto, setAbierto] = useState(false);
  const actual = OPCIONES.find((o) => o.tema === tema) ?? OPCIONES[0];

  return (
    <>
      <Pressable onPress={() => setAbierto(true)} hitSlop={8} accessibilityRole="button"
        accessibilityLabel={`Apariencia: ${actual.texto}. Cambiar`}
        style={({ pressed }) => [styles.boton, pressed && ui.presionado]}>
        <Icono nombre={actual.icono} color="#ffffff" tam={20} />
      </Pressable>

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={styles.fondo} onPress={() => setAbierto(false)} accessibilityLabel="Cerrar">
          {/* Pressable vacío: los toques dentro de la tarjeta no la cierran */}
          <Pressable style={[styles.tarjeta, { backgroundColor: t.backgroundElement }]} onPress={() => undefined}>
            <Text style={[styles.titulo, { color: t.muted }]}>APARIENCIA</Text>
            {OPCIONES.map((o, i) => {
              const activa = o.tema === tema;
              return (
                <Pressable key={o.tema} accessibilityRole="radio" accessibilityState={{ checked: activa }}
                  onPress={() => { setTema(o.tema); setAbierto(false); }}
                  style={({ pressed }) => [styles.opcion, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth },
                    pressed && { backgroundColor: t.backgroundSelected }]}>
                  <View style={[styles.icono, { backgroundColor: activa ? t.accentSoft : t.backgroundSelected }]}>
                    <Icono nombre={o.icono} color={activa ? t.accent : t.textSecondary} tam={20} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.texto, { color: t.text }]}>{o.texto}</Text>
                    <Text style={[styles.detalle, { color: t.textSecondary }]} numberOfLines={1}>{o.detalle}</Text>
                  </View>
                  {activa ? <Icono nombre="ok" color={t.accent} tam={20} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  boton: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  tarjeta: { width: '100%', maxWidth: 380, borderRadius: 16, overflow: 'hidden', paddingTop: Spacing.three },
  titulo: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12 },
  icono: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  texto: { fontSize: 16, fontWeight: '600' },
  detalle: { fontSize: 13, marginTop: 1 },
});
