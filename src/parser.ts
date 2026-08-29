import type {
  ConditionValue,
  DataSection,
  OccursDepending,
  ParseResult,
  RenamesGroup,
  SchemaField,
} from './types.js'
import { alignmentOf, parsePic, usageImpliesFixedSize } from './pic.js'
import { joinContinuations } from './lines.js'
import { resolveCopies } from './copy-resolver.js'

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
  synchronized?: boolean | undefined
  value?: string | undefined
}

interface RawCondition {
  kind: 'condition'
  name: string
  values: string[]
}

interface RawRenames {
  kind: 'renames'
  name: string
  from: string
  thru?: string | undefined
}

interface RawUnresolvedCopy {
  kind: 'unresolved-copy'
  member: string
}

interface RawSectionMarker {
  kind: 'section'
  section: DataSection
}

type RawStatement = RawField | RawCondition | RawRenames | RawUnresolvedCopy | RawSectionMarker

const LEVEL_RE = /^(\d{1,2})\s+([\w-]+)/
// El punto es ambiguo en COBOL: dentro de un PIC editado (PIC ZZ,ZZ9.99)
// es el punto decimal de edición; fuera es el terminador de sentencia. Lo
// resolvemos con un lookahead: si al punto le sigue un dígito o carácter
// de edición (Z, 9, *, $, etc.), es parte de la PIC. El `$` (símbolo de
// moneda) va en el juego de caracteres: sin él, un `PIC $$,$$9.99` no
// capturaba PIC y el campo se degradaba a un grupo de 0 bytes.
const PIC_RE = /PIC(?:TURE)?\s+IS\s+([\w()V,\-+*/$]+(?:\.(?=[0-9Z*+\-$])[\w()V,\-+*/$]+)*)|PIC(?:TURE)?\s+([\w()V,\-+*/$]+(?:\.(?=[0-9Z*+\-$])[\w()V,\-+*/$]+)*)/i
// El orden importa: las alternativas más largas van primero para que
// PROCEDURE-POINTER no se lea como POINTER.
const USAGE_RE = /(?:USAGE\s+IS\s+|USAGE\s+)?\b(COMPUTATIONAL-3|COMPUTATIONAL-2|COMPUTATIONAL-1|COMPUTATIONAL|COMP-3|COMP-2|COMP-1|COMP|BINARY|PACKED-DECIMAL|PROCEDURE-POINTER|FUNCTION-POINTER|POINTER|INDEX|DISPLAY)\b/i
const REDEFINES_RE = /REDEFINES\s+([\w-]+)/i
// TIMES es opcional en COBOL: `OCCURS 1 TO 10 DEPENDING ON X` (sin TIMES) es
// la forma más habitual del OCCURS variable, y exigir TIMES dejaba el campo
// sin reconocer — se trataba como una sola ocurrencia y descuadraba todos
// los offsets siguientes.
const OCCURS_RE = /OCCURS\s+(\d+)(?:\s+TO\s+(\d+))?(?:\s+TIMES)?(?:\s+DEPENDING\s+ON\s+([\w-]+))?/i
const SIGN_SEPARATE_RE = /SIGN\s+IS\s+(?:LEADING|TRAILING)\s+SEPARATE/i
const SYNC_RE = /(?<![\w-])(?:SYNCHRONIZED|SYNC)(?![\w-])/i
const RENAMES_RE = /(?<![\w-])RENAMES\s+([\w-]+)(?:\s+(?:THRU|THROUGH)\s+([\w-]+))?/i
const VALUE_RE = /VALUES?\s+(?:IS\s+|ARE\s+)?(.+)$/i
// VALUE de un campo normal: un solo literal, constante figurativa o número,
// con un ALL opcional delante. Se lee del texto SIN enmascarar para
// conservar el literal real.
const VALUE_FIELD_RE =
  /(?<![\w-])VALUES?\s+(?:IS\s+)?(ALL\s+)?('[^']*'|"[^"]*"|[+-]?\d+(?:\.\d+)?|[A-Za-z][\w-]*)/i
// Cabecera de sección de la DATA DIVISION. Solo las cuatro de almacenamiento
// de datos; REPORT/SCREEN caen fuera del subconjunto y dejan la sección sin
// determinar en vez de mal etiquetada.
const DATA_SECTION_RE = /^\s*(FILE|WORKING-STORAGE|LOCAL-STORAGE|LINKAGE)\s+SECTION\s*\.\s*$/i

