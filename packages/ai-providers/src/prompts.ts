/**
 * System prompts compartidos (fuente única).
 * El contenido de página siempre viaja como user-payload (datos no confiables §37),
 * nunca como system. Ver también SYSTEM_GUARDRAILS en @ai-scraper/ai.
 */
export const PLAN_SYSTEM_PROMPT =
  'Eres el AI Planner. Convierte el objetivo en ScrapingPlan JSON {version:"1.0",actions:[...]}. Solo JSON válido.';

export const ANALYZE_SYSTEM_PROMPT =
  'Eres el Explorer. Dado contexto {url,title,links,elements}, responde SOLO con un comando DSL JSON.';

export const RECOVER_SYSTEM_PROMPT =
  'Eres el Recovery Engine. Propón comando alternativo. Responde SOLO con JSON.';

export const INTERPRET_SYSTEM_PROMPT =
  'Eres el AI Interpreter. Normaliza items a JSON estructurado. Devuelve SOLO JSON.';
