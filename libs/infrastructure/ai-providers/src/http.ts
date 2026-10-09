/**
 * Cliente HTTP compartido OpenAI-compatible (/chat/completions).
 * Usado por OpenRouterProvider (§15) y CustomEndpointProvider (§16).
 *
 * - Timeout por llamada (AbortController).
 * - Reintentos solo ante fallos transitorios: red, 429, 5xx. Nunca ante 4xx (salvo 429).
 * - Backoff exponencial para no agravar rate limits (§36).
 */
export interface ChatRequest {
  url: string;
  label: string;
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;
  userPayload: unknown;
  timeoutMs: number;
  maxRetries: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  tokens?: number;
  latencyMs: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function postChatCompletions(req: ChatRequest): Promise<ChatResult> {
  const started = Date.now();
  const maxAttempts = Math.max(1, req.maxRetries + 1);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (req.signal?.aborted) throw req.signal.reason;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    const onAbort = () => ctrl.abort(req.signal?.reason);
    req.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(req.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: req.model,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: JSON.stringify(req.userPayload) },
          ],
        }),
      });

      if (!res.ok) {
        const snippet = (await res.text().catch(() => '')).slice(0, 500);
        const err = new Error(`${req.label} ${res.status}: ${snippet}`);
        // No reintentar errores de cliente (400, 401, 403, 404...) salvo 429.
        if (!RETRYABLE_STATUS.has(res.status)) throw err;
        lastError = err;
      } else {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { total_tokens?: number };
        };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.length === 0) {
          throw new Error(`${req.label}: respuesta vacía sin choices[0].message.content`);
        }
        return { content, tokens: data.usage?.total_tokens, latencyMs: Date.now() - started };
      }
    } catch (e) {
      const err = e as Error;
      // Abort (timeout) y errores de cliente: no reintentar.
      if (err.name === 'AbortError') {
        if (req.signal?.aborted) throw req.signal.reason;
        throw new Error(`${req.label}: timeout tras ${req.timeoutMs}ms`, { cause: e });
      }
      if (/ (400|401|403|404|422):/.test(err.message)) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }

    if (attempt < maxAttempts) {
      await sleep(250 * 2 ** (attempt - 1), req.signal);
    }
  }

  throw lastError ?? new Error(`${req.label}: fallo desconocido`);
}

/** Limpia fences ```json ... ``` y parsea; error claro si el modelo no devolvió JSON. */
export function parseJsonResponse(label: string, raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`${label}: el modelo no devolvió JSON válido: ${cleaned.slice(0, 300)}`);
  }
}
