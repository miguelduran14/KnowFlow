import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { FlowEdge, FlowResult, LinkedFlow } from 'knowflow'

export type NodeVariant = 'paragraph' | 'section' | 'implicit' | 'call' | 'missing'

export interface CanvasNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  label: string
  variant: NodeVariant
  terminates: boolean
  /** Sección a la que pertenece el párrafo, si aplica */
  section?: string | undefined
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  label: string
  kind: FlowEdge['kind']
  dynamic: boolean
  toMissing: boolean
  /** La arista está dentro de una rama IF/EVALUATE: no siempre se recorre */
  guarded: boolean
}

export interface CanvasGraph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** Mismo criterio que el motor usa para Mermaid: COBOL es case-insensitive */
function nodeId(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '_')
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
  // Mismo formato que el export Mermaid del motor: la guarda IF/EVALUATE
  // delante entre corchetes, porque es lo primero que hay que saber.
  return edge.guards ? `[${edge.guards.join(' AND ')}] ${base()}` : base()
}

const elk = new ELK()

export type ChainVariant = 'supplied' | 'missing' | 'dynamic'

export interface ChainNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  name: string
  variant: ChainVariant
  paragraphCount?: number | undefined
}

export interface ChainEdge {
  id: string
  source: string
  target: string
  label: string
  resolved: boolean
  dynamic: boolean
}

export interface ChainGraph {
  nodes: ChainNode[]
  edges: ChainEdge[]
}

/**
 * Posiciona el grafo de llamadas entre programas (izquierda a derecha:
 * un flujo de llamadas se lee mejor como cadena que como árbol). Proyección
 * 1:1 del LinkedFlow — los programas no aportados y los destinos dinámicos
 * aparecen como nodos propios, marcados.
 */
export async function layoutChain(linked: LinkedFlow): Promise<ChainGraph> {
  const nodes = new Map<string, Omit<ChainNode, 'x' | 'y'>>()

  for (const program of linked.programs) {
    const id = nodeId(program.name)
    nodes.set(id, {
      id,
      name: program.name,
      variant: 'supplied',
      paragraphCount: program.flow.paragraphs.length,
      width: Math.max(170, program.name.length * 9 + 60),
      height: 58,
    })
  }

  for (const call of linked.calls) {
    const id = nodeId(call.toProgram)
    if (nodes.has(id)) continue
    nodes.set(id, {
      id,
      name: call.toProgram,
      variant: call.dynamic ? 'dynamic' : 'missing',
      width: Math.max(170, call.toProgram.length * 9 + 60),
      height: 58,
    })
  }

  const edges: ChainEdge[] = linked.calls.map((call, i) => ({
    id: `c${i}`,
    source: nodeId(call.fromProgram),
    target: nodeId(call.toProgram),
    label: call.dynamic ? `CALL dinámica · ${call.fromParagraph}` : `CALL · ${call.fromParagraph}`,
    resolved: call.resolved,
    dynamic: call.dynamic,
  }))

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
    },
    children: [...nodes.values()].map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  const laidOut = await elk.layout(graph)

  return {
    nodes: (laidOut.children ?? []).map(child => {
      const meta = nodes.get(child.id)!
      return { ...meta, x: child.x ?? 0, y: child.y ?? 0 }
    }),
    edges,
  }
}

/**
 * Proyecta un FlowResult del motor a un grafo posicionado con elkjs
 * (algoritmo layered, de arriba abajo). Igual que el export Mermaid, es
 * una proyección 1:1 de los hechos verificados: ni añade ni omite nodos
 * o aristas.
 */
export async function layoutFlow(flow: FlowResult): Promise<CanvasGraph> {
  const missing = new Set(flow.missingTargets.map(t => nodeId(t)))

  const nodes = new Map<string, Omit<CanvasNode, 'x' | 'y'>>()

  for (const para of flow.paragraphs) {
    const id = nodeId(para.name)
    const label = para.implicit ? `${para.name} (entrada implícita)` : para.name
    nodes.set(id, {
      id,
      label,
      variant: para.implicit ? 'implicit' : para.kind === 'section' ? 'section' : 'paragraph',
      terminates: para.terminates === true,
      width: Math.max(150, label.length * 8.5 + 48),
      height: para.terminates ? 56 : 44,
      ...(para.section ? { section: para.section } : {}),
    })
  }

  for (const edge of flow.edges) {
    const id = nodeId(edge.to)
    if (nodes.has(id)) continue
    const isCall = edge.kind === 'call'
    const label = isCall ? edge.to : `${edge.to} — no encontrado`
    nodes.set(id, {
      id,
      label,
      variant: isCall ? 'call' : 'missing',
      terminates: false,
      width: Math.max(150, label.length * 8.5 + 48),
      height: 44,
    })
  }

  const edges: CanvasEdge[] = flow.edges.map((edge, i) => ({
    id: `e${i}`,
    source: nodeId(edge.from),
    target: nodeId(edge.to),
    label: edgeLabel(edge),
    kind: edge.kind,
    dynamic: edge.dynamic === true,
    toMissing: missing.has(nodeId(edge.to)),
    guarded: edge.guards !== undefined && edge.guards.length > 0,
  }))

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.edgeNode': '30',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
    },
    children: [...nodes.values()].map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  const laidOut = await elk.layout(graph)

  const positioned: CanvasNode[] = (laidOut.children ?? []).map(child => {
    const meta = nodes.get(child.id)!
    return { ...meta, x: child.x ?? 0, y: child.y ?? 0 }
  })

  return { nodes: positioned, edges }
}
