import type {
  CursorUsage,
  ExecBlock,
  FileOperation,
  FileUsage,
  FileVerb,
  Inventory,
} from './types.js'
import { cleanLines, matchHeader, type SourceLine } from './source-lines.js'

/**
 * Inventario de lo que el programa toca: ficheros con sus operaciones,
 * bloques EXEC SQL (tablas y cursores) y comandos EXEC CICS.
 *
 * Es extracción literal, no interpretación: se dice QUÉ tabla se nombra y
 * en qué línea, nunca qué significa la consulta. Lo que no se puede
 * resolver contra el fuente aportado (un WRITE de un registro cuyo FD está
 * en un copybook ausente) se lista aparte en vez de atribuirse a un
 * fichero inventado (ADR-0003).
 */

const DIVISION_RE = /^\s*(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION/i
const SECTION_RE = /^\s*([A-Z][\w-]*)\s+SECTION\s*\.\s*$/i
const FILE_CONTROL_RE = /^\s*FILE-CONTROL\s*\./i
const FD_RE = /^\s*(?:FD|SD)\s+([A-Za-z][\w-]*)/i
const LEVEL_01_RE = /^\s*01\s+([A-Za-z][\w-]*)/i

const SELECT_RE = /(?<![\w-])SELECT\s+(?:OPTIONAL\s+)?([A-Za-z][\w-]*)/i
const ASSIGN_RE = /(?<![\w-])ASSIGN\s+(?:TO\s+)?([A-Za-z][\w-]*(?:-[\w-]*)*)/i
const ORGANIZATION_RE = /(?<![\w-])ORGANIZATION\s+(?:IS\s+)?([A-Za-z][\w-]*)/i
const ACCESS_RE = /(?<![\w-])ACCESS\s+(?:MODE\s+)?(?:IS\s+)?([A-Za-z][\w-]*)/i

const EXEC_START_RE = /(?<![\w-])EXEC\s+(SQL|CICS)(?![\w-])/i
const END_EXEC_RE = /(?<![\w-])END-EXEC(?![\w-])/i

// Verbos de E/S de fichero. OPEN y CLOSE aceptan varios ficheros por
// sentencia; el resto nombra uno solo (fichero o registro).
const OPEN_RE = /(?<![\w-])OPEN(?![\w-])([^.]*)/i
const CLOSE_RE = /(?<![\w-])CLOSE(?![\w-])([^.]*)/i
const SINGLE_IO_RE = /(?<![\w-])(READ|WRITE|REWRITE|DELETE|START)\s+([A-Za-z][\w-]*)/gi
const OPEN_MODES = new Set(['INPUT', 'OUTPUT', 'I-O', 'EXTEND'])
// Palabras que pueden seguir al nombre en un OPEN/CLOSE sin ser ficheros
const IO_NOISE = new Set(['WITH', 'NO', 'REWIND', 'LOCK', 'FOR', 'REMOVAL', 'UNIT', 'REEL'])

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/** Tablas nombradas por un EXEC SQL. Solo posiciones donde SQL exige un
 *  nombre de tabla: los host variables (`:WS-X`) y las subconsultas
 *  quedan fuera, así que un `SELECT ... INTO :WS-N FROM T` da solo `T`. */
function sqlTables(text: string): string[] {
  const found: string[] = []
  // Juego de caracteres de un identificador DB2 (letras, dígitos, _, $, #, @),
  // no el de COBOL: el guion NO forma parte de un nombre de tabla.
  const name = "[A-Za-z][\\w$#@]*(?:\\.[A-Za-z][\\w$#@]*)?"
  const patterns = [
    new RegExp(`(?<![\\w-])FROM\\s+(${name})`, 'gi'),
    new RegExp(`(?<![\\w-])JOIN\\s+(${name})`, 'gi'),
    new RegExp(`(?<![\\w-])INSERT\\s+INTO\\s+(${name})`, 'gi'),
    new RegExp(`(?<![\\w-])UPDATE\\s+(${name})`, 'gi'),
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.push(m[1]!.toUpperCase())
  }
  // Una lista `FROM A, B` nombra las dos tablas.
  for (const m of text.matchAll(new RegExp(`(?<![\\w-])FROM\\s+${name}((?:\\s*,\\s*${name})+)`, 'gi'))) {
    for (const part of m[1]!.split(',')) {
      const trimmed = part.trim()
      if (trimmed !== '') found.push(trimmed.toUpperCase())
    }
  }
  return unique(found)
}

/** Cursor nombrado por el bloque, si lo hay */
function sqlCursor(text: string): { name: string; role: 'declare' | 'open' | 'fetch' | 'close' } | undefined {
  const declare = /(?<![\w-])DECLARE\s+([A-Za-z][\w-]*)\s+(?:.*\s+)?CURSOR(?![\w-])/i.exec(text)
  if (declare) return { name: declare[1]!.toUpperCase(), role: 'declare' }
  const open = /(?<![\w-])OPEN\s+([A-Za-z][\w-]*)/i.exec(text)
  if (open) return { name: open[1]!.toUpperCase(), role: 'open' }
  const fetch = /(?<![\w-])FETCH\s+(?:FIRST\s+FROM\s+|NEXT\s+FROM\s+|FROM\s+)?([A-Za-z][\w-]*)/i.exec(text)
  if (fetch) return { name: fetch[1]!.toUpperCase(), role: 'fetch' }
  const close = /(?<![\w-])CLOSE\s+([A-Za-z][\w-]*)/i.exec(text)
  if (close) return { name: close[1]!.toUpperCase(), role: 'close' }
  return undefined
}

/**
 * Comando CICS: el primer token tras CICS, más un segundo token si es una
 * palabra suelta sin paréntesis (`HANDLE CONDITION`). En `SEND MAP('M1')`
 * el MAP lleva valor, así que queda como opción y el comando es `SEND` —
 * es la forma del fuente, no una normalización a la sintaxis del manual.
 */
function cicsCommand(text: string): string {
  const m = /(?<![\w-])EXEC\s+CICS\s+([A-Za-z][\w-]*)(?:\s+([A-Za-z][\w-]*)(?![\w-])(?!\s*\())?/i.exec(text)
  if (!m) return ''
  return m[2] ? `${m[1]!.toUpperCase()} ${m[2].toUpperCase()}` : m[1]!.toUpperCase()
}

/** Opciones CICS con valor literal, tal cual: `FILE(CUSTFILE)`, `MAP(MENU1)` */
function cicsOptions(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(?<![\w-])([A-Za-z][\w-]*)\s*\(\s*'([^']*)'\s*\)/g)) {
    out.push(`${m[1]!.toUpperCase()}(${m[2]!})`)
  }
  for (const m of text.matchAll(/(?<![\w-])([A-Za-z][\w-]*)\s*\(\s*"([^"]*)"\s*\)/g)) {
    out.push(`${m[1]!.toUpperCase()}(${m[2]!})`)
  }
  return unique(out)
}

