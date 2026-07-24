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
}
