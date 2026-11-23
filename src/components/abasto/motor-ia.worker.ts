/**
 * Hilo aparte (Web Worker) donde corre el modelo del asistente en la web: así la pantalla no se traba mientras se
 * carga o escribe. motor-ia.ts lo arranca y le manda las preguntas; aquí solo se atienden con WebLLM.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
