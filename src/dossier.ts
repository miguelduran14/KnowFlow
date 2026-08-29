import type { Advisory, FlowResult, Inventory, ParseResult, SchemaField } from './types.js'
import type { Explanation } from './explain/explain.js'
import { factsFidelity } from './explain/facts.js'
import { flowToMermaid } from './mermaid.js'

/**
 * Todo lo necesario para armar el paquete de onboarding de UN programa.
 * La explicación es opcional: sin clave de IA el dossier sigue siendo útil
 * (flujo, datos, inventario y avisos son todos hechos del parser). Cuando
 * está, su prosa encabeza el documento.
 */
export interface DossierInput {
  data?: ParseResult | undefined
  flow?: FlowResult | undefined
  inventory?: Inventory | undefined
  advisories?: Advisory[] | undefined
  explanation?: Explanation | undefined
  /** Encabezado cuando el fuente no trae PROGRAM-ID (p. ej. el nombre del fichero) */
  sourceName?: string | undefined
}

/** Un nivel de indentación en la tabla, con espacios no rompibles que los
 *  renderizadores de Markdown (GitHub, wikis) sí respetan dentro de celdas. */
function indent(depth: number): string {
  return '  '.repeat(depth)
}

/** Escapa el `|` para que no rompa una celda de tabla Markdown. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/**
 * Vuelca un campo del esquema (y sus hijos/88/66) como filas de una tabla
 * Markdown. Mismas columnas y semántica que la vista Datos de la GUI, para
 * que el export sea la misma verdad en otro formato — revive la "tabla
 * Markdown exportable" (T4) sobre el esquema ya verificado.
 */
function schemaRows(field: SchemaField, depth: number, out: string[]): void {
  if (field.type === 'unresolved-copy') {
    out.push(
      `| ${indent(depth)}COPY ${cell(field.unresolvedCopyMember ?? '')} | — | no disponible | | ? | ? | copybook ausente |`,
    )
    return
  }

  const notes: string[] = []
  if (field.dataSection) notes.push(field.dataSection)
  if (field.value !== undefined) notes.push(`VALUE ${field.value}`)
  if (field.redefines) notes.push(`REDEFINES ${field.redefines}`)
  if (field.occurs !== undefined) notes.push(`OCCURS ${field.occurs}`)
  if (field.occursDepending) {
    notes.push(
      `OCCURS ${field.occursDepending.min}..${field.occursDepending.max ?? '?'} DEPENDING ON ${field.occursDepending.dependingOn}`,
    )
  }
  if (field.synchronized) notes.push('alineado (SYNC)')

  const typeCol =
    field.type === 'group' ? 'grupo' : (field.picture ?? field.type) + (field.type === 'numeric-edited' ? ' (editado)' : '')
  const offset = field.offsetUnknown ? '?' : String(field.offset)

  out.push(
    `| ${indent(depth)}${cell(field.name)} | ${String(field.level).padStart(2, '0')} | ${cell(typeCol)} | ${field.usage ?? ''} | ${field.lengthInBytes} | ${offset} | ${cell(notes.join('; '))} |`,
  )

  for (const cond of field.conditionValues ?? []) {
    out.push(`| ${indent(depth + 1)}88 ${cell(cond.name)} | 88 | | | | | = ${cell(cond.values.join(', '))} |`)
  }
  for (const child of field.children) {
    schemaRows(child, depth + 1, out)
  }
  for (const group of field.renamesGroups ?? []) {
    const range = group.thru ? `${group.from} THRU ${group.thru}` : group.from
    const span = group.offset !== undefined && group.lengthInBytes !== undefined ? String(group.lengthInBytes) : '?'
    const off = group.offset !== undefined ? String(group.offset) : '?'
    out.push(
      `| ${indent(depth + 1)}66 ${cell(group.name)} | 66 | misma memoria | | ${span} | ${off} | RENAMES ${cell(range)} |`,
    )
  }
}

