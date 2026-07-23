/**
 * Une líneas de continuación COBOL (columna 7 = '-' o carácter no blanco
 * en área A tras un punto y aparte) en sentencias lógicas. Reconoce el
 * inicio de una sentencia nueva por nivel numérico, COPY o EXEC SQL —
 * las tres formas de sentencia que aparecen en un copybook.
 */
export function joinContinuations(lines: string[]): string[] {
  const logical: string[] = []

  for (const raw of lines) {
    const line = raw.length > 6 ? raw.slice(6) : raw
    const trimmed = line.trimStart()

    if (trimmed === '' || trimmed.startsWith('*')) continue

    const startsNewStatement = /^(\d{1,2}\s+|COPY\b|EXEC\s+SQL\b)/i.test(trimmed)

    if (startsNewStatement || logical.length === 0) {
      logical.push(trimmed)
    } else {
      logical[logical.length - 1] += ' ' + trimmed.replace(/^-\s*/, '')
    }
  }

  return logical
}
