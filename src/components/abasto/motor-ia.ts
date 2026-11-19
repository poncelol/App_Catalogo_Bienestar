/**
 * Motor del asistente en la versión web: un modelo pequeño con WebLLM, dentro del navegador y en la tarjeta gráfica
 * (WebGPU). Nada sale del navegador. La versión de Android y iPhone está en motor-ia.native.ts.
 *
 * El modelo depende del equipo:
 * - Computadora con 8 GB de memoria o más: Qwen 3 1.7B (descarga de ~1 GB, ~2 GB de tarjeta gráfica). Redacta mejor.
 * - Teléfono o computadora con poca memoria: Llama 3.2 1B (~700 MB, ~0.9 GB de tarjeta gráfica). Su memoria de
 *   contexto es mucho más chica que la de Qwen (~32 KB por token contra ~114 KB): usa menos tarjeta gráfica que el
 *   Qwen 3 0.6B de antes, aun siendo más grande.
 *
 * Para no ocupar la tarjeta gráfica de más, el modelo se suelta cuando la página pasa a segundo plano (si no, en
 * Android el sistema le quita la memoria a media respuesta) y tras unos minutos con el asistente cerrado. Al volver
 * se carga del almacenamiento del navegador, sin descargarse otra vez.
 */
import type { ChatCompletionMessageParam, MLCEngine } from '@mlc-ai/web-llm';
import { useEffect, useRef, useState } from 'react';

import { instrucciones, limpiarRespuesta, RESPUESTA_MAX, type EstadoMotor, type Motor } from '@/data/asistente';

type Perfil = {
  /** Con números de 16 bits si la tarjeta gráfica los admite (más rápido y ligero); si no, de 32. */
  f16: string;
  f32: string;
  tamano: string;
  /** Los Qwen 3 razonan antes de responder si no se les pide lo contrario (enable_thinking). */
  qwen3: boolean;
};

const COMPLETO: Perfil = { f16: 'Qwen3-1.7B-q4f16_1-MLC', f32: 'Qwen3-1.7B-q4f32_1-MLC', tamano: '1 GB', qwen3: true };
const LIGERO: Perfil = { f16: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', f32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', tamano: '700 MB', qwen3: false };
/** Modelos de versiones anteriores: se borran del navegador para no ocupar espacio. */
const ANTERIORES = ['Qwen3-0.6B-q4f16_1-MLC', 'Qwen3-0.6B-q4f32_1-MLC'];

/** Teléfono, o computadora con menos de 8 GB (deviceMemory solo existe en Chrome y Edge; sin él se supone suficiente). */
function perfil(): Perfil {
  if (typeof navigator === 'undefined') return LIGERO; // (al generar las páginas estáticas)
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const movil = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav.userAgent);
  return movil || (nav.deviceMemory ?? 8) < 8 ? LIGERO : COMPLETO;
}

/** Preguntas anteriores (con sus datos) que se le recuerdan al modelo; más llenaría su memoria de contexto. */
const TURNOS_PREVIOS = 2;
/** Memoria de contexto de los dos modelos en WebLLM (context_window_size), en tokens. */
const CONTEXTO = 4096;
/** Lo que se aparta para las preguntas y respuestas anteriores que se le recuerdan. */
const RESERVA_HISTORIAL = TURNOS_PREVIOS * (60 + RESPUESTA_MAX);
/** Con el asistente cerrado este tiempo, se suelta el modelo. */
const LIBERAR_TRAS_MS = 5 * 60 * 1000;

export const INFO_MOTOR = {
  get tamano() {
    return perfil().tamano;
  },
  lugar: 'tu navegador',
};

/**
 * En la web no se descarga en segundo plano: sería casi 1 GB para cada visitante de la página, lo use o no.
 * Se descarga solo al abrir el asistente.
 */
export async function precargarModelo() {}

type Gpu = { requestAdapter: () => Promise<{ features: { has: (f: string) => boolean } } | null> };