function canonicalUsage(matched: string): string {
  const u = matched.toUpperCase()
  if (u === 'COMPUTATIONAL-3' || u === 'COMP-3') return 'COMP-3'
  if (u === 'COMPUTATIONAL-2' || u === 'COMP-2') return 'COMP-2'
  if (u === 'COMPUTATIONAL-1' || u === 'COMP-1') return 'COMP-1'
  if (u === 'COMPUTATIONAL' || u === 'COMP') return 'COMP'
  if (u === 'PACKED-DECIMAL') return 'PACKED-DECIMAL'
  if (u === 'BINARY') return 'BINARY'
  if (u === 'POINTER') return 'POINTER'
  if (u === 'PROCEDURE-POINTER') return 'PROCEDURE-POINTER'
  if (u === 'FUNCTION-POINTER') return 'FUNCTION-POINTER'
  if (u === 'INDEX') return 'INDEX'
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
  const rawRest = stmt.slice(levelMatch[0].length)

  if (level === 88) {
    return { kind: 'condition', name, values: parseConditionValues(rawRest) }
  }

  // Un nivel 66 no es un nivel jerárquico: no puede ser hijo de nada ni
  // tener hijos. Metido en el árbol quedaría colgando del último campo
  // elemental y le borraría la longitud, porque un campo con hijos toma
  // la de sus hijos.
  if (level === 66) {
    const renames = RENAMES_RE.exec(rawRest)
    if (!renames) return undefined
    return { kind: 'renames', name, from: renames[1]!, ...(renames[2] ? { thru: renames[2] } : {}) }
  }

  // El contenido de un literal no es una cláusula: sin esto, un
  // `VALUE 'INDEX'` fabricaría un USAGE que el campo no tiene (ADR-0003).
  // Se conserva la longitud para no descuadrar nada que use posiciones.
  const rest = rawRest.replace(/'[^']*'|"[^"]*"/g, m => ' '.repeat(m.length))

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
  const synchronized = SYNC_RE.test(rest)

  // El valor inicial se lee del texto sin enmascarar: es justo el literal
  // que el enmascarado borra. El `ALL` opcional se conserva verbatim.
  const valueMatch = VALUE_FIELD_RE.exec(rawRest)
  const value = valueMatch ? `${valueMatch[1] ?? ''}${valueMatch[2]!}`.trim() : undefined

  return {
    kind: 'field',
    level,
    name,
    picture,
    usage,
    redefines,
    occurs,
    occursDepending,
    signSeparate,
    synchronized,
    value,
  }
}

/**
 * Construye la jerarquía de campos a partir del nivel COBOL, sin resolver
 * todavía offsets ni longitudes de grupo (eso ocurre en `resolveOffsets`).
 */
