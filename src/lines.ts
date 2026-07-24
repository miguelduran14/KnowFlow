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

    // Columna 7 = '-': continuación explícita — siempre se une a la
    // anterior, aunque esta acabara en punto (p. ej. un literal cuyo
    // texto termina en '.' y sigue en la línea siguiente).
    const explicitContinuation = line[0] === '-'
    const startsNewStatement = /^(\d{1,2}\s+|COPY\b|EXEC\s+SQL\b)/i.test(trimmed)
    // El punto cierra la sentencia COBOL: si la lógica anterior ya terminó
    // en punto, esta línea empieza una nueva aunque no parezca "de datos".
    // Sin esta regla, en un programa completo la última cláusula VALUE de
    // un nivel 88 se tragaría las divisiones siguientes como continuación.
    const previousClosed = logical.length > 0 && /\.\s*$/.test(logical[logical.length - 1]!)

    if (!explicitContinuation && (startsNewStatement || previousClosed || logical.length === 0)) {
      logical.push(trimmed)
    } else if (logical.length === 0) {
      logical.push(trimmed.replace(/^-\s*/, ''))
    } else {
      logical[logical.length - 1] += ' ' + trimmed.replace(/^-\s*/, '')
    }
  }

  return logical
}
