import {
  flowToMermaid,
  linkPrograms,
  linkedFlowToMermaid,
  parse,
  parseFlow,
  type FlowResult,
  type ParseResult,
} from 'knowflow'
import { useCallback, useMemo, useState, type DragEvent } from 'react'
import { ChainCanvas } from './ChainCanvas.js'
import { ExplainPanel } from './ExplainPanel.js'
import { FlowCanvas } from './FlowCanvas.js'
import { SchemaTable } from './SchemaTable.js'

const SAMPLE = `      * Programa sintético de ejemplo (no es código real de nadie).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DEMOFLOW.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REGISTRO.
         05 WS-CLAVE          PIC X(8).
         05 WS-IMPORTE        PIC S9(7)V99 COMP-3.
         05 WS-ESTADO         PIC X(1).
           88 WS-ACTIVO         VALUE 'A'.
           88 WS-CERRADO        VALUE 'C'.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM INIT-PARA
           PERFORM PROCESS-PARA UNTIL WS-EOF = 'Y'
           PERFORM REPORT-PARA
           STOP RUN.
       INIT-PARA.
           MOVE 0 TO WS-COUNT.
       PROCESS-PARA.
           PERFORM READ-NEXT-PARA
           CALL 'VALIDMOD' USING WS-REGISTRO
           ADD 1 TO WS-COUNT.
       READ-NEXT-PARA.
           DISPLAY 'READ'.
       REPORT-PARA.
           CALL WS-REPORT-PROG
           DISPLAY 'DONE'.
`

const MAIN_SOURCE = 'programa pegado'

type Tab = 'flow' | 'chain' | 'data' | 'explain'

export function App() {
  const [source, setSource] = useState('')
  const [copybooks, setCopybooks] = useState<Map<string, string>>(new Map())
  const [others, setOthers] = useState<Map<string, string>>(new Map())
  const [tab, setTab] = useState<Tab>('flow')

  const flow: FlowResult | undefined = useMemo(
    () => (source.trim() === '' ? undefined : parseFlow(source)),
    [source],
  )

  const data: ParseResult | undefined = useMemo(
    () => (source.trim() === '' ? undefined : parse(source, copybooks)),
    [source, copybooks],
  )

  // Identidad estable mientras los hechos no cambien: ExplainPanel la usa
  // para descartar una explicación que ya no corresponde al fuente.
  const facts = useMemo(() => ({ data, flow }), [data, flow])

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
          {data && data.missingCopybooks.length > 0 && (
            <span className="notice notice--missing">
              Copybooks ausentes: {data.missingCopybooks.join(', ')}
            </span>
          )}
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
                <FlowCanvas flow={flow} />
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
            ) : (
              <ExplainPanel facts={facts} />
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
