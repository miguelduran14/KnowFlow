import {
  checkAdvisories,
  flowToMermaid,
  linkPrograms,
  linkedFlowToMermaid,
  parse,
  parseFlow,
  parseInventory,
  renderDossier,
  type Advisory,
  type Explanation,
  type FlowResult,
  type Inventory,
  type LinkedFlow,
  type ParseResult,
} from 'knowflow'
import {
  CaretRight,
  Code,
  Database,
  FileArrowDown,
  FlowArrow,
  LinkSimple,
  Moon,
  Sparkle,
  Sun,
  Table,
  UploadSimple,
  Warning,
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AdvisoriesPanel } from './AdvisoriesPanel.js'
import { DataPanel } from './DataPanel.js'
import { ExplainPanel } from './ExplainPanel.js'
import { GlossaryProvider } from './glossary.js'
import { InventoryPanel } from './InventoryPanel.js'
import { PrivacyBadge } from './PrivacyBadge.js'

// Los lienzos arrastran elkjs (~500 KB) y @xyflow/react: se cargan bajo
// demanda (code-splitting) para que el arranque no pague ese peso hasta que
// se ve un grafo. El resto de la app funciona sin ellos.
const FlowCanvas = lazy(() => import('./FlowCanvas.js').then(m => ({ default: m.FlowCanvas })))
const ChainCanvas = lazy(() => import('./ChainCanvas.js').then(m => ({ default: m.ChainCanvas })))

const SAMPLE = `      * Programa sintético de ejemplo (no es código real de nadie).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DEMOFLOW.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT MOV-FILE ASSIGN TO MOVDD
               ORGANIZATION IS SEQUENTIAL.
           SELECT RPT-FILE ASSIGN TO RPTDD.
       DATA DIVISION.
       FILE SECTION.
       FD  MOV-FILE.
       01  MOV-REC            PIC X(120).
       FD  RPT-FILE.
       01  RPT-REC            PIC X(133).
       WORKING-STORAGE SECTION.
           EXEC SQL INCLUDE SQLCA END-EXEC.
           EXEC SQL
               DECLARE CLI-CUR CURSOR FOR
                   SELECT CLI_ID, CLI_SALDO
                     FROM CLIENTES
                    WHERE CLI_ESTADO = 'A'
           END-EXEC.
       01 WS-REGISTRO.
         05 WS-CLAVE          PIC X(8).
         05 WS-IMPORTE        PIC S9(7)V99 COMP-3.
         05 WS-IMPORTE-ED     PIC ZZ,ZZ9.99.
         05 WS-ESTADO         PIC X(1).
           88 WS-ACTIVO         VALUE 'A'.
           88 WS-CERRADO        VALUE 'C'.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT MOV-FILE OUTPUT RPT-FILE
           PERFORM INIT-PARA
           PERFORM PROCESS-PARA UNTIL WS-EOF = 'Y'
           PERFORM REPORT-PARA
           CLOSE MOV-FILE RPT-FILE
           STOP RUN.
       INIT-PARA.
           MOVE 0 TO WS-COUNT
           EXEC SQL OPEN CLI-CUR END-EXEC.
       PROCESS-PARA.
           PERFORM READ-NEXT-PARA
           EVALUATE WS-ESTADO
               WHEN 'A'
                   CALL 'VALIDMOD' USING WS-REGISTRO
               WHEN 'C'
               WHEN 'X'
                   PERFORM CIERRE-PARA
               WHEN OTHER
                   PERFORM ERROR-PARA
           END-EVALUATE
           ADD 1 TO WS-COUNT.
       READ-NEXT-PARA.
           READ MOV-FILE
           EXEC SQL FETCH CLI-CUR INTO :WS-ID, :WS-SALDO END-EXEC.
       CIERRE-PARA.
           IF WS-IMPORTE > 0
               EXEC SQL
                   UPDATE CLIENTES
                      SET CLI_SALDO = :WS-SALDO
                    WHERE CLI_ID = :WS-ID
               END-EXEC
           END-IF.
       ERROR-PARA.
           DISPLAY 'ESTADO NO ESPERADO'.
       REPORT-PARA.
           WRITE RPT-REC
           CALL WS-REPORT-PROG
           DISPLAY 'DONE'.
`