/** Intentos de descarga: si la red se corta, las partes ya guardadas no se vuelven a bajar. */
const INTENTOS = 3;

class SinWebGpu extends Error {}

// El modelo se carga una vez y se comparte entre las veces que se abre la hoja. La descarga queda en el
// almacenamiento del navegador para las siguientes visitas
let cargado: { motor: MLCEngine; perfil: Perfil } | null = null;
let carga: Promise<{ motor: MLCEngine; perfil: Perfil }> | null = null;
let informar: (e: EstadoMotor) => void = () => undefined;
/** Hojas del asistente abiertas y respuestas en curso: mientras haya alguna, el modelo no se suelta. */
let abiertas = 0;
let generando = 0;
let temporizador: ReturnType<typeof setTimeout> | undefined;

function cargarMotor(onEstado: (e: EstadoMotor) => void) {
  informar = onEstado;
  carga ??= crearMotor().then(
    (m) => (cargado = m),
    (e: unknown) => {
      carga = null; // para que «Reintentar» empiece de nuevo
      throw e;
    },
  );
  return carga;
}

/** Suelta el modelo de la tarjeta gráfica; la siguiente pregunta lo vuelve a cargar. */
async function liberar() {
  // (si todavía se está cargando, se deja terminar: soltarlo a la mitad dejaría la carga a medias)
  const m = cargado;
  if (!m) return;
  cargado = null;
  carga = null;
  await m?.motor.unload().catch(() => undefined);
}

function liberarSiNoSeUsa() {
  if (!generando && (document.visibilityState === 'hidden' || !abiertas)) void liberar();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') liberarSiNoSeUsa();
  });
}

async function crearMotor() {
  const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
  const adaptador = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (!adaptador) throw new SinWebGpu('WebGPU no disponible');
  const p = perfil();
  const modelo = adaptador.features.has('shader-f16') ? p.f16 : p.f32;
  // Sin esto el navegador puede borrar la descarga cuando le falta espacio, y habría que bajarla otra vez
  await navigator.storage?.persist?.().catch(() => false);
  // Se carga aparte: la librería es grande y solo hace falta al abrir el asistente
  const webllm = await import('@mlc-ai/web-llm');
  for (let intento = 1; ; intento++) {
    const enCache = await webllm.hasModelInCache(modelo).catch(() => false);
    const avance = (progreso: number): EstadoMotor => (enCache ? { fase: 'cargando', progreso } : { fase: 'descargando', progreso });
    informar(avance(0));
    try {
      const motor = await webllm.CreateMLCEngine(modelo, { initProgressCallback: (x) => informar(avance(x.progress * 100)) });
      // Ya con el nuevo listo, se borran los de versiones anteriores
      for (const viejo of ANTERIORES) {
        void webllm.hasModelInCache(viejo).then((hay) => (hay ? webllm.deleteModelAllInfoInCache(viejo) : undefined)).catch(() => undefined);
      }
      return { motor, perfil: p };
    } catch (e) {
      if (intento >= INTENTOS || !esDeRed(e)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * intento));
    }
  }
}

const detalle = (e: unknown) => (e instanceof Error ? e.message : String(e));
const esDeRed = (e: unknown) => /fetch|network|load failed|timeout|aborted|connection/i.test(detalle(e));

