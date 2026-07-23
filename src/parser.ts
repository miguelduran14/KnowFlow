import type { ParseResult, SchemaField } from './types.js'
import { parsePic } from './pic.js'

interface RawField {
  level: number
  name: string
  picture?: string | undefined
  usage?: string | undefined
}

/**
 * Une líneas de continuación COBOL (columna 7 = '-' o carácter no blanco
 * en área A tras un punto y aparte) en sentencias lógicas.
 * Para el subconjunto del slice 1 basta con juntar líneas que no empiezan
 * un nuevo número de nivel ni son directivas.
 */
function joinContinuations(lines: string[]): string[] {
  const logical: string[] = []

  for (const raw of lines) {
    const line = raw.length > 6 ? raw.slice(6) : raw
    const trimmed = line.trimStart()

    if (trimmed === '' || trimmed.startsWith('*')) continue

    const startsNewStatement = /^\s*\d{1,2}\s+/.test(trimmed)

    if (startsNewStatement || logical.length === 0) {
      logical.push(trimmed)
    } else {
      logical[logical.length - 1] += ' ' + trimmed.replace(/^-\s*/, '')
    }
  }

  return logical
}

const LEVEL_RE = /^(\d{1,2})\s+([\w-]+)/
const PIC_RE = /PIC(?:TURE)?\s+IS\s+([\w()V,\-+*/]+)|PIC(?:TURE)?\s+([\w()V,\-+*/]+)/i
const USAGE_RE = /(?:USAGE\s+IS\s+|USAGE\s+)?(?:COMPUTATIONAL-3|COMP-3)/i

function parseField(statement: string): RawField | undefined {
  const stmt = statement.replace(/\.\s*$/, '')
  const levelMatch = LEVEL_RE.exec(stmt)
  if (!levelMatch) return undefined

  const level = Number(levelMatch[1])
  const name = levelMatch[2]!

  const picMatch = PIC_RE.exec(stmt)
  const picture = picMatch?.[1] ?? picMatch?.[2]

  const usageMatch = USAGE_RE.exec(stmt)
  const usage = usageMatch ? 'COMP-3' : undefined

  return { level, name, picture, usage }
}

function buildTree(rawFields: RawField[]): SchemaField[] {
  const roots: SchemaField[] = []
  const stack: SchemaField[] = []

  let currentOffset = 0

  for (const raw of rawFields) {
    if (raw.level === 1 || raw.level === 77) {
      currentOffset = 0
    }

    const pic = raw.picture ? parsePic(raw.picture, raw.usage) : undefined

    const field: SchemaField = {
      level: raw.level,
      name: raw.name,
      type: pic ? pic.type : 'group',
      ...(raw.picture ? { picture: raw.picture.toUpperCase().replace(/\s+/g, '') } : {}),
      ...(raw.usage ? { usage: raw.usage } : {}),
      lengthInBytes: pic ? pic.lengthInBytes : 0,
      offset: currentOffset,
      children: [],
    }

    while (stack.length > 0 && stack[stack.length - 1]!.level >= raw.level) {
      stack.pop()
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : undefined

    if (parent) {
      parent.children.push(field)
    } else {
      roots.push(field)
    }

    stack.push(field)

    if (pic) {
      currentOffset += pic.lengthInBytes
    }
  }

  propagateGroupSizes(roots)

  return roots
}

function propagateGroupSizes(fields: SchemaField[]): number {
  let total = 0
  for (const field of fields) {
    if (field.children.length > 0) {
      field.lengthInBytes = propagateGroupSizes(field.children)
    }
    total += field.lengthInBytes
  }
  return total
}

/**
 * Parsea un copybook COBOL trivial y extrae su esquema de campos.
 * Alcance de T1: niveles jerárquicos, PIC X/9 básicos y COMP-3.
 * No espera divisiones ni secciones — un copybook es solo la definición
 * del registro (eso es lo que se resuelve vía COPY en un programa real).
 */
export function parse(source: string): ParseResult {
  const statements = joinContinuations(source.split(/\r?\n/))
  const rawFields: RawField[] = []

  for (const stmt of statements) {
    const field = parseField(stmt)
    if (field) rawFields.push(field)
  }

  return { records: buildTree(rawFields) }
}
