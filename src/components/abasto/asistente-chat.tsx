import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FilaArticulo, Foto } from '@/components/abasto/catalogo';
import { IlustracionProducto } from '@/components/abasto/ilustracion-producto';
import { INFO_MOTOR, useMotor } from '@/components/abasto/motor-ia';
import { Icono, s as ui } from '@/components/abasto/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { contar, entero } from '@/data/abasto';
import { useAbasto } from '@/data/abasto-context';
import {
  conContexto, consultarCatalogo, entender, limpiarRespuesta, mensajeConDatos, revisarRespuesta, tieneFiltros, tieneTema,
  type EstadoMotor, type Grupo, type Intencion, type Mensaje, type PropsChat,
} from '@/data/asistente';
import { imagenProveedor } from '@/data/imagenes';
import { useTheme } from '@/hooks/use-theme';

export type { Mensaje } from '@/data/asistente';

/** Artículos que se muestran como tarjetas bajo cada respuesta. */
const TARJETAS = 4;

let siguiente = 0;
const nuevoId = () => `m${Date.now()}-${siguiente++}`;

/**
 * Chat del asistente, igual en Android, iPhone y web; solo cambia el motor que corre el modelo (motor-ia).
 * El modelo se descarga solo la primera vez que se abre (en el teléfono, antes y en segundo plano si hay Wi-Fi);
 * después se carga directo de lo ya descargado.
 */
export function ChatAsistente(props: PropsChat) {
  const [intento, setIntento] = useState(0);
  return <Sesion key={intento} {...props} onReintentar={() => setIntento((n) => n + 1)} />;
}

function Sesion({ mensajes, setMensajes, onVerArticulo, onVerProveedor, onVerProducto, onReintentar }: PropsChat & { onReintentar: () => void }) {
  const { datos, cargando } = useAbasto();
  const [generando, setGenerando] = useState(false);
  const motor = useMotor();
  // Lo que se entendió de la pregunta anterior, para seguimientos como «¿y el más caro?» o «¿quién los vende?»
  const previa = useRef<Intencion | null>(null);
  // Candado: dos toques rápidos mandarían dos preguntas antes de que `generando` cambie, y el modelo solo atiende una
  const ocupado = useRef(false);
  const detener = useRef(motor.detener);
  useEffect(() => {
    detener.current = motor.detener;
  });

  useEffect(() => {
    // Una respuesta que quedó a medias (se cerró la hoja mientras escribía) ya no va a terminar
    setMensajes((m) => (m.some((x) => x.pendiente) ? m.map((x) => (x.pendiente ? { ...x, pendiente: false, texto: x.texto || 'Respuesta interrumpida.' } : x)) : m));
    // Al cerrar la hoja a media respuesta, se detiene el modelo
    return () => {
      if (ocupado.current) detener.current();
    };
  }, [setMensajes]);

  const sugerencias = useMemo(() => {
    const arts = datos?.articulos ?? [];
    const proveedor = contar(arts, (a) => a.cve, (a) => a.provCorto)[0]?.etiqueta;
    return [
      '¿Qué aceites hay y cuál es el más barato?',
      'Artículos en oferta que vencen en 30 días',
      proveedor ? `¿Qué productos vende ${proveedor}?` : 'Resumen del catálogo',
      '¿Qué proveedores venden frijoles en la región Sureste?',
    ];
  }, [datos]);

  const enviar = async (pregunta: string) => {
    const q = pregunta.trim();
    if (!q || motor.estado.fase !== 'listo' || ocupado.current) return;
    const arts = datos?.articulos ?? [];
    if (!arts.length) {
      // Sin catálogo no hay con qué responder: mejor decirlo que dejar que el modelo improvise
      setMensajes((m) => [...m, { id: nuevoId(), rol: 'usuario', texto: q }, {
        id: nuevoId(), rol: 'asistente', error: true, pregunta: q,
        texto: cargando ? 'El catálogo todavía se está descargando; vuelve a intentar en unos segundos.' : 'No se pudo cargar el catálogo. Revisa tu conexión y vuelve a intentar.',
      }]);
      return;
    }
    ocupado.current = true;
    // Primero la app entiende la pregunta (unida a la anterior si sigue con su tema) y consulta el catálogo
    const intencion = conContexto(entender(q, arts), previa.current, q);
    const consulta = consultarCatalogo(intencion, arts);
    if (tieneTema(intencion) || tieneFiltros(intencion)) previa.current = intencion;

    const id = nuevoId();
    setGenerando(true);
    // Las tarjetas aparecen de inmediato; el modelo redacta mientras tanto
    setMensajes((m) => [...m, { id: nuevoId(), rol: 'usuario', texto: q }, {
      id, rol: 'asistente', texto: '', pendiente: true,
      articulos: consulta.articulos, proveedores: consulta.proveedores, productos: consulta.productos,
    }]);
    const cambiar = (c: Partial<Mensaje>) => setMensajes((m) => m.map((x) => (x.id === id ? { ...x, ...c } : x)));
    // El texto llega palabra por palabra: se muestra a lo más cada 80 ms, no en cada palabra (redibujar toda la
    // conversación tantas veces la vuelve lenta)
    let ultimo = '';
    let programado = false;
    let terminado = false;
    const alEscribir = (crudo: string) => {
      ultimo = crudo;
      if (programado) return;
      programado = true;
      setTimeout(() => {
        programado = false;
        if (!terminado) cambiar({ texto: limpiarRespuesta(ultimo) });
      }, 80);
    };
    try {
      const { texto, cancelado } = await motor.enviar(mensajeConDatos(q, consulta.datos), alEscribir);
      terminado = true;
      // Antes de dejar la respuesta, se revisa que sus cifras hayan salido de los datos consultados
      const revisada = cancelado
        ? { texto: limpiarRespuesta(ultimo) ? `${limpiarRespuesta(ultimo)}…\n\n(Respuesta detenida)` : 'Respuesta detenida.' }
        : revisarRespuesta(texto, consulta.datos);
      cambiar({ ...revisada, pendiente: false });
    } catch (e) {
      terminado = true;
      cambiar({ texto: `No pude responder: ${e instanceof Error ? e.message : String(e)}`, pendiente: false, error: true, pregunta: q });
    } finally {
      ocupado.current = false;
      setGenerando(false);
    }
  };

  if (motor.estado.fase !== 'listo') return <Preparando estado={motor.estado} onReintentar={onReintentar} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Conversacion mensajes={mensajes} sugerencias={sugerencias} onEnviar={enviar} acciones={{ onVerArticulo, onVerProveedor, onVerProducto }} />
      <Entrada generando={generando} onEnviar={enviar} onDetener={motor.detener} />
    </KeyboardAvoidingView>
  );
}

