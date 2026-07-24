import type { ExplanationProvider } from './provider.js'

const API_URL = 'https://api.anthropic.com/v1/messages'
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5'

export interface ClaudeProviderOptions {
  /** Clave del usuario (BYOK) — nunca sale de su máquina salvo hacia Anthropic */
  apiKey: string
  model?: string | undefined
  maxTokens?: number | undefined
}

/**
 * Adaptador Claude (Anthropic Messages API). Usa fetch, así que funciona
 * igual en Node 18+ y en navegador; la cabecera
 * anthropic-dangerous-direct-browser-access permite la llamada directa
 * navegador → Anthropic, que es exactamente el diseño local-first/BYOK:
 * el código del usuario no pasa por ningún servidor intermedio.
 */
export function createClaudeProvider(options: ClaudeProviderOptions): ExplanationProvider {
  return {
    id: 'claude',
    async complete(system: string, user: string): Promise<string> {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: options.model ?? DEFAULT_CLAUDE_MODEL,
          max_tokens: options.maxTokens ?? 2000,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Claude API ${response.status}: ${detail.slice(0, 300)}`)
      }

      const data = (await response.json()) as { content?: { type: string; text?: string }[] }
      const text = (data.content ?? [])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('')

      if (text === '') throw new Error('El proveedor devolvió una respuesta vacía')
      return text
    },
  }
}
