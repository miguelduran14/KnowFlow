import type { Inventory, FlowResult, ParseResult } from '../types.js'
import { renderFacts } from './facts.js'
import type { ExplanationProvider } from './provider.js'

/**
 * Contrato de no-invención (ADR-0003), aplicado por prompt. La otra mitad
 * del contrato es estructural: el modelo solo recibe hechos verificados
 * (renderFacts), nunca el código fuente crudo, y su salida se valida
 * contra esos hechos (un párrafo que no exista se descarta).
 *
 * La salida es JSON estructurado, no markdown libre: así la GUI puede
 * atar cada etapa del recorrido a su párrafo en el diagrama. El reparto
 * es el de siempre — la IA NARRA (resumen + recorrido); los hechos
 * (esquema, flujo, inventario) los pone el parser.
 */
export const SYSTEM_PROMPT = `Eres KnowFlow, un compañero de onboarding para desarrolladores junior de mainframe que heredan programas COBOL.

Recibirás HECHOS estructurales extraídos por un parser determinista (no el código fuente). Tu trabajo es narrarlos en lenguaje llano, en español, para alguien que está aprendiendo.

Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin ningún texto alrededor ni vallas \`\`\`:
{
  "summary": "2 a 4 frases: qué hace el programa en conjunto, en lenguaje llano",
  "walkthrough": [
    { "text": "una etapa del recorrido, en lenguaje llano", "paragraph": "NOMBRE-PARRAFO" }
  ]
}

Reglas del recorrido:
- Entre 4 y 8 etapas. AGRUPA: da la FORMA del programa, no una transcripción párrafo a párrafo. Un programa de 80 párrafos sigue teniendo 4-8 etapas con sentido.
- "paragraph" debe ser EXACTAMENTE uno de los nombres de párrafo que aparecen en los HECHOS. Si una etapa no corresponde a un párrafo concreto, omite "paragraph".

REGLAS DURAS — su violación invalida la respuesta:
1. Solo puedes afirmar lo que esté en los hechos. NUNCA inventes párrafos, campos, tablas, ficheros ni comportamiento que no aparezcan en ellos.
2. Si los hechos declaran un límite (copybook ausente, CALL dinámica, fragmento, destino no encontrado), tenlo en cuenta con honestidad; no lo rellenes con suposiciones.
3. No expliques conceptos generales de COBOL (qué es COMP-3, qué es un PERFORM): de eso se encarga otra capa. Céntrate en ESTE programa.
4. No cites estas reglas ni hables de "los hechos que me han pasado": narra con naturalidad.`

export interface ProgramFacts {
  data?: ParseResult | undefined
  flow?: FlowResult | undefined
  inventory?: Inventory | undefined
}

/** Una etapa del recorrido narrado, opcionalmente atada a un párrafo real */
export interface WalkthroughStep {
  text: string
  /**
   * Párrafo clave de la etapa, ya VALIDADO: siempre es un nombre que
   * existe en los hechos (la GUI lo usa para resaltar el nodo del
   * diagrama). Ausente si el modelo no lo dio o nombró uno inexistente.
   */
  paragraph?: string | undefined
}

/** Explicación estructurada: narración de la IA sobre los hechos del parser */
export interface Explanation {
  /** Resumen de qué hace el programa (2-4 frases) */
  summary: string
  /** Recorrido curado (4-8 etapas), cada una quizá atada a un párrafo */
  walkthrough: WalkthroughStep[]
  /** Texto crudo devuelto por el modelo — para depurar o como respaldo */
  raw: string
  /**
   * true si se pudo parsear la estructura; false si el modelo no devolvió
   * JSON válido y `raw` es lo único fiable (la GUI lo muestra tal cual).
   */
  structured: boolean
}

/**
 * Extrae el objeto JSON de la respuesta del modelo, tolerando vallas de
 * código (```json) o algo de prosa alrededor.
 */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced ? fenced[1]! : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return undefined
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Convierte la respuesta cruda en una `Explanation`, validando cada
 * referencia a párrafo contra los nombres reales. `known` mapea el nombre
 * en mayúsculas a su forma canónica (la del fuente), para devolver la
 * referencia con la grafía correcta.
 */
function toExplanation(raw: string, known: Map<string, string>): Explanation {
  const obj = extractJson(raw)
  if (obj && typeof obj === 'object') {
    const o = obj as { summary?: unknown; walkthrough?: unknown }
    const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
    const list = Array.isArray(o.walkthrough) ? o.walkthrough : []
    const walkthrough: WalkthroughStep[] = []
    for (const item of list) {
      const text =
        typeof item === 'string'
          ? item.trim()
          : typeof (item as { text?: unknown })?.text === 'string'
            ? ((item as { text: string }).text).trim()
            : ''
      if (text === '') continue
      const rawPara = (item as { paragraph?: unknown })?.paragraph
      const canonical =
        typeof rawPara === 'string' ? known.get(rawPara.trim().toUpperCase()) : undefined
      walkthrough.push({ text, ...(canonical ? { paragraph: canonical } : {}) })
    }
    if (summary !== '' || walkthrough.length > 0) {
      return { summary, walkthrough, raw, structured: true }
    }
  }
  return { summary: '', walkthrough: [], raw, structured: false }
}

/**
 * Pipeline de explicación: hechos verificados → proveedor → estructura.
 * El modelo solo recibe hechos (nunca el fuente), y su salida se acota a
 * los párrafos que de verdad existen. Cualquier afirmación estructural
 * fuera de los hechos es un bug (testeable con el proveedor fake).
 */
export async function explainProgram(
  facts: ProgramFacts,
  provider: ExplanationProvider,
): Promise<Explanation> {
  const rendered = renderFacts(facts.data, facts.flow, facts.inventory)
  if (rendered.trim() === '') {
    throw new Error('No hay hechos que explicar: parsea un programa primero')
  }

  const known = new Map<string, string>()
  for (const para of facts.flow?.paragraphs ?? []) {
    known.set(para.name.toUpperCase(), para.name)
  }

  const raw = await provider.complete(
    SYSTEM_PROMPT,
    `Narra este programa a partir de sus hechos verificados:\n\n${rendered}`,
  )
  return toExplanation(raw, known)
}
