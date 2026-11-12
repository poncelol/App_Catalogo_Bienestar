import { router } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Entrada } from '@/components/abasto/animaciones';
import { ArticuloDetalle } from '@/components/abasto/articulo-detalle';
import { ChatAsistente, type Mensaje } from '@/components/abasto/asistente-chat';
import { INFO_MOTOR, precargarModelo } from '@/components/abasto/motor-ia';
import { Icono, s as ui } from '@/components/abasto/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { Articulo } from '@/data/abasto';
import { useAbasto, type FiltrosArticulos } from '@/data/abasto-context';
import { useTheme } from '@/hooks/use-theme';

const Contexto = createContext<() => void>(() => undefined);

/** Abre el asistente desde cualquier pantalla. */
export const useAbrirAsistente = () => useContext(Contexto);

/**
 * Hoja del asistente. Los mensajes viven aquí y no en la hoja: al cerrarla se libera la memoria del modelo,
 * pero al volver a abrirla los mensajes siguen ahí.
 */
export function AsistenteProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { setFiltrosArticulos, setProductoAbierto, setRegion } = useAbasto();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [sel, setSel] = useState<Articulo | null>(null);
  const [conversacion, setConversacion] = useState(0);

  // Con Wi-Fi, el modelo se va descargando desde que abre la app para que el asistente ya esté listo
  useEffect(() => {
    precargarModelo();
  }, []);

  // Desde una tarjeta del chat: se cierra la hoja y se abre el catálogo del proveedor o la ficha del producto
  const verArticulos = (f: FiltrosArticulos) => {
    setSel(null);
    setAbierto(false);
    setFiltrosArticulos(f);
    router.navigate('/articulos');
  };
  const verProveedor = (cve: string) => verArticulos({ proveedor: cve });
  const verRegion = (sigla: string) => {
    setAbierto(false);
    setRegion(sigla);
    router.navigate('/regiones');
  };
  const verProducto = (prod: string) => {
    setAbierto(false);
    setProductoAbierto(prod);
    router.navigate('/productos');
  };

  const nueva = () => {
    setMensajes([]);
    setConversacion((n) => n + 1);
  };

  return (
    <Contexto.Provider value={() => setAbierto(true)}>
      {children}
      {/* Una sola vez, encima de las pestañas: así aparece en todas las pantallas */}
      <BotonAsistente />
      <Modal visible={abierto} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAbierto(false)}>
        <View style={[styles.hoja, { backgroundColor: t.background }]}>
          <View style={{ backgroundColor: t.banner }}>
            <SafeAreaView edges={['top']} style={styles.encabezado}>
              <View style={[styles.logo, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
                <Icono nombre="asistente" color="#E6D194" tam={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.titulo}>Asistente</Text>
                <Text style={styles.sub}>IA dentro de {INFO_MOTOR.lugar} · sin servicios en la nube</Text>
              </View>
              {mensajes.length ? (
                <Pressable onPress={nueva} hitSlop={10} accessibilityLabel="Nueva conversación"
                  style={({ pressed }) => [styles.boton, pressed && ui.presionado]}>
                  <Icono nombre="nueva" color="#ffffff" tam={20} />
                </Pressable>
              ) : null}
              <Pressable onPress={() => setAbierto(false)} hitSlop={10} accessibilityLabel="Cerrar"
                style={({ pressed }) => [styles.boton, pressed && ui.presionado]}>
                <Icono nombre="cerrar" color="#ffffff" tam={18} />
              </Pressable>
            </SafeAreaView>
            <View style={styles.franja} />
          </View>
          {abierto ? (
            <ChatAsistente key={conversacion} mensajes={mensajes} setMensajes={setMensajes} onVerArticulo={setSel}
              onVerProveedor={verProveedor} onVerProducto={verProducto}
              onVerHoja={(h) => verArticulos({ negociacion: h })} onVerInventario={(inv) => verArticulos({ inventario: inv })}
              onVerRegion={verRegion} />
          ) : null}
        </View>
        <ArticuloDetalle
          articulo={sel}
          onClose={() => setSel(null)}
          onVerProveedor={(a) => verProveedor(a.cve)}
        />
      </Modal>
    </Contexto.Provider>
  );
}

/** Botón flotante redondo para abrir el asistente. */
export function BotonAsistente() {
  const t = useTheme();
  const abrir = useAbrirAsistente();
  // En iPhone la barra de pestañas queda encima de la barra de inicio (la rayita de abajo): sin sumar ese espacio, el
  // botón quedaba pegado a la barra
  const { bottom } = useSafeAreaInsets();
  const abajo = BottomTabInset + Spacing.three + (Platform.OS === 'ios' ? bottom + Spacing.two : 0);
  return (
    // Aparece con un pequeño rebote al abrir la app
    <Entrada efecto="crecer" retraso={600} duracion={450} style={[styles.flotante, { bottom: abajo }]}>
      <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel="Abrir el asistente"
        style={({ pressed }) => [styles.botonFlotante, { backgroundColor: t.accent }, pressed && ui.presionado]}>
        <Icono nombre="asistente" color="#ffffff" tam={24} />
      </Pressable>
    </Entrada>
  );
}

const styles = StyleSheet.create({
  hoja: { flex: 1 },
  encabezado: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three, paddingBottom: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center',
  },
  logo: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  titulo: { color: '#fff', fontSize: 20, fontWeight: '700' },
  sub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 1 },
  boton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  franja: { height: 3, backgroundColor: '#CFB579' },
  flotante: { position: 'absolute', right: Spacing.four + Spacing.two },
  botonFlotante: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});
