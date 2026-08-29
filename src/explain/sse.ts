/**
 * Lectura de un stream de Server-Sent Events sobre `fetch`. Compartido por
 * los adaptadores Claude y OpenAI-compatible: ambos entregan la respuesta en
 * streaming como líneas `data: {json}` separadas por líneas en blanco.
 * Funciona igual en navegador y en Node 18+ (fetch trae `body` como stream).
 *
 * Llama a `onEvent` con el objeto JSON de cada `data:`; ignora `data: [DONE]`
 * y las líneas que no sean JSON (comentarios `:` de keep-alive, `event:`…).
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (data: unknown) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Los eventos SSE terminan en línea en blanco; procesamos por líneas
      // `data:` sueltas, que es como los emiten estos dos proveedores.
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        try {
          onEvent(JSON.parse(payload))
        } catch {
          // Fragmento no-JSON (keep-alive u otro): se ignora.
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
