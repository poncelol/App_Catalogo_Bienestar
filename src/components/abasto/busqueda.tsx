import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState, type ReactNode, type Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Foto, Resaltado } from '@/components/abasto/catalogo';
import { Icono, s as ui, type ICONOS } from '@/components/abasto/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { dinero, entero, type Articulo } from '@/data/abasto';
import type { Sugerencias } from '@/data/busqueda';
import { useTheme } from '@/hooks/use-theme';

/** Encabezado guinda compacto con el título y, debajo, el buscador. */
export function EncabezadoBusqueda({ titulo, derecha, children }: { titulo: string; derecha?: ReactNode; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.banner }}>
      <SafeAreaView edges={['top']} style={styles.encabezado}>
        <View style={styles.tituloFila}>
          <Text style={styles.titulo}>{titulo}</Text>
          {derecha}
        </View>
        {children}
      </SafeAreaView>
      <View style={styles.franja} />
    </View>
  );
}

type PropsBarra = {
  valor: string;
  onCambiar: (v: string) => void;
  placeholder: string;
  onEnviar?: () => void;
  onFoco?: () => void;
  /** Muestra «Cancelar» a la derecha mientras el buscador está activo. */
  activo?: boolean;
  onCancelar?: () => void;
  inputRef?: Ref<TextInput>;
};

