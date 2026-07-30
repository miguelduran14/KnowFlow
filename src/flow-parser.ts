import type { FlowEdge, FlowParagraph, FlowResult } from './types.js'
import {
  cleanLines,
  extractProgramIds,
  groupText,
  isDeclarativesMarker,
  matchHeader,
  type SourceLine,
} from './source-lines.js'

const PROCEDURE_DIVISION_RE = /^\s*PROCEDURE\s+DIVISION/i
const END_PROGRAM_RE = /^\s*END\s+PROGRAM\b/i
const TERMINATES_G = /(?<![\w-])(?:STOP\s+RUN|GOBACK|EXIT\s+PROGRAM)(?![\w-])/gi

// Un nombre de párrafo puede empezar por dígito (convención 0000-/1000-),
// así que los destinos aceptan letra o dígito inicial. Un destino que sea
// SOLO dígitos (`PERFORM 3 TIMES`) es un contador, no un nombre, y se
// descarta con isProcedureName.
const NAME = '[A-Za-z0-9][\\w-]*'

// PERFORM <destino> [THRU <destino>] [<n> TIMES] [UNTIL <cond>]
// Un PERFORM inline (PERFORM UNTIL/VARYING ... END-PERFORM) no tiene
// destino: el "target" capturado sería una palabra reservada y se
// descarta con INLINE_KEYWORDS. La condición UNTIL captura hasta el punto
// o el fin de línea (greedy) — una condición partida en varias líneas
// queda truncada a la primera, limitación aceptada del subconjunto.
const PERFORM_RE = new RegExp(
  `(?<![\\w-])PERFORM\\s+(${NAME})(?:\\s+(?:THRU|THROUGH)\\s+(${NAME}))?(?:\\s+(\\d+)\\s+TIMES)?(?:\\s+(UNTIL\\s+[^.]+))?`,
  'dgi',
)
const INLINE_KEYWORDS = new Set(['UNTIL', 'VARYING', 'WITH', 'TEST', 'TIMES'])

const CALL_RE = /(?<![\w-])CALL\s+('[^']*'|"[^"]*"|[A-Za-z][\w-]*)/dgi
const GO_TO_DEPENDING_RE = new RegExp(
  `(?<![\\w-])GO\\s+TO\\s+((?:${NAME}\\s+)+)DEPENDING\\s+ON\\s+([\\w-]+)`,
  'gi',
)
const GO_TO_RE = new RegExp(`(?<![\\w-])GO\\s+TO\\s+(${NAME})`, 'gi')

// SORT/MERGE ... INPUT PROCEDURE IS <párrafo> [THRU <párrafo>]. Es una
// transferencia de control real: el compilador ejecuta ese rango por cada
// registro. Sin ella el párrafo aparece como isla en el diagrama.
const SORT_PROCEDURE_RE = new RegExp(
  `(?<![\\w-])(INPUT|OUTPUT)\\s+PROCEDURE\\s+(?:IS\\s+)?(${NAME})(?:\\s+(?:THRU|THROUGH)\\s+(${NAME}))?`,
  'dgi',
)

/** Un destino de PERFORM/GO TO válido: un nombre, no un contador. Un token
 *  de solo dígitos es el `3` de `PERFORM 3 TIMES`, no un párrafo. */
function isProcedureName(token: string): boolean {
  return !/^\d+$/.test(token)
}

// ── Condicionales ───────────────────────────────────────────────────────
// El grafo sigue siendo de párrafos: un IF no crea nodo propio, sino que
// *guarda* las aristas que caen dentro de su rama. Eso es lo verificable
// ("este PERFORM solo ocurre si WS-TIPO = 'A'"); un nodo de decisión con
// sus dos salidas sería una estructura que el fuente no declara y que
// habría que inventar párrafo a párrafo (ADR-0003).
// Las frases de manejo (AT END, INVALID KEY, ON SIZE ERROR…) son ramas
// igual que un ELSE: lo que cuelga de ellas solo ocurre si la condición se
// da. Sin tratarlas, un `PERFORM FIN-PARA` bajo un AT END se leería como
// incondicional. Las alternativas van de más larga a más corta.
const HANDLER_ALTERNATIVES = [
  'NOT\\s+AT\\s+END-OF-PAGE',
  'NOT\\s+AT\\s+EOP',
  'AT\\s+END-OF-PAGE',
  'AT\\s+EOP',
  'NOT\\s+AT\\s+END',
  'AT\\s+END',
  'NOT\\s+INVALID\\s+KEY',
  'INVALID\\s+KEY',
  'NOT\\s+ON\\s+SIZE\\s+ERROR',
  'ON\\s+SIZE\\s+ERROR',
  'NOT\\s+ON\\s+OVERFLOW',
  'ON\\s+OVERFLOW',
  'NOT\\s+ON\\s+EXCEPTION',
  'ON\\s+EXCEPTION',
].join('|')

