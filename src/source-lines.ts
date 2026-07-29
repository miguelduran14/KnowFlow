/**
 * Utilidades de lectura de fuente COBOL compartidas por los parsers que
 * trabajan línea a línea (flujo e inventario): recorte de columnas de
 * formato fijo, descarte de comentarios y enmascarado de literales.
 */

export interface SourceLine {
  /** Contenido de código de la línea (sin secuencia ni indicador en formato fijo) */
  body: string
  /**
   * El mismo contenido con el interior de los literales de cadena en
   * blanco (misma longitud). Los regex de sentencias se ejecutan sobre
   * esta versión: un verbo dentro de un literal (`DISPLAY 'PERFORM X'`)
   * no es una sentencia, y tratarlo como tal fabricaría un hecho que no
   * existe en el programa (ADR-0003).
   */
  masked: string
  /** Número de línea 1-based en el fuente original */
  line: number
}

export function maskLiterals(body: string): string {
  return body.replace(/'[^']*'|"[^"]*"/g, m => "'" + ' '.repeat(m.length - 2) + "'")
}

/**
 * Formato fijo (cols 1-6 secuencia, col 7 indicador) vs libre: si alguna
 * línea con contenido tiene algo que no sea espacio o dígito en las
 * columnas 1-6, el fuente es un pegado en formato libre y no se recortan
 * columnas — recortarlas destrozaría los nombres ("MAIN-PARA." → "RA.").
 */
export function isFixedFormat(rawLines: string[]): boolean {
  for (const line of rawLines) {
    if (line.trim() === '') continue
    if (!/^[\s\d]*$/.test(line.slice(0, 6))) return false
  }
  return true
}

export function cleanLines(source: string): SourceLine[] {
  const raw = source.split(/\r?\n/)
  const fixed = isFixedFormat(raw)
  const out: SourceLine[] = []

  for (let i = 0; i < raw.length; i++) {
    let body: string
    if (fixed) {
      const line = raw[i]!
      const indicator = line.length > 6 ? line[6]! : ' '
      if (indicator === '*' || indicator === '/') continue
      // El área de programa es columnas 8-72. Las columnas 73-80 son la
      // zona de identificación/secuencia (p. ej. "CM2014.2" en la suite
      // NIST): el compilador las ignora, y si no se recortan, la basura
      // final impide que una cabecera "PARRAFO." o un "PROCEDURE DIVISION."
      // acaben en punto y se pierde todo el cuerpo del programa.
      body = line.length > 7 ? line.slice(7, 72) : ''
    } else {
      body = raw[i]!
      if (body.trimStart().startsWith('*')) continue
    }
    if (body.trim() === '') continue
    out.push({ body, masked: maskLiterals(body), line: i + 1 })
  }

  return out
}

// Un nombre de párrafo o sección puede EMPEZAR por dígito: la convención
// numérica (0000-, 1000-, 9999-) es de las más extendidas en shops reales.
// Exigir letra inicial dejaba ciego al parser ante esos programas enteros.
const SECTION_HEADER_RE = /^([A-Za-z0-9][\w-]*)\s+SECTION\s*\.\s*$/
const PARAGRAPH_HEADER_RE = /^([A-Za-z0-9][\w-]*)\s*\.\s*$/

// Tokens de área A que parecen cabecera de párrafo pero no lo son
const NON_PARAGRAPH_HEADERS = new Set(['DECLARATIVES', 'END-DECLARATIVES'])

/**
 * `DECLARATIVES.` y `END-DECLARATIVES.` delimitan la zona de manejadores.
 * No son cabeceras de párrafo, pero tampoco sentencias: tratarlas como
 * sentencia abriría un párrafo de entrada implícito que no existe.
 */
export function isDeclarativesMarker(masked: string): boolean {
  return /^\s*(?:END-)?DECLARATIVES\s*\.\s*$/i.test(masked)
}

/** Cabecera de párrafo/sección: un solo token + punto, arrancando en área A
 *  (columnas 8-11). Las sentencias van en área B (columna 12+), así que la
 *  indentación distingue "PARRAFO." de una sentencia de un solo verbo. */
export function matchHeader(masked: string): { name: string; kind: 'paragraph' | 'section' } | undefined {
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

/**
 * Extrae los PROGRAM-ID del fuente, con su línea. El primero es el
 * programa; los demás son programas anidados. Cubre las dos formas del
 * estándar: el nombre en la misma línea (`PROGRAM-ID. FOO.`) y el nombre
 * en la línea siguiente (`PROGRAM-ID.` / `    FOO.`), que es como lo
 * escribe la suite NIST y buena parte del COBOL clásico.
 */
export function extractProgramIds(lines: SourceLine[]): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /(?<![\w-])PROGRAM-ID\s*\.\s*([A-Za-z0-9][\w-]*)?/i.exec(lines[i]!.masked)
    if (!m) continue
    let name = m[1]
    if (!name && lines[i + 1]) {
      name = /^\s*([A-Za-z0-9][\w-]*)/.exec(lines[i + 1]!.masked)?.[1]
    }
    if (name) out.push({ name, line: lines[i]!.line })
  }
  return out
}

/** Trozo del body original correspondiente a un grupo capturado (los regex
 *  corren sobre `masked`; el texto real —p. ej. una condición con un
 *  literal dentro— se recupera del original por posición). */
export function groupText(m: RegExpMatchArray, group: number, original: string): string | undefined {
  const span = m.indices?.[group]
  return span ? original.slice(span[0], span[1]) : undefined
}
