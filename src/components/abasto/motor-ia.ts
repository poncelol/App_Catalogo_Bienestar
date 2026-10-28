/**
 * Motor del asistente en la versión web: el mismo modelo (Qwen 3 0.6B) con WebLLM, dentro del navegador y en la
 * tarjeta gráfica (WebGPU). Nada sale del navegador. La versión de Android y iPhone está en motor-ia.native.ts.
 */
import type { ChatCompletionMessageParam, MLCEngine } from '@mlc-ai/web-llm';
import { useEffect, useRef, useState } from 'react';

import { instrucciones, limpiarRespuesta, type EstadoMotor, type Motor } from '@/data/asistente';

// Con números de 16 bits si la tarjeta gráfica los admite (más rápido y ligero); si no, de 32
const MODELO_F16 = 'Qwen3-0.6B-q4f16_1-MLC';
const MODELO_F32 = 'Qwen3-0.6B-q4f32_1-MLC';
/** Preguntas anteriores (con sus datos) que se le recuerdan al modelo; más llenaría su memoria de contexto. */
const TURNOS_PREVIOS = 2;

export const INFO_MOTOR = { tamano: '500 MB', lugar: 'tu navegador' };

/**
 * En la web no se descarga en segundo plano: serían 500 MB para cada visitante de la página, lo use o no.
 * Se descarga solo al abrir el asistente.
 */
export async function precargarModelo() {}

type Gpu = { requestAdapter: () => Promise<{ features: { has: (f: string) => boolean } } | null> };

/** Intentos de descarga: si la red se corta, las partes ya guardadas no se vuelven a bajar. */
const INTENTOS = 3;

class SinWebGpu extends Error {}

// El modelo se carga una sola vez por página y se queda en la tarjeta gráfica aunque se cierre la hoja: volver a
// abrirla es inmediato. La descarga queda en el almacenamiento del navegador para las siguientes visitas
let cargado: MLCEngine | null = null;
let carga: Promise<MLCEngine> | null = null;
let informar: (e: EstadoMotor) => void = () => undefined;

function cargarMotor(onEstado: (e: EstadoMotor) => void): Promise<MLCEngine> {
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

async function crearMotor(): Promise<MLCEngine> {
  const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
  const adaptador = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (!adaptador) throw new SinWebGpu('WebGPU no disponible');
  const modelo = adaptador.features.has('shader-f16') ? MODELO_F16 : MODELO_F32;
  // Sin esto el navegador puede borrar la descarga cuando le falta espacio, y habría que bajarla otra vez
  await navigator.storage?.persist?.().catch(() => false);
  // Se carga aparte: la librería es grande y solo hace falta al abrir el asistente
  const webllm = await import('@mlc-ai/web-llm');
  for (let intento = 1; ; intento++) {
    const enCache = await webllm.hasModelInCache(modelo).catch(() => false);
    const avance = (progreso: number): EstadoMotor => (enCache ? { fase: 'cargando', progreso } : { fase: 'descargando', progreso });
    informar(avance(0));
    try {
      return await webllm.CreateMLCEngine(modelo, { initProgressCallback: (p) => informar(avance(p.progress * 100)) });
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
    if (cargado) return;
    let vivo = true;
    cargarMotor((e) => vivo && setEstado(e))
      .then(() => vivo && setEstado({ fase: 'listo' }))
      .catch((e: unknown) => {
        if (!vivo) return;
        const tipo = e instanceof SinWebGpu ? 'navegador' : esDeRed(e) || /cache|quota|storage/i.test(detalle(e)) ? 'descarga' : 'carga';
        setEstado({ fase: 'error', tipo, detalle: detalle(e) });
      });
    return () => {
      // La carga sigue aunque se cierre la hoja; solo deja de avisar a esta
      vivo = false;
    };
  }, []);

  const enviar: Motor['enviar'] = async (mensaje, onCrudo) => {
    const m = cargado;
    if (!m) throw new Error('El asistente todavía no está listo.');
    cancelado.current = false;
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
        max_tokens: 300,
        extra_body: { enable_thinking: false },
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
        // La tarjeta gráfica se reinició (pestaña en segundo plano, controlador): al reabrir, se carga de nuevo
        if (/device|lost|disposed|unload/i.test(detalle(e))) {
          cargado = null;
          carga = null;
          setEstado({ fase: 'error', tipo: 'carga', detalle: detalle(e) });
        }
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
  };

  const detener = () => {
    cancelado.current = true;
    cargado?.interruptGenerate();
  };

  return { estado, enviar, detener };
}