// Terminadores de ámbito de las sentencias que admiten manejadores.
const SCOPE_END_ALTERNATIVES =
  'END-READ|END-WRITE|END-REWRITE|END-DELETE|END-START|END-ADD|END-SUBTRACT|END-MULTIPLY|END-DIVIDE|END-COMPUTE|END-STRING|END-UNSTRING|END-CALL|END-RETURN'

const CONTROL_RE = new RegExp(
  `(?<![\\w-])(END-EVALUATE|END-PERFORM|END-IF|${SCOPE_END_ALTERNATIVES}|${HANDLER_ALTERNATIVES}|EVALUATE|PERFORM|ELSE|WHEN|IF)(?![\\w-])`,
  'gi',
)

const HANDLER_TOKEN_RE = new RegExp(`^(?:${HANDLER_ALTERNATIVES})$`, 'i')
const SCOPE_END_TOKEN_RE = new RegExp(`^(?:${SCOPE_END_ALTERNATIVES})$`, 'i')

// Lo que puede seguir a PERFORM en un bucle en línea (sin destino).
const INLINE_PERFORM_HEAD_RE = /^\s*(UNTIL|VARYING|WITH\s+TEST|FOREVER|\d+\s+TIMES)(?![\w-])/i

// El texto de una condición termina donde empieza el primer verbo: en
// COBOL no hay separador entre "IF <cond>" y la sentencia que gobierna.
const VERB_RE = /(?<![\w-])(PERFORM|CALL|GO|MOVE|ADD|SUBTRACT|MULTIPLY|DIVIDE|COMPUTE|DISPLAY|ACCEPT|READ|WRITE|REWRITE|DELETE|OPEN|CLOSE|START|SET|STRING|UNSTRING|INSPECT|INITIALIZE|EXEC|CONTINUE|EXIT|STOP|GOBACK|SEARCH|SORT|RETURN|RELEASE|CANCEL|MERGE|NEXT|UNLOCK)(?![\w-])/gi

// Un punto cierra la sentencia y con ella TODOS los IF/EVALUATE abiertos
// sin terminador explícito. El lookahead evita confundirlo con el punto
// decimal de un literal numérico (MOVE 1.5 TO ...).
const PERIOD_RE = /\.(?![0-9])/g

/** Un IF, EVALUATE, manejador o bucle en línea abierto, con su guarda */
interface CondFrame {
  kind: 'if' | 'evaluate' | 'handler' | 'loop'
  /** IF: texto de la condición (para poder negarla en el ELSE). EVALUATE: sujeto */
  head: string
  /** Guarda activa: la condición de la rama en la que estamos ahora mismo */
  guard?: string | undefined
  /** EVALUATE: valores del grupo de WHEN en curso (WHEN A WHEN B → OR) */
  whenParts?: string[]
  /** EVALUATE: hay un WHEN abierto sin sentencias todavía */
  whenOpen?: boolean
}

/** Qué fragmento de texto se está acumulando cuando una condición
 *  continúa en las líneas siguientes (`IF WS-A = 1` / `AND WS-B = 2`). */
type Collecting = { frame: CondFrame; role: 'if' | 'evaluate' | 'when' } | undefined

function tidyCondition(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\.\s*$/, '').trim()
}

