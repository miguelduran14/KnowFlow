import type { ConditionValue, OccursDepending, ParseResult, SchemaField } from './types.js'
import { parsePic, usageImpliesFixedSize } from './pic.js'

interface RawField {
  kind: 'field'
  level: number
  name: string
  picture?: string | undefined
  usage?: string | undefined
  redefines?: string | undefined
  occurs?: number | undefined
  occursDepending?: OccursDepending | undefined
  signSeparate?: boolean | undefined
}

interface RawCondition {
  kind: 'condition'
  name: string
  values: string[]
}

type RawStatement = RawField | RawCondition

/**
 * Une líneas de continuación COBOL (columna 7 = '-' o carácter no blanco
 * en área A tras un punto y aparte) en sentencias lógicas.
 * Para el subconjunto del slice 1 basta con juntar líneas que no empiezan
 * un nuevo número de nivel ni son directivas.
 */
function joinContinuations(lines: string[]): string[] {
  const logical: string[] = []

  for (const raw of lines) {
    const line = raw.length > 6 ? raw.slice(6) : raw
    const trimmed = line.trimStart()

    if (trimmed === '' || trimmed.startsWith('*')) continue

    const startsNewStatement = /^\s*\d{1,2}\s+/.test(trimmed)

    if (startsNewStatement || logical.length === 0) {
      logical.push(trimmed)
    } else {
      logical[logical.length - 1] += ' ' + trimmed.replace(/^-\s*/, '')
    }
  }

  return logical
}

const LEVEL_RE = /^(\d{1,2})\s+([\w-]+)/
const PIC_RE = /PIC(?:TURE)?\s+IS\s+([\w()V,\-+*/]+)|PIC(?:TURE)?\s+([\w()V,\-+*/]+)/i
const USAGE_RE = /(?:USAGE\s+IS\s+|USAGE\s+)?\b(COMPUTATIONAL-3|COMPUTATIONAL-2|COMPUTATIONAL-1|COMPUTATIONAL|COMP-3|COMP-2|COMP-1|COMP|BINARY|PACKED-DECIMAL|DISPLAY)\b/i
const REDEFINES_RE = /REDEFINES\s+([\w-]+)/i
const OCCURS_RE = /OCCURS\s+(\d+)(?:\s+TO\s+(\d+))?\s+TIMES(?:\s+DEPENDING\s+ON\s+([\w-]+))?/i
const SIGN_SEPARATE_RE = /SIGN\s+IS\s+(?:LEADING|TRAILING)\s+SEPARATE/i
const VALUE_RE = /VALUES?\s+(?:IS\s+|ARE\s+)?(.+)$/i

function canonicalUsage(matched: string): string {
  const u = matched.toUpperCase()
  if (u === 'COMPUTATIONAL-3' || u === 'COMP-3') return 'COMP-3'
  if (u === 'COMPUTATIONAL-2' || u === 'COMP-2') return 'COMP-2'
  if (u === 'COMPUTATIONAL-1' || u === 'COMP-1') return 'COMP-1'
  if (u === 'COMPUTATIONAL' || u === 'COMP') return 'COMP'
  if (u === 'PACKED-DECIMAL') return 'PACKED-DECIMAL'
  if (u === 'BINARY') return 'BINARY'
  return 'DISPLAY'
}

function parseConditionValues(stmt: string): string[] {
  const match = VALUE_RE.exec(stmt)
  if (!match) return []
  const tokens = match[1]!.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
  return tokens.filter(t => t !== ',')
}

function parseStatement(statement: string): RawStatement | undefined {
  const stmt = statement.replace(/\.\s*$/, '')
  const levelMatch = LEVEL_RE.exec(stmt)
  if (!levelMatch) return undefined

  const level = Number(levelMatch[1])
  const name = levelMatch[2]!
  // Las cláusulas se buscan solo en lo que sigue a "NIVEL NOMBRE" — si se
  // buscaran en la sentencia completa, un nombre de campo que contenga una
  // palabra reservada como componente (p. ej. "SIGNED-DISPLAY") produciría
  // una cláusula inventada que no está en el fuente.
  const rest = stmt.slice(levelMatch[0].length)

  if (level === 88) {
    return { kind: 'condition', name, values: parseConditionValues(rest) }
  }

  const picMatch = PIC_RE.exec(rest)
  const picture = picMatch?.[1] ?? picMatch?.[2]

  const usageMatch = USAGE_RE.exec(rest)
  const usage = usageMatch ? canonicalUsage(usageMatch[1]!) : undefined

  const redefinesMatch = REDEFINES_RE.exec(rest)
  const redefines = redefinesMatch?.[1]

  const occursMatch = OCCURS_RE.exec(rest)
  let occurs: number | undefined
  let occursDepending: OccursDepending | undefined
  if (occursMatch) {
    const first = Number(occursMatch[1])
    const second = occursMatch[2] ? Number(occursMatch[2]) : undefined
    const dependingOn = occursMatch[3]
    if (dependingOn) {
      occursDepending = second !== undefined
        ? { min: first, max: second, dependingOn }
        : { min: 1, max: first, dependingOn }
    } else {
      occurs = first
    }
  }

  const signSeparate = SIGN_SEPARATE_RE.test(rest)

  return { kind: 'field', level, name, picture, usage, redefines, occurs, occursDepending, signSeparate }
}

