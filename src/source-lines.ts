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

const SECTION_HEADER_RE = /^([A-Za-z][\w-]*)\s+SECTION\s*\.\s*$/
const PARAGRAPH_HEADER_RE = /^([A-Za-z][\w-]*)\s*\.\s*$/

// Tokens de área A que parecen cabecera de párrafo pero no lo son
const NON_PARAGRAPH_HEADERS = new Set(['DECLARATIVES', 'END-DECLARATIVES'])

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

/** Trozo del body original correspondiente a un grupo capturado (los regex
 *  corren sobre `masked`; el texto real —p. ej. una condición con un
 *  literal dentro— se recupera del original por posición). */
export function groupText(m: RegExpMatchArray, group: number, original: string): string | undefined {
  const span = m.indices?.[group]
  return span ? original.slice(span[0], span[1]) : undefined
}
