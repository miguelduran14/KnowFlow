import type { ExplanationProvider } from './provider.js'
import { readSseStream } from './sse.js'

export interface OpenAICompatibleOptions {
  /**
   * URL completa del endpoint de chat completions. No se asume ninguna
   * ruta: se pasa tal cual la publique el gateway. Ejemplos:
   *   - OpenAI:  https://api.openai.com/v1/chat/completions
   *   - Azure:   https://<rec>.openai.azure.com/openai/deployments/<dep>/chat/completions?api-version=2024-02-01
   *   - Gateway corporativo (CODEX/AXET): la URL que te den.
   */
  endpoint: string
  /** Clave/token del usuario (BYOK) — solo viaja hacia `endpoint` */
  apiKey: string
  /** Identificador de modelo tal como lo espera el gateway */
  model: string
  /**
   * Cabecera de autenticación. Por defecto `Authorization: Bearer <clave>`
   * (OpenAI y la mayoría). Azure usa `api-key: <clave>` → { name: 'api-key',
   * prefix: '' }. Un gateway propio puede pedir otra cosa.
   */
  auth?: { name?: string | undefined; prefix?: string | undefined } | undefined
  /** Cabeceras extra (org id, versión de API, etc.) */
  headers?: Record<string, string> | undefined
  /** Etiqueta del proveedor, para distinguirlo en la UI ('codex', 'axet'…) */
  id?: string | undefined
  maxTokens?: number | undefined
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

/**
 * Convierte un fallo del gateway en un mensaje accionable. Cubre los tres
 * modos de fallo típicos de una pasarela corporativa cuyo shape no controlas:
 * código de error HTTP, respuesta que no es JSON (URL mal, página de login),
 * y JSON que no sigue el formato OpenAI (falta `choices`).
 */
async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  let detail = raw
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    if (parsed.error?.message) detail = parsed.error.message
  } catch {
    // No era JSON.
  }
  const hint =
    response.status === 401 || response.status === 403
      ? ' — revisa la clave/token y la cabecera de auth.'
      : response.status === 404
        ? ' — revisa el endpoint y el nombre del modelo.'
        : response.status === 429
          ? ' — límite de tasa o cuota agotada.'
          : ''
  return `El endpoint respondió ${response.status}${hint} ${detail.slice(0, 300)}`.trim()
}

/**
 * Adaptador para cualquier API compatible con OpenAI (`/chat/completions`).
 * Vía "lista para conectar" a una IA corporativa cuyo shape exacto aún no se
 * conoce: casi todos los gateways (Azure OpenAI, pasarelas internas, la
 * mayoría de endpoints tipo CODEX/AXET) hablan este formato.
 *
 * Mismo contrato BYOK/local-first que el adaptador Claude: la llamada va
 * directa del navegador del usuario al `endpoint` que él configure. Que ese
 * endpoint acepte código de clientes es su decisión (restricción de IP).
 * Si el gateway NO fuese compatible, la interfaz `ExplanationProvider`
 * permite un adaptador a medida sin tocar el resto del motor.
 */
export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ExplanationProvider {
  const authName = options.auth?.name ?? 'Authorization'
  const authPrefix = options.auth?.prefix ?? 'Bearer '
  const maxTokens = options.maxTokens ?? 2000

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    [authName]: `${authPrefix}${options.apiKey}`,
    ...options.headers,
  })

  const body = (system: string, user: string, stream: boolean): string =>
    JSON.stringify({
      model: options.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(stream ? { stream: true } : {}),
    })

  return {
    id: options.id ?? 'openai-compatible',

    async complete(system: string, user: string): Promise<string> {
      const response = await fetch(options.endpoint, { method: 'POST', headers: headers(), body: body(system, user, false) })
      if (!response.ok) throw new Error(await readError(response))

      const raw = await response.text()
      let data: ChatResponse
      try {
        data = JSON.parse(raw) as ChatResponse
      } catch {
        throw new Error(
          'El endpoint respondió, pero no en JSON. Revisa que la URL apunte al chat de completions y no a una página de login o a otra ruta.',
        )
      }
      if (!Array.isArray(data.choices)) {
        const why = data.error?.message ? `: ${data.error.message}` : ''
        throw new Error(
          `El endpoint respondió pero no en formato compatible con OpenAI (falta "choices")${why}. Confirma que es un endpoint de chat completions.`,
        )
      }
      const text = data.choices[0]?.message?.content ?? ''
      if (text === '') throw new Error('El proveedor devolvió una respuesta vacía')
      return text
    },

    async stream(system: string, user: string, onChunk: (chunk: string) => void): Promise<string> {
      const response = await fetch(options.endpoint, { method: 'POST', headers: headers(), body: body(system, user, true) })
      if (!response.ok) throw new Error(await readError(response))
      if (!response.body) throw new Error('El endpoint no devolvió un cuerpo en streaming')

      let text = ''
      await readSseStream(response.body, event => {
        const e = event as { choices?: { delta?: { content?: string } }[] }
        const chunk = e.choices?.[0]?.delta?.content
        if (chunk) {
          text += chunk
          onChunk(chunk)
        }
      })
      if (text === '') throw new Error('El proveedor devolvió una respuesta vacía')
      return text
    },
  }
}
