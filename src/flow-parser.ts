import type { FlowEdge, FlowParagraph, FlowResult } from './types.js'

const PROGRAM_ID_RE = /(?<![\w-])PROGRAM-ID\s*\.\s*([A-Za-z][\w-]*)/i
const PROCEDURE_DIVISION_RE = /^\s*PROCEDURE\s+DIVISION/i
const END_PROGRAM_RE = /^\s*END\s+PROGRAM\b/i
const SECTION_HEADER_RE = /^([A-Za-z][\w-]*)\s+SECTION\s*\.\s*$/
const PARAGRAPH_HEADER_RE = /^([A-Za-z][\w-]*)\s*\.\s*$/
const TERMINATES_RE = /(?<![\w-])(STOP\s+RUN|GOBACK|EXIT\s+PROGRAM)(?![\w-])/i

// Tokens de área A que parecen cabecera de párrafo pero no lo son
const NON_PARAGRAPH_HEADERS = new Set(['DECLARATIVES', 'END-DECLARATIVES'])

// PERFORM <destino> [THRU <destino>] [<n> TIMES] [UNTIL <cond>]
// Un PERFORM inline (PERFORM UNTIL/VARYING ... END-PERFORM) no tiene
// destino: el "target" capturado sería una palabra reservada y se
// descarta con INLINE_KEYWORDS. La condición UNTIL captura hasta el punto
// o el fin de línea (greedy) — una condición partida en varias líneas
// queda truncada a la primera, limitación aceptada del subconjunto.
const PERFORM_RE = /(?<![\w-])PERFORM\s+([A-Za-z][\w-]*)(?:\s+(?:THRU|THROUGH)\s+([A-Za-z][\w-]*))?(?:\s+(\d+)\s+TIMES)?(?:\s+(UNTIL\s+[^.]+))?/dgi
const INLINE_KEYWORDS = new Set(['UNTIL', 'VARYING', 'WITH', 'TEST', 'TIMES'])

const CALL_RE = /(?<![\w-])CALL\s+('[^']*'|"[^"]*"|[A-Za-z][\w-]*)/dgi
const GO_TO_DEPENDING_RE = /(?<![\w-])GO\s+TO\s+((?:[A-Za-z][\w-]*\s+)+)DEPENDING\s+ON\s+([\w-]+)/gi
const GO_TO_RE = /(?<![\w-])GO\s+TO\s+([A-Za-z][\w-]*)/gi

interface SourceLine {
  /** Contenido de código de la línea (sin secuencia ni indicador en formato fijo) */
  body: string
  /**
   * El mismo contenido con el interior de los literales de cadena en
   * blanco (misma longitud). Los regex de sentencias se ejecutan sobre
   * esta versión: un verbo dentro de un literal (`DISPLAY 'PERFORM X'`)
   * no es una sentencia, y tratarlo como tal fabricaría una arista que
   * no existe en el programa (ADR-0003).
   */
  masked: string
  /** Número de línea 1-based en el fuente original */
  line: number
}

function maskLiterals(body: string): string {
  return body.replace(/'[^']*'|"[^"]*"/g, m => "'" + ' '.repeat(m.length - 2) + "'")
}

/**
 * Formato fijo (cols 1-6 secuencia, col 7 indicador) vs libre: si alguna
 * línea con contenido tiene algo que no sea espacio o dígito en las
 * columnas 1-6, el fuente es un pegado en formato libre y no se recortan
 * columnas — recortarlas destrozaría los nombres ("MAIN-PARA." → "RA.").
 */
function isFixedFormat(rawLines: string[]): boolean {
  for (const line of rawLines) {
    if (line.trim() === '') continue
    if (!/^[\s\d]*$/.test(line.slice(0, 6))) return false
  }
  return true
}

function cleanLines(source: string): SourceLine[] {
  const raw = source.split(/\r?\n/)
  const fixed = isFixedFormat(raw)
  const out: SourceLine[] = []

  for (let i = 0; i < raw.length; i++) {
    let body: string
    if (fixed) {
      const content = raw[i]!.length > 6 ? raw[i]!.slice(6) : raw[i]!
      const indicator = content[0] ?? ' '
      if (indicator === '*' || indicator === '/') continue
      body = content.slice(1)
    } else {
      body = raw[i]!
      if (body.trimStart().startsWith('*')) continue
    }
    if (body.trim() === '') continue
    out.push({ body, masked: maskLiterals(body), line: i + 1 })
  }

  return out
}

/** Cabecera de párrafo/sección: un solo token + punto, arrancando en área A
 *  (columnas 8-11). Las sentencias van en área B (columna 12+), así que la
 *  indentación distingue "PARRAFO." de una sentencia de un solo verbo. */
function matchHeader(masked: string): { name: string; kind: 'paragraph' | 'section' } | undefined {
  const leadingSpaces = masked.length - masked.trimStart().length
  if (leadingSpaces >= 4) return undefined

  const trimmed = masked.trim()
  const sectionMatch = SECTION_HEADER_RE.exec(trimmed)
  if (sectionMatch) return { name: sectionMatch[1]!, kind: 'section' }
  const paraMatch = PARAGRAPH_HEADER_RE.exec(trimmed)
  if (paraMatch && !NON_PARAGRAPH_HEADERS.has(paraMatch[1]!.toUpperCase())) {
    return { name: paraMatch[1]!, kind: 'paragraph' }
  }
  return undefined
}

