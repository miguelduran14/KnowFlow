import type { ExplanationProvider } from './provider.js'

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
 * Adaptador para cualquier API compatible con OpenAI (`/chat/completions`).
 * Es la vía "lista para conectar" a una IA corporativa cuyo shape exacto
 * aún no se conoce: casi todos los gateways —Azure OpenAI, pasarelas
 * internas, la mayoría de endpoints tipo CODEX/AXET— hablan este formato.
 *
 * Cumple el mismo contrato BYOK/local-first que el adaptador Claude: usa
 * fetch y la llamada va directa del navegador del usuario al `endpoint`
 * que él configure, sin pasar por ningún servidor de KnowFlow. Que ese
 * endpoint acepte código de clientes es decisión y responsabilidad del
 * usuario (restricción de IP del proyecto), no de esta capa.
 *
 * Si el gateway objetivo NO fuese compatible con OpenAI, la interfaz
 * `ExplanationProvider` permite escribir un adaptador a medida sin tocar
 * el resto del motor.
 */
export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ExplanationProvider {
  const authName = options.auth?.name ?? 'Authorization'
  const authPrefix = options.auth?.prefix ?? 'Bearer '

  return {
    id: options.id ?? 'openai-compatible',
    async complete(system: string, user: string): Promise<string> {
      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [authName]: `${authPrefix}${options.apiKey}`,
          ...options.headers,
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: options.maxTokens ?? 2000,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`API ${response.status}: ${detail.slice(0, 300)}`)
      }

      const data = (await response.json()) as ChatResponse
      const text = data.choices?.[0]?.message?.content ?? ''
      if (text === '') {
        const why = data.error?.message ? `: ${data.error.message}` : ''
        throw new Error(`El proveedor devolvió una respuesta vacía${why}`)
      }
      return text
    },
  }
}