/** Sentencias SELECT de FILE-CONTROL, cada una unida hasta su punto final */
function collectSelects(lines: SourceLine[]): FileUsage[] {
  const files: FileUsage[] = []
  let inFileControl = false
  let buffer = ''

  const flush = (): void => {
    const stmt = buffer.replace(/\s+/g, ' ').trim()
    buffer = ''
    const select = SELECT_RE.exec(stmt)
    if (!select) return
    const assign = ASSIGN_RE.exec(stmt)
    const organization = ORGANIZATION_RE.exec(stmt)
    const access = ACCESS_RE.exec(stmt)
    files.push({
      name: select[1]!.toUpperCase(),
      ...(assign ? { assignTo: assign[1]!.toUpperCase() } : {}),
      ...(organization ? { organization: organization[1]!.toUpperCase() } : {}),
      ...(access ? { access: access[1]!.toUpperCase() } : {}),
      records: [],
      operations: [],
    })
  }

  for (const { masked } of lines) {
    if (FILE_CONTROL_RE.test(masked)) {
      inFileControl = true
      continue
    }
    if (!inFileControl) continue
    // FILE-CONTROL termina donde empieza otra sección o división.
    if (DIVISION_RE.test(masked) || SECTION_RE.test(masked)) {
      flush()
      inFileControl = false
      continue
    }
    buffer += ' ' + masked
    if (/\./.test(masked)) flush()
  }
  flush()

  return files
}