const ERRORES = {
  descarga: ['No se pudo descargar el asistente', 'Revisa tu conexión a internet. La descarga continúa donde se quedó.'],
  carga: ['No se pudo cargar el asistente', 'Puede que no haya memoria suficiente. Cierra otras apps o pestañas e inténtalo de nuevo.'],
  navegador: [
    'Este navegador no puede correr el asistente',
    'Necesita WebGPU: ábrelo en Chrome o Edge recientes, de preferencia en una computadora, o usa la app de Android o iPhone.',
  ],
} as const;

/** Descarga, carga en memoria y errores del modelo. */
function Preparando({ estado, onReintentar }: { estado: Exclude<EstadoMotor, { fase: 'listo' }>; onReintentar: () => void }) {
  const t = useTheme();
  if (estado.fase === 'error') {
    const [titulo, texto] = ERRORES[estado.tipo];
    return (
      <Centro>
        <Icono nombre="alerta" color={t.danger} tam={32} />
        <Text style={[styles.tituloEstado, { color: t.text }]}>{titulo}</Text>
        <Text style={[styles.textoEstado, { color: t.textSecondary }]}>{texto}</Text>
        {/* El mensaje técnico, para poder reportar qué falló */}
        {estado.detalle ? <Text style={[styles.detalle, { color: t.muted }]} selectable numberOfLines={4}>Detalle: {estado.detalle}</Text> : null}
        {estado.tipo !== 'navegador' ? (
          <Pressable onPress={onReintentar} style={({ pressed }) => [styles.botonPrincipal, { backgroundColor: t.accent }, pressed && ui.presionado]}>
            <Text style={styles.botonPrincipalTexto}>Reintentar</Text>
          </Pressable>
        ) : null}
      </Centro>
    );
  }
  if (estado.fase === 'descargando') {
    return (
      <Centro>
        <Icono nombre="descargar" color={t.accent} tam={34} />
        <Text style={[styles.tituloEstado, { color: t.text }]}>Descargando el asistente</Text>
        <Barra progreso={estado.progreso} />
        <Text style={[styles.textoEstado, { color: t.textSecondary }]}>
          {Math.floor(estado.progreso)} % de {INFO_MOTOR.tamano}. Solo se descarga una vez; te recomendamos usar Wi-Fi. Si cierras esta hoja, continúa al volver a abrirla.
        </Text>
      </Centro>
    );
  }
  if (estado.fase === 'cargando' && estado.progreso !== undefined) {
    return (
      <Centro>
        <ActivityIndicator size="large" color={t.accent} />
        <Text style={[styles.textoEstado, { color: t.textSecondary }]}>Preparando el asistente…</Text>
        <Barra progreso={estado.progreso} />
      </Centro>
    );
  }
  return <Cargando texto={estado.fase === 'revisando' ? 'Revisando el asistente…' : 'Preparando el asistente…'} />;
}

