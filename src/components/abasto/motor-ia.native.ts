/**
 * Motor del asistente en Android y iPhone: Qwen 3 0.6B con react-native-executorch, dentro del teléfono.
 * La versión web está en motor-ia.ts.
 */
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { useEffect, useRef, useState } from 'react';
import {
  createLLMChatSession, download, models, setTelemetryEnabled, useResourceDownload, type LLMChatSession,
} from 'react-native-executorch';

import { instrucciones, limpiarRespuesta, type EstadoMotor, type Motor } from '@/data/asistente';

setTelemetryEnabled(false);

// Qwen 3 de 0.6 mil millones de parámetros: entiende español y redacta bien con los datos que se le pasan.
// Se descarga una vez (518 MB) y desde entonces funciona sin internet
const MODELO = models.llm.QWEN3_0_6B.XNNPACK_8DA4W;
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
  const red = await getNetworkStateAsync().catch(() => null);
  if (!red?.isConnected || (red.type !== NetworkStateType.WIFI && red.type !== NetworkStateType.ETHERNET)) return;
  await download(MODELO).catch(() => undefined);
}

export function useMotor(): Motor {
  const { resource, downloadProgress, downloadError } = useResourceDownload(MODELO);
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

function nuevaSesion(resource: typeof MODELO) {
  return createLLMChatSession(resource, {
    initialMessages: [{ role: 'system', content: instrucciones() }],
    generationConfig: GENERACION,
  });
}