/** Sección de recorrido a partir de la explicación estructurada. */
function walkthroughSection(explanation: Explanation, out: string[]): void {
  if (explanation.summary) {
    out.push('## Resumen')
    out.push('')
    out.push(explanation.summary)
    out.push('')
  }
  if (explanation.walkthrough.length > 0) {
    out.push('## Recorrido')
    out.push('')
    out.push('_Narración generada por IA sobre los hechos del parser; cada etapa enlaza al párrafo que la demuestra._')
    out.push('')
    explanation.walkthrough.forEach((step, i) => {
      const anchor = step.paragraph
        ? ` — \`${step.paragraph}\`${step.line !== undefined ? ` (L${step.line})` : ''}${step.branches ? ' · rama condicional' : ''}`
        : ''
      out.push(`${i + 1}. ${step.text}${anchor}`)
    })
    out.push('')
  }
}

/**
 * Arma el paquete de onboarding de un programa como un solo documento
 * Markdown, pegable en una wiki o un PR: prosa (si hay IA) + diagrama de
 * flujo (Mermaid, que se renderiza solo) + esquema de datos en tabla +
 * inventario + avisos + límites de lo verificado. Todo son hechos del
 * parser salvo la prosa, que va etiquetada como tal.
 */
export function renderDossier(input: DossierInput): string {
  const { data, flow, inventory, advisories, explanation, sourceName } = input
  const out: string[] = []

  const title = flow?.programId ?? sourceName ?? 'programa COBOL'
  out.push(`# Dossier de onboarding — ${title}`)
  out.push('')

  const fidelity = factsFidelity(data, flow, inventory)
  out.push(
    fidelity.level === 'verified'
      ? '> **Fidelidad: verificado por parser.** Los hechos (flujo, datos, inventario) salen del fuente, no de una estimación. La prosa, si la hay, es de una IA sobre esos hechos.'
      : `> **Fidelidad: parcialmente verificado.** ${fidelity.reasons.join('; ')}.`,
  )
  out.push('')
  out.push('_Generado por KnowFlow. Los diagramas Mermaid se renderizan solos en GitHub y la mayoría de wikis._')
  out.push('')

  if (explanation) {
    if (explanation.structured) {
      walkthroughSection(explanation, out)
    } else if (explanation.raw.trim() !== '') {
      out.push('## Resumen')
      out.push('')
      out.push(explanation.raw.trim())
      out.push('')
    }
  }

  const flowHasFacts = flow !== undefined && (flow.edges.length > 0 || flow.paragraphs.some(p => !p.implicit))
  if (flow && flowHasFacts) {
    out.push('## Flujo')
    out.push('')
    out.push('```mermaid')
    out.push(flowToMermaid(flow).trimEnd())
    out.push('```')
    out.push('')
  }

  if (data && data.records.length > 0) {
    out.push('## Datos')
    out.push('')
    out.push('| Campo | Nivel | PIC / tipo | USAGE | Bytes | Offset | Notas |')
    out.push('| --- | ---: | --- | --- | ---: | ---: | --- |')
    const rows: string[] = []
    for (const record of data.records) schemaRows(record, 0, rows)
    out.push(...rows)
    out.push('')
  }

  const inventoryHasFacts =
    inventory !== undefined &&
    (inventory.files.length > 0 || inventory.execs.length > 0 || inventory.unresolvedFileOps.length > 0)
  if (inventory && inventoryHasFacts) {
    out.push('## Qué toca el programa')
    out.push('')
    if (inventory.files.length > 0) {
      out.push('### Ficheros')
      out.push('')
      for (const file of inventory.files) {
        const decl = [
          file.assignTo ? `ASSIGN TO ${file.assignTo}` : '',
          file.organization ?? '',
          file.access ?? '',
        ].filter(Boolean)
        out.push(`- **${file.name}**${decl.length > 0 ? ` — ${decl.join(', ')}` : ''}`)
        for (const op of file.operations) {
          const where = op.paragraphImplicit ? `${op.paragraph} (entrada implícita)` : op.paragraph
          out.push(`  - ${op.verb}${op.mode ? ` ${op.mode}` : ''} en ${where} (L${op.line})`)
        }
        if (file.operations.length === 0) out.push('  - declarado, sin operaciones en el fuente aportado')
      }
      out.push('')
    }
    if (inventory.tables.length > 0) {
      out.push(`**Tablas DB2:** ${inventory.tables.join(', ')}`)
      out.push('')
    }
    if (inventory.cursors.length > 0) {
      out.push('### Cursores')
      out.push('')
      for (const cursor of inventory.cursors) {
        const ops = [
          cursor.declared ? 'DECLARE' : '',
          cursor.opened ? 'OPEN' : '',
          cursor.fetched ? 'FETCH' : '',
          cursor.closed ? 'CLOSE' : '',
        ].filter(Boolean)
        out.push(
          `- **${cursor.name}**: ${ops.join(' → ') || 'nombrado sin operaciones reconocidas'}` +
            (cursor.tables.length > 0 ? ` — sobre ${cursor.tables.join(', ')}` : ''),
        )
      }
      out.push('')
    }
    if (inventory.cicsCommands.length > 0) {
      out.push(`**Comandos CICS:** ${inventory.cicsCommands.map(c => `${c.command}${c.count > 1 ? ` ×${c.count}` : ''}`).join(', ')}`)
      out.push('')
    }
    if (inventory.unresolvedFileOps.length > 0) {
      const targets = [...new Set(inventory.unresolvedFileOps.map(o => `${o.verb} ${o.target}`))]
      out.push(`**E/S sin fichero resuelto** (falta el SELECT o el FD): ${targets.join(', ')}`)
      out.push('')
    }
  }

  if (advisories && advisories.length > 0) {
    out.push('## Avisos — cuidado con esto')
    out.push('')
    out.push('_Trampas de mantenimiento verificadas contra el fuente, no huecos de fidelidad._')
    out.push('')
    for (const advisory of advisories) {
      const at = advisory.line > 0 ? ` (${advisory.paragraph ? `${advisory.paragraph}, ` : ''}L${advisory.line})` : ''
      out.push(`- **${advisory.title}**${at} — ${advisory.message}`)
    }
    out.push('')
  }

  const gaps = collectGaps(data, flow, inventory)
  if (gaps.length > 0) {
    out.push('## Límites de lo verificado')
    out.push('')
    for (const gap of gaps) out.push(`- ${gap}`)
    out.push('')
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Huecos honestos: lo que el parser NO pudo verificar contra el fuente. */
function collectGaps(
  data: ParseResult | undefined,
  flow: FlowResult | undefined,
  inventory: Inventory | undefined,
): string[] {
  const gaps: string[] = []
  if (flow?.fragment) gaps.push('El fuente es un fragmento sin PROCEDURE DIVISION: fidelidad parcial.')
  for (const member of data?.missingCopybooks ?? []) {
    gaps.push(`Copybook \`${member}\` no disponible: su estructura es desconocida.`)
  }
  for (const target of flow?.missingTargets ?? []) {
    gaps.push(`El destino \`${target}\` no existe en el fuente aportado.`)
  }
  for (const nested of flow?.nestedPrograms ?? []) {
    gaps.push(`El programa anidado \`${nested}\` no se ha analizado.`)
  }
  for (const edge of flow?.edges ?? []) {
    if (edge.dynamic) gaps.push(`CALL dinámica en L${edge.line}: el destino (\`${edge.to}\`) es una variable.`)
  }
  for (const op of inventory?.unresolvedFileOps ?? []) {
    gaps.push(`\`${op.verb} ${op.target}\` en L${op.line}: sin SELECT ni FD que lo respalde.`)
  }
  for (const exec of inventory?.execs ?? []) {
    if (exec.dynamic) gaps.push(`EXEC ${exec.kind.toUpperCase()} ${exec.verb} en L${exec.line}: el recurso es una variable.`)
  }
  return gaps
}
