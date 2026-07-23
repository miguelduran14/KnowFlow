import { joinContinuations } from './lines.js'

export type ResolvedStatement =
  | { kind: 'text'; statement: string }
  | { kind: 'unresolved-copy'; member: string }

export interface CopyResolutionResult {
  statements: ResolvedStatement[]
  /** Members de COPY/EXEC SQL INCLUDE no encontrados en el conjunto aportado */
  missingCopybooks: string[]
}

const COPY_RE = /^COPY\s+([\w-]+)(?:\s+REPLACING\s+(.+?))?\s*\.\s*$/i
const EXEC_SQL_INCLUDE_RE = /^EXEC\s+SQL\s+INCLUDE\s+([\w-]+)\s+END-EXEC\s*\.?\s*$/i

interface Replacement {
  from: string
  to: string
}

/** Extrae pares FROM/BY de una cláusula REPLACING — con o sin pseudo-texto ==...== */
function parseReplacingClause(clause: string): Replacement[] {
  const pairs: Replacement[] = []
  const re = /(?:==(.*?)==|(\S+))\s+BY\s+(?:==(.*?)==|(\S+))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(clause))) {
    const from = (m[1] ?? m[2] ?? '').trim()
    const to = (m[3] ?? m[4] ?? '').trim()
    if (from) pairs.push({ from, to })
  }
  return pairs
}

function applyReplacing(text: string, replacements: Replacement[]): string {
  let result = text
  for (const { from, to } of replacements) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // El límite de palabra de COBOL no es \b: un identificador con guiones
    // ("ITEM-CODE") es UNA sola palabra léxica, distinta de "ITEM". \b trata
    // el guion como frontera, así que confundiría ambas — el límite real
    // exige que ni antes ni después del token haya letra, dígito o guion.
    result = result.replace(new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, 'gi'), to)
  }
  return result
}

/**
 * Resuelve COPY y EXEC SQL INCLUDE contra el conjunto de copybooks
 * aportado, recursivamente (un member puede a su vez tener COPY).
 *
 * Un member no encontrado se marca como `{ kind: 'unresolved-copy' }` en
 * el flujo de sentencias — nunca se inventa contenido para él (ADR-0003).
 * Un COPY circular (member A copia a B que copia a A) se trata igual que
 * un member ausente, para no expandir indefinidamente.
 */
export function resolveCopies(
  statements: string[],
  copybooks: Map<string, string>,
  missing: string[] = [],
  seen: ReadonlySet<string> = new Set(),
): CopyResolutionResult {
  const resolved: ResolvedStatement[] = []

  for (const stmt of statements) {
    const copyMatch = COPY_RE.exec(stmt)
    const execMatch = !copyMatch ? EXEC_SQL_INCLUDE_RE.exec(stmt) : null
    const match = copyMatch ?? execMatch

    if (!match) {
      resolved.push({ kind: 'text', statement: stmt })
      continue
    }

    const memberName = match[1]!
    const replacingClause = copyMatch?.[2]
    const memberSource = seen.has(memberName) ? undefined : copybooks.get(memberName)

    if (memberSource === undefined) {
      if (!missing.includes(memberName)) missing.push(memberName)
      resolved.push({ kind: 'unresolved-copy', member: memberName })
      continue
    }

    const replacements = replacingClause ? parseReplacingClause(replacingClause) : []
    const expandedText = replacements.length > 0 ? applyReplacing(memberSource, replacements) : memberSource
    const memberStatements = joinContinuations(expandedText.split(/\r?\n/))

    const nestedSeen = new Set(seen)
    nestedSeen.add(memberName)
    const nested = resolveCopies(memberStatements, copybooks, missing, nestedSeen)
    resolved.push(...nested.statements)
  }

  return { statements: resolved, missingCopybooks: missing }
}