export function useMotor(): Motor {
  const [estado, setEstado] = useState<EstadoMotor>(() => (cargado ? { fase: 'listo' } : { fase: 'revisando' }));
  const historial = useRef<ChatCompletionMessageParam[]>([]);
  const cancelado = useRef(false);

  useEffect(() => {
    abiertas++;
    clearTimeout(temporizador);
    let vivo = true;
    if (!cargado) {
      cargarMotor((e) => vivo && setEstado(e))
        .then(() => vivo && setEstado({ fase: 'listo' }))
        .catch((e: unknown) => {
          if (!vivo) return;
          const tipo = e instanceof SinWebGpu ? 'navegador' : esDeRed(e) || /cache|quota|storage/i.test(detalle(e)) ? 'descarga' : 'carga';
          setEstado({ fase: 'error', tipo, detalle: detalle(e) });
        });
    }
    return () => {
      // La carga sigue aunque se cierre la hoja; solo deja de avisar a esta. Si sigue cerrada, se suelta el modelo
      vivo = false;
      abiertas--;
      clearTimeout(temporizador);
      temporizador = setTimeout(liberarSiNoSeUsa, LIBERAR_TRAS_MS);
    };
  }, []);

  const enviar: Motor['enviar'] = async (mensaje, onCrudo) => {
    cancelado.current = false;
    generando++;
    try {
      // Si se soltó el modelo (segundo plano, tarjeta gráfica reiniciada), se vuelve a cargar aquí, sin avisar:
      // ya está en el almacenamiento del navegador, así que no se descarga otra vez
      const { motor: m, perfil: p } = cargado ?? (await cargarMotor(() => undefined));
      const pregunta: ChatCompletionMessageParam = { role: 'user', content: mensaje };
      const generar = async (previos: ChatCompletionMessageParam[]) => {
        // Casi sin aleatoriedad, para que se apegue a los datos, y con castigo a repetir, para que no se cicle
        const flujo = await m.chat.completions.create({
          messages: [{ role: 'system', content: instrucciones() }, ...previos, pregunta],
          stream: true,
          temperature: 0.2,
          top_p: 0.8,
          frequency_penalty: 0.3,
          presence_penalty: 0, // explícito: si falta, WebLLM avisa en cada pregunta
          max_tokens: RESPUESTA_MAX,
          // Solo a Qwen 3: WebLLM le agrega a cualquier modelo un bloque <think> vacío, que a otros los confunde
          ...(p.qwen3 ? { extra_body: { enable_thinking: false } } : {}),
        });
        let salida = '';
        for await (const parte of flujo) {
          salida += parte.choices[0]?.delta?.content ?? '';
          onCrudo(salida);
        }
        return salida;
      };
      let salida: string;
      try {
        salida = await generar(historial.current);
      } catch (e) {
        // Memoria de contexto llena: se olvidan las preguntas anteriores y se intenta otra vez
        if (/context|window|exceed|too long/i.test(detalle(e)) && historial.current.length) {
          historial.current = [];
          salida = await generar([]);
        } else {
          // La tarjeta gráfica se reinició (pestaña en segundo plano, controlador; «mapAsync … Buffer was unmapped»:
          // Android liberó su memoria a media respuesta). Se suelta el modelo para que el siguiente intento lo cargue
          // de nuevo; el chat reintenta solo y, si tampoco sale, responde con los datos del catálogo
          if (/device|lost|disposed|unload|unmapped|mapAsync|GPUBuffer/i.test(detalle(e))) await liberar();
          throw e;
        }
      }
      if (cancelado.current) return { texto: '', cancelado: true };
      const texto = limpiarRespuesta(salida);
      // Se recuerda la pregunta sin sus datos: con los de antes a la vista, un modelo pequeño los mezcla con los nuevos
      const sinDatos = mensaje.match(/Pregunta: ([\s\S]*?)(\n\n|$)/)?.[1] ?? mensaje;
      historial.current = [...historial.current, { role: 'user' as const, content: sinDatos }, { role: 'assistant' as const, content: texto }]
        .slice(-TURNOS_PREVIOS * 2);
      return { texto, cancelado: false };
    } finally {
      generando--;
      // Si la página pasó a segundo plano mientras respondía, se suelta al terminar
      if (document.visibilityState === 'hidden') liberarSiNoSeUsa();
    }
  };

  const detener = () => {
    cancelado.current = true;
    cargado?.motor.interruptGenerate();
  };

  return { estado, enviar, detener, contexto: CONTEXTO - RESERVA_HISTORIAL };
}