const MAIN_SOURCE = 'programa pegado'

type View = 'explain' | 'flow' | 'data' | 'inventory' | 'advisories' | 'chain'

interface ViewDef {
  id: View
  label: string
  Icon: typeof FlowArrow
  hint: string
}

// Orden por prioridad de onboarding: primero la explicación en lenguaje
// llano, luego el flujo (la estrella visual), después datos e inventario,
// avisos justo después (son sobre esos mismos hechos), y la cadena al
// final (solo relevante con varios programas).
const VIEWS: ViewDef[] = [
  { id: 'explain', label: 'Explicación', Icon: Sparkle, hint: 'En lenguaje llano' },
  { id: 'flow', label: 'Flujo', Icon: FlowArrow, hint: 'Cómo se recorre' },
  { id: 'data', label: 'Datos', Icon: Table, hint: 'El esquema de bytes' },
  { id: 'inventory', label: 'Qué toca', Icon: Database, hint: 'Ficheros, DB2, CICS' },
  { id: 'advisories', label: 'Avisos', Icon: Warning, hint: 'Cuidado con esto' },
  { id: 'chain', label: 'Cadena', Icon: LinkSimple, hint: 'Llamadas entre programas' },
]

export function App() {
  return (
    <GlossaryProvider>
      <AppShell />
    </GlossaryProvider>
  )
}

// ── Controles de la topbar ──────────────────────────────────────────────

/** Toggle de tema (papel milimetrado ↔ consola). Estampa data-theme en el
 *  <html>, que gana sobre el prefers-color-scheme del SO. */
function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(
    () => localStorage.getItem('knowflow.theme') as 'light' | 'dark' | null,
  )
  useEffect(() => {
    const root = document.documentElement
    if (theme) root.setAttribute('data-theme', theme)
    else root.removeAttribute('data-theme')
  }, [theme])

  const effective =
    theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  const next = effective === 'dark' ? 'light' : 'dark'

  return (
    <button
      className="icon-btn"
      onClick={() => {
        setTheme(next)
        localStorage.setItem('knowflow.theme', next)
      }}
      title={`Cambiar a tema ${next === 'dark' ? 'oscuro' : 'claro'}`}
      aria-label="Cambiar tema"
    >
      {effective === 'dark' ? <Moon size={17} weight="fill" /> : <Sun size={17} weight="fill" />}
    </button>
  )
}

// ── Estado de bienvenida ────────────────────────────────────────────────

