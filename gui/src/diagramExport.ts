import type { CanvasGraph, CanvasNode, CanvasEdge } from './layout.js'

/**
 * Colores ya resueltos (no variables CSS: el SVG exportado tiene que verse
 * igual fuera de la app, sin la cascada de tokens del tema). Se leen del
 * `getComputedStyle` en el momento del export para respetar el tema activo.
 */
export interface DiagramPalette {
  bg: string
  nodeFill: string
  nodeStroke: string
  text: string
  textDim: string
  accent: string
  violet: string
  missing: string
  ok: string
  fall: string
  /** Color de trazo por tipo de arista (perform, goto, call…) */
  edge: Record<string, string>
}

const PAD = 28
const MONO = "'Fira Code', ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace"

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Color del trazo de una arista — mismo criterio que el lienzo. */
function edgeColor(e: CanvasEdge, p: DiagramPalette): string {
  if (e.kind === 'fall-through') return p.fall
  if (e.toMissing) return p.missing
  if (e.guarded) return p.violet
  return p.edge[e.kind] ?? p.edge['perform'] ?? p.accent
}

function edgeDash(e: CanvasEdge): string | undefined {
  if (e.kind === 'call') return e.dynamic ? '3 3' : '7 4'
  if (e.kind === 'fall-through') return '2 4'
  return undefined
}

/** Relleno y borde de un nodo según su variante. */
function nodeStyle(n: CanvasNode, p: DiagramPalette): { stroke: string; dash?: string } {
  switch (n.variant) {
    case 'section':
      return { stroke: p.accent }
    case 'implicit':
      return { stroke: p.nodeStroke, dash: '4 4' }
    case 'call':
      return { stroke: p.ok, dash: '6 4' }
    case 'missing':
      return { stroke: p.missing, dash: '4 4' }
    default:
      return { stroke: n.terminates ? p.accent : p.nodeStroke }
  }
}

/** Puntos del trazado, con respaldo recto entre centros si elk no los dio. */
function edgePoints(e: CanvasEdge, byId: Map<string, CanvasNode>): { x: number; y: number }[] {
  if (e.points && e.points.length >= 2) return e.points
  const a = byId.get(e.source)
  const b = byId.get(e.target)
  if (!a || !b) return []
  return [
    { x: a.x + a.width / 2, y: a.y + a.height },
    { x: b.x + b.width / 2, y: b.y },
  ]
}

/** Triángulo de la punta de flecha, orientado según el último segmento. */
function arrowHead(pts: { x: number; y: number }[], color: string): string {
  const end = pts[pts.length - 1]!
  const prev = pts[pts.length - 2] ?? end
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x)
  const size = 7
  const a1 = angle + Math.PI - 0.42
  const a2 = angle + Math.PI + 0.42
  const p1 = { x: end.x + size * Math.cos(a1), y: end.y + size * Math.sin(a1) }
  const p2 = { x: end.x + size * Math.cos(a2), y: end.y + size * Math.sin(a2) }
  return `<path d="M${end.x.toFixed(1)} ${end.y.toFixed(1)} L${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${p2.x.toFixed(1)} ${p2.y.toFixed(1)} Z" fill="${color}" />`
}

/**
 * Proyecta un grafo ya posicionado a un SVG independiente. Es una foto del
 * diagrama tal como lo ordenó elk (mismos colores semánticos, mismas formas),
 * apta para pegar en un dossier o una wiki de traspaso. No depende de React
 * Flow ni de la cascada de temas.
 */
export function graphToSvg(graph: CanvasGraph, palette: DiagramPalette): string {
  if (graph.nodes.length === 0) return ''
  const minX = Math.min(...graph.nodes.map(n => n.x))
  const minY = Math.min(...graph.nodes.map(n => n.y))
  const maxX = Math.max(...graph.nodes.map(n => n.x + n.width))
  const maxY = Math.max(...graph.nodes.map(n => n.y + n.height))
  const width = maxX - minX + PAD * 2
  const height = maxY - minY + PAD * 2
  const byId = new Map(graph.nodes.map(n => [n.id, n]))

  const edgeSvg = graph.edges
    .map(e => {
      const pts = edgePoints(e, byId)
      if (pts.length < 2) return ''
      const color = edgeColor(e, palette)
      const dash = edgeDash(e)
      const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')
      const stroke = e.kind === 'fall-through' ? 1 : e.guarded ? 1.7 : 1.5
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
      const line = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${stroke}"${dashAttr} stroke-linejoin="round" />`
      const head = arrowHead(pts, color)
      // La etiqueta se ancla al punto medio del trazado.
      let label = ''
      if (e.label) {
        const mid = pts[Math.floor(pts.length / 2)]!
        const w = Math.min(e.label.length * 6.4 + 12, 220)
        label =
          `<rect x="${(mid.x - w / 2).toFixed(1)}" y="${(mid.y - 9).toFixed(1)}" width="${w.toFixed(1)}" height="18" rx="5" fill="${palette.bg}" stroke="${palette.nodeStroke}" />` +
          `<text x="${mid.x.toFixed(1)}" y="${(mid.y + 3.5).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${e.guarded ? palette.violet : palette.textDim}">${escapeXml(e.label.length > 34 ? e.label.slice(0, 33) + '…' : e.label)}</text>`
      }
      return line + head + label
    })
    .join('\n')

  const nodeSvg = graph.nodes
    .map(n => {
      const { stroke, dash } = nodeStyle(n, palette)
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
      const cx = n.x + n.width / 2
      const cy = n.y + n.height / 2
      const label = n.label.length > 40 ? n.label.slice(0, 39) + '…' : n.label
      return (
        `<g>` +
        `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="9" fill="${palette.nodeFill}" stroke="${stroke}" stroke-width="1.5"${dashAttr} />` +
        `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${palette.text}">${escapeXml(label)}</text>` +
        `</g>`
      )
    })
    .join('\n')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(minX - PAD).toFixed(1)} ${(minY - PAD).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}">` +
    `<rect x="${(minX - PAD).toFixed(1)}" y="${(minY - PAD).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${palette.bg}" />` +
    `<g>${edgeSvg}</g>` +
    `<g>${nodeSvg}</g>` +
    `</svg>`
  )
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadSvg(svg: string, filename: string): void {
  triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

/**
 * Rasteriza el SVG a PNG dibujándolo en un <canvas>. El SVG es autónomo (sin
 * referencias externas), así que un <img> lo carga sin tocar la red y el
 * canvas no queda "tainted". `scale` sube la resolución para pantallas HiDPI.
 */
export function downloadPng(svg: string, filename: string, scale = 2): Promise<void> {
  return new Promise((resolve, reject) => {
    const match = svg.match(/width="(\d+)" height="(\d+)"/)
    const w = match ? Number(match[1]) : 1200
    const h = match ? Number(match[2]) : 800
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w * scale
      canvas.height = h * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('No se pudo crear el contexto 2D'))
        return
      }
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => {
        if (blob) triggerDownload(blob, filename)
        resolve()
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo rasterizar el diagrama'))
    }
    img.src = url
  })
}
