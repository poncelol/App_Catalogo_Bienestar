/**
 * Motor del asistente en Android y iPhone: un modelo pequeño con react-native-executorch, dentro del teléfono.
 * La versión web está en motor-ia.ts.
 *
 * La librería trae código nativo: solo existe en la app instalada (build de EAS o de desarrollo), no en Expo Go.
 * Por eso se carga con require y solo si está disponible; si no, el resto de la app funciona y el asistente avisa.
 * El modelo corre en un hilo aparte (worklet), así que la pantalla no se traba mientras responde.
 *
 * Memoria: hay una sola sesión del modelo para toda la app.
 * - Si el asistente se usó en los últimos días, se carga al abrir la app (en espera), para que al abrirlo ya esté listo.
 * - Se queda cargada mientras el asistente se use; con la hoja cerrada unos minutos, o con la app en segundo plano,
 *   se suelta (si no, Android puede cerrar la app por falta de memoria). Volver a cargarla tarda unos segundos;
 *   descargarla, solo la primera vez.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import type { LLMChatSession } from 'react-native-executorch';

import { instrucciones, limpiarRespuesta, RESPUESTA_MAX, type EstadoMotor, type Motor } from '@/data/asistente';

type Executorch = typeof import('react-native-executorch');

/** La librería, o null en Expo Go (o si la app se instaló antes de agregarla y le falta el código nativo). */
const rne: Executorch | null = (() => {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require('react-native-executorch') as Executorch;
    lib.setTelemetryEnabled(false);
    return lib;
  } catch {
    return null;
  }
})();

/**
 * Teléfono con menos de ~3 GB de RAM (los de «4 GB» reportan unos 3.6). Si no se sabe, se supone suficiente.
 */
const POCA_MEMORIA = (Device.totalMemory ?? Infinity) < 3e9;

// LFM 2.5 1.2B (Liquid AI): hecho para teléfonos. La mayoría de sus capas no guardan memoria de contexto, así que
// usa poca memoria aunque sea el doble de grande que Qwen 3 0.6B, y redacta mejor. Se descarga una vez (810 MB) y
// desde entonces funciona sin internet. En teléfonos con poca memoria se queda Qwen 3 0.6B (518 MB)
const MODELO = rne && (POCA_MEMORIA ? rne.models.llm.QWEN3_0_6B.XNNPACK_8DA4W : rne.models.llm.LFM2_5_1_2B.XNNPACK_8DA4W);
type Modelo = NonNullable<typeof MODELO>;
/** Archivo del modelo anterior (Qwen 3 0.6B), que se borra al tener el nuevo para no ocupar 518 MB de más. */
const ANTERIOR = POCA_MEMORIA ? null : 'qwen_3_0_6b_xnnpack_8da4w.pte';
// Casi sin aleatoriedad para que se apegue a los datos, y con castigo a repetir para que no se cicle. Qwen, sin
// razonamiento visible (más rápido); LFM, con los valores que recomienda Liquid AI
const GENERACION = POCA_MEMORIA
  ? { enableThinking: false, temperature: 0.2, topP: 0.8, topK: 20, repetitionPenalty: 1.1, maxNewTokens: RESPUESTA_MAX }
  : { temperature: 0.1, topP: 0.1, topK: 50, repetitionPenalty: 1.05, maxNewTokens: RESPUESTA_MAX };
/** Memoria de contexto que se supone mientras la sesión no la informa (la del modelo exportado suele ser mayor). */
const CONTEXTO_INICIAL = 2048;
/** Con la hoja del asistente cerrada este tiempo, se suelta el modelo. */
const LIBERAR_TRAS_MS = 5 * 60 * 1000;
/** Si el asistente se usó en estos días, el modelo se carga al abrir la app. */
const DIAS_PRECARGA = 7;
const CLAVE_USO = 'asistente.ultimoUso';

export const INFO_MOTOR = { tamano: POCA_MEMORIA ? '520 MB' : '810 MB', lugar: 'tu teléfono' };

/** Carpeta donde react-native-executorch guarda lo descargado. */
const CARPETA = `${Platform.OS === 'android' ? RNBlobUtil.fs.dirs.SDCardDir || RNBlobUtil.fs.dirs.DocumentDir : RNBlobUtil.fs.dirs.DocumentDir}/react-native-executorch`;
const nombreArchivo = (ruta: string) => ruta.split('?')[0].split('/').pop() ?? '';

