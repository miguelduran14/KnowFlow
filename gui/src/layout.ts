import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { FlowEdge, FlowResult, LinkedFlow } from '@miguelduran14/knowflow'

/**
 * Etiqueta de arista para el LIENZO — distinta del `flowEdgeLabel` del motor
 * (que va al export Mermaid, donde no hay hover). En el lienzo el color ya
 * dice el tipo (ver la leyenda), así que la etiqueta se reserva para lo que
 * el color NO dice: la guarda IF/EVALUATE (la joya del parser), la condición
 * de bucle (UNTIL/VARYING/DEPENDING), el nº de veces, el THRU y el marcador
 * dinámico. Un PERFORM/GO TO/CALL/caída trivial se queda SIN etiqueta —
 * menos ruido, más legible en un grafo grande.
 */
function canvasEdgeLabel(edge: FlowEdge): string {
  const parts: string[] = []
  if (edge.guards && edge.guards.length > 0) parts.push(edge.guards.join(' Y '))
  if (edge.condition) parts.push(edge.condition)
  if (edge.thru) parts.push(`THRU ${edge.thru}`)
  if (edge.times !== undefined) parts.push(`${edge.times}×`)
  if (edge.kind === 'sort-input') parts.push('SORT ENTRADA')
  if (edge.kind === 'sort-output') parts.push('SORT SALIDA')
  if (edge.dynamic) parts.push('dinámica')
  return parts.join(' · ')
}

/**
 * Ancho máximo (px) reservado para una etiqueta de arista en el layout —
 * coincide con el `max-width` CSS de `.edge-label` en el lienzo (ver
 * FlowCanvas.tsx). Una guarda larga se trunca visualmente con "…"; el
 * layout no necesita reservar más hueco del que el label va a ocupar en
 * pantalla — si no, una condición compuesta gigante estiraría el diagrama
 * entero por una sola arista.
 */
export const MAX_EDGE_LABEL_WIDTH = 220

/**
 * Estima el ancho en px de una etiqueta de arista (fuente mono 11px + el
 * padding de la pastilla), para que elk le reserve hueco REAL en el layout.
 * Es la causa raíz de las etiquetas tapadas: hoy elk no sabe que las
 * etiquetas existen, así que no les deja sitio — el texto cae encima de lo
 * que ya estuviera ahí (un nodo, otra arista).
 */
function estimateLabelWidth(text: string): number {
  if (text === '') return 0
  const CHAR_PX = 6.4
  const PADDING = 16
  return Math.min(text.length * CHAR_PX + PADDING, MAX_EDGE_LABEL_WIDTH)
}

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
  /** El nodo es una sección plegada: representa a sus párrafos miembros */
  collapsed?: boolean | undefined
  /** Cuántos párrafos miembros absorbe una sección plegada */
  memberCount?: number | undefined
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
  /**
   * Puntos del trazado que calculó elk (inicio · codos · fin), en coordenadas
   * del grafo. El lienzo (React Flow) re-rutea con su propio smoothstep, pero
   * el export SVG los usa para dibujar una arista fiel al layout sin depender
   * de React Flow. Ausentes si elk no devolvió sección para la arista.
   */
  points?: { x: number; y: number }[] | undefined
}

export interface CanvasGraph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** Mismo criterio que el motor usa para Mermaid: COBOL es case-insensitive.
 *  Expuesto (`nodeIdFor`) para que otros componentes puedan pedir el id de
 *  un nodo por su nombre COBOL — p. ej. para resaltarlo desde fuera. */
function nodeId(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}
export const nodeIdFor = nodeId

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
 * Nombres de las secciones (kind==='section') presentes en un flujo. La GUI
 * las ofrece como plegables.
 */
export function sectionNames(flow: FlowResult): string[] {
  return flow.paragraphs.filter(p => p.kind === 'section').map(p => p.name)
}

/**
 * Proyecta un FlowResult del motor a un grafo posicionado con elkjs
 * (algoritmo layered, de arriba abajo). Igual que el export Mermaid, es
 * una proyección 1:1 de los hechos verificados: ni añade ni omite nodos
 * o aristas.
 *
 * `collapsedSections` es estado de vista, no un hecho: cada sección en el
 * conjunto absorbe a sus párrafos miembros en un solo nodo, y las aristas
 * que cruzaban a/desde ellos se redirigen a ese nodo (las internas se
 * descartan). No cambia los hechos —solo cómo se dibujan— para que un
 * programa de 200 párrafos se pueda leer por bloques.
 */