/** Trozo del body original correspondiente a un grupo capturado (los regex
 *  corren sobre `masked`; el texto real —p. ej. una condición con un
 *  literal dentro— se recupera del original por posición). */
function groupText(m: RegExpMatchArray, group: number, original: string): string | undefined {
  const span = m.indices?.[group]
  return span ? original.slice(span[0], span[1]) : undefined
}

/**
 * Extrae los hechos de flujo de la PROCEDURE DIVISION: párrafos/secciones
 * en orden de fuente y aristas PERFORM/CALL/GO TO, cada una anclada a la
 * línea donde aparece. Todo lo no verificable se marca, no se rellena:
 * un CALL con variable es `dynamic` (el destino real solo se conoce en
 * ejecución), un destino que no existe en el fuente va a `missingTargets`,
 * y un fuente sin cabecera PROCEDURE DIVISION queda como `fragment`.
 */
export function parseFlow(source: string): FlowResult {
  const cleaned = cleanLines(source)

  let programId: string | undefined
  for (const { masked } of cleaned) {
    const m = PROGRAM_ID_RE.exec(masked)
    if (m) {
      programId = m[1]!
      break
    }
  }

  let lines: SourceLine[]
  let fragment = false
  const headerIndex = cleaned.findIndex(l => PROCEDURE_DIVISION_RE.test(l.body))
  if (headerIndex === -1) {
    lines = cleaned
    fragment = true
  } else {
    let start = headerIndex + 1
    // PROCEDURE DIVISION USING ... puede continuar en más líneas hasta el
    // punto final; nada de eso son sentencias.
    if (!/\.\s*$/.test(cleaned[headerIndex]!.body)) {
      while (start < cleaned.length && !/\.\s*$/.test(cleaned[start]!.body)) start++
      start++
    }
    lines = cleaned.slice(start)
  }

  const paragraphs: FlowParagraph[] = []
  const edges: FlowEdge[] = []
  let currentSection: string | undefined
  let current: FlowParagraph | undefined

  const ensureCurrent = (): FlowParagraph => {
    if (current) return current
    // Sentencias antes del primer párrafo declarado: nodo de entrada
    // sintético, marcado como implicit para no hacerlo pasar por un
    // párrafo real del fuente.
    const entry: FlowParagraph = { name: programId ?? 'MAIN', kind: 'paragraph', implicit: true }
    paragraphs.push(entry)
    current = entry
    return entry
  }

  for (const { body, masked, line } of lines) {
    if (END_PROGRAM_RE.test(masked)) break

    const header = matchHeader(masked)
    if (header) {
      const para: FlowParagraph = {
        name: header.name,
        kind: header.kind,
        ...(header.kind === 'paragraph' && currentSection ? { section: currentSection } : {}),
      }
      paragraphs.push(para)
      if (header.kind === 'section') currentSection = header.name
      current = para
      continue
    }

    const owner = ensureCurrent()

    if (TERMINATES_RE.test(masked)) {
      owner.terminates = true
    }

    for (const m of masked.matchAll(PERFORM_RE)) {
      const target = m[1]!
      if (INLINE_KEYWORDS.has(target.toUpperCase())) continue
      const condition = groupText(m, 4, body)
      edges.push({
        from: owner.name,
        to: target,
        kind: 'perform',
        ...(m[2] ? { thru: m[2] } : {}),
        ...(m[3] ? { times: Number(m[3]) } : {}),
        ...(condition ? { condition: condition.trim() } : {}),
        line,
      })
    }

    for (const m of masked.matchAll(CALL_RE)) {
      // El target se recupera del body original: en masked el interior
      // del literal está en blanco.
      const rawTarget = groupText(m, 1, body)!
      const isLiteral = rawTarget.startsWith("'") || rawTarget.startsWith('"')
      edges.push({
        from: owner.name,
        to: isLiteral ? rawTarget.slice(1, -1) : rawTarget,
        kind: 'call',
        ...(isLiteral ? {} : { dynamic: true }),
        line,
      })
    }

    const depMatches = [...masked.matchAll(GO_TO_DEPENDING_RE)]
    for (const m of depMatches) {
      const targets = m[1]!.trim().split(/\s+/)
      for (const target of targets) {
        edges.push({
          from: owner.name,
          to: target,
          kind: 'goto',
          condition: `DEPENDING ON ${m[2]!}`,
          line,
        })
      }
    }
    if (depMatches.length === 0) {
      for (const m of masked.matchAll(GO_TO_RE)) {
        edges.push({ from: owner.name, to: m[1]!, kind: 'goto', line })
      }
    }
  }

  const defined = new Set(paragraphs.map(p => p.name.toUpperCase()))
  const missingTargets: string[] = []
  for (const edge of edges) {
    if (edge.kind === 'call') continue // el destino de CALL es otro programa, no un párrafo
    for (const target of [edge.to, edge.thru]) {
      if (target && !defined.has(target.toUpperCase()) && !missingTargets.includes(target)) {
        missingTargets.push(target)
      }
    }
  }

  return {
    ...(programId ? { programId } : {}),
    paragraphs,
    edges,
    missingTargets,
    fragment,
  }
}