function Barra({ progreso }: { progreso: number }) {
  const t = useTheme();
  return (
    <View style={[styles.barraFondo, { backgroundColor: t.backgroundSelected }]}>
      <View style={[styles.barra, { width: `${progreso}%`, backgroundColor: t.accent }]} />
    </View>
  );
}

type Acciones = Pick<PropsChat, 'onVerArticulo' | 'onVerProveedor' | 'onVerProducto'>;

function Conversacion({ mensajes, sugerencias, onEnviar, acciones }: {
  mensajes: Mensaje[]; sugerencias: string[]; onEnviar: (q: string) => void; acciones: Acciones;
}) {
  const t = useTheme();
  const scroll = useRef<ScrollView>(null);
  // Solo se baja sola si ya estaba abajo: si el usuario subió a leer, no se le mueve mientras el modelo escribe
  const abajo = useRef(true);
  useEffect(() => {
    abajo.current = true; // pregunta nueva: siempre se muestra
  }, [mensajes.length]);
  return (
    <ScrollView ref={scroll} contentContainerStyle={styles.conversacion} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
      scrollEventThrottle={100}
      onScroll={({ nativeEvent: n }) => {
        abajo.current = n.contentOffset.y + n.layoutMeasurement.height >= n.contentSize.height - 80;
      }}
      onContentSizeChange={() => abajo.current && scroll.current?.scrollToEnd({ animated: true })}>
      {!mensajes.length ? (
        <View style={styles.vacio}>
          <View style={[styles.medallon, { backgroundColor: t.accentSoft }]}>
            <Icono nombre="asistente" color={t.accent} tam={30} />
          </View>
          <Text style={[styles.tituloEstado, { color: t.text }]}>¿Qué quieres consultar?</Text>
          <Text style={[styles.textoEstado, { color: t.textSecondary }]}>
            Pregunta por artículos, precios, productos, proveedores, regiones o vigencias, como se lo preguntarías a una persona.
          </Text>
          <View style={styles.sugerencias}>
            {sugerencias.map((s) => (
              <Pressable key={s} onPress={() => onEnviar(s)}
                style={({ pressed }) => [styles.sugerencia, { backgroundColor: t.backgroundElement, borderColor: t.border }, pressed && ui.presionado]}>
                <Icono nombre="asistente" color={t.gold} tam={14} />
                <Text style={[styles.sugerenciaTexto, { color: t.text }]}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        mensajes.map((m) => <Burbuja key={m.id} m={m} acciones={acciones} onReintentar={onEnviar} />)
      )}
    </ScrollView>
  );
}

function Burbuja({ m, acciones, onReintentar }: { m: Mensaje; acciones: Acciones; onReintentar: (q: string) => void }) {
  const t = useTheme();
  if (m.rol === 'usuario') {
    return (
      <View style={[styles.burbuja, styles.usuario, { backgroundColor: t.accent }]}>
        <Text style={[styles.texto, { color: '#ffffff' }]} selectable>{m.texto}</Text>
      </View>
    );
  }
  const extra = (m.articulos?.length ?? 0) - TARJETAS;
  return (
    <View style={styles.respuesta}>
      <View style={[styles.burbuja, styles.asistente, { backgroundColor: t.backgroundElement, borderColor: t.border }]}
        accessibilityLiveRegion={m.pendiente ? 'none' : 'polite'}>
        {m.texto ? <TextoFormateado texto={m.texto} color={m.error ? t.danger : t.text} /> : null}
        {m.aviso ? (
          <View style={[styles.advertencia, { backgroundColor: t.backgroundSelected }]}>
            <Icono nombre="alerta" color={t.gold} tam={14} />
            <Text style={[styles.advertenciaTexto, { color: t.textSecondary }]}>{m.aviso}</Text>
          </View>
        ) : null}
        {m.pendiente && !m.texto ? (
          <View style={styles.pensando}>
            <ActivityIndicator size="small" color={t.accent} />
            <Text style={[styles.pensandoTexto, { color: t.textSecondary }]}>Escribiendo…</Text>
          </View>
        ) : null}
        {m.error && m.pregunta ? (
          <Pressable onPress={() => onReintentar(m.pregunta!)} hitSlop={8} style={({ pressed }) => [styles.reintentar, pressed && ui.presionado]}>
            <Icono nombre="reciente" color={t.accent} tam={14} />
            <Text style={[styles.reintentarTexto, { color: t.accent }]}>Volver a intentar</Text>
          </Pressable>
        ) : null}
      </View>
      {m.articulos?.length ? (
        <View style={{ gap: Spacing.two }}>
          {m.articulos.slice(0, TARJETAS).map((a) => <FilaArticulo key={a.artId} a={a} onPress={acciones.onVerArticulo} />)}
          {extra > 0 ? <Text style={[styles.mas, { color: t.muted }]}>y {entero(extra)} artículos más en el catálogo</Text> : null}
        </View>
      ) : null}
      {m.proveedores?.length ? (
        <View style={{ gap: Spacing.two }}>
          {m.proveedores.map((g) => <FilaGrupo key={g.clave} g={g} tipo="proveedor" onPress={() => acciones.onVerProveedor(g.clave)} />)}
        </View>
      ) : null}
      {m.productos?.length ? (
        <View style={{ gap: Spacing.two }}>
          {m.productos.map((g) => <FilaGrupo key={g.clave} g={g} tipo="producto" onPress={() => acciones.onVerProducto(g.clave)} />)}
        </View>
      ) : null}
    </View>
  );
}

/** Tarjeta de un proveedor (con su logotipo) o de un producto (con su ilustración): lleva a su catálogo. */
function FilaGrupo({ g, tipo, onPress }: { g: Grupo; tipo: 'proveedor' | 'producto'; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [styles.grupo, { backgroundColor: t.backgroundElement }, pressed && ui.presionado]}>
      {tipo === 'producto'
        ? <IlustracionProducto nombre={g.nombre} tamIcono={18} style={styles.grupoImagen} />
        : <Foto uri={imagenProveedor(g.clave)} clave={g.clave} icono="proveedor" style={styles.grupoImagen} tamIcono={20} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.grupoNombre, { color: t.text }]} numberOfLines={2}>{g.nombre}</Text>
        <Text style={[styles.grupoDetalle, { color: t.textSecondary }]}>
          {tipo === 'proveedor' ? `CVE ${g.clave}` : `PROD. ${g.clave}`} · {entero(g.articulos)} {g.articulos === 1 ? 'artículo' : 'artículos'}
        </Text>
      </View>
      <Text style={[styles.grupoAccion, { color: t.accent }]}>{tipo === 'proveedor' ? 'Ver artículos' : 'Ver producto'}</Text>
      <Icono nombre="flecha" color={t.accent} tam={13} />
    </Pressable>
  );
}

/**
 * Texto del modelo con su formato: **negritas** en negritas y listas («- », «* ») con viñetas, en vez de mostrar
 * los asteriscos tal cual.
 */
function TextoFormateado({ texto, color }: { texto: string; color: string }) {
  const limpio = texto
    .split('\n')
    .map((l) => l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*[-*•]\s+/, '• '))
    .join('\n');
  return (
    <Text style={[styles.texto, { color }]} selectable>
      {limpio.split(/(\*\*[^*\n]+\*\*)/g).map((parte, i) =>
        /^\*\*[^*\n]+\*\*$/.test(parte)
          ? <Text key={i} style={{ fontWeight: '700' }}>{parte.slice(2, -2)}</Text>
          : parte.replace(/\*+/g, ''),
      )}
    </Text>
  );
}

