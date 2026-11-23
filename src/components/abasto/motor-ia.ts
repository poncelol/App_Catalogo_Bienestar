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
 * El modelo corre en un Web Worker (motor-ia.worker.ts), un hilo aparte: la pantalla no se traba mientras carga o
 * escribe. Si el navegador no puede crear el worker, corre en la página como antes.
 *
 * Memoria: si el asistente se usó en los últimos días y el modelo ya está descargado, se carga al abrir la página
 * (en espera), para que al abrir el asistente ya esté listo. Se suelta cuando la página pasa a segundo plano (si no,
 * en Android el sistema le quita la memoria a media respuesta) y tras un rato con el asistente cerrado (5 minutos en
 * teléfono, 20 en computadora). Al volver se carga del almacenamiento del navegador, sin descargarse otra vez.
 */
import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { useEffect, useRef, useState } from 'react';

import { instrucciones, limpiarRespuesta, RESPUESTA_MAX, type EstadoMotor, type Motor } from '@/data/asistente';

type Perfil = {
  /** Con números de 16 bits si la tarjeta gráfica los admite (más rápido y ligero); si no, de 32. */
  f16: string;
  f32: string;
  tamano: string;
  /** Los Qwen 3 razonan antes de responder si no se les pide lo contrario (enable_thinking). */
  qwen3: boolean;
  /** Con el asistente cerrado este tiempo, se suelta el modelo. */
  liberarTrasMs: number;
  /** Artículos y caracteres de datos por pregunta: en teléfono, menos, para que empiece a responder antes. */
  maxArticulos: number;
  maxDatos: number;
};

const COMPLETO: Perfil = {
  f16: 'Qwen3-1.7B-q4f16_1-MLC', f32: 'Qwen3-1.7B-q4f32_1-MLC', tamano: '1 GB', qwen3: true, liberarTrasMs: 20 * 60 * 1000,
  maxArticulos: 8, maxDatos: 5000,
};
const LIGERO: Perfil = {
  f16: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', f32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', tamano: '700 MB', qwen3: false, liberarTrasMs: 5 * 60 * 1000,
  maxArticulos: 5, maxDatos: 3000,
};
/** Modelos de versiones anteriores: se borran del navegador para no ocupar espacio. */
const ANTERIORES = ['Qwen3-0.6B-q4f16_1-MLC', 'Qwen3-0.6B-q4f32_1-MLC'];

/** Teléfono, o computadora con menos de 8 GB (deviceMemory solo existe en Chrome y Edge; sin él se supone suficiente). */
function perfil(): Perfil {
  if (typeof navigator === 'undefined') return LIGERO; // (al generar las páginas estáticas)
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const movil = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav.userAgent);
  return movil || (nav.deviceMemory ?? 8) < 8 ? LIGERO : COMPLETO;
}

/**
 * Memoria de contexto de los dos modelos en WebLLM (context_window_size), en tokens. Cada pregunta va sola, sin las
 * anteriores: WebLLM solo aprovecha lo ya leído si la conversación es idéntica a la anterior más un mensaje, y como
 * cada pregunta trae datos distintos, con historial releía todo cada vez (más lento). El tema de la conversación lo
 * sigue la app («¿y el más caro?», ver conContexto).
 */
const CONTEXTO = 4096;
/** Si el asistente se usó en estos días, el modelo se carga al abrir la página. */
const DIAS_PRECARGA = 7;
const CLAVE_USO = 'asistente.ultimoUso';

export const INFO_MOTOR = {
  get tamano() {
    return perfil().tamano;
  },
  lugar: 'tu navegador',
};

function ultimoUso() {
  try {
    return Number(localStorage.getItem(CLAVE_USO)) || 0;
  } catch {
    return 0;
  }
}

function registrarUso() {
  try {
    localStorage.setItem(CLAVE_USO, String(Date.now()));
  } catch {
    // (navegación privada o almacenamiento bloqueado: solo no se precarga la próxima vez)
  }
}

/**
 * Al abrir la página: si el asistente se usó en los últimos días y el modelo ya está descargado, lo carga en espera
 * (en el worker, sin trabar la pantalla). Nunca descarga: sería casi 1 GB para cada visitante, lo use o no; la
 * descarga empieza solo al abrir el asistente.
 */
