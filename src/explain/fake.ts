import type { ExplanationProvider } from './provider.js'

export interface FakeProvider extends ExplanationProvider {
  /** Registro de llamadas recibidas, para aserciones en tests */
  calls: { system: string; user: string }[]
}

/**
 * Proveedor falso para tests: sin red, sin claves. Es la costura de test
 * secundaria del spec — permite ejercitar el pipeline de explicación
 * completo y verificar qué se le envía exactamente al proveedor.
 */
export function createFakeProvider(cannedResponse = 'explicación de prueba'): FakeProvider {
  const calls: { system: string; user: string }[] = []
  return {
    id: 'fake',
    calls,
    async complete(system: string, user: string): Promise<string> {
      calls.push({ system, user })
      return cannedResponse
    },
    async stream(system: string, user: string, onChunk: (chunk: string) => void): Promise<string> {
      calls.push({ system, user })
      // Trocea la respuesta en palabras para ejercitar el camino de streaming
      // sin red: la GUI recibe fragmentos y el resultado final es el mismo.
      for (const word of cannedResponse.split(/(\s+)/)) {
        if (word !== '') onChunk(word)
      }
      return cannedResponse
    },
  }
}
