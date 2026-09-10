import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ExecBlock, FileOperation, FlowEdge, FlowParagraph, FlowResult, Inventory } from '@miguelduran14/knowflow'
import {
  ArrowSquareOut,
  Code,
  CaretDown,
  CaretRight,
  CaretUp,
  DownloadSimple,
  FileSvg,
  FunnelSimple,
  ImageSquare,
  Info,
  MagnifyingGlass,
  SignIn,
  SignOut,
  Stack,
  X,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  layoutFlow,
  MAX_EDGE_LABEL_WIDTH,
  nodeIdFor,
  sectionNames,
  type CanvasGraph,
  type CanvasNode,
} from './layout.js'
import { downloadPng, downloadSvg, graphToSvg, type DiagramPalette } from './diagramExport.js'
import { useThemeTokens } from './theme.js'

type CobolNodeData = { canvas: CanvasNode; focused?: boolean; dimmed?: boolean }
type CobolNode = Node<CobolNodeData, 'cobol'>

function CobolNodeView({ data }: NodeProps<CobolNode>) {
  const { canvas, focused, dimmed } = data
  const cls = [
    'node',
    `node--${canvas.variant}`,
    canvas.terminates && !canvas.collapsed ? 'node--terminates' : '',
    focused ? 'node--focus' : '',
    dimmed ? 'node--dim' : '',
    canvas.collapsed ? 'node--collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={{ width: canvas.width, minHeight: canvas.height }}>
      <Handle type="target" position={Position.Top} className="handle" />
      {canvas.collapsed && <Stack size={14} weight="bold" className="node__stack" />}
      <span className="node__label">{canvas.label}</span>
      {canvas.collapsed && <span className="node__badge node__badge--expand">clic para desplegar</span>}
      {canvas.terminates && <span className="node__badge">fin de programa</span>}
      {canvas.section && !canvas.collapsed && <span className="node__section">{canvas.section}</span>}
      <Handle type="source" position={Position.Bottom} className="handle" />
    </div>
  )
}

const nodeTypes = { cobol: CobolNodeView }

type CobolEdgeData = { color: string; dash?: string | undefined; guarded: boolean; isFall: boolean; kind: FlowEdge['kind'] }
type CobolEdgeType = Edge<CobolEdgeData, 'cobol'>

/**
 * Arista con etiqueta HTML (no la SVG por defecto de React Flow), para
 * poder truncarla con "…" y ofrecer el texto completo en un tooltip nativo.
 * Antes las guardas largas (condiciones IF/EVALUATE compuestas) se pintaban
 * enteras y sin límite, tapando nodos y otras aristas — el layout (ver
 * layout.ts) ya les reserva hueco real, pero una condición muy larga sigue
 * necesitando un tope visual. El trazo (BaseEdge) no cambia.
 */
function CobolEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  data,
}: EdgeProps<CobolEdgeType>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const text = typeof label === 'string' ? label : undefined

  return (
    <>
      <BaseEdge id={id} path={path} style={style} {...(markerEnd ? { markerEnd } : {})} />
      {text && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label nodrag nopan${data?.guarded ? ' edge-label--guard' : ''}${data?.isFall ? ' edge-label--fall' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              maxWidth: MAX_EDGE_LABEL_WIDTH,
            }}
            title={text}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const edgeTypes = { cobol: CobolEdgeView }

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

/**
 * Familias de arista que ofrece el filtro (punto 4). Se agrupan por lo que le
 * importa al lector —transferencias explícitas frente a caídas naturales— no
 * por cada `kind` del motor: SORT entra/sale se cuentan como PERFORM a efectos
 * de ocultar/mostrar. Cada familia lista los `kind` que absorbe.
 */
const EDGE_FAMILIES: { id: string; label: string; color: string; kinds: FlowEdge['kind'][] }[] = [
  { id: 'perform', label: 'PERFORM', color: EDGE_COLOR['perform']!, kinds: ['perform', 'sort-input', 'sort-output'] },
  { id: 'call', label: 'CALL', color: EDGE_COLOR['call']!, kinds: ['call'] },
  { id: 'goto', label: 'GO TO', color: EDGE_COLOR['goto']!, kinds: ['goto'] },
  { id: 'fall-through', label: 'Caídas naturales', color: EDGE_COLOR['fall-through']!, kinds: ['fall-through'] },
]

/**
 * Leyenda del código visual del diagrama. Sin ella, los colores de arista y
 * las formas de nodo son indescifrables para quien no leyó el código — era
 * el mayor agujero de la vista. Plegable, para no robar sitio al grafo.
 */
function FlowLegend() {
  const [open, setOpen] = useState(false)
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
    <div className="flow-legend">
      <button className="flow-legend__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Info size={15} weight="bold" />
        <span>Leyenda</span>
        {open ? <CaretDown size={13} weight="bold" /> : <CaretUp size={13} weight="bold" />}
      </button>
      {open && (
        <div className="flow-legend__body">
          <div className="leg-group">Cómo pasa el control</div>
          {line(EDGE_COLOR['perform']!, 'PERFORM (llama y vuelve)')}
          {line(EDGE_COLOR['call']!, 'CALL (a otro programa)', true)}
          {line(EDGE_COLOR['goto']!, 'GO TO (salta, no vuelve)')}
          {line('var(--violet)', 'rama IF/EVALUATE (con guarda)')}
          {line(EDGE_COLOR['fall-through']!, 'caída natural (orden del fuente)', true)}
          {line('var(--missing)', 'destino no encontrado')}
          <div className="leg-group">Tipos de nodo</div>
          <span className="leg-row">
            <span className="leg-node" /> párrafo
          </span>
          <span className="leg-row">
            <span className="leg-node leg-node--section" /> sección
          </span>
          <span className="leg-row">
            <span className="leg-node leg-node--implicit" /> entrada (sintética)
          </span>
          <span className="leg-row">
            <span className="leg-node leg-node--end" /> fin del programa
          </span>
          <span className="leg-row">
            <span className="leg-node leg-node--call" /> otro programa (CALL)
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Buscador de párrafos sobre el lienzo. En un programa de 200 párrafos, el
 * minimapa no basta para encontrar "el que hace el UPDATE": esto filtra por
 * nombre (subcadena, case-insensitive como COBOL) y salta al nodo. Vive
 * dentro de <ReactFlow> para poder pedir el paneo por el contexto.
 */
function FlowSearch({
  names,
  onPick,
  activeName,
}: {
  names: string[]
  onPick: (name: string) => void
  activeName: string | undefined
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (q === '') return []
    return names.filter(n => n.toUpperCase().includes(q)).slice(0, 8)
  }, [names, query])

  // El cursor de selección vuelve al principio cada vez que cambia la lista.
  useEffect(() => setCursor(0), [query])

  const pick = useCallback(
    (name: string) => {
      onPick(name)
      setQuery('')
    },
    [onPick],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => (c + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => (c - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = matches[cursor]
      if (chosen) pick(chosen)
    } else if (e.key === 'Escape') {
      setQuery('')
    }
  }

  return (
    <div className="flow-search">
      <div className="flow-search__field">
        <MagnifyingGlass size={15} weight="bold" className="flow-search__icon" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Buscar párrafo…"
          aria-label="Buscar párrafo por nombre"
          spellCheck={false}
        />
        {(query !== '' || activeName) && (
          <button
            className="flow-search__clear"
            onClick={() => {
              setQuery('')
              onPick('')
              inputRef.current?.focus()
            }}
            title="Limpiar"
            aria-label="Limpiar búsqueda"
          >
            <X size={13} weight="bold" />
          </button>
        )}
      </div>
      {matches.length > 0 && (
        <ul className="flow-search__list" role="listbox">
          {matches.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={i === cursor}
              className={`flow-search__opt${i === cursor ? ' flow-search__opt--on' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(name)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {activeName && matches.length === 0 && (
        <div className="flow-search__active">
          Enfocado: <strong>{activeName}</strong>
        </div>
      )}
    </div>
  )
}

/**
 * Panel de secciones: pliega/despliega los bloques de la PROCEDURE DIVISION.
 * Solo aparece si el programa usa SECTIONs. Plegar reduce un programa de
 * cientos de párrafos a sus bloques de alto nivel — luego se despliega el
 * que interesa (o se hace clic en su nodo).
 */
function SectionsPanel({
  sections,
  collapsed,
  onToggle,
  onAll,
}: {
  sections: string[]
  collapsed: ReadonlySet<string>
  onToggle: (name: string) => void
  onAll: (collapse: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const collapsedCount = sections.filter(s => collapsed.has(s)).length

  return (
    <div className="sections-panel">
      <button className="sections-panel__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Stack size={15} weight="bold" />
        <span>Secciones</span>
        <span className="sections-panel__count">
          {collapsedCount > 0 ? `${collapsedCount}/${sections.length} plegadas` : sections.length}
        </span>
        {open ? <CaretDown size={13} weight="bold" /> : <CaretRight size={13} weight="bold" />}
      </button>
      {open && (
        <div className="sections-panel__body">
          <div className="sections-panel__actions">
            <button onClick={() => onAll(true)}>Plegar todas</button>
            <button onClick={() => onAll(false)}>Desplegar todas</button>
          </div>
          <ul>
            {sections.map(name => {
              const isCollapsed = collapsed.has(name)
              return (
                <li key={name}>
                  <label>
                    <input
                      type="checkbox"
                      checked={isCollapsed}
                      onChange={() => onToggle(name)}
                    />
                    <span>{name}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Filtro por tipo de arista (punto 4): oculta familias enteras para despejar
 * el grafo — típicamente las caídas naturales, que son ruido de fondo cuando
 * lo que se busca son las transferencias explícitas. Plegable como el resto
 * de paneles del lienzo.
 */
function EdgeFilterPanel({
  hidden,
  present,
  onToggleFamily,
  onOnlyTransfers,
  onShowAll,
}: {
  hidden: ReadonlySet<FlowEdge['kind']>
  present: ReadonlySet<FlowEdge['kind']>
  onToggleFamily: (kinds: FlowEdge['kind'][], visible: boolean) => void
  onOnlyTransfers: () => void
  onShowAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const families = EDGE_FAMILIES.filter(f => f.kinds.some(k => present.has(k)))
  if (families.length === 0) return null
  const hiddenCount = families.filter(f => f.kinds.every(k => hidden.has(k))).length

  return (
    <div className="edge-filter">
      <button className="edge-filter__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <FunnelSimple size={15} weight="bold" />
        <span>Aristas</span>
        {hiddenCount > 0 && <span className="edge-filter__count">{hiddenCount} ocultas</span>}
        {open ? <CaretDown size={13} weight="bold" /> : <CaretUp size={13} weight="bold" />}
      </button>
      {open && (
        <div className="edge-filter__body">
          {families.map(f => {
            const visible = !f.kinds.every(k => hidden.has(k))
            return (
              <label key={f.id} className="edge-filter__row">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => onToggleFamily(f.kinds, visible)}
                />
                <span className="edge-filter__swatch" style={{ background: f.color }} />
                <span>{f.label}</span>
              </label>
            )
          })}
          <div className="edge-filter__actions">
            <button onClick={onOnlyTransfers}>Solo transferencias</button>
            <button onClick={onShowAll}>Mostrar todo</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Botones de export del diagrama (punto 5): SVG vectorial y PNG rasterizado. */
function ExportButtons({ onSvg, onPng }: { onSvg: () => void; onPng: () => void }) {
  return (
    <div className="flow-export">
      <span className="flow-export__label">
        <DownloadSimple size={13} weight="bold" /> Exportar
      </span>
      <button className="flow-export__btn" onClick={onSvg} title="Descargar el diagrama como SVG vectorial">
        <FileSvg size={14} weight="bold" /> SVG
      </button>
      <button className="flow-export__btn" onClick={onPng} title="Descargar el diagrama como imagen PNG">
        <ImageSquare size={14} weight="bold" /> PNG
      </button>
    </div>
  )
}

const KIND_LABEL: Record<FlowEdge['kind'], string> = {
  perform: 'PERFORM',
  call: 'CALL',
  goto: 'GO TO',
  'fall-through': 'cae a',
  'sort-input': 'SORT entrada',
  'sort-output': 'SORT salida',
}

/** Una fila de arista dentro de la ficha (llamada saliente o entrante). */
function EdgeRow({
  edge,
  peer,
  jumpable,
  onJump,
}: {
  edge: FlowEdge
  /** El otro extremo a mostrar: destino (salientes) u origen (entrantes) */
  peer: string
  jumpable: boolean
  onJump: (name: string) => void
}) {
  const guards = edge.guards && edge.guards.length > 0 ? edge.guards.join(' Y ') : undefined
  return (
    <li className="pcard__edge">
      <span className={`pcard__kind pcard__kind--${edge.kind}`}>{KIND_LABEL[edge.kind]}</span>
      {jumpable ? (
        <button className="pcard__peer pcard__peer--link" onClick={() => onJump(peer)} title="Enfocar este párrafo">
          {peer}
        </button>
      ) : (
        <span className="pcard__peer">{peer}</span>
      )}
      {guards && (
        <span className="pcard__guard" title={guards}>
          {guards}
        </span>
      )}
      <span className="pcard__line">L{edge.line}</span>
    </li>
  )
}

/**
 * Ficha del párrafo (punto 3): al hacer clic en un nodo se abre este cajón con
 * lo que el nodo, por sí solo, no cuenta — a qué llama, quién lo llama (con la
 * guarda que condiciona cada arista), qué EXEC SQL/CICS y qué E/S de fichero
 * contiene, y su línea en el fuente para saltar al código. Es la última milla
 * de verificabilidad: del diagrama al hecho concreto.
 */
function ParagraphCard({
  name,
  flow,
  inventory,
  onClose,
  onJump,
  onOpenCode,
}: {
  name: string
  flow: FlowResult
  inventory: Inventory | undefined
  onClose: () => void
  onJump: (name: string) => void
  onOpenCode: ((line: number) => void) | undefined
}) {
  const id = nodeIdFor(name)
  const para: FlowParagraph | undefined = flow.paragraphs.find(p => nodeIdFor(p.name) === id)
  const paraIds = useMemo(() => new Set(flow.paragraphs.map(p => nodeIdFor(p.name))), [flow])
  const outgoing = flow.edges.filter(e => nodeIdFor(e.from) === id)
  const incoming = flow.edges.filter(e => nodeIdFor(e.to) === id)

  const execs: ExecBlock[] = (inventory?.execs ?? []).filter(
    x => x.paragraph && nodeIdFor(x.paragraph) === id,
  )
  const fileOps: { file: string; op: FileOperation }[] = []
  for (const file of inventory?.files ?? []) {
    for (const op of file.operations) {
      if (nodeIdFor(op.paragraph) === id) fileOps.push({ file: file.name, op })
    }
  }
  for (const op of inventory?.unresolvedFileOps ?? []) {
    if (nodeIdFor(op.paragraph) === id) fileOps.push({ file: op.target, op })
  }

  const line = para?.line

  return (
    <aside className="pcard" aria-label={`Ficha del párrafo ${name}`}>
      <header className="pcard__head">
        <div className="pcard__title">
          <span className="pcard__name">{name}</span>
          <div className="pcard__tags">
            {para?.kind === 'section' && <span className="pcard__tag">sección</span>}
            {para?.section && <span className="pcard__tag">en {para.section}</span>}
            {para?.terminates && <span className="pcard__tag pcard__tag--end">fin de programa</span>}
            {para?.inDeclaratives && <span className="pcard__tag">DECLARATIVES</span>}
            {para?.implicit && <span className="pcard__tag">entrada implícita</span>}
          </div>
        </div>
        <button className="pcard__close" onClick={onClose} title="Cerrar" aria-label="Cerrar la ficha">
          <X size={15} weight="bold" />
        </button>
      </header>

      {line !== undefined && onOpenCode && (
        <button className="pcard__gotocode" onClick={() => onOpenCode(line)}>
          <Code size={14} weight="bold" /> Saltar al código · línea {line}
          <ArrowSquareOut size={13} weight="bold" />
        </button>
      )}

      <section className="pcard__sec">
        <h4 className="pcard__h">
          <SignOut size={13} weight="bold" /> A qué llama <span className="pcard__n">{outgoing.length}</span>
        </h4>
        {outgoing.length === 0 ? (
          <p className="pcard__empty">No transfiere el control a ningún sitio.</p>
        ) : (
          <ul className="pcard__list">
            {outgoing.map((e, i) => (
              <EdgeRow
                key={i}
                edge={e}
                peer={e.to}
                jumpable={paraIds.has(nodeIdFor(e.to))}
                onJump={onJump}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="pcard__sec">
        <h4 className="pcard__h">
          <SignIn size={13} weight="bold" /> Quién lo llama <span className="pcard__n">{incoming.length}</span>
        </h4>
        {incoming.length === 0 ? (
          <p className="pcard__empty">Nadie lo referencia — se llega en línea o es un punto de entrada.</p>
        ) : (
          <ul className="pcard__list">
            {incoming.map((e, i) => (
              <EdgeRow
                key={i}
                edge={e}
                peer={e.from}
                jumpable={paraIds.has(nodeIdFor(e.from))}
                onJump={onJump}
              />
            ))}
          </ul>
        )}
      </section>

      {execs.length > 0 && (
        <section className="pcard__sec">
          <h4 className="pcard__h">EXEC <span className="pcard__n">{execs.length}</span></h4>
          <ul className="pcard__list">
            {execs.map((x, i) => (
              <li key={i} className="pcard__exec">
                <span className={`pcard__kind pcard__kind--${x.kind}`}>{x.kind.toUpperCase()}</span>
                <span className="pcard__exectext" title={x.text}>
                  {x.verb}
                  {x.cursor ? ` · ${x.cursor}` : ''}
                  {x.dynamic ? ' · dinámico' : ''}
                </span>
                <span className="pcard__line">L{x.line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fileOps.length > 0 && (
        <section className="pcard__sec">
          <h4 className="pcard__h">Ficheros <span className="pcard__n">{fileOps.length}</span></h4>
          <ul className="pcard__list">
            {fileOps.map(({ file, op }, i) => (
              <li key={i} className="pcard__exec">
                <span className="pcard__kind pcard__kind--io">{op.verb}</span>
                <span className="pcard__exectext">
                  {file}
                  {op.mode ? ` · ${op.mode}` : ''}
                </span>
                <span className="pcard__line">L{op.line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}

interface FlowCanvasProps {
  flow: FlowResult
  inventory?: Inventory | undefined
  focusParagraph?: string | undefined
  onFocused?: (() => void) | undefined
  /** Abre el panel de código de la app en una línea concreta ("saltar al código") */
  onOpenCode?: ((line: number) => void) | undefined
}

function FlowCanvasInner({ flow, inventory, focusParagraph, onFocused, onOpenCode }: FlowCanvasProps) {
  const [nodes, setNodes] = useState<CobolNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  // Nodo enfocado, sea por búsqueda o por un salto externo (chip de
  // Explicación/Avisos). Persiste hasta que se elige otro o se limpia — así
  // en un grafo grande el resalte se queda donde aterrizas.
  const [activeId, setActiveId] = useState<string | undefined>()
  // Párrafo cuya ficha está abierta (punto 3). Distinto de `activeId`: un
  // salto externo o una búsqueda enfocan sin abrir la ficha; solo el clic en
  // un nodo la abre.
  const [cardName, setCardName] = useState<string | undefined>()
  // Familias de arista ocultas por el filtro (punto 4) — estado de vista.
  const [hiddenKinds, setHiddenKinds] = useState<Set<FlowEdge['kind']>>(new Set())
  // Secciones plegadas (estado de vista): cada una absorbe a sus párrafos en
  // un solo nodo. Ver layoutFlow.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Último grafo posicionado (nodos + aristas con geometría de elk): la fuente
  // del export SVG/PNG, que no pasa por React Flow.
  const graphRef = useRef<CanvasGraph | undefined>(undefined)
  // Tokens del tema para el TRAZO de las aristas (React Flow los recibe como
  // string inline, no CSS). Las etiquetas van por CSS puro (.edge-label*).
  const tk = useThemeTokens(v => ({
    dots: v('--border'),
    missing: v('--missing'),
    guard: v('--violet'),
  }))
  // Hooks del contexto de React Flow (el componente va envuelto en
  // <ReactFlowProvider>): `rf` para paneo/encuadre, y updateNodeInternals
  // para forzar la medición de los bounds de los handles — sin ella, en
  // React 19 + RF 12 las aristas no se dibujan (los handles existen en el
  // DOM pero RF no captura sus posiciones). Ver el efecto tras el layout.
  const rf = useReactFlow<CobolNode, Edge>()
  const updateNodeInternals = useUpdateNodeInternals()

  const sections = useMemo(() => sectionNames(flow), [flow])

  // Un salto externo (prop) se copia al foco interno. Se hace por nombre →
  // id para no depender de que el prop ya venga normalizado.
  useEffect(() => {
    if (focusParagraph) setActiveId(nodeIdFor(focusParagraph))
  }, [focusParagraph])

  // Un programa nuevo (cambio de `flow` DENTRO de este montaje) invalida el
  // foco anterior: el párrafo enfocado quizá ya no exista. Se omite el
  // primer pase — en el montaje NO se limpia, para respetar un foco que
  // llega por prop (salto desde otra vista, que remonta este componente).
  const firstFlow = useRef(true)
  useEffect(() => {
    if (firstFlow.current) {
      firstFlow.current = false
      return
    }
    setActiveId(undefined)
    setCardName(undefined)
    setHiddenKinds(new Set())
    setCollapsed(new Set())
  }, [flow])

  const paragraphNames = useMemo(
    () => flow.paragraphs.filter(p => !p.implicit).map(p => p.name),
    [flow],
  )

  // Predecesores y sucesores directos del nodo activo: la vecindad que se
  // mantiene iluminada mientras el resto se atenúa (B2).
  const neighborhood = useMemo(() => {
    if (!activeId) return undefined
    const set = new Set<string>([activeId])
    for (const edge of flow.edges) {
      const from = nodeIdFor(edge.from)
      const to = nodeIdFor(edge.to)
      if (from === activeId) set.add(to)
      if (to === activeId) set.add(from)
    }
    return set
  }, [activeId, flow])

  useEffect(() => {
    let cancelled = false
    layoutFlow(flow, collapsed).then(graph => {
      if (cancelled) return
      graphRef.current = graph
      setNodes(
        graph.nodes.map(n => ({
          id: n.id,
          type: 'cobol' as const,
          position: { x: n.x, y: n.y },
          // Dimensiones explícitas: ya las calculó elk, así React Flow no
          // tiene que medir el DOM para anclar las aristas.
          width: n.width,
          height: n.height,
          data: { canvas: n },
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
            type: 'cobol' as const,
            data: { color, dash, guarded: e.guarded, isFall, kind: e.kind },
            style: {
              stroke: color,
              // Jerarquía de trazo: la caída natural es la más fina (columna
              // tranquila de fondo); la rama con guarda va algo más marcada
              // porque es una DECISIÓN; el resto, peso medio.
              strokeWidth: isFall ? 1 : e.guarded ? 1.7 : 1.5,
              ...(dash ? { strokeDasharray: dash } : {}),
            },
            markerEnd: { type: MarkerType.ArrowClosed, color },
          }
        }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [flow, tk, collapsed])

  // Fuerza a React Flow a medir los bounds de los handles de cada nodo tras
  // cada layout. Sin esto las aristas no se dibujan (bug pre-existente en
  // React 19 + RF 12: los handles están en el DOM pero RF no captura sus
  // posiciones por su cuenta). En el frame siguiente, ya con los nodos
  // montados. Ver también el `measured` que se fija arriba.
  useEffect(() => {
    if (nodes.length === 0) return
    const id = requestAnimationFrame(() => updateNodeInternals(nodes.map(n => n.id)))
    return () => cancelAnimationFrame(id)
  }, [nodes, updateNodeInternals])

  // Ajuste inicial: encuadra todo el grafo cuando hay nodos. Se usa fitBounds
  // (no el fitView del prop, que aquí es un no-op) sobre los bounds calculados
  // de los nodos ya posicionados. En este entorno —React 19 + React Flow 12—
  // las operaciones de viewport ANIMADAS no mueven la vista; las instantáneas
  // sí, así que este fit va sin `duration`. Corre en cada layout nuevo.
  useEffect(() => {
    if (nodes.length === 0) return
    const xs = nodes.map(n => n.position.x)
    const ys = nodes.map(n => n.position.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...nodes.map(n => n.position.x + n.data.canvas.width))
    const maxY = Math.max(...nodes.map(n => n.position.y + n.data.canvas.height))
    rf.fitBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { padding: 0.12 })
  }, [nodes, rf])

  // Aplica foco y atenuado sobre los nodos ya posicionados. Separado del
  // layout (que es caro y asíncrono) para que resaltar no recalcule elk.
  const decoratedNodes = useMemo<CobolNode[]>(
    () =>
      nodes.map(n => ({
        ...n,
        data: {
          ...n.data,
          focused: activeId === n.id,
          dimmed: neighborhood !== undefined && !neighborhood.has(n.id),
        },
      })),
    [nodes, activeId, neighborhood],
  )

  // Aristas visibles tras el filtro por tipo (punto 4), y luego atenuadas
  // fuera de la vecindad a la vez que los nodos, para que el subgrafo activo
  // destaque como una unidad.
  const decoratedEdges = useMemo(
    () =>
      edges
        .filter(e => {
          const kind = (e.data as CobolEdgeData | undefined)?.kind
          return !kind || !hiddenKinds.has(kind)
        })
        .map(e => {
          if (!neighborhood) return e
          const on = neighborhood.has(e.source) && neighborhood.has(e.target)
          return { ...e, style: { ...e.style, opacity: on ? 1 : 0.12 } }
        }),
    [edges, neighborhood, hiddenKinds],
  )

  // Paneo real al nodo activo: el resalte anterior no movía la vista, así
  // que en un grafo grande "saltar" a un párrafo no mostraba nada. Centra
  // conservando un zoom cómodo (nunca por debajo de 0.85 para que se lea).
  useEffect(() => {
    if (!activeId) return
    const node = nodes.find(n => n.id === activeId)
    if (!node) return
    const w = node.data.canvas.width
    const h = node.data.canvas.height
    // Sin `duration`: el paneo animado (transición d3-zoom) es un no-op en
    // este entorno; el instantáneo sí centra. El resalte + atenuado de la
    // vecindad dejan claro dónde aterriza aunque el salto no sea suave.
    const zoom = Math.max(rf.getZoom(), 0.85)
    rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom })
  }, [activeId, nodes, rf])

  // El salto externo se "consume" tras un momento para que un segundo clic
  // en la misma etapa vuelva a disparar el efecto. El foco interno (activeId)
  // NO se limpia aquí: el resalte se queda hasta que el usuario elija otro.
  useEffect(() => {
    if (!focusParagraph || !onFocused) return
    const t = window.setTimeout(() => onFocused(), 1600)
    return () => window.clearTimeout(t)
  }, [focusParagraph, onFocused])

  const activeName = useMemo(() => {
    if (!activeId) return undefined
    return nodes.find(n => n.id === activeId)?.data.canvas.label
  }, [activeId, nodes])

  const pickByName = useCallback((name: string) => {
    setActiveId(name === '' ? undefined : nodeIdFor(name))
  }, [])

  const toggleSection = useCallback((name: string) => {
    // Cambiar el plegado descarta el foco: el nodo enfocado quizá deje de
    // dibujarse (absorbido) o aparezca uno nuevo (la sección).
    setActiveId(undefined)
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const setAllCollapsed = useCallback(
    (collapse: boolean) => {
      setActiveId(undefined)
      setCollapsed(collapse ? new Set(sections) : new Set())
    },
    [sections],
  )

  // Clic en un nodo: una sección plegada se despliega; cualquier otro nodo se
  // enfoca (vecindad + paneo) y abre su ficha (punto 3). Los nodos externos
  // (CALL a otro programa, destino no encontrado) solo enfocan — no son
  // párrafos de este programa, así que no tienen ficha propia.
  const onNodeClick = useCallback(
    (_e: unknown, node: CobolNode) => {
      const canvas = node.data.canvas
      if (canvas.collapsed) {
        const name = sections.find(s => nodeIdFor(s) === node.id)
        if (name) toggleSection(name)
        return
      }
      setActiveId(node.id)
      if (canvas.variant === 'call' || canvas.variant === 'missing') {
        setCardName(undefined)
        return
      }
      const real = flow.paragraphs.find(p => nodeIdFor(p.name) === node.id)?.name
      setCardName(real ?? canvas.label)
    },
    [sections, toggleSection, flow],
  )

  // Salto desde la ficha a un párrafo referenciado: lo enfoca y mueve la ficha
  // a él, para recorrer la vecindad sin volver al diagrama.
  const jumpToCardParagraph = useCallback((name: string) => {
    setActiveId(nodeIdFor(name))
    setCardName(name)
  }, [])

  // Tipos de arista presentes en el flujo — el filtro solo ofrece los que hay.
  const presentKinds = useMemo(() => new Set(flow.edges.map(e => e.kind)), [flow])

  const toggleFamily = useCallback((kinds: FlowEdge['kind'][], visible: boolean) => {
    setHiddenKinds(prev => {
      const next = new Set(prev)
      // `visible` es el estado ACTUAL: si se ve, el clic la oculta, y al revés.
      if (visible) kinds.forEach(k => next.add(k))
      else kinds.forEach(k => next.delete(k))
      return next
    })
  }, [])
  const onlyTransfers = useCallback(() => setHiddenKinds(new Set(['fall-through'])), [])
  const showAllEdges = useCallback(() => setHiddenKinds(new Set()), [])

  // Export: se arma un SVG autónomo desde el grafo posicionado (no desde React
  // Flow), respetando el filtro por tipo — se exporta lo que se ve.
  const buildSvg = useCallback((): string | undefined => {
    const graph = graphRef.current
    if (!graph) return undefined
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string) => cs.getPropertyValue(name).trim()
    const palette: DiagramPalette = {
      bg: v('--bg') || '#0b0e14',
      nodeFill: v('--bg-raised') || '#1b212b',
      nodeStroke: v('--border') || '#262e3a',
      text: v('--text') || '#e6ebf2',
      textDim: v('--text-dim') || '#828d9e',
      accent: v('--accent') || '#3fd9b4',
      violet: v('--violet') || '#8b7bf0',
      missing: v('--missing') || '#f0708a',
      ok: v('--ok') || '#6fcf97',
      fall: EDGE_COLOR['fall-through']!,
      edge: EDGE_COLOR,
    }
    const visible: CanvasGraph = {
      nodes: graph.nodes,
      edges: graph.edges.filter(e => !hiddenKinds.has(e.kind)),
    }
    return graphToSvg(visible, palette)
  }, [hiddenKinds])

  const baseName = (flow.programId ?? 'diagrama').toLowerCase()
  const exportSvg = useCallback(() => {
    const svg = buildSvg()
    if (svg) downloadSvg(svg, `${baseName}-flujo.svg`)
  }, [buildSvg, baseName])
  const exportPng = useCallback(() => {
    const svg = buildSvg()
    if (svg) void downloadPng(svg, `${baseName}-flujo.png`)
  }, [buildSvg, baseName])

  return (
    <div className="flow-wrap">
      <ReactFlow
        nodes={decoratedNodes}
        edges={decoratedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.2}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        onPaneClick={() => {
          setActiveId(undefined)
          setCardName(undefined)
        }}
        proOptions={{ hideAttribution: false }}
      >
        <Panel position="top-left">
          <FlowSearch names={paragraphNames} onPick={pickByName} activeName={activeName} />
        </Panel>
        <Panel position="top-right">
          <div className="flow-tools">
            {sections.length > 0 && (
              <SectionsPanel
                sections={sections}
                collapsed={collapsed}
                onToggle={toggleSection}
                onAll={setAllCollapsed}
              />
            )}
            <EdgeFilterPanel
              hidden={hiddenKinds}
              present={presentKinds}
              onToggleFamily={toggleFamily}
              onOnlyTransfers={onlyTransfers}
              onShowAll={showAllEdges}
            />
            <ExportButtons onSvg={exportSvg} onPng={exportPng} />
          </div>
        </Panel>
        <Panel position="bottom-left">
          <FlowLegend />
        </Panel>
        <Background gap={24} size={1.5} color={tk.dots} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="minimap" />
      </ReactFlow>

      {cardName && (
        <ParagraphCard
          name={cardName}
          flow={flow}
          inventory={inventory}
          onClose={() => setCardName(undefined)}
          onJump={jumpToCardParagraph}
          onOpenCode={onOpenCode}
        />
      )}
    </div>
  )
}

/**
 * Proyecta un FlowResult a un lienzo interactivo (React Flow + elk). El
 * provider da a FlowCanvasInner el contexto de React Flow que usan sus
 * hooks (useReactFlow para paneo/encuadre, useUpdateNodeInternals para que
 * las aristas anclen). El "viewport muerto" que antes se achacaba al
 * provider era en realidad el bug de las operaciones con `duration`.
 */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