/** Borra el archivo del modelo anterior, si sigue en el teléfono. */
async function borrarAnterior() {
  if (!ANTERIOR) return;
  const archivos = await RNBlobUtil.fs.ls(CARPETA).catch(() => [] as string[]);
  await Promise.all(archivos.filter((a) => a.endsWith(`_${ANTERIOR}`)).map((a) => RNBlobUtil.fs.unlink(`${CARPETA}/${a}`).catch(() => undefined)));
}

/** ¿El modelo ya está en el teléfono? (para cargarlo sin red, sin arrancar una descarga con datos móviles). */
async function yaDescargado() {
  if (!MODELO) return false;
  const archivos = await RNBlobUtil.fs.ls(CARPETA).catch(() => [] as string[]);
  return archivos.some((a) => a.endsWith(`_${nombreArchivo(MODELO.modelPath as string)}`));
}

// ──────────────────────────────────────────────────────────────
// Una sola sesión del modelo para toda la app
// ──────────────────────────────────────────────────────────────

let sesion: LLMChatSession | null = null;
let creando: Promise<LLMChatSession> | null = null;
/** Respuesta en curso: la sesión no se suelta mientras escribe (seguiría usando memoria ya liberada). */
let respondiendo: Promise<unknown> | null = null;
let recurso: Modelo | null = null;
let abiertas = 0;
let temporizador: ReturnType<typeof setTimeout> | undefined;
const avisos = new Set<() => void>();
const avisar = () => avisos.forEach((f) => f());
/** Se pidió una conversación nueva: la siguiente pregunta empieza con la sesión sin las preguntas anteriores. */
let olvidar = false;

/** «Nueva conversación»: el modelo olvida las preguntas anteriores (la sesión las guarda en su memoria). */
export function nuevaConversacion() {
  olvidar = true;
}

function nuevaSesion(r: Modelo) {
  return rne!.createLLMChatSession(r, {
    initialMessages: [{ role: 'system', content: instrucciones() }],
    generationConfig: GENERACION,
  });
}

function obtenerSesion(r: Modelo): Promise<LLMChatSession> {
  recurso = r;
  if (sesion) return Promise.resolve(sesion);
  creando ??= nuevaSesion(r).then(
    (s) => {
      sesion = s;
      creando = null;
      avisar();
      return s;
    },
    (e: unknown) => {
      creando = null;
      throw e;
    },
  );
  return creando;
}

/** Suelta el modelo de la memoria (si no está respondiendo); la siguiente vez se vuelve a cargar del teléfono. */
function liberar() {
  if (respondiendo || !sesion) return;
  const s = sesion;
  sesion = null;
  s.dispose();
  avisar();
}

function programarLiberar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => !abiertas && liberar(), LIBERAR_TRAS_MS);
}

if (rne) {
  AppState.addEventListener('change', (a) => {
    if (a === 'background') liberar();
    // Al volver con la hoja abierta, se carga otra vez
    else if (a === 'active' && abiertas && recurso) obtenerSesion(recurso).catch(() => undefined);
  });
}

/**
 * Al abrir la app: con Wi-Fi o cable descarga el modelo en segundo plano (no gasta datos móviles), para que el
 * asistente esté listo cuando se abra; si se interrumpe, la siguiente vez continúa donde se quedó. Y si el asistente
 * se usó en los últimos días, lo deja cargado en espera.
 */
export async function precargarModelo() {
  if (!rne || !MODELO) return;
  if (!(await yaDescargado())) {
    const red = await getNetworkStateAsync().catch(() => null);
    if (!red?.isConnected || (red.type !== NetworkStateType.WIFI && red.type !== NetworkStateType.ETHERNET)) return;
  }
  const r = await rne.download(MODELO).catch(() => null);
  if (!r) return;
  await borrarAnterior();
  const ultimo = Number(await AsyncStorage.getItem(CLAVE_USO).catch(() => null)) || 0;
  if (Date.now() - ultimo < DIAS_PRECARGA * 864e5 && AppState.currentState === 'active') {
    await obtenerSesion(r).catch(() => undefined);
    if (!abiertas) programarLiberar();
  }
}

/** Sin la librería (Expo Go): el asistente explica que necesita la app instalada. */
function useMotorNoDisponible(): Motor {
  return {
    estado: { fase: 'error', tipo: 'app', detalle: 'react-native-executorch no está en esta app (Expo Go)' },
    enviar: async () => {
      throw new Error('El asistente no está disponible en esta versión de la app.');
    },
    detener: () => undefined,
    contexto: 0,
  };
}

