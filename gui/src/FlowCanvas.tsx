import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FlowResult } from 'knowflow'
import { useEffect, useState } from 'react'
import { layoutFlow, nodeIdFor, type CanvasNode } from './layout.js'

/**
 * React Flow recibe colores como strings inline (no CSS), así que no
 * heredan las variables del tema por cascada. Este hook resuelve los
 * tokens que el lienzo necesita y se re-ejecuta cuando cambia el tema
 * (toggle → atributo data-theme, o cambio de preferencia del SO), para
 * que el fondo y las etiquetas dejen de desentonar en claro.
 */
function useThemeTokens() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string) => cs.getPropertyValue(name).trim()
    return {
      dots: v('--border'),
      labelBg: v('--bg-raised'),
      labelText: v('--text'),
      dim: v('--text-dim'),
      missing: v('--missing'),
      guard: v('--violet'),
    }
  }
  const [tokens, setTokens] = useState(read)
  useEffect(() => {
    const refresh = () => setTokens(read())
    const obs = new MutationObserver(refresh)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', refresh)
    return () => {
      obs.disconnect()
      mq.removeEventListener('change', refresh)
    }
  }, [])
  return tokens
}

type CobolNodeData = { canvas: CanvasNode; focused?: boolean }
type CobolNode = Node<CobolNodeData, 'cobol'>

function CobolNodeView({ data }: NodeProps<CobolNode>) {
  const { canvas, focused } = data
  const cls = `node node--${canvas.variant}${focused ? ' node--focus' : ''}`
  return (
    <div className={cls} style={{ width: canvas.width, minHeight: canvas.height }}>
      <Handle type="target" position={Position.Top} className="handle" />
      <span className="node__label">{canvas.label}</span>
      {canvas.terminates && <span className="node__badge">fin de programa</span>}
      {canvas.section && <span className="node__section">{canvas.section}</span>}
      <Handle type="source" position={Position.Bottom} className="handle" />
    </div>
  )
}

const nodeTypes = { cobol: CobolNodeView }

const EDGE_COLOR: Record<string, string> = {
  perform: '#7aa2f7',
  goto: '#e0af68',
  call: '#9ece6a',
  'sort-input': '#7dcfff',
  'sort-output': '#7dcfff',
  // Gris apagado: la caída natural es la que menos ruido debe meter, es el
  // fondo sobre el que destacan las transferencias explícitas.
  'fall-through': '#565f89',
}

export function FlowCanvas({
  flow,
  focusParagraph,
  onFocused,
}: {
  flow: FlowResult
  focusParagraph?: string | undefined
  onFocused?: (() => void) | undefined
}) {
  const [nodes, setNodes] = useState<CobolNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const focusId = focusParagraph ? nodeIdFor(focusParagraph) : undefined
  const tk = useThemeTokens()

  useEffect(() => {
    let cancelled = false
    layoutFlow(flow).then(graph => {
      if (cancelled) return
      setNodes(
        graph.nodes.map(n => ({
          id: n.id,
          type: 'cobol' as const,
          position: { x: n.x, y: n.y },
          // Dimensiones explícitas: ya las calculó elk, así React Flow no
          // tiene que medir el DOM para decidir dónde anclar las aristas.
          width: n.width,
          height: n.height,
          data: { canvas: n, focused: focusId === n.id },
        })),
      )
      setEdges(
        graph.edges.map(e => {
          // Las aristas condicionales se pintan en el color de la rama y
          // más finas: de un vistazo se distingue el camino que siempre se
          // recorre del que depende de un IF/EVALUATE. Las etiquetas sí
          // usan tokens del tema (fondo/texto), que es lo que desentonaba
          // en claro; los hues semánticos de las líneas se mantienen.
          const isFall = e.kind === 'fall-through'
          const color = isFall
            ? EDGE_COLOR['fall-through']!
            : e.toMissing
              ? tk.missing
              : e.guarded
                ? tk.guard
                : EDGE_COLOR[e.kind] ?? '#7aa2f7'
          const dash = e.kind === 'call' ? (e.dynamic ? '3 3' : '7 4') : isFall ? '2 4' : undefined
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            type: 'smoothstep',
            style: {
              stroke: color,
              strokeWidth: e.guarded || isFall ? 1.2 : 1.6,
              ...(dash ? { strokeDasharray: dash } : {}),
            },
            labelStyle: { fill: isFall ? tk.dim : e.guarded ? tk.guard : tk.labelText, fontSize: 11 },
            labelBgStyle: { fill: tk.labelBg, fillOpacity: 0.92 },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 4,
            markerEnd: { type: MarkerType.ArrowClosed, color },
          }
        }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [flow, focusId, tk])

  // El foco se "consume" tras un momento: así el destaque queda un instante
  // (el usuario ve dónde aterriza), y luego el estado se limpia — un segundo
  // clic en la misma etapa vuelve a disparar el foco.
  useEffect(() => {
    if (!focusParagraph || !onFocused) return
    const t = window.setTimeout(() => onFocused(), 1600)
    return () => window.clearTimeout(t)
  }, [focusParagraph, onFocused])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.2}
      nodesDraggable
      nodesConnectable={false}
      edgesFocusable={false}
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={24} size={1.5} color={tk.dots} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable className="minimap" />
    </ReactFlow>
  )
}
