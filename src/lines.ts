import { isFixedFormat } from './source-lines.js'

/**
 * Une líneas de continuación COBOL (columna 7 = '-' o carácter no blanco
 * en área A tras un punto y aparte) en sentencias lógicas. Reconoce el
 * inicio de una sentencia nueva por nivel numérico, COPY o EXEC SQL —
 * las tres formas de sentencia que aparecen en un copybook.
 *
 * Detecta formato fijo vs libre igual que el lado de flujo/inventario
 * (`isFixedFormat`): en fijo se recortan las columnas de secuencia (1-6) e
 * identificación (73-80) y el indicador va en la col. 7; en libre el código
 * ocupa la línea entera y recortar columnas destrozaría los nombres (un
 * `01 WS-REC.` en col. 1 se quedaría en `S-REC.`). Sin esta distinción, la
 * DATA DIVISION en formato libre se parseaba a un esquema vacío mientras el
 * flujo sí se leía — una inconsistencia dentro del propio motor.
 */
export function joinContinuations(lines: string[]): string[] {
  const logical: string[] = []
  const fixed = isFixedFormat(lines)

  for (const raw of lines) {
    // Columna 7 = indicador, columnas 8-72 = programa, 73-80 = zona de
    // identificación que el compilador ignora (p. ej. "CM2014.2" en la
    // suite NIST). Recortarla evita que un VALUE o un PIC se traguen esa
    // basura y que la detección de fin de sentencia por punto se rompa. En
    // formato libre no hay columnas que recortar.
    const line = fixed ? (raw.length > 6 ? raw.slice(6, 72) : raw) : raw
    const trimmed = line.trimStart()

    if (trimmed === '' || trimmed.startsWith('*')) continue

    // Columna 7 = '-': continuación explícita — siempre se une a la
    // anterior, aunque esta acabara en punto (p. ej. un literal cuyo
    // texto termina en '.' y sigue en la línea siguiente). Solo es
    // indicador en la col. 7 del formato fijo; en libre una sentencia no
    // empieza por '-'.
    const explicitContinuation = fixed && line[0] === '-'
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