export async function layoutFlow(
  flow: FlowResult,
  collapsedSections?: ReadonlySet<string>,
): Promise<CanvasGraph> {
  const collapsed = collapsedSections ?? new Set<string>()
  const missing = new Set(flow.missingTargets.map(t => nodeId(t)))

  // Nombre de párrafo → sección que lo absorbe (si su sección está plegada,
  // o si es la cabecera de una sección plegada). El resto no se remapea.
  const absorbedBy = new Map<string, string>()
  const memberCount = new Map<string, number>()
  for (const para of flow.paragraphs) {
    if (para.kind === 'section') {
      if (collapsed.has(para.name)) absorbedBy.set(para.name, para.name)
    } else if (para.section) {
      memberCount.set(para.section, (memberCount.get(para.section) ?? 0) + 1)
      if (collapsed.has(para.section)) absorbedBy.set(para.name, para.section)
    }
  }
  // Un nombre se dibuja como su sección plegada, o como sí mismo.
  const displayName = (name: string): string => absorbedBy.get(name) ?? name

  const nodes = new Map<string, Omit<CanvasNode, 'x' | 'y'>>()

  for (const para of flow.paragraphs) {
    // Un párrafo miembro de una sección plegada no se dibuja: lo representa
    // el nodo de la sección.
    if (para.kind !== 'section' && para.section && collapsed.has(para.section)) continue

    const id = nodeId(para.name)
    const isCollapsedSection = para.kind === 'section' && collapsed.has(para.name)
    const count = memberCount.get(para.name) ?? 0
    const label = para.implicit
      ? `${para.name} (entrada implícita)`
      : isCollapsedSection
        ? `${para.name} · ${count} ${count === 1 ? 'párrafo' : 'párrafos'}`
        : para.name
    nodes.set(id, {
      id,
      label,
      variant: para.implicit ? 'implicit' : para.kind === 'section' ? 'section' : 'paragraph',
      terminates: para.terminates === true,
      width: Math.max(150, label.length * 8.5 + 48),
      height: para.terminates ? 56 : 44,
      ...(para.section ? { section: para.section } : {}),
      ...(isCollapsedSection ? { collapsed: true, memberCount: count } : {}),
    })
  }

  for (const edge of flow.edges) {
    const id = nodeId(displayName(edge.to))
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

  // Aristas remapeadas a los nodos visibles. Se descartan las que quedan
  // dentro de una misma sección plegada (source===target), y se deduplican
  // las que colapsan a la misma pareja (source,target,kind).
  const seen = new Set<string>()
  const edges: CanvasEdge[] = []
  flow.edges.forEach((edge, i) => {
    const source = nodeId(displayName(edge.from))
    const target = nodeId(displayName(edge.to))
    if (source === target) return
    const dedupeKey = `${source}|${target}|${edge.kind}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    edges.push({
      id: `e${i}`,
      source,
      target,
      label: canvasEdgeLabel(edge),
      kind: edge.kind,
      dynamic: edge.dynamic === true,
      toMissing: missing.has(nodeId(edge.to)),
      guarded: edge.guards !== undefined && edge.guards.length > 0,
    })
  })

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.edgeNode': '34',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '26',
      // Espacio propio para la etiqueta (no pegada a nodos/otras aristas).
      'elk.spacing.edgeLabel': '10',
      // 'false': la etiqueta cuenta como espacio real que hay que reservar
      // en el layout (como un nodo más), no un adorno que se superpone sin
      // más al trazo. Esta es la causa raíz del texto tapado: sin esto, elk
      // no sabe que las etiquetas existen y no les deja hueco.
      'elk.layered.edgeLabels.inline': 'false',
    },
    children: [...nodes.values()].map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
      // Sin esto, elk no reserva sitio para el texto (ver la nota de arriba).
      ...(e.label !== '' ? { labels: [{ text: e.label, width: estimateLabelWidth(e.label), height: 20 }] } : {}),
    })),
  }

  const laidOut = await elk.layout(graph)

  const positioned: CanvasNode[] = (laidOut.children ?? []).map(child => {
    const meta = nodes.get(child.id)!
    return { ...meta, x: child.x ?? 0, y: child.y ?? 0 }
  })

  // Trazado de cada arista según elk: inicio → codos → fin. Se adjunta por id
  // para que el export SVG lo dibuje sin re-rutear.
  const routing = new Map<string, { x: number; y: number }[]>()
  for (const e of laidOut.edges ?? []) {
    const section = e.sections?.[0]
    if (!section) continue
    routing.set(e.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint])
  }
  const routed = edges.map(e => {
    const points = routing.get(e.id)
    return points ? { ...e, points } : e
  })

  return { nodes: positioned, edges: routed }
}
