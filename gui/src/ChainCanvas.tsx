import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { LinkedFlow } from '@miguelduran14/knowflow'
import { useEffect, useMemo, useState } from 'react'
import { layoutChain, type ChainEdge, type ChainNode } from './layout.js'
import { useThemeTokens } from './theme.js'

type ProgramNode = Node<{ chain: ChainNode }, 'program'>

function ProgramNodeView({ data }: NodeProps<ProgramNode>) {
  const { chain } = data
  return (
    <div className={`prog prog--${chain.variant}`} style={{ width: chain.width, minHeight: chain.height }}>
      <Handle type="target" position={Position.Left} className="handle" />
      <span className="prog__name">{chain.name}</span>
      {chain.variant === 'missing' && <span className="prog__note">fuente no aportado</span>}
      {chain.variant === 'dynamic' && <span className="prog__note">destino dinámico</span>}
      {chain.variant === 'supplied' && chain.paragraphCount !== undefined && (
        <span className="prog__note">{chain.paragraphCount} párrafos</span>
      )}
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  )
}

const nodeTypes = { program: ProgramNodeView }

/** Leyenda del código de color de las aristas de la cadena. */
function ChainLegend({ colors }: { colors: { resolved: string; missing: string; dynamic: string } }) {
  const line = (color: string, label: string, dashed?: boolean) => (
    <span className="leg-row">
      <span
        className="leg-line"
        style={
          dashed
            ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` }
            : { background: color }
        }
      />
      {label}
    </span>
  )
  return (
    <div className="chain-legend">
      {line(colors.resolved, 'CALL resuelta (programa aportado)')}
      {line(colors.missing, 'fuente no aportado')}
      {line(colors.dynamic, 'CALL dinámica (destino en ejecución)', true)}
    </div>
  )
}

function ChainCanvasInner({ linked }: { linked: LinkedFlow }) {
  const [nodes, setNodes] = useState<ProgramNode[]>([])
  // Aristas del motor (con `resolved`/`dynamic`): el color se aplica aparte,
  // en un memo con los tokens del tema, para no re-hacer el layout al cambiar
  // de tema.
  const [rawEdges, setRawEdges] = useState<ChainEdge[]>([])
  const updateNodeInternals = useUpdateNodeInternals()

  // Tokens del tema: el trazo y las etiquetas de React Flow van como estilo
  // inline, así que no heredan las variables CSS por cascada. Sin esto, la
  // cadena se veía con colores de tema oscuro sobre el papel claro.
  const tk = useThemeTokens(v => ({
    resolved: v('--ok') || '#6fcf97',
    missing: v('--missing') || '#f0708a',
    dynamic: v('--violet') || '#8b7bf0',
    labelText: v('--text') || '#e6ebf2',
    labelBg: v('--bg-panel') || '#12161d',
    border: v('--border') || '#262e3a',
  }))

  useEffect(() => {
    let cancelled = false
    layoutChain(linked).then(graph => {
      if (cancelled) return
      setNodes(
        graph.nodes.map(n => ({
          id: n.id,
          type: 'program' as const,
          position: { x: n.x, y: n.y },
          // Dimensiones explícitas: ya las calculó elk, así React Flow no
          // tiene que medir el DOM para decidir dónde anclar las aristas.
          width: n.width,
          height: n.height,
          data: { chain: n },
        })),
      )
      setRawEdges(graph.edges)
    })
    return () => {
      cancelled = true
    }
  }, [linked])

  // Fuerza a React Flow a medir los handles tras cada layout. Sin esto, al
  // remontar el lienzo (cambiar de vista y volver) las aristas no se
  // redibujaban aunque los nodos sí — mismo patrón que FlowCanvas.
  useEffect(() => {
    if (nodes.length === 0) return
    const id = requestAnimationFrame(() => updateNodeInternals(nodes.map(n => n.id)))
    return () => cancelAnimationFrame(id)
  }, [nodes, updateNodeInternals])

  // Aristas de React Flow con el color del tema activo. Verde = CALL a un
  // programa aportado; rosa = literal cuyo fuente falta; violeta punteado =
  // CALL dinámica (destino solo conocido en ejecución).
  const edges: Edge[] = useMemo(
    () =>
      rawEdges.map(e => {
        const color = e.dynamic ? tk.dynamic : e.resolved ? tk.resolved : tk.missing
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          type: 'smoothstep',
          style: {
            stroke: color,
            strokeWidth: 1.8,
            ...(e.dynamic ? { strokeDasharray: '3 3' } : {}),
          },
          labelStyle: { fill: tk.labelText, fontSize: 11 },
          labelBgStyle: { fill: tk.labelBg, fillOpacity: 0.92, stroke: tk.border },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: { type: MarkerType.ArrowClosed, color },
        }
      }),
    [rawEdges, tk],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.2}
      nodesConnectable={false}
      edgesFocusable={false}
    >
      <Panel position="top-left">
        <ChainLegend colors={{ resolved: tk.resolved, missing: tk.missing, dynamic: tk.dynamic }} />
      </Panel>
      <Background gap={24} size={1.5} color={tk.border} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

/**
 * Grafo de llamadas ENTRE programas (izquierda→derecha). Envuelto en
 * ReactFlowProvider para poder pedir `useUpdateNodeInternals` (el workaround
 * de medición de handles que hace que las aristas se dibujen y sobrevivan a
 * un remontaje), igual que FlowCanvas.
 */
export function ChainCanvas({ linked }: { linked: LinkedFlow }) {
  return (
    <ReactFlowProvider>
      <ChainCanvasInner linked={linked} />
    </ReactFlowProvider>
  )
}
