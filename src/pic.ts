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
  const isNumeric = /[9SV]/.test(expanded) && !/[XA]/.test(expanded)

  if (!isNumeric) {
    const len = (expanded.match(/X/gi) ?? []).length
      + (expanded.match(/A/gi) ?? []).length
    return {
      type: 'alphanumeric',
      picture,
      totalDigits: 0,
      decimalDigits: 0,
      lengthInBytes: len || 1,
    }
  }

  const integerPart = expanded.replace(/^S/, '').split('V')[0] ?? ''
  const decimalPart = expanded.split('V')[1] ?? ''
  const intDigits = (integerPart.match(/9/g) ?? []).length
  const decDigits = (decimalPart.match(/9/g) ?? []).length
  const totalDigits = intDigits + decDigits

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

  const signExtra = options?.signSeparate ? 1 : 0
  return {
    type: 'numeric',
    picture,
    totalDigits,
    decimalDigits: decDigits,
    lengthInBytes: totalDigits + signExtra,
  }
}

/** USAGE que no requiere PIC para determinar su tamaño (floats de tamaño fijo) */
export function usageImpliesFixedSize(usage?: string): boolean {
  const n = normalizeUsage(usage)
  return n === 'COMP1' || n === 'COMP2'
}
