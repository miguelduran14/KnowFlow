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
  }
}
