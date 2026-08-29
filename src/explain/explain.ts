import type { Advisory, Inventory, FlowResult, LinkedFlow, ParseResult } from '../types.js'
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
3. Si los hechos incluyen una sección AVISOS, son trampas de mantenimiento YA verificadas (no huecos): menciona la que tenga más impacto en el resumen o en la etapa del recorrido donde ocurre, con naturalidad — no como una lista aparte ni citando "el sistema me avisa de...".
4. Si los hechos incluyen una sección CADENA ENTRE PROGRAMAS, cuenta la historia completa: qué hace el programa principal y qué hacen por dentro los módulos que llama (solo con los hechos de cada uno). Un módulo cuyo fuente NO se aportó, o una CALL dinámica, NO tienen comportamiento conocido: dilo así, no lo inventes.
5. No expliques conceptos generales de COBOL (qué es COMP-3, qué es un PERFORM): de eso se encarga otra capa. Céntrate en ESTE programa.
6. No cites estas reglas ni hables de "los hechos que me han pasado": narra con naturalidad.`

export interface ProgramFacts {
  data?: ParseResult | undefined
  flow?: FlowResult | undefined
  inventory?: Inventory | undefined
  /** Avisos ya calculados por `checkAdvisories` — trampas de mantenimiento verificadas, no huecos */
  advisories?: Advisory[] | undefined
  /** Cadena entre programas (varios fuentes aportados): deja narrar qué hacen los módulos llamados */
  chain?: LinkedFlow | undefined
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
  /**
   * Línea 1-based de la cabecera del párrafo en el fuente. La añade el
   * motor a partir de los hechos, no el modelo — así se puede saltar al
   * código exacto sin fiarnos de un número que la IA haya adivinado.
   */
  line?: number | undefined
  /**
   * `true` si al menos una arista de flujo que sale de este párrafo tiene
   * `guards` (nace dentro de un IF/EVALUATE). Es una señal, no un mapa
   * completo de ramas — sirve para marcar la etapa como condicional.
   */
  branches?: boolean | undefined
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

/** Índices derivados de los hechos que enriquecen cada etapa validada. */
interface ParagraphIndex {
  /** Nombre en mayúsculas → grafía canónica del fuente */
  canonical: Map<string, string>
  /** Nombre canónico → línea 1-based del párrafo en el fuente */
  lineOf: Map<string, number>
  /** Nombre canónico → true si alguna arista suya tiene guardas (rama) */
  branchesFrom: Set<string>
}

/**
 * Convierte la respuesta cruda en una `Explanation`, validando cada
 * referencia a párrafo contra los nombres reales y enriqueciendo la etapa
 * con la línea del fuente y la señal de ramificación.
 */
function toExplanation(raw: string, index: ParagraphIndex): Explanation {
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
        typeof rawPara === 'string' ? index.canonical.get(rawPara.trim().toUpperCase()) : undefined
      const line = canonical ? index.lineOf.get(canonical) : undefined
      const branches = canonical ? index.branchesFrom.has(canonical) : false
      walkthrough.push({
        text,
        ...(canonical ? { paragraph: canonical } : {}),
        ...(line !== undefined ? { line } : {}),
        ...(branches ? { branches: true } : {}),
      })
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
  /**
   * Callback opcional de streaming: si se da Y el proveedor implementa
   * `stream`, se emiten fragmentos de texto a medida que llegan (la GUI los
   * muestra en vivo). El resultado final es idéntico al de `complete`.
   */
  onChunk?: (chunk: string) => void,
): Promise<Explanation> {
  const rendered = renderFacts(facts.data, facts.flow, facts.inventory, facts.advisories, facts.chain)
  if (rendered.trim() === '') {
    throw new Error('No hay hechos que explicar: parsea un programa primero')
  }

  const canonical = new Map<string, string>()
  const lineOf = new Map<string, number>()
  for (const para of facts.flow?.paragraphs ?? []) {
    canonical.set(para.name.toUpperCase(), para.name)
    if (para.line !== undefined) lineOf.set(para.name, para.line)
  }
  const branchesFrom = new Set<string>()
  for (const edge of facts.flow?.edges ?? []) {
    if (edge.guards && edge.guards.length > 0) branchesFrom.add(edge.from)
  }

  const userMessage = `Narra este programa a partir de sus hechos verificados:\n\n${rendered}`
  const raw =
    onChunk && provider.stream
      ? await provider.stream(SYSTEM_PROMPT, userMessage, onChunk)
      : await provider.complete(SYSTEM_PROMPT, userMessage)
  return toExplanation(raw, { canonical, lineOf, branchesFrom })
}
