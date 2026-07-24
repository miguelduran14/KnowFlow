import type { FlowResult, ParseResult, SchemaField } from '../types.js'

/**
 * Nivel de fidelidad de un conjunto de hechos (ADR-0003). Nivel 3 (solo
 * LLM) no aplica aquí: estos hechos siempre vienen del parser.
 */
export interface FactsFidelity {
  level: 'verified' | 'partial'
  /** Motivos concretos por los que la fidelidad baja a 'partial' */
  reasons: string[]
}

/**
 * Calcula la etiqueta de fidelidad de unos hechos. Es el motor quien la
 * decide —no la GUI— para que todas las superficies etiqueten igual.
 */
export function factsFidelity(
  data: ParseResult | undefined,
  flow: FlowResult | undefined,
): FactsFidelity {
  const reasons: string[] = []
  if (flow?.fragment) reasons.push('fragmento sin PROCEDURE DIVISION')
  if (data && data.missingCopybooks.length > 0) {
    reasons.push(`copybooks ausentes: ${data.missingCopybooks.join(', ')}`)
  }
  if (flow && flow.missingTargets.length > 0) {
    reasons.push(`destinos no encontrados: ${flow.missingTargets.join(', ')}`)
  }
  if (flow?.edges.some(e => e.dynamic)) reasons.push('hay CALL dinámicas sin destino verificable')
  return { level: reasons.length > 0 ? 'partial' : 'verified', reasons }
}

function renderField(field: SchemaField, depth: number, out: string[]): void {
  const indent = '  '.repeat(depth)

  if (field.type === 'unresolved-copy') {
    out.push(`${indent}[HUECO] COPY ${field.unresolvedCopyMember} no disponible — estructura desconocida`)
    return
  }

  const parts = [`${indent}${String(field.level).padStart(2, '0')} ${field.name}`]
  if (field.picture) parts.push(`PIC ${field.picture}`)
  if (field.usage) parts.push(`USAGE ${field.usage}`)
  if (field.occurs !== undefined) parts.push(`OCCURS ${field.occurs}`)
  if (field.occursDepending) {
    parts.push(
      `OCCURS ${field.occursDepending.min}..${field.occursDepending.max ?? '?'} DEPENDING ON ${field.occursDepending.dependingOn} (longitud variable)`,
    )
  }
  if (field.redefines) parts.push(`REDEFINES ${field.redefines} (misma memoria)`)
  parts.push(`${field.lengthInBytes} bytes`)
  parts.push(field.offsetUnknown ? 'offset NO verificable (hueco previo)' : `offset ${field.offset}`)
  out.push(parts.join(' | '))

  for (const cond of field.conditionValues ?? []) {
    out.push(`${indent}  88 ${cond.name} = ${cond.values.join(', ')}`)
  }
  for (const child of field.children) {
    renderField(child, depth + 1, out)
  }
}

/**
 * Convierte los hechos verificados por el parser (datos y/o flujo) en un
 * documento de texto determinista — lo ÚNICO que la capa LLM recibe como
 * descripción del programa. El modelo nunca ve código fuente crudo del
 * que pueda "deducir" estructura sin verificar: si un hecho no está
 * aquí, no existe para la explicación.
 */
export function renderFacts(data: ParseResult | undefined, flow: FlowResult | undefined): string {
  const out: string[] = []

  // Un flujo aporta hechos solo si tiene aristas o algún párrafo REAL del
  // fuente: el nodo de entrada implícito es andamiaje del parser, no un
  // hecho del programa. Emitir una sección de flujo vacía invitaría al
  // modelo a rellenarla — mejor que explainProgram falle sin hechos.
  const flowHasFacts =
    flow !== undefined && (flow.edges.length > 0 || flow.paragraphs.some(p => !p.implicit))

  if (flow && flowHasFacts) {
    out.push('## FLUJO (verificado por parser)')
    if (flow.programId) out.push(`PROGRAM-ID: ${flow.programId}`)
    out.push('Párrafos/secciones en orden de fuente:')
    for (const para of flow.paragraphs) {
      const marks = [
        para.kind === 'section' ? 'SECTION' : '',
        para.section ? `(en ${para.section})` : '',
        para.terminates ? '[termina el programa]' : '',
        para.implicit ? '[entrada implícita — sentencias antes del primer párrafo]' : '',
      ].filter(Boolean)
      out.push(`- ${para.name}${marks.length > 0 ? ' ' + marks.join(' ') : ''}`)
    }
    if (flow.edges.length > 0) {
      out.push('Aristas de flujo (una por sentencia, con línea del fuente):')
      for (const edge of flow.edges) {
        const extra = [
          edge.thru ? `THRU ${edge.thru}` : '',
          edge.times !== undefined ? `${edge.times} TIMES` : '',
          edge.condition ?? '',
          edge.dynamic ? '[dinámica: destino real solo se conoce en ejecución]' : '',
        ].filter(Boolean)
        out.push(
          `- L${edge.line}: ${edge.from} -> ${edge.to} (${edge.kind.toUpperCase()}${extra.length > 0 ? ' ' + extra.join(' ') : ''})`,
        )
      }
    }
  }

  const dataHasFacts = data !== undefined && data.records.length > 0

  if (data && dataHasFacts) {
    out.push('')
    out.push('## DATOS (verificado por parser)')
    for (const record of data.records) {
      renderField(record, 0, out)
    }
  }

  // Sin ningún hecho no hay nada que acotar: devolver solo la sección de
  // límites daría un documento que parece analizable pero está vacío.
  if (!flowHasFacts && !dataHasFacts) return ''

  const gaps: string[] = []
  if (flow?.fragment) {
    gaps.push('El fuente es un FRAGMENTO sin PROCEDURE DIVISION: fidelidad parcialmente verificada.')
  }
  for (const member of data?.missingCopybooks ?? []) {
    gaps.push(`Copybook ${member} NO disponible: su estructura es desconocida.`)
  }
  for (const target of flow?.missingTargets ?? []) {
    gaps.push(`El destino ${target} no existe en el fuente aportado.`)
  }
  for (const edge of flow?.edges ?? []) {
    if (edge.dynamic) {
      gaps.push(`CALL dinámica en L${edge.line}: el programa destino (${edge.to}) es una variable.`)
    }
  }
  if (gaps.length > 0) {
    out.push('')
    out.push('## LÍMITES DE LO VERIFICADO')
    for (const gap of gaps) out.push(`- ${gap}`)
  }

  return out.join('\n')
}