function whenGuard(subject: string, value: string): string {
  if (value.toUpperCase() === 'OTHER') return 'WHEN OTHER'
  if (subject === '' || subject.toUpperCase() === 'TRUE') return value
  return `${subject} = ${value}`
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

  // Todos los PROGRAM-ID del fuente: el primero es este programa, los
  // demás son programas anidados dentro de él.
  const programIds = extractProgramIds(cleaned)
  const programId = programIds[0]?.name
  const nestedPrograms = programIds.slice(1).map(p => p.name)
  const nestedFrom = programIds[1]?.line

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
  let inDeclaratives = false
  // Párrafos que contienen una transferencia de control incondicional:
  // quien llegue a ellos NO sigue en el párrafo siguiente.
  const cutsFlow = new Set<FlowParagraph>()
  // Línea de la cabecera de cada párrafo, para anclar la caída natural.
  const headerLine = new Map<FlowParagraph, number>()

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

  // Pila de IF/EVALUATE abiertos y, si una condición se parte en varias
  // líneas, qué fragmento se está acumulando.
  const frames: CondFrame[] = []
  let collecting: Collecting

  const activeGuards = (): string[] =>
    frames.map(f => f.guard).filter((g): g is string => g !== undefined && g !== '')

  const refreshGuard = (f: CondFrame): void => {
    if (f.kind === 'if') {
      f.guard = f.head === '' ? undefined : f.head
    } else if (f.kind === 'loop') {
      // Prefijo explícito: la guarda de un bucle no es una condición de
      // "solo si", sino de "en cada vuelta". Distinguirlo evita leer
      // `[VARYING ...]` como si fuera un IF.
      f.guard = f.head === '' ? 'en bucle' : `en bucle (${f.head})`
    } else if (f.kind === 'evaluate' && f.whenParts && f.whenParts.length > 0) {
      f.guard = f.whenParts.map(v => whenGuard(f.head, tidyCondition(v))).join(' OR ')
    }
  }

  /** Desapila hasta el frame abierto más cercano del tipo pedido, incluido */
  const closeFrame = (kind: CondFrame['kind']): void => {
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i]!.kind === kind) {
        frames.length = i
        return
      }
    }
  }

  /** El frame abierto más cercano del tipo pedido, cerrando los de dentro */
  const innermost = (kind: CondFrame['kind']): CondFrame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i]!.kind === kind) {
        frames.length = i + 1
        return frames[i]
      }
    }
    return undefined
  }

  type LineEvent =
    | { at: number; rank: 0; kind: 'control'; token: string; end: number }
    | { at: number; rank: 1; kind: 'edge'; edge: FlowEdge }
    | { at: number; rank: 1; kind: 'terminate' }
    | { at: number; rank: 2; kind: 'verb' }
    | { at: number; rank: 3; kind: 'period' }

  for (const { body, masked, line } of lines) {
    if (END_PROGRAM_RE.test(masked)) break
    // Un segundo PROGRAM-ID abre un programa anidado: sus párrafos no son
    // de este programa y mezclarlos daría un flujo que no existe. Se corta
    // aquí y el anidado se declara como límite, no se parsea a medias.
    if (nestedFrom !== undefined && line >= nestedFrom) break
    if (isDeclarativesMarker(masked)) {
      inDeclaratives = !/END-DECLARATIVES/i.test(masked)
      continue
    }

    const header = matchHeader(masked)
    if (header) {
      const para: FlowParagraph = {
        name: header.name,
        kind: header.kind,
        ...(header.kind === 'paragraph' && currentSection ? { section: currentSection } : {}),
        ...(inDeclaratives ? { inDeclaratives: true } : {}),
        line,
      }
      paragraphs.push(para)
      headerLine.set(para, line)
      if (header.kind === 'section') currentSection = header.name
      current = para
      // Un párrafo nuevo siempre viene tras un punto: nada queda abierto.
      frames.length = 0
      collecting = undefined
      continue
    }

    const owner = ensureCurrent()

    // Posiciones donde termina el texto de una condición: el primer
    // token de control o el primer verbo que aparezca a partir de ahí.
    const stops: number[] = []
    for (const m of masked.matchAll(CONTROL_RE)) stops.push(m.index)
    for (const m of masked.matchAll(VERB_RE)) stops.push(m.index)
    stops.sort((a, b) => a - b)

    const boundaryFrom = (from: number): number => {
      for (const s of stops) if (s >= from) return s
      return masked.length
    }

    // Continuación de una condición partida en varias líneas: el texto
    // anterior al primer verbo/control de esta línea todavía es condición.
    if (collecting) {
      const stop = boundaryFrom(0)
      const chunk = tidyCondition(body.slice(0, stop))
      if (chunk !== '') {
        const f = collecting.frame
        if (collecting.role === 'when' && f.whenParts && f.whenParts.length > 0) {
          f.whenParts[f.whenParts.length - 1] += ' ' + chunk
        } else {
          f.head = tidyCondition(`${f.head} ${chunk}`)
        }
        refreshGuard(f)
      }
      if (stop < masked.length) collecting = undefined
    }

    const events: LineEvent[] = []

    for (const m of masked.matchAll(CONTROL_RE)) {
      events.push({
        at: m.index,
        rank: 0,
        kind: 'control',
        token: m[1]!.toUpperCase().replace(/\s+/g, ' '),
        end: m.index + m[0].length,
      })
    }
    for (const m of masked.matchAll(VERB_RE)) {
      events.push({ at: m.index, rank: 2, kind: 'verb' })
    }
    for (const m of masked.matchAll(TERMINATES_G)) {
      events.push({ at: m.index, rank: 1, kind: 'terminate' })
    }
    for (const m of masked.matchAll(PERIOD_RE)) {
      events.push({ at: m.index, rank: 3, kind: 'period' })
    }

    // SORT/MERGE ... INPUT/OUTPUT PROCEDURE: transferencia de control a un
    // párrafo (o rango THRU), igual de real que un PERFORM.
    for (const m of masked.matchAll(SORT_PROCEDURE_RE)) {
      if (!isProcedureName(m[2]!)) continue
      const kind = m[1]!.toUpperCase() === 'INPUT' ? 'sort-input' : 'sort-output'
      events.push({
        at: m.index,
        rank: 1,
        kind: 'edge',
        edge: {
          from: owner.name,
          to: m[2]!,
          kind,
          ...(m[3] ? { thru: m[3] } : {}),
          line,
        },
      })
    }

    for (const m of masked.matchAll(PERFORM_RE)) {
      const target = m[1]!
      if (INLINE_KEYWORDS.has(target.toUpperCase())) continue
      // `PERFORM 3 TIMES`: el "3" es el contador, no un párrafo destino.
      if (!isProcedureName(target)) continue
      const condition = groupText(m, 4, body)
      events.push({
        at: m.index,
        rank: 1,
        kind: 'edge',
        edge: {
          from: owner.name,
          to: target,
          kind: 'perform',
          ...(m[2] ? { thru: m[2] } : {}),
          ...(m[3] ? { times: Number(m[3]) } : {}),
          ...(condition ? { condition: condition.trim() } : {}),
          line,
        },
      })
    }

    for (const m of masked.matchAll(CALL_RE)) {
      // El target se recupera del body original: en masked el interior
      // del literal está en blanco.
      const rawTarget = groupText(m, 1, body)!
      const isLiteral = rawTarget.startsWith("'") || rawTarget.startsWith('"')
      events.push({
        at: m.index,
        rank: 1,
        kind: 'edge',
        edge: {
          from: owner.name,
          to: isLiteral ? rawTarget.slice(1, -1) : rawTarget,
          kind: 'call',
          ...(isLiteral ? {} : { dynamic: true }),
          line,
        },
      })
    }

    const depMatches = [...masked.matchAll(GO_TO_DEPENDING_RE)]
    for (const m of depMatches) {
      const targets = m[1]!.trim().split(/\s+/)
      for (const target of targets) {
        if (!isProcedureName(target)) continue
        events.push({
          at: m.index,
          rank: 1,
          kind: 'edge',
          edge: { from: owner.name, to: target, kind: 'goto', condition: `DEPENDING ON ${m[2]!}`, line },
        })
      }
    }
    if (depMatches.length === 0) {
      for (const m of masked.matchAll(GO_TO_RE)) {
        if (!isProcedureName(m[1]!)) continue
        events.push({
          at: m.index,
          rank: 1,
          kind: 'edge',
          edge: { from: owner.name, to: m[1]!, kind: 'goto', line },
        })
      }
    }

    events.sort((a, b) => a.at - b.at || a.rank - b.rank)

    for (const ev of events) {
      if (ev.kind === 'period') {
        // El punto cierra la sentencia: todos los IF/EVALUATE sin
        // terminador explícito quedan cerrados con ella.
        frames.length = 0
        collecting = undefined
        continue
      }

      if (ev.kind === 'verb') {
        const top = frames[frames.length - 1]
        if (top?.kind === 'evaluate') top.whenOpen = false
        continue
      }

      if (ev.kind === 'terminate') {
        owner.terminates = true
        // Un STOP RUN/GOBACK/EXIT PROGRAM fuera de toda rama corta el
        // flujo: quien llega aquí no sigue en el párrafo siguiente.
        if (activeGuards().length === 0) cutsFlow.add(owner)
        continue
      }

      if (ev.kind === 'edge') {
        const guards = activeGuards()
        edges.push(guards.length > 0 ? { ...ev.edge, guards } : ev.edge)
        // Un GO TO incondicional (no DEPENDING, sin guarda) es una
        // transferencia de control: el párrafo no cae en el siguiente.
        if (ev.edge.kind === 'goto' && guards.length === 0 && !ev.edge.condition) {
          cutsFlow.add(owner)
        }
        continue
      }

      const text = tidyCondition(body.slice(ev.end, boundaryFrom(ev.end)))
      const openEnded = boundaryFrom(ev.end) >= masked.length

      switch (ev.token) {
        case 'IF': {
          const frame: CondFrame = { kind: 'if', head: text }
          refreshGuard(frame)
          frames.push(frame)
          if (openEnded) collecting = { frame, role: 'if' }
          break
        }
        case 'ELSE': {
          const frame = innermost('if')
          // Sin condición legible (partida de forma que el subconjunto no
          // cubre) se etiqueta la rama por lo que es, no se inventa texto.
          if (frame) frame.guard = frame.head === '' ? 'ELSE' : `NOT (${frame.head})`
          collecting = undefined
          break
        }
        case 'END-IF': {
          closeFrame('if')
          collecting = undefined
          break
        }
        case 'EVALUATE': {
          const frame: CondFrame = { kind: 'evaluate', head: text, whenParts: [] }
          frames.push(frame)
          if (openEnded) collecting = { frame, role: 'evaluate' }
          break
        }
        case 'WHEN': {
          // Un WHEN fuera de un EVALUATE (SEARCH ... WHEN) no se guarda:
          // el subconjunto no cubre SEARCH y no se inventa una rama.
          const frame = innermost('evaluate')
          if (!frame) break
          if (frame.whenOpen && frame.whenParts && frame.whenParts.length > 0) {
            frame.whenParts.push(text)
          } else {
            frame.whenParts = [text]
            frame.whenOpen = true
          }
          refreshGuard(frame)
          if (openEnded) collecting = { frame, role: 'when' }
          break
        }
        case 'END-EVALUATE': {
          closeFrame('evaluate')
          collecting = undefined
          break
        }
        case 'PERFORM': {
          // Un PERFORM en línea (PERFORM UNTIL/VARYING/n TIMES/FOREVER sin
          // destino) abre un bucle: lo que cuelga de él se repite. Un
          // PERFORM con destino no abre nada — su arista la crea PERFORM_RE.
          if (INLINE_PERFORM_HEAD_RE.test(body.slice(ev.end))) {
            const frame: CondFrame = { kind: 'loop', head: text }
            refreshGuard(frame)
            frames.push(frame)
            if (openEnded) collecting = { frame, role: 'if' }
          }
          break
        }
        case 'END-PERFORM': {
          closeFrame('loop')
          collecting = undefined
          break
        }
        default: {
          if (HANDLER_TOKEN_RE.test(ev.token)) {
            // AT END / INVALID KEY / ON SIZE ERROR y sus NOT: ramas de la
            // sentencia de E/S o aritmética. Un segundo manejador (NOT AT
            // END tras AT END) sustituye al anterior, como un ELSE.
            if (frames[frames.length - 1]?.kind === 'handler') frames.pop()
            const frame: CondFrame = { kind: 'handler', head: ev.token, guard: ev.token }
            frames.push(frame)
          } else if (SCOPE_END_TOKEN_RE.test(ev.token)) {
            closeFrame('handler')
            collecting = undefined
          }
          break
        }
      }
    }
  }

  // Caída natural: un párrafo que no corta el flujo continúa en el
  // siguiente por orden de fuente. Es EL malentendido clásico del que
  // hereda COBOL, así que se dibuja explícito. No cruza la frontera de
  // DECLARATIVES (los manejadores no se ejecutan en línea con el cuerpo).
  const fallEdges: FlowEdge[] = []
  for (let i = 0; i < paragraphs.length - 1; i++) {
    const from = paragraphs[i]!
    const to = paragraphs[i + 1]!
    if (cutsFlow.has(from)) continue
    if ((from.inDeclaratives ?? false) !== (to.inDeclaratives ?? false)) continue
    from.fallsThrough = true
    fallEdges.push({ from: from.name, to: to.name, kind: 'fall-through', line: headerLine.get(to) ?? 0 })
  }
  edges.push(...fallEdges)

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
    nestedPrograms,
    fragment,
  }
}
