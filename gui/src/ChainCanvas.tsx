import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { LinkedFlow } from 'knowflow'
import { useEffect, useState } from 'react'
import { layoutChain, type ChainNode } from './layout.js'

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

export function ChainCanvas({ linked }: { linked: LinkedFlow }) {
  const [nodes, setNodes] = useState<ProgramNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

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
      setEdges(
        graph.edges.map(e => {
          const color = e.dynamic ? '#bb9af7' : e.resolved ? '#9ece6a' : '#f7768e'
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
            labelStyle: { fill: '#c0caf5', fontSize: 11 },
            labelBgStyle: { fill: '#1f2335', fillOpacity: 0.9 },
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
  }, [linked])

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
      <Background gap={24} size={1.5} color="#2a2f45" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
