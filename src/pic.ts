import type { DataType } from './types.js'

export interface PicInfo {
  type: DataType
  picture: string
  totalDigits: number
  decimalDigits: number
  lengthInBytes: number
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

/**
 * Parsea una cláusula PIC y calcula tipo y longitud en bytes.
 * Soporta: PIC X, PIC 9, PIC S9 V, con USAGE DISPLAY o COMP-3.
 */
export function parsePic(rawPicture: string, usage?: string): PicInfo {
  const picture = rawPicture.toUpperCase().replace(/\s+/g, '')
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

  const normalizedUsage = (usage ?? 'DISPLAY').toUpperCase().replace(/[-\s]/g, '')

  if (normalizedUsage === 'COMP3') {
    const bytes = Math.ceil((totalDigits + 1) / 2)
    return {
      type: 'packed-decimal',
      picture,
      totalDigits,
      decimalDigits: decDigits,
      lengthInBytes: bytes,
    }
  }

  return {
    type: 'numeric',
    picture,
    totalDigits,
    decimalDigits: decDigits,
    lengthInBytes: totalDigits,
  }
}
