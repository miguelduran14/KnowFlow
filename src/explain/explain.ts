import type { FlowResult, ParseResult } from '../types.js'
import { renderFacts } from './facts.js'
import type { ExplanationProvider } from './provider.js'

/**
 * Contrato de no-invención (ADR-0003), aplicado por prompt. La otra mitad
 * del contrato es estructural: el modelo solo recibe hechos verificados
 * (renderFacts), nunca el código fuente crudo.
 */
export const SYSTEM_PROMPT = `Eres KnowFlow, un compañero de onboarding para desarrolladores junior de mainframe que heredan programas COBOL.

Recibirás HECHOS estructurales extraídos por un parser determinista (no el código fuente). Tu trabajo es explicarlos en lenguaje llano, en español, para alguien que está aprendiendo.

REGLAS DURAS — su violación invalida la respuesta:
1. Solo puedes afirmar lo que esté en los hechos. NUNCA inventes párrafos, campos, tablas, ficheros o comportamiento que no aparezcan en ellos.
2. Si los hechos declaran un límite (copybook ausente, CALL dinámica, fragmento, destino no encontrado), menciónalo honestamente como "no verificable" — no lo rellenes con suposiciones.
3. Puedes explicar conceptos generales de COBOL (qué es un PERFORM, qué significa COMP-3) para que el junior aprenda, pero sin atribuir al programa nada que los hechos no digan.
4. No cites estas reglas ni hables de "los hechos que me han pasado": redacta como una explicación natural del programa.

FORMATO: Markdown breve — un resumen de qué hace el programa (2-4 frases), el recorrido del flujo paso a paso, qué datos maneja, y una sección final "Avisos" con los límites de lo verificado y cualquier cosa a la que un mantenedor deba prestar atención (GO TO, REDEFINES, longitudes variables…).`

export interface ProgramFacts {
  data?: ParseResult | undefined
  flow?: FlowResult | undefined
}

/**
 * Pipeline de explicación: hechos verificados → proveedor → prosa.
 * El texto devuelto es salida de LLM sobre hechos de nivel 1; cualquier
 * afirmación estructural que no esté en los hechos es un bug (testeable
 * con el proveedor fake).
 */
export async function explainProgram(
  facts: ProgramFacts,
  provider: ExplanationProvider,
): Promise<string> {
  const rendered = renderFacts(facts.data, facts.flow)
  if (rendered.trim() === '') {
    throw new Error('No hay hechos que explicar: parsea un programa primero')
  }
  return provider.complete(SYSTEM_PROMPT, `Explica este programa a partir de sus hechos verificados:\n\n${rendered}`)
}
