/**
 * Motor del asistente en Android y iPhone: Qwen 3 0.6B con react-native-executorch, dentro del teléfono.
 * La versión web está en motor-ia.ts.
 *
 * La librería trae código nativo: solo existe en la app instalada (build de EAS o de desarrollo), no en Expo Go.
 * Por eso se carga con require y solo si está disponible; si no, el resto de la app funciona y el asistente avisa.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { useEffect, useRef, useState } from 'react';
import type { LLMChatSession } from 'react-native-executorch';

import { instrucciones, limpiarRespuesta, type EstadoMotor, type Motor } from '@/data/asistente';

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

// Qwen 3 de 0.6 mil millones de parámetros: entiende español y redacta bien con los datos que se le pasan.
// Se descarga una vez (518 MB) y desde entonces funciona sin internet
const MODELO = rne?.models.llm.QWEN3_0_6B.XNNPACK_8DA4W;
type Modelo = NonNullable<typeof MODELO>;
// Sin razonamiento visible (más rápido), casi sin aleatoriedad para que se apegue a los datos, y con castigo a
// repetir para que no se cicle
const GENERACION = { enableThinking: false, temperature: 0.2, topP: 0.8, topK: 20, repetitionPenalty: 1.1, maxNewTokens: 300 };
/** Con más de esto de la memoria de contexto ocupada, se empieza otra sesión antes de la siguiente pregunta. */
const USO_MAXIMO = 0.5;

export const INFO_MOTOR = { tamano: '520 MB', lugar: 'tu teléfono' };

/**
 * Descarga el modelo en segundo plano al abrir la app, solo con Wi-Fi o cable (no gasta datos móviles), para que
 * el asistente esté listo cuando se abra. Si ya está descargado no hace nada; si se interrumpe, la siguiente vez
 * continúa donde se quedó. Si el asistente se abre a media descarga, se une a esta en vez de empezar otra.
 */
export async function precargarModelo() {
  if (!rne || !MODELO) return;
  const red = await getNetworkStateAsync().catch(() => null);
  if (!red?.isConnected || (red.type !== NetworkStateType.WIFI && red.type !== NetworkStateType.ETHERNET)) return;
  await rne.download(MODELO).catch(() => undefined);
}

/** Sin la librería (Expo Go): el asistente explica que necesita la app instalada. */
function useMotorNoDisponible(): Motor {
  return {
    estado: { fase: 'error', tipo: 'app', detalle: 'react-native-executorch no está en esta app (Expo Go)' },
    enviar: async () => {
      throw new Error('El asistente no está disponible en esta versión de la app.');
    },
    detener: () => undefined,
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

  useEffect(() => {
    if (!resource) return;
    let vivo = true;
    nuevaSesion(resource)
      .then((s) => {
        if (vivo) {
          sesion.current = s;
          setListo(true);
        } else {
          s.dispose();
        }
      })
      .catch((e: unknown) => vivo && setErrorCarga(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
      const s = sesion.current;
      sesion.current = null;
      if (!s) return;
      // Al cerrar la hoja a media respuesta: se detiene y se libera cuando termine
      s.stop();
      (enCurso.current ?? Promise.resolve()).catch(() => undefined).finally(() => s.dispose());
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
    // Cada pregunta lleva sus datos: la memoria de contexto se llena en pocas preguntas y entonces se empieza de nuevo
    if (sesion.current.getKVCacheState().usageRatio > USO_MAXIMO) await reiniciar();
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

  return { estado, enviar, detener: () => sesion.current?.stop() };
}

// Se decide una sola vez al cargar la app, así el hook siempre llama a los mismos hooks
export const useMotor: () => Motor = rne ? useMotorEnTelefono : useMotorNoDisponible;

function nuevaSesion(resource: Modelo) {
  return rne!.createLLMChatSession(resource, {
    initialMessages: [{ role: 'system', content: instrucciones() }],
    generationConfig: GENERACION,
  });
}
