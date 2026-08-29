import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeProvider } from '../src/explain/claude.js'

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('adaptador Claude', () => {
  it('complete devuelve el texto concatenado de los bloques', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async json() {
          return { content: [{ type: 'text', text: 'una ' }, { type: 'text', text: 'explicación' }] }
        },
        async text() { return '' },
      })) as unknown as typeof fetch,
    )
    const provider = createClaudeProvider({ apiKey: 'sk-ant-x' })
    expect(await provider.complete('s', 'u')).toBe('una explicación')
  })

  it('un 401 se traduce a un mensaje con pista sobre la clave', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        async text() { return JSON.stringify({ error: { message: 'invalid x-api-key' } }) },
      })) as unknown as typeof fetch,
    )
    const provider = createClaudeProvider({ apiKey: 'bad' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/401.*clave/i)
  })

  it('streaming: acumula los text_delta y emite cada fragmento', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Abre "}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"el cursor."}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
      async text() { return '' },
    })) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchSpy)

    const provider = createClaudeProvider({ apiKey: 'sk-ant-x' })
    const chunks: string[] = []
    const full = await provider.stream!('s', 'u', c => chunks.push(c))

    expect(chunks).toEqual(['Abre ', 'el cursor.'])
    expect(full).toBe('Abre el cursor.')
    const [, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(JSON.parse((init as RequestInit).body as string).stream).toBe(true)
  })
})
