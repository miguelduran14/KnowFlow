import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleProvider } from '../src/explain/openai.js'

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
    async text() { return JSON.stringify(body) },
  })) as unknown as typeof fetch
}

/** Respuesta cuyo cuerpo es texto crudo (no JSON) — página de login, HTML… */
function mockTextFetch(status: number, raw: string): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    async text() { return raw },
  })) as unknown as typeof fetch
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

function mockStreamFetch(chunks: string[]): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    body: sseStream(chunks),
    async text() { return '' },
  })) as unknown as typeof fetch
}

afterEach(() => vi.restoreAllMocks())

describe('adaptador compatible con OpenAI', () => {
  it('manda system + user en formato chat y devuelve el contenido', async () => {
    const fetchSpy = mockFetch(200, { choices: [{ message: { content: 'una explicación' } }] })
    vi.stubGlobal('fetch', fetchSpy)

    const provider = createOpenAICompatibleProvider({
      endpoint: 'https://gateway.corp/v1/chat/completions',
      apiKey: 'SECRETO',
      model: 'corp-llm-1',
    })
    const out = await provider.complete('eres KnowFlow', 'explica esto')

    expect(out).toBe('una explicación')
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('https://gateway.corp/v1/chat/completions')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('corp-llm-1')
    expect(body.messages).toEqual([
      { role: 'system', content: 'eres KnowFlow' },
      { role: 'user', content: 'explica esto' },
    ])
    // Auth por defecto: Authorization: Bearer <clave>
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer SECRETO' })
  })

  it('permite una cabecera de auth a medida (estilo Azure api-key)', async () => {
    const fetchSpy = mockFetch(200, { choices: [{ message: { content: 'ok' } }] })
    vi.stubGlobal('fetch', fetchSpy)

    const provider = createOpenAICompatibleProvider({
      endpoint: 'https://rec.openai.azure.com/…/chat/completions',
      apiKey: 'K',
      model: 'gpt',
      auth: { name: 'api-key', prefix: '' },
      headers: { 'x-org': 'acme' },
      id: 'axet',
    })
    await provider.complete('s', 'u')

    expect(provider.id).toBe('axet')
    const [, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect((init as RequestInit).headers).toMatchObject({ 'api-key': 'K', 'x-org': 'acme' })
  })

  it('propaga un error HTTP con su código', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { error: { message: 'clave inválida' } }))
    const provider = createOpenAICompatibleProvider({ endpoint: 'https://x/y', apiKey: 'bad', model: 'm' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/401/)
  })

  it('una respuesta sin texto se reporta como vacía', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { choices: [{ message: { content: '' } }] }))
    const provider = createOpenAICompatibleProvider({ endpoint: 'https://x/y', apiKey: 'k', model: 'm' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/vacía/)
  })

  it('una respuesta que no es JSON da un error accionable (no un volcado crudo)', async () => {
    vi.stubGlobal('fetch', mockTextFetch(200, '<!doctype html><title>Login</title>'))
    const provider = createOpenAICompatibleProvider({ endpoint: 'https://x/login', apiKey: 'k', model: 'm' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/no en JSON/)
  })

  it('un JSON sin "choices" se explica como formato incompatible', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { result: 'algo raro' }))
    const provider = createOpenAICompatibleProvider({ endpoint: 'https://x/y', apiKey: 'k', model: 'm' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/choices/)
  })

  it('streaming: acumula los deltas y emite cada fragmento', async () => {
    const fetchSpy = mockStreamFetch([
      'data: {"choices":[{"delta":{"content":"Lee "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"el fichero."}}]}\n\n',
      'data: [DONE]\n\n',
    ])
    vi.stubGlobal('fetch', fetchSpy)
    const provider = createOpenAICompatibleProvider({ endpoint: 'https://x/y', apiKey: 'k', model: 'm' })

    const chunks: string[] = []
    const full = await provider.stream!('s', 'u', c => chunks.push(c))

    expect(chunks).toEqual(['Lee ', 'el fichero.'])
    expect(full).toBe('Lee el fichero.')
    // El body de streaming pide stream: true.
    const [, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(JSON.parse((init as RequestInit).body as string).stream).toBe(true)
  })
})
