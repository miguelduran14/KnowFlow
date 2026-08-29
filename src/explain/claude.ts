import type { ExplanationProvider } from './provider.js'
import { readSseStream } from './sse.js'

const API_URL = 'https://api.anthropic.com/v1/messages'
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5'

export interface ClaudeProviderOptions {
  /** Clave del usuario (BYOK) — nunca sale de su máquina salvo hacia Anthropic */
  apiKey: string
  model?: string | undefined
  maxTokens?: number | undefined
}

/** Convierte un fallo de la API en un mensaje accionable para el usuario. */
async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  let detail = raw
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    if (parsed.error?.message) detail = parsed.error.message
  } catch {
    // La respuesta no era JSON (p. ej. una página HTML de error): se usa cruda.
  }
  const hint =
    response.status === 401
      ? ' — revisa la clave API.'
      : response.status === 404
        ? ' — revisa el nombre del modelo.'
        : response.status === 429
          ? ' — límite de tasa o saldo agotado.'
          : ''
  return `Claude API ${response.status}${hint} ${detail.slice(0, 300)}`.trim()
}

function baseHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Permite la llamada directa navegador → Anthropic (diseño local-first/BYOK).
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

/**
 * Adaptador Claude (Anthropic Messages API). Usa fetch, así que funciona
 * igual en Node 18+ y en navegador; la llamada va directa del navegador del
 * usuario a Anthropic, sin servidor intermedio.
 */
export function createClaudeProvider(options: ClaudeProviderOptions): ExplanationProvider {
  const model = options.model ?? DEFAULT_CLAUDE_MODEL
  const maxTokens = options.maxTokens ?? 2000

  return {
    id: 'claude',

    async complete(system: string, user: string): Promise<string> {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: baseHeaders(options.apiKey),
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      })
      if (!response.ok) throw new Error(await readError(response))

      const data = (await response.json()) as { content?: { type: string; text?: string }[] }
      const text = (data.content ?? [])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('')
      if (text === '') throw new Error('Claude devolvió una respuesta vacía')
      return text
    },

    async stream(system: string, user: string, onChunk: (chunk: string) => void): Promise<string> {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: baseHeaders(options.apiKey),
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          stream: true,
        }),
      })
      if (!response.ok) throw new Error(await readError(response))
      if (!response.body) throw new Error('Claude no devolvió un cuerpo en streaming')

      let text = ''
      await readSseStream(response.body, event => {
        const e = event as { type?: string; delta?: { type?: string; text?: string } }
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
          text += e.delta.text
          onChunk(e.delta.text)
        }
      })
      if (text === '') throw new Error('Claude devolvió una respuesta vacía')
      return text
    },
  }
}