/** Caja de búsqueda con botón para borrar y «Cancelar», al estilo de iOS. */
export function BarraBusqueda({ valor, onCambiar, placeholder, onEnviar, onFoco, activo, onCancelar, inputRef }: PropsBarra) {
  const t = useTheme();
  return (
    <View style={styles.barraFila}>
      <View style={[styles.barra, { backgroundColor: t.backgroundElement }]}>
        <Icono nombre="buscar" color={t.muted} tam={17} />
        <TextInput
          ref={inputRef}
          value={valor}
          onChangeText={onCambiar}
          onFocus={onFoco}
          onSubmitEditing={onEnviar}
          placeholder={placeholder}
          placeholderTextColor={t.muted}
          style={[styles.input, { color: t.text }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          enterKeyHint="search"
        />
        {valor ? (
          <Pressable onPress={() => onCambiar('')} hitSlop={10} accessibilityLabel="Borrar búsqueda"
            style={[styles.borrar, { backgroundColor: t.muted }]}>
            <Icono nombre="cerrar" color={t.backgroundElement} tam={10} />
          </Pressable>
        ) : null}
      </View>
      {activo && onCancelar ? (
        <Pressable onPress={onCancelar} hitSlop={8}>
          <Text style={styles.cancelar}>Cancelar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Últimas búsquedas (se guardan en el teléfono). Cada pantalla usa su propia `clave`. */
export function useRecientes(clave = 'busquedas-recientes:v1') {
  const [recientes, setRecientes] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(clave)
      .then((v) => v && setRecientes(JSON.parse(v) as string[]))
      .catch(() => undefined);
  }, [clave]);
  const guardar = useCallback((lista: string[]) => {
    setRecientes(lista);
    AsyncStorage.setItem(clave, JSON.stringify(lista)).catch(() => undefined);
  }, [clave]);
  const agregar = useCallback(
    (q: string) => {
      const limpio = q.trim();
      if (limpio.length < 2) return;
      guardar([limpio, ...recientes.filter((r) => r.toLowerCase() !== limpio.toLowerCase())].slice(0, 8));
    },
    [recientes, guardar],
  );
  return { recientes, agregar, borrar: () => guardar([]) };
}

type PropsPanel = {
  consulta: string;
  sugerencias: Sugerencias;
  recientes: string[];
  onBorrarRecientes: () => void;
  onTexto: (q: string) => void;
  onCompletar: (q: string) => void;
  onMarca: (marca: string) => void;
  onProveedor: (cve: string, nombre: string) => void;
  onArticulo: (a: Articulo) => void;
};

/** Panel que ocupa el lugar del catálogo mientras se escribe: búsquedas recientes o sugerencias por grupo. */
export function PanelSugerencias(p: PropsPanel) {
  const t = useTheme();
  const { marcas, proveedores, articulos } = p.sugerencias;
  const vacio = !marcas.length && !proveedores.length && !articulos.length;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.panel}>
      {!p.consulta.trim() ? (
        p.recientes.length ? (
          <Grupo titulo="Búsquedas recientes" accion="Borrar" onAccion={p.onBorrarRecientes}>
            {p.recientes.map((r) => (
              <Renglon key={r} icono="reciente" onPress={() => p.onTexto(r)} onCompletar={() => p.onCompletar(r)}>
                <Text style={[styles.renglonTexto, { color: t.text }]} numberOfLines={1}>{r}</Text>
              </Renglon>
            ))}
          </Grupo>
        ) : (
          <Text style={[styles.ayuda, { color: t.muted }]}>
            Busca por nombre, marca, producto, proveedor, clave ART. o código de barras.
          </Text>
        )
      ) : vacio ? (
        <Text style={[styles.ayuda, { color: t.muted }]}>Sin coincidencias para «{p.consulta.trim()}».</Text>
      ) : (
        <>
          <Renglon icono="buscar" onPress={() => p.onTexto(p.consulta)}>
            <Text style={[styles.renglonTexto, { color: t.text }]} numberOfLines={1}>
              Buscar «<Text style={{ fontWeight: '700' }}>{p.consulta.trim()}</Text>»
            </Text>
          </Renglon>
          {articulos.length ? (
            <Grupo titulo="Artículos">
              {articulos.map((a) => (
                <Pressable key={a.artId} onPress={() => p.onArticulo(a)}
                  style={({ pressed }) => [styles.articulo, { borderBottomColor: t.border }, pressed && ui.presionado]}>
                  <Foto uri={a.imagen} clave={a.prod} style={styles.miniatura} tamIcono={18} />
                  <View style={{ flex: 1 }}>
                    <Resaltado texto={a.articulo} consulta={p.consulta} numberOfLines={1} style={[styles.renglonTexto, { color: t.text }]} />
                    <Text style={[styles.sub, { color: t.muted }]} numberOfLines={1}>{a.marca} · {a.presentacion}</Text>
                  </View>
                  <Text style={[styles.precio, { color: t.accent }]}>{dinero(a.costoUnit)}</Text>
                </Pressable>
              ))}
            </Grupo>
          ) : null}
          {marcas.length ? (
            <Grupo titulo="Marcas">
              {marcas.map((m) => (
                <Renglon key={m.clave} icono="marca" onPress={() => p.onMarca(m.clave)} extra={`${entero(m.valor)} art.`}>
                  <Resaltado texto={m.etiqueta} consulta={p.consulta} numberOfLines={1} style={[styles.renglonTexto, { color: t.text }]} />
                </Renglon>
              ))}
            </Grupo>
          ) : null}
          {proveedores.length ? (
            <Grupo titulo="Proveedores">
              {proveedores.map((v) => (
                <Renglon key={v.clave} icono="proveedor" onPress={() => p.onProveedor(v.clave, v.etiqueta)} extra={`${entero(v.valor)} art.`}>
                  <Resaltado texto={v.etiqueta} consulta={p.consulta} numberOfLines={1} style={[styles.renglonTexto, { color: t.text }]} />
                </Renglon>
              ))}
            </Grupo>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

export function Grupo({ titulo, accion, onAccion, children }: { titulo: string; accion?: string; onAccion?: () => void; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.grupo}>
      <View style={styles.grupoH}>
        <Text style={[styles.grupoTitulo, { color: t.muted }]}>{titulo}</Text>
        {accion ? (
          <Pressable onPress={onAccion} hitSlop={8}>
            <Text style={[styles.grupoAccion, { color: t.accent }]}>{accion}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function Renglon({ icono, onPress, onCompletar, extra, children }: {
  icono: keyof typeof ICONOS;
  onPress: () => void;
  onCompletar?: () => void;
  extra?: string;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.renglon, { borderBottomColor: t.border }, pressed && ui.presionado]}>
      <Icono nombre={icono} color={t.muted} tam={16} />
      <View style={{ flex: 1 }}>{children}</View>
      {extra ? <Text style={[styles.sub, { color: t.muted }]}>{extra}</Text> : null}
      {onCompletar ? (
        // Pasa el texto al buscador sin buscar todavía, para poder seguir escribiendo
        <Pressable onPress={onCompletar} hitSlop={10} accessibilityLabel="Usar en el buscador">
          <Icono nombre="completar" color={t.muted} tam={14} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  encabezado: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  tituloFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  titulo: { color: '#fff', fontSize: 26, fontWeight: '700' },
  franja: { height: 3, backgroundColor: '#CFB579' },
  barraFila: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  barra: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, paddingHorizontal: 12, minHeight: 42 },
  input: { flex: 1, fontSize: 16, paddingVertical: 9 },
  borrar: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cancelar: { color: '#fff', fontSize: 16, fontWeight: '500' },
  panel: { paddingBottom: BottomTabInset + Spacing.five, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  ayuda: { fontSize: 14, textAlign: 'center', padding: Spacing.five, lineHeight: 20 },
  grupo: { paddingTop: Spacing.three },
  grupoH: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingBottom: Spacing.one },
  grupoTitulo: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  grupoAccion: { fontSize: 13, fontWeight: '600' },
  renglon: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  renglonTexto: { fontSize: 15 },
  articulo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  miniatura: { width: 44, height: 44, aspectRatio: undefined, borderRadius: 8 },
  sub: { fontSize: 12 },
  precio: { fontSize: 14, fontWeight: '700' },
});