function useMotorEnTelefono(): Motor {
  const lib = rne!;
  const modelo = MODELO!;
  const { resource, downloadProgress, downloadError } = lib.useResourceDownload(modelo);
  const [listo, setListo] = useState(() => !!sesion);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [contexto, setContexto] = useState(() => sesion?.getKVCacheState().maxContextLen ?? CONTEXTO_INICIAL);

  // Hoja abierta: el modelo no se suelta mientras esté abierta (salvo en segundo plano)
  useEffect(() => {
    abiertas++;
    clearTimeout(temporizador);
    void AsyncStorage.setItem(CLAVE_USO, String(Date.now())).catch(() => undefined);
    const alCambiar = () => {
      setListo(!!sesion);
      if (sesion) setContexto(sesion.getKVCacheState().maxContextLen);
    };
    avisos.add(alCambiar);
    return () => {
      avisos.delete(alCambiar);
      abiertas--;
      if (!abiertas) programarLiberar();
    };
  }, []);

  useEffect(() => {
    if (!resource) return;
    let vivo = true;
    void borrarAnterior();
    obtenerSesion(resource).catch((e: unknown) => vivo && setErrorCarga(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
  }, [resource]);

  const estado: EstadoMotor = downloadError
    ? { fase: 'error', tipo: 'descarga', detalle: downloadError.message }
    : errorCarga
      ? { fase: 'error', tipo: 'carga', detalle: errorCarga }
      : !resource
        // El progreso queda en 0 mientras revisa si ya estaba descargado
        ? downloadProgress > 0 && downloadProgress < 100 ? { fase: 'descargando', progreso: downloadProgress } : { fase: 'revisando' }
        : listo ? { fase: 'listo' } : { fase: 'cargando' };

  const enviar: Motor['enviar'] = async (mensaje, onCrudo) => {
    if (!resource) throw new Error('El asistente todavía no está listo.');
    // Si se soltó (segundo plano, reintento), se vuelve a cargar aquí
    let s = await obtenerSesion(resource);
    const reiniciar = async () => {
      sesion = null;
      s.dispose();
      s = await obtenerSesion(resource);
    };
    // Cada pregunta lleva sus datos: si lo que queda de memoria no alcanza para ellos y la respuesta, se empieza
    // una sesión nueva (las preguntas anteriores ya no hacen falta: la app guarda el tema de la conversación)
    // (y tras «Nueva conversación», si la sesión ya traía preguntas)
    const conHistorial = s.getHistory().length > 1;
    if ((olvidar && conHistorial) || s.getKVCacheState().remainingTokens < Math.ceil(mensaje.length / 2.6) + RESPUESTA_MAX) await reiniciar();
    olvidar = false;
    const preguntar = () => {
      let crudo = '';
      const p = s.sendMessage(mensaje, (token) => {
        crudo += token;
        onCrudo(crudo);
      });
      respondiendo = p;
      return p.finally(() => {
        respondiendo = null;
        // Si la app pasó a segundo plano mientras respondía, se suelta al terminar
        if (AppState.currentState === 'background') liberar();
      });
    };
    let turno;
    try {
      turno = await preguntar();
    } catch (e) {
      // Si aun así no cupo en la memoria de contexto, se intenta una vez con una sesión nueva. Con otro error, la
      // sesión se suelta: el reintento del chat empieza con una limpia
      if (!/context|capacity|exceed|too long|kv/i.test(e instanceof Error ? e.message : String(e))) {
        liberar();
        throw e;
      }
      await reiniciar();
      turno = await preguntar();
    }
    if (turno.finishReason === 'cancelled') return { texto: '', cancelado: true };
    const final = [...turno.messages].reverse().find((m) => m.role === 'assistant');
    return { texto: final && typeof final.content === 'string' ? limpiarRespuesta(final.content) : '', cancelado: false };
  };

  // Lo que ocupan las instrucciones ya está contado en presupuestoDatos
  // En el teléfono, 5 artículos y ~3000 caracteres de datos por pregunta: menos que leer, empieza a responder antes
  // (y la memoria de la sesión se llena más despacio: reiniciarla obliga a cargar el modelo otra vez)
  return { estado, enviar, detener: () => sesion?.stop(), contexto, maxArticulos: 5, maxDatos: 3000 };
}

// Se decide una sola vez al cargar la app, así el hook siempre llama a los mismos hooks
export const useMotor: () => Motor = rne ? useMotorEnTelefono : useMotorNoDisponible;
