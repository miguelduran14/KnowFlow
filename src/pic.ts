import type { DataType } from './types.js'

export interface PicInfo {
  type: DataType
  picture: string
  totalDigits: number
  decimalDigits: number
  lengthInBytes: number
}

export interface ParsePicOptions {
  /** SIGN IS LEADING/TRAILING SEPARATE — añade 1 byte extra en DISPLAY */
  signSeparate?: boolean | undefined
}

/**
 * Expande repeticiones en una cláusula PIC.
 * "X(10)" → "XXXXXXXXXX", "9(3)V9(2)" → "999V99"
 */
function expandPic(raw: string): string {
  return raw.replace(/([XABSV9P0Z*+\-,./])\((\d+)\)/gi, (_m, ch: string, n: string) =>
    ch.repeat(Number(n)),
  )
}

function normalizeUsage(usage?: string): string {
  return (usage ?? 'DISPLAY').toUpperCase().replace(/[-\s]/g, '')
}

/**
 * Tamaño de un campo binario (COMP/BINARY) según el número de dígitos
 * decimales que representa — convención estándar IBM Enterprise COBOL:
 * 1-4 dígitos → halfword (2 bytes), 5-9 → fullword (4 bytes), 10-18 → doubleword (8 bytes).
 */
function binarySize(totalDigits: number): number {
  if (totalDigits <= 4) return 2
  if (totalDigits <= 9) return 4
  return 8
}

/**
 * Clasifica un carácter de PIC expandido: qué aporta al conteo de bytes.
 *
 * En DISPLAY, cada posición de la PIC cuesta EXACTAMENTE un byte — dígitos,
 * signos, caracteres de edición (Z, *, +, -, coma, punto, barra, B, 0) y
 * los sufijos CR/DB (que ocupan 2 bytes cada uno). V (decimal implícito) y
 * S (signo embebido, excepto SEPARATE) NO cuestan bytes.
 *
 * La clasificación importa porque los empaquetados (COMP-3, COMP) solo
 * cuentan posiciones numéricas (9, Z, *) y los que aceptan un signo embebido.
 */
/**
 * Determina si un PIC expandido es numérico, editado-numérico, o alfanumérico.
 * Numérico puro: solo 9, S, V, P.
 * Editado numérico: contiene Z, *, +, -, CR, DB, coma, punto, B (como edición), 0 (inserción).
 * Alfanumérico: contiene X o A.
 */
function classifyPic(expanded: string): 'numeric' | 'numeric-edited' | 'alphanumeric' {
  if (/[XA]/i.test(expanded)) return 'alphanumeric'
  if (/[Z*+\-,./B]|CR|DB/i.test(expanded)) return 'numeric-edited'
  return 'numeric'
}

/**
 * Cuenta bytes DISPLAY de un PIC expandido. Cada carácter posicional = 1 byte,
 * excepto V (decimal implícito, 0 bytes), S (signo embebido, 0 bytes a menos
 * que SIGN SEPARATE), y CR/DB (2 bytes cada uno — pero en el expandido cada
 * letra ya está separada: C, R se cuentan individualmente, 1+1=2).
 */
function displayBytes(expanded: string, signSeparate: boolean): number {
  let bytes = 0
  for (const ch of expanded) {
    const upper = ch.toUpperCase()
    if (upper === 'V') continue
    if (upper === 'S') {
      if (signSeparate) bytes++
      continue
    }
    // P (scaling) no ocupa byte físico
    if (upper === 'P') continue
    bytes++
  }
  return bytes || 1
}

/**
 * Cuenta dígitos numéricos de un PIC expandido — las posiciones que cuentan
 * para la aritmética COMP-3 y COMP. Son: 9, Z, *, P (scaling), y el primer
 * + o - (como dígito de signo, los demás son inserción).
 */
function countDigits(expanded: string): { total: number; decimal: number } {
  const noSign = expanded.replace(/^S/i, '')
  const parts = noSign.split(/V/i)
  const intPart = parts[0] ?? ''
  const decPart = parts[1] ?? ''

  function digitCount(s: string): number {
    let count = 0
    for (const ch of s) {
      const upper = ch.toUpperCase()
      if (upper === '9' || upper === 'Z' || upper === '*' || upper === 'P') count++
    }
    return count
  }

  const intDigits = digitCount(intPart)
  const decDigits = digitCount(decPart)
  return { total: intDigits + decDigits, decimal: decDigits }
}

/**
 * Parsea una cláusula PIC (y USAGE) y calcula tipo y longitud en bytes.
 * COMP-1/COMP-2 no requieren PIC — su tamaño es fijo (float de 4/8 bytes).
 */
export function parsePic(rawPicture: string | undefined, usage?: string, options?: ParsePicOptions): PicInfo {
  const normalizedUsage = normalizeUsage(usage)
  const picture = (rawPicture ?? '').toUpperCase().replace(/\s+/g, '')

  if (normalizedUsage === 'COMP1') {
    return { type: 'float-single', picture, totalDigits: 0, decimalDigits: 0, lengthInBytes: 4 }
  }

  if (normalizedUsage === 'COMP2') {
    return { type: 'float-double', picture, totalDigits: 0, decimalDigits: 0, lengthInBytes: 8 }
  }

  const expanded = expandPic(picture)
  const classification = classifyPic(expanded)

  if (classification === 'alphanumeric') {
    const len = displayBytes(expanded, false)
    return {
      type: 'alphanumeric',
      picture,
      totalDigits: 0,
      decimalDigits: 0,
      lengthInBytes: len,
    }
  }

  const { total: totalDigits, decimal: decDigits } = countDigits(expanded)

  if (normalizedUsage === 'COMP3' || normalizedUsage === 'PACKEDDECIMAL') {
    const bytes = Math.ceil((totalDigits + 1) / 2)
    return {
      type: 'packed-decimal',
      picture,
      totalDigits,
      decimalDigits: decDigits,
      lengthInBytes: bytes,
    }
  }

  if (normalizedUsage === 'COMP' || normalizedUsage === 'BINARY') {
    return {
      type: 'binary',
      picture,
      totalDigits,
      decimalDigits: decDigits,
      lengthInBytes: binarySize(totalDigits),
    }
  }

  const bytes = displayBytes(expanded, options?.signSeparate === true)

  return {
    // Un PIC editado es un campo de presentación: los caracteres de
    // inserción ocupan bytes reales pero no son dígitos con los que
    // se pueda operar. Distinguirlo evita que la tabla de esquema
    // sugiera que ZZ,ZZ9.99 se comporta como 9(7)V99.
    type: classification === 'numeric-edited' ? 'numeric-edited' : 'numeric',
    picture,
    totalDigits,
    decimalDigits: decDigits,
    lengthInBytes: bytes,
  }
}

/** USAGE que no requiere PIC para determinar su tamaño (floats de tamaño fijo) */
export function usageImpliesFixedSize(usage?: string): boolean {
  const n = normalizeUsage(usage)
  return n === 'COMP1' || n === 'COMP2'
}