function Entrada({ generando, onEnviar, onDetener }: { generando: boolean; onEnviar: (q: string) => void; onDetener: () => void }) {
  const t = useTheme();
  const [texto, setTexto] = useState('');
  const enviar = () => {
    if (!texto.trim() || generando) return;
    onEnviar(texto);
    setTexto('');
  };
  const activo = generando || !!texto.trim();
  return (
    <SafeAreaView edges={['bottom']} style={[styles.entradaFondo, { backgroundColor: t.backgroundElement, borderTopColor: t.border }]}>
      <View style={styles.entrada}>
        <TextInput value={texto} onChangeText={setTexto} placeholder="Escribe tu pregunta" placeholderTextColor={t.muted}
          style={[styles.input, { color: t.text, backgroundColor: t.background, borderColor: t.border }]}
          multiline maxLength={500} onSubmitEditing={enviar} submitBehavior="submit" returnKeyType="send" enterKeyHint="send"
          onKeyPress={(e) => {
            // En computadora: Enter envía y Mayús+Enter hace un salto de línea, como en cualquier chat
            const tecla = e.nativeEvent as { key: string; shiftKey?: boolean };
            if (Platform.OS === 'web' && tecla.key === 'Enter' && !tecla.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }} />
        <Pressable onPress={generando ? onDetener : enviar} disabled={!activo} hitSlop={6}
          accessibilityLabel={generando ? 'Detener respuesta' : 'Enviar pregunta'}
          style={({ pressed }) => [styles.enviar, { backgroundColor: activo ? t.accent : t.backgroundSelected }, pressed && ui.presionado]}>
          <Icono nombre={generando ? 'detener' : 'enviar'} color={activo ? '#ffffff' : t.muted} tam={18} />
        </Pressable>
      </View>
      <Text style={[styles.nota, { color: t.muted }]}>La IA puede equivocarse: confirma los datos en la ficha del artículo.</Text>
    </SafeAreaView>
  );
}

function Cargando({ texto }: { texto: string }) {
  const t = useTheme();
  return (
    <Centro>
      <ActivityIndicator size="large" color={t.accent} />
      {texto ? <Text style={[styles.textoEstado, { color: t.textSecondary }]}>{texto}</Text> : null}
    </Centro>
  );
}

function Centro({ children }: { children: ReactNode }) {
  return <View style={styles.centro}>{children}</View>;
}

const styles = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  tituloEstado: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  textoEstado: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  detalle: { fontSize: 11, lineHeight: 15, textAlign: 'center', maxWidth: 420 },
  barraFondo: { width: '100%', maxWidth: 320, height: 8, borderRadius: 4, overflow: 'hidden' },
  barra: { height: 8, borderRadius: 4 },
  botonPrincipal: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 13 },
  botonPrincipalTexto: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  conversacion: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexGrow: 1 },
  vacio: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.four },
  medallon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  sugerencias: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.three },
  sugerencia: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  sugerenciaTexto: { flex: 1, fontSize: 14, fontWeight: '500' },
  burbuja: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '88%' },
  usuario: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  asistente: { alignSelf: 'flex-start', borderWidth: 1, borderBottomLeftRadius: 6, gap: Spacing.two },
  respuesta: { gap: Spacing.two },
  texto: { fontSize: 15, lineHeight: 21 },
  advertencia: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: 8, padding: 8 },
  advertenciaTexto: { flex: 1, fontSize: 12, lineHeight: 16 },
  pensando: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pensandoTexto: { fontSize: 13 },
  grupo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 14, padding: 10, paddingRight: 12 },
  grupoImagen: { width: 48, height: 48, aspectRatio: undefined, borderRadius: 10 },
  grupoNombre: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  grupoDetalle: { fontSize: 12 },
  grupoAccion: { fontSize: 12, fontWeight: '600' },
  reintentar: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  reintentarTexto: { fontSize: 13, fontWeight: '600' },
  mas: { fontSize: 12, textAlign: 'center' },
  entradaFondo: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  entrada: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  input: { flex: 1, fontSize: 15, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, maxHeight: 120 },
  enviar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  nota: { fontSize: 11, textAlign: 'center', paddingVertical: 6 },
});