export async function precargarModelo() {
  if (typeof document === 'undefined' || cargado || carga) return;
  if (Date.now() - ultimoUso() > DIAS_PRECARGA * 864e5) return;
  // Unos segundos después, para no competir con la descarga del catálogo y el dibujo de la página
  await new Promise((r) => setTimeout(r, 4000));
  if (document.visibilityState === 'hidden' || cargado || carga) return;
  const p = perfil();
  const webllm = await import('@mlc-ai/web-llm');
  const enCache = await Promise.all([p.f16, p.f32].map((m) => webllm.hasModelInCache(m).catch(() => false)));
  if (!enCache.some(Boolean)) return;
  await cargarMotor(() => undefined).catch(() => undefined);
  if (!abiertas) programarLiberar();
}

/** En la web cada conversación ya empieza sin historial (vive en el chat, que se crea de nuevo). */
export function nuevaConversacion() {}

type Gpu = { requestAdapter: () => Promise<{ features: { has: (f: string) => boolean } } | null> };

/** Intentos de descarga: si la red se corta, las partes ya guardadas no se vuelven a bajar. */
const INTENTOS = 3;

class SinWebGpu extends Error {}

// El modelo se carga una vez y se comparte entre las veces que se abre la hoja. La descarga queda en el
// almacenamiento del navegador para las siguientes visitas
type Cargado = { motor: MLCEngineInterface; perfil: Perfil; worker?: Worker };
let cargado: Cargado | null = null;
let carga: Promise<Cargado> | null = null;
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
  await m.motor.unload().catch(() => undefined);
  // Cerrar el worker devuelve también la memoria que le quede
  m.worker?.terminate();
}

function liberarSiNoSeUsa() {
  if (!generando && (document.visibilityState === 'hidden' || !abiertas)) void liberar();
}

function programarLiberar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(liberarSiNoSeUsa, perfil().liberarTrasMs);
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
    const opciones = { initProgressCallback: (x: { progress: number }) => informar(avance(x.progress * 100)) };
    let worker: Worker | undefined;
    try {
      let motor: MLCEngineInterface;
      try {
        worker = new Worker(new URL('./motor-ia.worker.ts', import.meta.url));
        motor = await webllm.CreateWebWorkerMLCEngine(worker, modelo, opciones);
      } catch (e) {
        worker?.terminate();
        worker = undefined;
        // Un corte de red se reintenta abajo; si el worker no funciona en este navegador, el modelo corre en la página
        if (esDeRed(e)) throw e;
        motor = await webllm.CreateMLCEngine(modelo, opciones);
      }
      // Ya con el nuevo listo, se borran los de versiones anteriores
      for (const viejo of ANTERIORES) {
        void webllm.hasModelInCache(viejo).then((hay) => (hay ? webllm.deleteModelAllInfoInCache(viejo) : undefined)).catch(() => undefined);
      }
      return { motor, perfil: p, worker };
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
  const cancelado = useRef(false);

  useEffect(() => {
    abiertas++;
    clearTimeout(temporizador);
    registrarUso();
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
      if (!abiertas) programarLiberar();
    };
  }, []);

  const enviar: Motor['enviar'] = async (mensaje, onCrudo) => {
    cancelado.current = false;
    generando++;
    try {
      // Si se soltó el modelo (segundo plano, tarjeta gráfica reiniciada), se vuelve a cargar aquí, sin avisar:
      // ya está en el almacenamiento del navegador, así que no se descarga otra vez
      const { motor: m, perfil: p } = cargado ?? (await cargarMotor(() => undefined));
      const generar = async () => {
        // Casi sin aleatoriedad, para que se apegue a los datos, y con castigo a repetir, para que no se cicle
        const flujo = await m.chat.completions.create({
          messages: [{ role: 'system', content: instrucciones() }, { role: 'user', content: mensaje }],
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
        salida = await generar();
      } catch (e) {
        // La tarjeta gráfica se reinició (pestaña en segundo plano, controlador; «mapAsync … Buffer was unmapped»:
        // Android liberó su memoria a media respuesta). Se suelta el modelo para que el siguiente intento lo cargue
        // de nuevo; el chat reintenta solo y, si tampoco sale, responde con los datos del catálogo
        if (/device|lost|disposed|unload|unmapped|mapAsync|GPUBuffer/i.test(detalle(e))) await liberar();
        throw e;
      }
      if (cancelado.current) return { texto: '', cancelado: true };
      return { texto: limpiarRespuesta(salida), cancelado: false };
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

  return { estado, enviar, detener, contexto: CONTEXTO, maxArticulos: perfil().maxArticulos, maxDatos: perfil().maxDatos };
}
