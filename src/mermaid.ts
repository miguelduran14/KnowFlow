import type { FlowEdge, FlowResult, LinkedFlow } from './types.js'

/** Id de nodo Mermaid válido a partir de un nombre COBOL. En mayúsculas:
 *  COBOL es case-insensitive, así que "Main-Para" y "MAIN-PARA." deben
 *  acabar en el mismo nodo. */
function nodeId(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

/** Mermaid rompe con comillas dobles dentro de una etiqueta "..." */
function escapeLabel(text: string): string {
  return text.replace(/"/g, '#quot;')
}

function edgeLabel(edge: FlowEdge): string {
  const base = (): string => {
    if (edge.kind === 'call') return edge.dynamic ? 'CALL dinámica' : 'CALL'
    if (edge.kind === 'goto') return edge.condition ? `GO TO ${edge.condition}` : 'GO TO'
    let label = 'PERFORM'
    if (edge.thru) label += ` THRU ${edge.thru}`
    if (edge.times !== undefined) label += ` ${edge.times} TIMES`
    if (edge.condition) label += ` ${edge.condition}`
    return label
  }
  // Las guardas IF/EVALUATE van delante entre corchetes: lo primero que
  // hay que saber de una arista condicional es cuándo ocurre, no qué verbo
  // la produce. Anidadas se unen con AND, que es lo que significan.
  return edge.guards ? `[${edge.guards.join(' AND ')}] ${base()}` : base()
}

/**
 * Renderiza los hechos de flujo como diagrama Mermaid (flowchart TD).
 * Es una proyección directa del FlowResult: cada nodo y cada arista del
 * diagrama proviene de un hecho verificado por el parser, y las marcas de
 * fidelidad viajan con él — el nodo de entrada implícito se declara como
 * sintético, un fuente en modo fragmento lleva su aviso visible, y un
 * destino que no existe en el fuente se marca como no encontrado.
 * Formas: párrafos como rectángulos, entrada implícita como estadio,
 * secciones como rectángulo doble, programas externos (CALL) como
 * subrutina.
 */
export function flowToMermaid(flow: FlowResult): string {
  const out: string[] = ['flowchart TD']

  if (flow.fragment) {
    out.push('  NOTA_FRAGMENTO["⚠ Fragmento sin PROCEDURE DIVISION — parcialmente verificado"]')
  }

  const declared = new Set<string>()

  for (const para of flow.paragraphs) {
    const id = nodeId(para.name)
    declared.add(id)
    let label = para.name
    if (para.implicit) label += ' (entrada implícita)'
    if (para.terminates) label += ' — fin'
    if (para.implicit) {
      out.push(`  ${id}(["${escapeLabel(label)}"])`)
    } else if (para.kind === 'section') {
      out.push(`  ${id}[["${escapeLabel(label)} SECTION"]]`)
    } else {
      out.push(`  ${id}["${escapeLabel(label)}"]`)
    }
  }

  // Nodos que solo existen como destino: programas externos (CALL) y
  // destinos no encontrados en el fuente (missingTargets).
  for (const edge of flow.edges) {
    const id = nodeId(edge.to)
    if (declared.has(id)) continue
    declared.add(id)
    if (edge.kind === 'call') {
      out.push(`  ${id}[["${escapeLabel(edge.to)}"]]`)
    } else {
      out.push(`  ${id}["${escapeLabel(edge.to)} ⟵ no encontrado"]`)
    }
  }

  for (const edge of flow.edges) {
    out.push(`  ${nodeId(edge.from)} -->|"${escapeLabel(edgeLabel(edge))}"| ${nodeId(edge.to)}`)
  }

  return out.join('\n') + '\n'
}

/**
 * Renderiza la cadena entre programas como diagrama Mermaid: un nodo por
 * programa y una arista por CALL que cruza la frontera. Igual que el resto
 * de salidas, refleja los hechos tal cual: los programas no aportados y
 * los destinos dinámicos se marcan, nunca se resuelven a ciegas.
 */
export function linkedFlowToMermaid(linked: LinkedFlow): string {
  const out: string[] = ['flowchart LR']
  const declared = new Set<string>()

  for (const program of linked.programs) {
    const id = nodeId(program.name)
    declared.add(id)
    out.push(`  ${id}["${escapeLabel(program.name)}"]`)
  }

  for (const call of linked.calls) {
    const id = nodeId(call.toProgram)
    if (declared.has(id)) continue
    declared.add(id)
    const label = call.dynamic
      ? `${call.toProgram} — destino dinámico`
      : `${call.toProgram} — fuente no aportado`
    out.push(`  ${id}["${escapeLabel(label)}"]`)
  }

  for (const call of linked.calls) {
    const label = call.dynamic ? `CALL dinámica (${call.fromParagraph})` : `CALL (${call.fromParagraph})`
    out.push(
      `  ${nodeId(call.fromProgram)} -->|"${escapeLabel(label)}"| ${nodeId(call.toProgram)}`,
    )
  }

  return out.join('\n') + '\n'
}