/** Antes de cargar nada: hero con zona de arrastre y preview de las salidas. */
function Landing({
  over,
  onLoadExample,
}: {
  over: boolean
  onLoadExample: () => void
}) {
  const reduce = useReducedMotion()
  const rise = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: 0.05 * i, type: 'spring' as const, stiffness: 320, damping: 30 },
        }

  return (
    <div className="landing">
      <motion.div className={`dropzone${over ? ' dropzone--over' : ''}`} {...rise(0)}>
        <div className="dropzone__icon">
          <UploadSimple size={30} weight="regular" />
        </div>
        <h1 className="landing__title">
          Entiende un programa COBOL <span className="accent">sin leer el código</span>
        </h1>
        <p className="landing__sub">
          Arrastra aquí tu programa <code>.cbl</code> y sus copybooks <code>.cpy</code>. KnowFlow lo
          analiza y te devuelve el flujo, los datos, qué toca y una explicación en lenguaje llano —
          todo verificado por el parser, nada lo inventa un modelo.
        </p>
        <div className="landing__cta">
          <button className="btn btn--primary" onClick={onLoadExample}>
            <Sparkle size={16} weight="fill" /> Cargar programa de ejemplo
          </button>
          <span className="landing__or">o arrastra un fichero</span>
        </div>
      </motion.div>

      <motion.div className="preview-cards" {...rise(1)}>
        {VIEWS.filter(v => v.id !== 'chain').map((v, i) => (
          <motion.div key={v.id} className="preview-card" {...rise(2 + i)}>
            <v.Icon size={20} weight="duotone" />
            <div>
              <b>{v.label}</b>
              <span>{v.hint}</span>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <motion.p className="landing__ip" {...rise(6)}>
        Local-first: tu código solo sale de tu máquina hacia el proveedor de IA que tú configures.
        Usa solo COBOL sintético o público — nunca código de clientes.
      </motion.p>
    </div>
  )
}

// ── Rail de navegación ──────────────────────────────────────────────────

function NavRail({
  view,
  onView,
  chainEnabled,
  advisoryCount,
}: {
  view: View
  onView: (v: View) => void
  chainEnabled: boolean
  advisoryCount: number
}) {
  return (
    <nav className="rail" aria-label="Vistas del análisis">
      {VIEWS.map(v => {
        const disabled = v.id === 'chain' && !chainEnabled
        const active = view === v.id
        const badge = v.id === 'advisories' && advisoryCount > 0 ? advisoryCount : undefined
        return (
          <button
            key={v.id}
            className={`rail-item${active ? ' rail-item--active' : ''}`}
            onClick={() => !disabled && onView(v.id)}
            disabled={disabled}
            title={disabled ? 'Sin llamadas a otros programas' : v.hint}
            aria-current={active ? 'page' : undefined}
          >
            {active && (
              <motion.span
                layoutId="rail-active"
                className="rail-item__glow"
                transition={{ type: 'spring', stiffness: 400, damping: 34 }}
              />
            )}
            <v.Icon size={20} weight={active ? 'fill' : 'regular'} className="rail-item__icon" />
            <span className="rail-item__label">{v.label}</span>
            {badge !== undefined && <span className="rail-item__badge">{badge}</span>}
          </button>
        )
      })}
    </nav>
  )
}

// ── Panel de código plegable ────────────────────────────────────────────

function CodePanel({
  source,
  onChange,
  open,
  onToggle,
  jump,
}: {
  source: string
  onChange: (v: string) => void
  open: boolean
  onToggle: () => void
  /** Petición de salto a una línea (con nonce para repetir la misma línea) */
  jump?: { line: number; nonce: number } | undefined
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Desplaza el textarea a la línea pedida y selecciona su texto — así "saltar
  // al código" desde el diagrama aterriza en la sentencia concreta. Cuando el
  // panel venía cerrado se abre con una transición de ancho, y en los primeros
  // frames el textarea aún no acepta la selección de forma fiable: se reintenta
  // frame a frame hasta que la selección cuaja (o se agotan los intentos).
  useEffect(() => {
    if (!jump || !open) return
    let raf = 0
    let attempts = 0
    const apply = () => {
      const ta = textareaRef.current
      if (ta) {
        const lines = source.split('\n')
        const clamped = Math.min(Math.max(jump.line, 1), lines.length)
        const start = lines.slice(0, clamped - 1).reduce((n, l) => n + l.length + 1, 0)
        const end = start + (lines[clamped - 1]?.length ?? 0)
        ta.focus()
        ta.setSelectionRange(start, end)
        // Con `wrap=off` cada línea lógica ocupa exactamente una fila visual de
        // `lineHeight` px, así que el desplazamiento a la línea es exacto: se
        // centra la línea destino teniendo en cuenta el padding superior real.
        const cs = getComputedStyle(ta)
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.55 || 18
        const padTop = parseFloat(cs.paddingTop) || 0
        const lineTop = padTop + (clamped - 1) * lh
        ta.scrollTop = Math.max(0, lineTop + lh / 2 - ta.clientHeight / 2)
        // El inicio de la línea a la vista (COBOL empieza en la col. 8): si se
        // había desplazado a la derecha, el nombre del párrafo quedaría fuera.
        ta.scrollLeft = 0
        if (ta.selectionStart === start && ta.clientHeight > 0) return
      }
      if (attempts++ < 30) raf = requestAnimationFrame(apply)
    }
    raf = requestAnimationFrame(apply)
    return () => cancelAnimationFrame(raf)
  }, [jump, open, source])

  return (
    <aside className={`code-panel${open ? ' code-panel--open' : ''}`}>
      <button
        className="code-panel__handle"
        onClick={onToggle}
        title={open ? 'Ocultar código' : 'Ver código'}
        aria-label={open ? 'Ocultar el código fuente' : 'Ver el código fuente'}
        aria-expanded={open}
      >
        <Code size={17} weight="bold" />
        {!open && <span className="code-panel__handle-label">Código</span>}
        <CaretRight
          size={14}
          weight="bold"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform .2s' }}
        />
      </button>
      {open && (
        <div className="code-panel__body">
          <div className="code-panel__title">Fuente COBOL</div>
          <textarea
            ref={textareaRef}
            value={source}
            onChange={e => onChange(e.target.value)}
            spellCheck={false}
            wrap="off"
            aria-label="Código fuente COBOL"
          />
        </div>
      )}
    </aside>
  )
}

// ── Persistencia de sesión ──────────────────────────────────────────────
// El trabajo del usuario (programa + copybooks + otros fuentes) sobrevive al
// cierre de la pestaña, en localStorage — local-first, nada sale de la
// máquina. Solo estado de trabajo; la clave de IA se guarda aparte (ver
// ExplainPanel). Un fuente grande podría rebasar la cuota: se traga el error
// en vez de romper la app.

const SESSION = {
  source: 'knowflow.session.source',
  copybooks: 'knowflow.session.copybooks',
  others: 'knowflow.session.others',
} as const

function loadSessionMap(key: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(key)
    const entries: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(entries) ? new Map(entries as [string, string][]) : new Map()
  } catch {
    return new Map()
  }
}

function saveSession(key: string, value: string): void {
  try {
    if (value === '' || value === '[]') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Cuota excedida u otro fallo de almacenamiento: la sesión no persiste,
    // pero la app sigue usable con lo que hay en memoria.
  }
}

// ── Shell principal ─────────────────────────────────────────────────────

function AppShell() {
  const reduce = useReducedMotion()
  const [source, setSource] = useState(() => localStorage.getItem(SESSION.source) ?? '')
  const [copybooks, setCopybooks] = useState<Map<string, string>>(() => loadSessionMap(SESSION.copybooks))
  const [others, setOthers] = useState<Map<string, string>>(() => loadSessionMap(SESSION.others))
  const [view, setView] = useState<View>('flow')
  const [dragOver, setDragOver] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  // Línea a la que saltar en el panel de código (desde la ficha del párrafo del
  // diagrama). Un contador junto a la línea fuerza el re-salto aunque se pida
  // la misma línea dos veces seguidas.
  const [codeJump, setCodeJump] = useState<{ line: number; nonce: number } | undefined>()
  const [focusParagraph, setFocusParagraph] = useState<string | undefined>()
  // La explicación vive aquí (no en ExplainPanel) para sobrevivir cambios
  // de vista: saltar a Flujo a verificar un párrafo y volver no debe costar
  // otra llamada a la IA.
  const [explanation, setExplanation] = useState<Explanation | undefined>()

  const jumpToParagraph = useCallback((name: string) => {
    setFocusParagraph(name)
    setView('flow')
  }, [])

  // "Saltar al código" desde la ficha del párrafo: abre el panel de código y
  // pide el desplazamiento a la línea.
  const openCodeAt = useCallback((line: number) => {
    setCodeOpen(true)
    setCodeJump({ line, nonce: Date.now() })
  }, [])

  // Persistencia de la sesión: cada cambio del trabajo se guarda para
  // sobrevivir a un cierre de pestaña o una recarga.
  useEffect(() => saveSession(SESSION.source, source), [source])
  useEffect(() => saveSession(SESSION.copybooks, JSON.stringify([...copybooks])), [copybooks])
  useEffect(() => saveSession(SESSION.others, JSON.stringify([...others])), [others])

  const flow: FlowResult | undefined = useMemo(
    () => (source.trim() === '' ? undefined : parseFlow(source)),
    [source],
  )
  const data: ParseResult | undefined = useMemo(
    () => (source.trim() === '' ? undefined : parse(source, copybooks)),
    [source, copybooks],
  )
  const inventory: Inventory | undefined = useMemo(
    () => (source.trim() === '' ? undefined : parseInventory(source)),
    [source],
  )
  // Avisos: trampas de mantenimiento ya verificadas contra el fuente (no
  // huecos de fidelidad) — ver `checkAdvisories` en el motor.
  const advisories: Advisory[] = useMemo(
    () => (source.trim() === '' ? [] : checkAdvisories(source, data, flow, inventory)),
    [source, data, flow, inventory],
  )
  const linked: LinkedFlow | undefined = useMemo(() => {
    if (source.trim() === '') return undefined
    const sources = new Map<string, string>([[MAIN_SOURCE, source], ...others])
    return linkPrograms(sources)
  }, [source, others])

  // La explicación recibe también la cadena: así, con varios fuentes, narra
  // qué hacen los módulos llamados (ver `chain` en explainProgram). Solo se
  // pasa si hay algo que contar — otro programa aportado o una CALL que cruza.
  const chain = useMemo(
    () => (linked && (linked.calls.length > 0 || linked.programs.length > 1) ? linked : undefined),
    [linked],
  )
  const facts = useMemo(
    () => ({ data, flow, inventory, advisories, chain }),
    [data, flow, inventory, advisories, chain],
  )

  const addFile = useCallback((file: File, text: string, index: number) => {
    if (/\.(cpy|copy)$/i.test(file.name)) {
      const member = file.name.replace(/\.(cpy|copy)$/i, '').toUpperCase()
      setCopybooks(prev => new Map(prev).set(member, text))
    } else if (index === 0) {
      setSource(text)
    } else {
      setOthers(prev => new Map(prev).set(file.name, text))
    }
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      setDragOver(false)
      const files = [...event.dataTransfer.files]
      files.forEach((file, index) => void file.text().then(text => addFile(file, text, index)))
    },
    [addFile],
  )

  const removeCopybook = useCallback((member: string) => {
    setCopybooks(prev => {
      const next = new Map(prev)
      next.delete(member)
      return next
    })
  }, [])
  const removeProgram = useCallback((name: string) => {
    setOthers(prev => {
      const next = new Map(prev)
      next.delete(name)
      return next
    })
  }, [])

  const copyMermaid = useCallback(() => {
    if (view === 'chain' && linked) {
      void navigator.clipboard.writeText(linkedFlowToMermaid(linked))
      return
    }
    if (flow) void navigator.clipboard.writeText(flowToMermaid(flow))
  }, [view, linked, flow])

  // Exporta el paquete de onboarding completo a un .md descargable (todo se
  // arma en el navegador; nada sale de la máquina). Reúne los hechos del
  // parser y, si existe, la explicación de IA ya generada.
  const exportDossier = useCallback(() => {
    const md = renderDossier({
      data,
      flow,
      inventory,
      advisories,
      explanation,
      sourceName: flow?.programId ?? 'programa pegado',
    })
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(flow?.programId ?? 'dossier').toLowerCase()}-onboarding.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [data, flow, inventory, advisories, explanation])

  const clearAll = useCallback(() => {
    setSource('')
    setCopybooks(new Map())
    setOthers(new Map())
    setExplanation(undefined)
    setCodeOpen(false)
  }, [])

  const hasSource = source.trim() !== ''
  const hasGraph = flow !== undefined && flow.paragraphs.length > 0
  const chainEnabled = !!(linked && linked.calls.length > 0)

  return (
    <div
      className="app"
      onDrop={onDrop}
      onDragOver={e => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={e => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">KnowFlow</span>
          <span className="brand__tag">comprensión de COBOL, verificada por parser</span>
        </div>
        <div className="actions">
          <PrivacyBadge />
          <ThemeToggle />
          {!hasSource ? (
            <button className="btn" onClick={() => setSource(SAMPLE)}>
              Cargar ejemplo
            </button>
          ) : (
            <>
              <button className="btn btn--primary" onClick={exportDossier} disabled={!hasSource}>
                <FileArrowDown size={15} weight="bold" /> Exportar dossier
              </button>
              <button className="btn" onClick={copyMermaid} disabled={!hasGraph}>
                Copiar Mermaid
              </button>
              <button className="btn" onClick={clearAll}>
                Limpiar
              </button>
            </>
          )}
        </div>
      </header>

      {!hasSource ? (
        <Landing over={dragOver} onLoadExample={() => setSource(SAMPLE)} />
      ) : (
        <div className={`workspace${codeOpen ? ' workspace--code-open' : ''}`}>
          <NavRail view={view} onView={setView} chainEnabled={chainEnabled} advisoryCount={advisories.length} />

          <main className="stage">
            <IdentityBand
              flow={flow}
              data={data}
              inventory={inventory}
              hasGraph={hasGraph}
              copybooks={copybooks}
              others={others}
              onRemoveCopybook={removeCopybook}
              onRemoveProgram={removeProgram}
              onAddFile={(file, text) => addFile(file, text, 1)}
            />

            <div className="stage__body">
              {/* Solo animamos la ENTRADA de cada vista: al cambiar `view`,
                  la key cambia y React remonta el contenido al instante,
                  reproduciendo initial→animate. Sin `exit` no hay riesgo de
                  que AnimatePresence se quede esperando una salida que no
                  termina (pasa con hijos como react-flow). */}
              <motion.div
                key={view}
                className="stage__view"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <ActiveView
                  view={view}
                  flow={flow}
                  data={data}
                  inventory={inventory}
                  advisories={advisories}
                  linked={linked}
                  facts={facts}
                  hasGraph={hasGraph}
                  focusParagraph={focusParagraph}
                  onFocused={() => setFocusParagraph(undefined)}
                  onJumpToParagraph={jumpToParagraph}
                  onOpenCode={openCodeAt}
                  explanation={explanation}
                  onExplanation={setExplanation}
                />
              </motion.div>
            </div>
          </main>

          <CodePanel
            source={source}
            onChange={setSource}
            open={codeOpen}
            onToggle={() => setCodeOpen(o => !o)}
            jump={codeJump}
          />
        </div>
      )}

      {/* Overlay de arrastre cuando ya hay un programa cargado */}
      <AnimatePresence>
        {dragOver && hasSource && (
          <motion.div
            className="drag-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="drag-overlay__card">
              <UploadSimple size={28} weight="regular" />
              Suelta para añadir un copybook o programa
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Banda de identidad ──────────────────────────────────────────────────

function IdentityBand({
  flow,
  data,
  inventory,
  hasGraph,
  copybooks,
  others,
  onRemoveCopybook,
  onRemoveProgram,
  onAddFile,
}: {
  flow: FlowResult | undefined
  data: ParseResult | undefined
  inventory: Inventory | undefined
  hasGraph: boolean
  copybooks: Map<string, string>
  others: Map<string, string>
  onRemoveCopybook: (m: string) => void
  onRemoveProgram: (n: string) => void
  onAddFile: (file: File, text: string) => void
}) {
  return (
    <div className="identband">
      {flow?.programId && (
        <span className="ident">
          <span className="ident__dot" />
          <span className="ident__label">PROGRAM-ID</span>
          {flow.programId}
        </span>
      )}
      {(hasGraph || inventory) && (
        <div className="specs">
          {hasGraph && (
            <div className="specs__cell">
              <b>{flow!.paragraphs.filter(p => !p.implicit).length}</b>
              <span>párrafos</span>
            </div>
          )}
          {inventory && (
            <div className="specs__cell">
              <b>{inventory.files.length}</b>
              <span>ficheros</span>
            </div>
          )}
          {inventory && (
            <div className="specs__cell">
              <b>{inventory.tables.length}</b>
              <span>tablas</span>
            </div>
          )}
        </div>
      )}
      <div className="identband__chips">
        {flow?.fragment && <span className="notice notice--warn">Fragmento parcial</span>}
        {flow && flow.missingTargets.length > 0 && (
          <span className="notice notice--missing">
            Destinos no encontrados: {flow.missingTargets.join(', ')}
          </span>
        )}
        {flow && flow.nestedPrograms.length > 0 && (
          <span className="notice notice--warn">Anidados sin analizar: {flow.nestedPrograms.join(', ')}</span>
        )}
        {data?.missingCopybooks.map(name => (
          <MissingCopybookChip key={name} name={name} onFile={onAddFile} />
        ))}
        {[...copybooks.keys()].map(member => (
          <span key={member} className="notice notice--copybook">
            {member}.cpy
            <button
              className="chip-close"
              onClick={() => onRemoveCopybook(member)}
              title="Quitar"
              aria-label={`Quitar copybook ${member}`}
            >
              ×
            </button>
          </span>
        ))}
        {[...others.keys()].map(name => (
          <span key={name} className="notice notice--program">
            {name}
            <button
              className="chip-close"
              onClick={() => onRemoveProgram(name)}
              title="Quitar"
              aria-label={`Quitar programa ${name}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Copybook ausente: además de nombrarlo, es una drop zone individual. */
function MissingCopybookChip({
  name,
  onFile,
}: {
  name: string
  onFile: (file: File, text: string) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <span
      className={`notice notice--missing missing-cpy${over ? ' missing-cpy--over' : ''}`}
      onDragOver={e => {
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const file = e.dataTransfer.files[0]
        if (file) void file.text().then(text => onFile(file, text))
      }}
      title={`Falta ${name}.cpy — arrástralo aquí para completar el esquema`}
    >
      <span className="missing-cpy__name">{name}.cpy</span>
      <span className="missing-cpy__hint">{over ? 'suelta' : 'arrástralo'}</span>
    </span>
  )
}

// ── Vista activa ────────────────────────────────────────────────────────

function ActiveView({
  view,
  flow,
  data,
  inventory,
  advisories,
  linked,
  facts,
  hasGraph,
  focusParagraph,
  onFocused,
  onJumpToParagraph,
  onOpenCode,
  explanation,
  onExplanation,
}: {
  view: View
  flow: FlowResult | undefined
  data: ParseResult | undefined
  inventory: Inventory | undefined
  advisories: Advisory[]
  linked: LinkedFlow | undefined
  facts: {
    data?: ParseResult | undefined
    flow?: FlowResult | undefined
    inventory?: Inventory | undefined
    advisories?: Advisory[] | undefined
  }
  hasGraph: boolean
  focusParagraph: string | undefined
  onFocused: () => void
  onJumpToParagraph: (p: string) => void
  onOpenCode: (line: number) => void
  explanation: Explanation | undefined
  onExplanation: (e: Explanation | undefined) => void
}): ReactNode {
  if (view === 'flow') {
    return hasGraph ? (
      <Suspense fallback={<CanvasLoading />}>
        <FlowCanvas
          flow={flow!}
          inventory={inventory}
          focusParagraph={focusParagraph}
          onFocused={onFocused}
          onOpenCode={onOpenCode}
        />
      </Suspense>
    ) : (
      <Empty title="No se ha encontrado flujo en el fuente." />
    )
  }
  if (view === 'chain') {
    return linked && linked.calls.length > 0 ? (
      <div className="chain">
        {linked.missingPrograms.length > 0 && (
          <div className="chain__missing">
            Programas llamados cuyo fuente no has aportado:{' '}
            <strong>{linked.missingPrograms.join(', ')}</strong> — arrástralos para completar la cadena.
          </div>
        )}
        <div className="chain__canvas">
          <Suspense fallback={<CanvasLoading />}>
            <ChainCanvas linked={linked} />
          </Suspense>
        </div>
      </div>
    ) : (
      <Empty
        title="Este programa no llama a ningún otro."
        hint="Arrastra más ficheros .cbl para ver cómo se encadenan entre sí."
      />
    )
  }
  if (view === 'data') return data ? <DataPanel data={data} /> : null
  if (view === 'inventory') return inventory ? <InventoryPanel inventory={inventory} onOpenCode={onOpenCode} /> : null
  if (view === 'advisories') {
    return (
      <AdvisoriesPanel
        advisories={advisories}
        onJumpToParagraph={onJumpToParagraph}
        onOpenCode={onOpenCode}
      />
    )
  }
  return (
    <ExplainPanel
      facts={facts}
      onJumpToParagraph={onJumpToParagraph}
      explanation={explanation}
      onExplanation={onExplanation}
    />
  )
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p>{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
    </div>
  )
}

/** Fallback mientras se carga el chunk del lienzo (elk + React Flow). */
function CanvasLoading() {
  return (
    <div className="empty" aria-live="polite">
      <p>Cargando el lienzo…</p>
    </div>
  )
}
