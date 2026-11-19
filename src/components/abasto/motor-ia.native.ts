/**
 * Motor del asistente en Android y iPhone: un modelo pequeño con react-native-executorch, dentro del teléfono.
 * La versión web está en motor-ia.ts.
 *
 * La librería trae código nativo: solo existe en la app instalada (build de EAS o de desarrollo), no en Expo Go.
 * Por eso se carga con require y solo si está disponible; si no, el resto de la app funciona y el asistente avisa.
 *
 * Para no ocupar memoria de más, el modelo solo está cargado mientras la hoja del asistente está abierta y la app
 * en primer plano: en segundo plano se suelta (si no, Android puede cerrar la app por falta de memoria).
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { useEffect, useRef, useState } from 'react';
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

export const INFO_MOTOR = { tamano: POCA_MEMORIA ? '520 MB' : '810 MB', lugar: 'tu teléfono' };

/** Borra el archivo del modelo anterior, si sigue en el teléfono (la carpeta es la de react-native-executorch). */
async function borrarAnterior() {
  if (!ANTERIOR) return;
  const base = Platform.OS === 'android' ? RNBlobUtil.fs.dirs.SDCardDir || RNBlobUtil.fs.dirs.DocumentDir : RNBlobUtil.fs.dirs.DocumentDir;
  const carpeta = `${base}/react-native-executorch`;
  const archivos = await RNBlobUtil.fs.ls(carpeta).catch(() => [] as string[]);
  await Promise.all(archivos.filter((a) => a.endsWith(`_${ANTERIOR}`)).map((a) => RNBlobUtil.fs.unlink(`${carpeta}/${a}`).catch(() => undefined)));
}

/**
 * Descarga el modelo en segundo plano al abrir la app, solo con Wi-Fi o cable (no gasta datos móviles), para que
 * el asistente esté listo cuando se abra. Si ya está descargado no hace nada; si se interrumpe, la siguiente vez
 * continúa donde se quedó. Si el asistente se abre a media descarga, se une a esta en vez de empezar otra.
 */
export async function precargarModelo() {
  if (!rne || !MODELO) return;
  const red = await getNetworkStateAsync().catch(() => null);
  if (!red?.isConnected || (red.type !== NetworkStateType.WIFI && red.type !== NetworkStateType.ETHERNET)) return;
  if (await rne.download(MODELO).then(() => true, () => false)) await borrarAnterior();
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
  const sesion = useRef<LLMChatSession | null>(null);
  // Respuesta en curso: la sesión no se libera mientras escribe (el modelo seguiría usando memoria ya liberada)
  const enCurso = useRef<Promise<unknown> | null>(null);
  const [listo, setListo] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [contexto, setContexto] = useState(CONTEXTO_INICIAL);

  useEffect(() => {
    if (!resource) return;
    let vivo = true;
    void borrarAnterior();
    const abrir = () => {
      nuevaSesion(resource)
        .then((s) => {
          if (vivo && !sesion.current && AppState.currentState !== 'background') {
            sesion.current = s;
            setContexto(s.getKVCacheState().maxContextLen);
            setListo(true);
          } else {
            s.dispose();
          }
        })
        .catch((e: unknown) => vivo && setErrorCarga(e instanceof Error ? e.message : String(e)));
    };
    const cerrar = () => {
      const s = sesion.current;
      sesion.current = null;
      if (!s) return;
      // A media respuesta: se detiene y se libera cuando termine
      s.stop();
      (enCurso.current ?? Promise.resolve()).catch(() => undefined).finally(() => s.dispose());
    };
    abrir();
    // En segundo plano se suelta el modelo (si no está respondiendo); al volver se carga otra vez del teléfono
    const cambio = AppState.addEventListener('change', (a) => {
      if (a === 'background' && sesion.current && !enCurso.current) {
        cerrar();
        setListo(false);
      } else if (a === 'active' && !sesion.current) {
        abrir();
      }
    });
    return () => {
      vivo = false;
      cambio.remove();
      cerrar();
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
    if (!sesion.current || !resource) throw new Error('El asistente todavía no está listo.');
    const reiniciar = async () => {
      sesion.current?.dispose();
      sesion.current = null;
      sesion.current = await nuevaSesion(resource);
    };
    // Cada pregunta lleva sus datos: si lo que queda de memoria no alcanza para ellos y la respuesta, se empieza
    // una sesión nueva (las preguntas anteriores ya no hacen falta: la app guarda el tema de la conversación)
    if (sesion.current.getKVCacheState().remainingTokens < Math.ceil(mensaje.length / 2.6) + RESPUESTA_MAX) await reiniciar();
    const preguntar = () => {
      let crudo = '';
      const p = sesion.current!.sendMessage(mensaje, (token) => {
        crudo += token;
        onCrudo(crudo);
      });
      enCurso.current = p;
      return p.finally(() => {
        enCurso.current = null;
      });
    };
    let turno;
    try {
      turno = await preguntar();
    } catch (e) {
      // Si aun así no cupo en la memoria de contexto, se intenta una vez con una sesión nueva
      if (!/context|capacity|exceed|too long|kv/i.test(e instanceof Error ? e.message : String(e))) throw e;
      await reiniciar();
      turno = await preguntar();
    }
    if (turno.finishReason === 'cancelled') return { texto: '', cancelado: true };
    const final = [...turno.messages].reverse().find((m) => m.role === 'assistant');
    return { texto: final && typeof final.content === 'string' ? limpiarRespuesta(final.content) : '', cancelado: false };
  };

  // Lo que ocupan las instrucciones ya está contado en presupuestoDatos
  return { estado, enviar, detener: () => sesion.current?.stop(), contexto };
}

// Se decide una sola vez al cargar la app, así el hook siempre llama a los mismos hooks
export const useMotor: () => Motor = rne ? useMotorEnTelefono : useMotorNoDisponible;

function nuevaSesion(resource: Modelo) {
  return rne!.createLLMChatSession(resource, {
    initialMessages: [{ role: 'system', content: instrucciones() }],
    generationConfig: GENERACION,
  });
}