/**
 * Construye la jerarquía de campos a partir del nivel COBOL, sin resolver
 * todavía offsets ni longitudes de grupo (eso ocurre en `resolveOffsets`).
 */
function buildTree(statements: RawStatement[]): SchemaField[] {
  const roots: SchemaField[] = []
  const stack: SchemaField[] = []
  let lastField: SchemaField | undefined

  for (const raw of statements) {
    if (raw.kind === 'condition') {
      if (lastField) {
        const conditionValue: ConditionValue = { name: raw.name, values: raw.values }
        lastField.conditionValues = [...(lastField.conditionValues ?? []), conditionValue]
      }
      continue
    }

    const hasOwnSize = !!raw.picture || usageImpliesFixedSize(raw.usage)
    const pic = hasOwnSize ? parsePic(raw.picture, raw.usage, { signSeparate: raw.signSeparate }) : undefined

    const field: SchemaField = {
      level: raw.level,
      name: raw.name,
      type: pic ? pic.type : 'group',
      ...(raw.picture ? { picture: raw.picture.toUpperCase().replace(/\s+/g, '') } : {}),
      ...(raw.usage ? { usage: raw.usage } : {}),
      lengthInBytes: pic ? pic.lengthInBytes : 0,
      offset: 0,
      children: [],
      ...(raw.redefines ? { redefines: raw.redefines } : {}),
      ...(raw.occurs !== undefined ? { occurs: raw.occurs } : {}),
      ...(raw.occursDepending ? { occursDepending: raw.occursDepending } : {}),
    }

    while (stack.length > 0 && stack[stack.length - 1]!.level >= raw.level) {
      stack.pop()
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : undefined

    if (parent) {
      parent.children.push(field)
    } else {
      roots.push(field)
    }

    stack.push(field)
    lastField = field
  }

  return roots
}

/**
 * Segunda fase: calcula offset y longitud final de cada campo, en orden
 * dentro de cada nivel de hermanos.
 *
 * REDEFINES en COBOL válido siempre aparece contiguo, justo a continuación
 * del campo que redefine (o de otro REDEFINES del mismo campo) — por eso
 * un campo con `redefines` toma el offset del "clúster" que sigue abierto,
 * sin necesidad de buscarlo por nombre. El clúster se cierra al llegar al
 * siguiente campo que NO redefine nada, y el puntero avanza el **máximo**
 * de bytes visto entre el campo base y todas sus vistas — igual que COBOL
 * reserva memoria para la mayor de las vistas solapadas, no solo la base.
 *
 * OCCURS ... DEPENDING ON: `lengthInBytes` del propio campo queda como la
 * longitud de una sola ocurrencia (la longitud real depende de un valor en
 * tiempo de ejecución, así que no se puede fijar). Para que los campos
 * siguientes no se solapen con el peor caso, el puntero de offset sí avanza
 * usando el máximo declarado (o el mínimo si no hay máximo) — una reserva
 * conservadora, no un valor verificado.
 */
function resolveOffsets(fields: SchemaField[], baseOffset: number): number {
  let offset = baseOffset
  let clusterMaxLength = 0

  for (const field of fields) {
    if (field.redefines) {
      field.offset = offset
    } else {
      offset += clusterMaxLength
      field.offset = offset
      clusterMaxLength = 0
    }

    if (field.children.length > 0) {
      field.lengthInBytes = resolveOffsets(field.children, field.offset)
    }

    if (field.occurs) {
      field.lengthInBytes *= field.occurs
    }

    const ownLength = field.occursDepending
      ? field.lengthInBytes * (field.occursDepending.max ?? field.occursDepending.min)
      : field.lengthInBytes

    clusterMaxLength = Math.max(clusterMaxLength, ownLength)
  }

  offset += clusterMaxLength
  return offset - baseOffset
}

/**
 * Parsea un copybook COBOL trivial y extrae su esquema de campos.
 * Alcance de T1+T2: niveles jerárquicos, PIC X/9, OCCURS (fijo y
 * DEPENDING ON reconocido), REDEFINES, niveles 88 y USAGE
 * (DISPLAY, COMP, COMP-1, COMP-2, COMP-3, BINARY, PACKED-DECIMAL).
 * No espera divisiones ni secciones — un copybook es solo la definición
 * del registro (eso es lo que se resuelve vía COPY en un programa real).
 */
export function parse(source: string): ParseResult {
  const statements = joinContinuations(source.split(/\r?\n/))
    .map(parseStatement)
    .filter((s): s is RawStatement => s !== undefined)

  const roots = buildTree(statements)

  // Cada 01/77 de nivel raíz es un área de almacenamiento independiente
  // (no hay FD ni FILE SECTION en el alcance de un copybook): sus offsets
  // internos son relativos a su propio inicio, no continúan entre records.
  for (const root of roots) {
    resolveOffsets([root], 0)
  }

  return { records: roots }
}
