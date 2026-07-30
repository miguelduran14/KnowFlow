import {
  flowToMermaid,
  linkPrograms,
  linkedFlowToMermaid,
  parse,
  parseFlow,
  parseInventory,
  type Explanation,
  type FlowResult,
  type Inventory,
  type ParseResult,
} from 'knowflow'
import { useCallback, useMemo, useState, type DragEvent } from 'react'
import { ChainCanvas } from './ChainCanvas.js'
import { ExplainPanel } from './ExplainPanel.js'
import { FlowCanvas } from './FlowCanvas.js'
import { GlossaryProvider, useGlossary } from './glossary.js'
import { InventoryPanel } from './InventoryPanel.js'
import { SchemaTable } from './SchemaTable.js'

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

type Tab = 'flow' | 'chain' | 'data' | 'inventory' | 'explain'

export function App() {
  return (
    <GlossaryProvider>
      <AppShell />
    </GlossaryProvider>
  )
}

/**
 * Chip para un copybook que falta: además de nombrarlo, es una drop zone
 * individual. El usuario arrastra el .cpy exacto sobre este chip y el
 * hueco se rellena; sin salir del contexto del programa.
 */
function MissingCopybookChip({
  name,
  onFile,
}: {
  name: string
  onFile: (file: File, text: string) => void
}) {
  const [over, setOver] = useState(false)
  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    void file.text().then(text => onFile(file, text))
  }
  return (
    <span
      className={`notice notice--missing missing-cpy${over ? ' missing-cpy--over' : ''}`}
      onDragOver={e => {
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      title={`Falta ${name}.cpy — arrástralo aquí para completar el esquema`}
    >
      <span className="missing-cpy__name">{name}.cpy</span>
      <span className="missing-cpy__hint">{over ? 'suelta aquí' : 'arrástralo'}</span>
    </span>
  )
}

/** Toggle del modo aprendiz — consume el contexto del glosario. */
function LearnToggle() {
  const { learn, setLearn } = useGlossary()
  return (
    <label className="learn-toggle" title="Marcar los términos COBOL con highlight y activar la ayuda al pasar el ratón">
      <input type="checkbox" checked={learn} onChange={e => setLearn(e.target.checked)} />
      <span className="learn-toggle__track" />
      <span className="learn-toggle__label">Modo aprendiz</span>
    </label>
  )
}

function AppShell() {
  const [source, setSource] = useState('')
  const [copybooks, setCopybooks] = useState<Map<string, string>>(new Map())
  const [others, setOthers] = useState<Map<string, string>>(new Map())
  const [tab, setTab] = useState<Tab>('flow')
  // Párrafo al que se debe saltar cuando se cambia a la pestaña Flujo,
  // set desde el dossier al hacer clic en el chip de la etapa. El propio
  // FlowCanvas lo limpia tras consumirlo, así que un segundo clic vuelve
  // a disparar el foco aunque sea el mismo destino.
  const [focusParagraph, setFocusParagraph] = useState<string | undefined>()
  // La explicación vive aquí (no en ExplainPanel) para que sobreviva a los
  // cambios de pestaña: si el usuario salta a Flujo a verificar un párrafo
  // y vuelve, no queremos hacerle pagar otra llamada a la IA. Se limpia
  // cuando cambian los hechos (el useEffect vive en ExplainPanel).
  const [explanation, setExplanation] = useState<Explanation | undefined>()

  const jumpToParagraph = useCallback((name: string) => {
    setFocusParagraph(name)
    setTab('flow')
  }, [])

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

  // Identidad estable mientras los hechos no cambien: ExplainPanel la usa
  // para descartar una explicación que ya no corresponde al fuente.
  const facts = useMemo(() => ({ data, flow, inventory }), [data, flow, inventory])

  const linked = useMemo(() => {
    if (source.trim() === '') return undefined
    const sources = new Map<string, string>([[MAIN_SOURCE, source], ...others])
    return linkPrograms(sources)
  }, [source, others])

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    const files = [...event.dataTransfer.files]
    for (const [index, file] of files.entries()) {
      void file.text().then(text => {
        if (/\.(cpy|copy)$/i.test(file.name)) {
          const member = file.name.replace(/\.(cpy|copy)$/i, '').toUpperCase()
          setCopybooks(prev => new Map(prev).set(member, text))
        } else if (index === 0) {
          // El primer programa soltado pasa al editor; los demás se suman
          // a la cadena sin pisar lo que estás mirando.
          setSource(text)
        } else {
          setOthers(prev => new Map(prev).set(file.name, text))
        }
      })
    }
  }, [])

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
    if (tab === 'chain' && linked) {
      void navigator.clipboard.writeText(linkedFlowToMermaid(linked))
      return
    }
    if (flow) void navigator.clipboard.writeText(flowToMermaid(flow))
  }, [tab, linked, flow])

  const hasGraph = flow !== undefined && flow.paragraphs.length > 0
  const hasSource = source.trim() !== ''

  return (
    <div className="app" onDrop={onDrop} onDragOver={e => e.preventDefault()}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">KnowFlow</span>
          <span className="brand__tag">hechos verificados por parser · explicación con IA encima</span>
        </div>
        <div className="actions">
          <LearnToggle />
          <button onClick={() => setSource(SAMPLE)}>Cargar ejemplo</button>
          <button onClick={copyMermaid} disabled={!hasGraph}>
            Copiar Mermaid
          </button>
          <button
            onClick={() => {
              setSource('')
              setCopybooks(new Map())
              setOthers(new Map())
            }}
            disabled={!hasSource && copybooks.size === 0 && others.size === 0}
          >
            Limpiar
          </button>
        </div>
      </header>

      {(flow || data) && (
        <div className="notices">
          {flow?.programId && <span className="notice">PROGRAM-ID: {flow.programId}</span>}
          {flow?.fragment && (
            <span className="notice notice--warn">
              ⚠ Fragmento sin PROCEDURE DIVISION — parcialmente verificado
            </span>
          )}
          {flow && flow.missingTargets.length > 0 && (
            <span className="notice notice--missing">
              Destinos no encontrados: {flow.missingTargets.join(', ')}
            </span>
          )}
          {flow && flow.nestedPrograms.length > 0 && (
            <span className="notice notice--warn">
              ⚠ Programas anidados sin analizar: {flow.nestedPrograms.join(', ')}
            </span>
          )}
          {data?.missingCopybooks.map(name => (
            <MissingCopybookChip key={name} name={name} onFile={(file, text) => {
              const member = file.name.replace(/\.(cpy|copy)$/i, '').toUpperCase()
              setCopybooks(prev => new Map(prev).set(member, text))
            }} />
          ))}
          {[...copybooks.keys()].map(member => (
            <span key={member} className="notice notice--copybook">
              {member}.cpy
              <button className="chip-close" onClick={() => removeCopybook(member)} title="Quitar">
                ×
              </button>
            </span>
          ))}
          {[...others.keys()].map(name => (
            <span key={name} className="notice notice--program">
              {name}
              <button className="chip-close" onClick={() => removeProgram(name)} title="Quitar">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <main className="content">
        <section className="editor">
          <textarea
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder={
              'Pega aquí un programa COBOL (o un fragmento), o arrastra ficheros.\n' +
              'Los .cpy se usan como copybooks; otros programas .cbl se añaden a la cadena.\n\n' +
              'Recuerda: solo COBOL sintético o público — nunca código de clientes.'
            }
            spellCheck={false}
          />
        </section>
        <section className="panel">
          <nav className="tabs">
            <button className={tab === 'flow' ? 'tab tab--active' : 'tab'} onClick={() => setTab('flow')}>
              Flujo
            </button>
            <button className={tab === 'chain' ? 'tab tab--active' : 'tab'} onClick={() => setTab('chain')}>
              Cadena
            </button>
            <button className={tab === 'data' ? 'tab tab--active' : 'tab'} onClick={() => setTab('data')}>
              Datos
            </button>
            <button
              className={tab === 'inventory' ? 'tab tab--active' : 'tab'}
              onClick={() => setTab('inventory')}
            >
              Qué toca
            </button>
            <button
              className={tab === 'explain' ? 'tab tab--active' : 'tab'}
              onClick={() => setTab('explain')}
            >
              Explicación
            </button>
          </nav>
          <div className="panel__body">
            {!hasSource ? (
              <div className="empty">
                <p>El análisis aparecerá aquí.</p>
                <p className="empty__hint">
                  Todo lo que veas viene de hechos extraídos por el parser — nada lo inventa un modelo.
                </p>
              </div>
            ) : tab === 'flow' ? (
              hasGraph ? (
                <FlowCanvas flow={flow} focusParagraph={focusParagraph} onFocused={() => setFocusParagraph(undefined)} />
              ) : (
                <div className="empty">
                  <p>No se ha encontrado flujo en el fuente.</p>
                </div>
              )
            ) : tab === 'chain' ? (
              linked && linked.calls.length > 0 ? (
                <div className="chain">
                  {linked.missingPrograms.length > 0 && (
                    <div className="chain__missing">
                      Programas llamados cuyo fuente no has aportado:{' '}
                      <strong>{linked.missingPrograms.join(', ')}</strong> — arrástralos para
                      completar la cadena.
                    </div>
                  )}
                  <div className="chain__canvas">
                    <ChainCanvas linked={linked} />
                  </div>
                </div>
              ) : (
                <div className="empty">
                  <p>Este programa no llama a ningún otro.</p>
                  <p className="empty__hint">
                    Arrastra más ficheros .cbl para ver cómo se encadenan entre sí.
                  </p>
                </div>
              )
            ) : tab === 'data' ? (
              data ? (
                <SchemaTable data={data} />
              ) : null
            ) : tab === 'inventory' ? (
              inventory ? (
                <InventoryPanel inventory={inventory} />
              ) : null
            ) : (
              <ExplainPanel
                facts={facts}
                onJumpToParagraph={jumpToParagraph}
                explanation={explanation}
                onExplanation={setExplanation}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