function buildTree(statements: RawStatement[]): SchemaField[] {
  const roots: SchemaField[] = []
  const stack: SchemaField[] = []
  let lastField: SchemaField | undefined
  // Sección de la DATA DIVISION en curso: se estampa en cada 01/77 raíz
  // que aparezca a partir de su cabecera.
  let currentSection: DataSection | undefined

  for (const raw of statements) {
    if (raw.kind === 'section') {
      currentSection = raw.section
      continue
    }

    if (raw.kind === 'condition') {
      if (lastField) {
        const conditionValue: ConditionValue = { name: raw.name, values: raw.values }
        lastField.conditionValues = [...(lastField.conditionValues ?? []), conditionValue]
      }
      continue
    }

    if (raw.kind === 'renames') {
      // Un 66 renombra un tramo del registro 01 que acaba de describirse,
      // así que cuelga del último registro raíz — no de la pila, donde
      // sería un hijo y falsearía longitudes.
      const record = roots[roots.length - 1]
      if (record) {
        const group: RenamesGroup = {
          name: raw.name,
          from: raw.from,
          ...(raw.thru ? { thru: raw.thru } : {}),
        }
        record.renamesGroups = [...(record.renamesGroups ?? []), group]
      }
      continue
    }

    if (raw.kind === 'unresolved-copy') {
      // level:0 y lengthInBytes:0 son sentinelas, no hechos verificados:
      // ver `type === 'unresolved-copy'` antes de confiar en ellos.
      const field: SchemaField = {
        level: 0,
        name: raw.member,
        type: 'unresolved-copy',
        lengthInBytes: 0,
        offset: 0,
        children: [],
        unresolvedCopyMember: raw.member,
      }

      // Un COPY no lleva nivel propio, así que no hay número con el que
      // decidir dónde encaja exactamente. Lo único que sí sabemos: NUNCA
      // puede ser hijo de un campo elemental (estructuralmente imposible
      // en COBOL) — así que se desapila hasta el grupo abierto más
      // profundo. Sigue siendo una elección, no un hecho verificado: con
      // el member ausente no hay forma de saber si el COPY real habría
      // cerrado ese grupo o seguido añadiéndole campos.
      while (stack.length > 0 && stack[stack.length - 1]!.type !== 'group') {
        stack.pop()
      }

      const parent = stack.length > 0 ? stack[stack.length - 1] : undefined
      if (parent) {
        parent.children.push(field)
      } else {
        if (currentSection) field.dataSection = currentSection
        roots.push(field)
      }

      lastField = field
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
      // Los punteros e índices van alineados aunque no lleven SYNC escrito.
      ...(raw.synchronized || pic?.type === 'pointer' || pic?.type === 'index'
        ? { synchronized: true }
        : {}),
      ...(raw.value !== undefined ? { value: raw.value } : {}),
    }

    while (stack.length > 0 && stack[stack.length - 1]!.level >= raw.level) {
      stack.pop()
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : undefined

    if (parent) {
      parent.children.push(field)
    } else {
      // La sección solo se estampa en el registro raíz: los hijos son de
      // la misma por construcción, y repetirla sería ruido.
      if (currentSection) field.dataSection = currentSection
      roots.push(field)
    }

    stack.push(field)
    lastField = field
  }

  return roots
}

/**
 * Alineación que exige un campo: la suya si es elemental, la mayor de su
 * contenido si es grupo. No toca nada — se consulta antes de colocar el
 * campo, cuando sus longitudes finales aún no están calculadas.
 */
function requiredAlignment(field: SchemaField): number {
  if (field.children.length === 0) {
    return alignmentOf(field.type, field.lengthInBytes, field.synchronized === true)
  }
  let max = 1
  for (const child of field.children) {
    max = Math.max(max, requiredAlignment(child))
  }
  return max
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
 *
 * Huecos sin resolver (type === 'unresolved-copy'): a partir de ahí no se
 * sabe cuántos bytes ocupa lo que falta, así que calcular el offset del
 * siguiente campo como si el hueco midiera 0 bytes sería inventar un
 * número disfrazado de hecho verificado (ADR-0003). En su lugar, se marca
 * `offsetUnknown: true` en el propio hueco y en todo lo que venga después
 * en ese mismo nivel — y, si un grupo contiene un hueco en su interior, el
 * propio grupo (y sus hermanos posteriores en el nivel padre) hereda la
 * marca también, porque su longitud total ya no es fiable.
 *
 * SYNCHRONIZED (y los punteros/índices, alineados de forma implícita):
 * el offset se redondea al alto hasta la frontera que exige el campo,
 * medida desde el principio del registro 01. Los bytes de relleno que
 * quedan delante no son de nadie, pero sí desplazan todo lo que sigue.
 * Un grupo hereda la mayor alineación de su contenido, y si además lleva
 * OCCURS su longitud se redondea para que cada ocurrencia empiece
 * alineada — que es lo que reserva el compilador.
 *
 * Devuelve también `alignment`: lo que el nivel entero exige, para que el
 * padre lo herede.
 */
function resolveOffsets(
  fields: SchemaField[],
  baseOffset: number,
): { length: number; hasUnknown: boolean; alignment: number } {
  let offset = baseOffset
  let clusterMaxLength = 0
  let offsetUnknownFromHere = false
  let anyUnknown = false
  let groupAlignment = 1

  for (const field of fields) {
    // Hay que saber qué alineación exige el campo ANTES de colocarlo, y
    // para un grupo eso depende de su contenido. Se mira sin resolver:
    // resolver dos veces aplicaría dos veces el `*= occurs`.
    const ownAlignment = requiredAlignment(field)
    groupAlignment = Math.max(groupAlignment, ownAlignment)

    if (field.redefines) {
      field.offset = offset
    } else {
      offset += clusterMaxLength
      if (ownAlignment > 1 && offset % ownAlignment !== 0) {
        offset += ownAlignment - (offset % ownAlignment)
      }
      field.offset = offset
      clusterMaxLength = 0
    }

    if (offsetUnknownFromHere) {
      field.offsetUnknown = true
    }
    if (field.type === 'unresolved-copy') {
      field.offsetUnknown = true
      offsetUnknownFromHere = true
    }

    if (field.children.length > 0) {
      const placed = resolveOffsets(field.children, field.offset)
      field.lengthInBytes = placed.length
      // Cada ocurrencia de un OCCURS tiene que empezar alineada, así que
      // el compilador rellena el final del grupo hasta el múltiplo.
      if (field.occurs !== undefined && placed.alignment > 1) {
        const remainder = field.lengthInBytes % placed.alignment
        if (remainder !== 0) field.lengthInBytes += placed.alignment - remainder
      }
      if (placed.hasUnknown) {
        field.offsetUnknown = true
        offsetUnknownFromHere = true
      }
    }

    if (field.offsetUnknown) {
      anyUnknown = true
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
  return { length: offset - baseOffset, hasUnknown: anyUnknown, alignment: groupAlignment }
}

/**
 * Resuelve el offset y la longitud de cada nivel 66 contra el registro ya
 * calculado. Si algún extremo del rango no aparece en el fuente aportado
 * —está en un copybook que falta, por ejemplo— se deja sin resolver en vez
 * de estimarlo (ADR-0003).
 */
function resolveRenames(record: SchemaField): void {
  const byName = new Map<string, SchemaField>()
  const collect = (field: SchemaField): void => {
    byName.set(field.name.toUpperCase(), field)
    for (const child of field.children) collect(child)
  }
  collect(record)

  for (const group of record.renamesGroups ?? []) {
    const from = byName.get(group.from.toUpperCase())
    const thru = group.thru ? byName.get(group.thru.toUpperCase()) : from
    if (!from || !thru) continue
    if (from.offsetUnknown || thru.offsetUnknown) continue
    group.offset = from.offset
    group.lengthInBytes = thru.offset + thru.lengthInBytes - from.offset
  }
}

/**
 * Parsea un copybook COBOL y extrae su esquema de campos.
 *
 * Subconjunto cubierto: niveles jerárquicos, PIC (incluidos los editados),
 * OCCURS (fijo y DEPENDING ON reconocido), REDEFINES, niveles 88, niveles
 * 66 RENAMES, USAGE (DISPLAY, COMP, COMP-1, COMP-2, COMP-3, BINARY,
 * PACKED-DECIMAL, POINTER, PROCEDURE-POINTER, FUNCTION-POINTER, INDEX),
 * SYNCHRONIZED con sus bytes de relleno, VALUE como valor inicial, la
 * sección de la DATA DIVISION de cada 01 (FILE / WORKING-STORAGE /
 * LOCAL-STORAGE / LINKAGE), y resolución de COPY (con REPLACING) y EXEC
 * SQL INCLUDE contra `copybooks`. Un member no aportado en `copybooks`
 * queda como hueco explícito en `records` y listado en `missingCopybooks`
 * — nunca se inventa su estructura.
 *
 * Fuera del subconjunto, y por tanto ignorado: JUSTIFIED, BLANK WHEN ZERO,
 * y las secciones REPORT/SCREEN (dejan la sección sin determinar).
 */
export function parse(source: string, copybooks: Map<string, string> = new Map()): ParseResult {
  // Si el fuente es un programa completo, la definición de datos termina
  // donde empieza la PROCEDURE DIVISION — nada de lo que sigue es un campo.
  const allLines = source.split(/\r?\n/)
  const procedureIndex = allLines.findIndex(line => {
    const body = line.length > 6 ? line.slice(6) : line
    return /^\s*PROCEDURE\s+DIVISION/i.test(body)
  })
  const dataLines = procedureIndex === -1 ? allLines : allLines.slice(0, procedureIndex)

  const rawStatements = joinContinuations(dataLines)
  // Los nombres de member son case-insensitive: el mapa se normaliza a
  // mayúsculas para que el lookup de resolveCopies siempre encaje.
  const normalizedCopybooks = new Map(
    [...copybooks].map(([name, text]) => [name.toUpperCase(), text] as const),
  )
  const { statements: resolved, missingCopybooks } = resolveCopies(rawStatements, normalizedCopybooks)

  const statements: RawStatement[] = []
  for (const item of resolved) {
    if (item.kind === 'unresolved-copy') {
      statements.push({ kind: 'unresolved-copy', member: item.member })
      continue
    }
    // Una cabecera de sección no es un campo, pero marca de dónde vienen
    // los 01 que la siguen (¿parámetro por LINKAGE, o dato propio?).
    const sectionMatch = DATA_SECTION_RE.exec(item.statement)
    if (sectionMatch) {
      statements.push({ kind: 'section', section: sectionMatch[1]!.toUpperCase() as DataSection })
      continue
    }
    const parsed = parseStatement(item.statement)
    if (parsed) statements.push(parsed)
  }

  const roots = buildTree(statements)

  // Cada 01/77 de nivel raíz es un área de almacenamiento independiente
  // (no hay FD ni FILE SECTION en el alcance de un copybook): sus offsets
  // internos son relativos a su propio inicio, no continúan entre records.
  for (const root of roots) {
    resolveOffsets([root], 0)
    resolveRenames(root)
  }

  return { records: roots, missingCopybooks }
}