/** Registros 01 bajo cada FD: es lo que permite resolver un WRITE, que
 *  nombra el registro y no el fichero. */
function collectFdRecords(lines: SourceLine[]): Map<string, string[]> {
  const byFile = new Map<string, string[]>()
  let currentFd: string | undefined

  for (const { masked } of lines) {
    if (DIVISION_RE.test(masked)) {
      currentFd = undefined
      continue
    }
    const fd = FD_RE.exec(masked)
    if (fd) {
      currentFd = fd[1]!.toUpperCase()
      byFile.set(currentFd, [])
      continue
    }
    if (SECTION_RE.test(masked)) {
      currentFd = undefined
      continue
    }
    if (!currentFd) continue
    const record = LEVEL_01_RE.exec(masked)
    if (record) byFile.get(currentFd)!.push(record[1]!.toUpperCase())
  }

  return byFile
}

/**
 * Extrae el inventario de E/S y bloques EXEC del fuente completo — los
 * EXEC SQL viven tanto en WORKING-STORAGE (DECLARE CURSOR, INCLUDE) como
 * en la PROCEDURE DIVISION, así que se recorre el programa entero.
 */
export function parseInventory(source: string): Inventory {
  const lines = cleanLines(source)

  const files = collectSelects(lines)
  const fdRecords = collectFdRecords(lines)
  for (const file of files) {
    file.records = fdRecords.get(file.name) ?? []
  }

  const byName = new Map(files.map(f => [f.name, f]))
  const byRecord = new Map<string, FileUsage>()
  for (const file of files) {
    for (const record of file.records) byRecord.set(record, file)
  }

  const execs: ExecBlock[] = []
  const unresolvedFileOps: (FileOperation & { target: string })[] = []

  let inProcedure = false
  let paragraph: string | undefined
  // Un bloque EXEC abierto acumula líneas hasta su END-EXEC. Se guardan
  // las dos versiones: la enmascarada para reconocer verbos y tablas (un
  // "FROM T" dentro de un literal no es una tabla) y la original para el
  // texto legible y los valores literales de las opciones CICS.
  let openExec:
    | { kind: 'sql' | 'cics'; line: number; parts: string[]; raw: string[]; paragraph?: string | undefined }
    | undefined

  const record = (target: string, op: FileOperation): void => {
    const file = byName.get(target) ?? byRecord.get(target)
    if (file) file.operations.push(op)
    else unresolvedFileOps.push({ ...op, target })
  }

  const collapse = (parts: string[]): string => parts.join(' ').replace(/\s+/g, ' ').trim()

  for (const { body, masked, line } of lines) {
    if (openExec) {
      openExec.parts.push(masked.trim())
      openExec.raw.push(body.trim())
      if (END_EXEC_RE.test(masked)) {
        execs.push(
          buildExec(openExec.kind, collapse(openExec.parts), collapse(openExec.raw), openExec.line, openExec.paragraph),
        )
        openExec = undefined
      }
      continue
    }

    if (/^\s*PROCEDURE\s+DIVISION/i.test(masked)) {
      inProcedure = true
      continue
    }

    const execStart = EXEC_START_RE.exec(masked)
    if (execStart) {
      const kind = execStart[1]!.toUpperCase() === 'SQL' ? 'sql' : 'cics'
      if (END_EXEC_RE.test(masked)) {
        execs.push(buildExec(kind, collapse([masked]), collapse([body]), line, paragraph))
      } else {
        openExec = { kind, line, parts: [masked.trim()], raw: [body.trim()], paragraph }
      }
      continue
    }

    if (!inProcedure) continue

    const header = matchHeader(masked)
    if (header) {
      paragraph = header.name
      continue
    }
    if (paragraph === undefined) paragraph = 'MAIN'

    const open = OPEN_RE.exec(masked)
    if (open) {
      let mode: string | undefined
      for (const token of open[1]!.trim().split(/\s+/)) {
        const upper = token.toUpperCase()
        if (upper === '') continue
        if (OPEN_MODES.has(upper)) {
          mode = upper
          continue
        }
        if (IO_NOISE.has(upper)) continue
        record(upper, { verb: 'OPEN', ...(mode ? { mode } : {}), paragraph, line })
      }
    }

    const close = CLOSE_RE.exec(masked)
    if (close) {
      for (const token of close[1]!.trim().split(/\s+/)) {
        const upper = token.toUpperCase()
        if (upper === '' || IO_NOISE.has(upper)) continue
        record(upper, { verb: 'CLOSE', paragraph, line })
      }
    }

    for (const m of masked.matchAll(SINGLE_IO_RE)) {
      record(m[2]!.toUpperCase(), { verb: m[1]!.toUpperCase() as FileVerb, paragraph, line })
    }
  }

  // Un EXEC sin END-EXEC (fuente truncado) se registra igual: es un hecho
  // del fuente aportado, y ocultarlo perdería una tabla o un comando.
  if (openExec) {
    execs.push(
      buildExec(openExec.kind, collapse(openExec.parts), collapse(openExec.raw), openExec.line, openExec.paragraph),
    )
  }

  const tables = unique(execs.filter(e => e.kind === 'sql').flatMap(e => e.names))

  const cursors = new Map<string, CursorUsage>()
  for (const exec of execs) {
    if (exec.kind !== 'sql' || !exec.cursor) continue
    const entry = cursors.get(exec.cursor) ?? {
      name: exec.cursor,
      declared: false,
      opened: false,
      fetched: false,
      closed: false,
      tables: [],
    }
    const verb = exec.verb
    if (verb === 'DECLARE') {
      entry.declared = true
      entry.tables = unique([...entry.tables, ...exec.names])
    }
    if (verb === 'OPEN') entry.opened = true
    if (verb === 'FETCH') entry.fetched = true
    if (verb === 'CLOSE') entry.closed = true
    cursors.set(exec.cursor, entry)
  }

  const cicsCounts = new Map<string, number>()
  for (const exec of execs) {
    if (exec.kind !== 'cics') continue
    cicsCounts.set(exec.verb, (cicsCounts.get(exec.verb) ?? 0) + 1)
  }

  return {
    files,
    unresolvedFileOps,
    execs,
    tables,
    cursors: [...cursors.values()],
    cicsCommands: [...cicsCounts].map(([command, count]) => ({ command, count })),
  }
}

/**
 * `masked` es la versión con los literales en blanco: de ahí salen verbos,
 * tablas y cursores, para que un `FROM ORDERS` escrito dentro de una
 * cadena no se cuele como tabla. `raw` es el texto real: de ahí salen el
 * texto legible del bloque y los valores literales de las opciones CICS,
 * que es precisamente lo que interesa (`FILE('ACCTFILE')`).
 */
function buildExec(
  kind: 'sql' | 'cics',
  masked: string,
  raw: string,
  line: number,
  paragraph: string | undefined,
): ExecBlock {
  if (kind === 'cics') {
    return {
      kind,
      verb: cicsCommand(masked),
      ...(paragraph ? { paragraph } : {}),
      line,
      text: raw,
      names: cicsOptions(raw),
    }
  }

  const verbMatch = /(?<![\w-])EXEC\s+SQL\s+([A-Za-z][\w-]*)/i.exec(masked)
  const cursor = sqlCursor(masked)
  return {
    kind,
    verb: verbMatch ? verbMatch[1]!.toUpperCase() : '',
    ...(paragraph ? { paragraph } : {}),
    line,
    text: raw,
    names: sqlTables(masked),
    ...(cursor ? { cursor: cursor.name } : {}),
  }
}
