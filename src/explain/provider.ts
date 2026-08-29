/**
 * Interfaz agnóstica de proveedor de explicación (ADR: capa de IA
 * pluggable, BYOK). El motor no sabe qué proveedor hay detrás; cualquier
 * implementación que cumpla esto sirve — Claude, OpenAI/GPT, o un fake
 * para tests.
 */
export interface ExplanationProvider {
  /** Identificador estable del proveedor ('claude', 'fake', …) */
  readonly id: string
  /** Envía system + mensaje de usuario y devuelve el texto de respuesta */
  complete(system: string, user: string): Promise<string>
  /**
   * Variante en streaming, opcional: emite fragmentos de texto con `onChunk`
   * a medida que llegan y resuelve con el texto completo. Un proveedor que no
   * la implemente hace que la capa superior use `complete` (sin token a
   * token). La salida final es idéntica a la de `complete`.
   */
  stream?(system: string, user: string, onChunk: (chunk: string) => void): Promise<string>
}
