import { flowToMermaid, parseFlow, type FlowResult } from 'knowflow'
import { useCallback, useMemo, useState, type DragEvent } from 'react'
import { FlowCanvas } from './FlowCanvas.js'

const SAMPLE = `      * Programa sintético de ejemplo (no es código real de nadie).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DEMOFLOW.
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
           CALL 'VALIDMOD' USING WS-RECORD
           ADD 1 TO WS-COUNT.
       READ-NEXT-PARA.
           DISPLAY 'READ'.
       REPORT-PARA.
           CALL WS-REPORT-PROG
           DISPLAY 'DONE'.
`

export function App() {
  const [source, setSource] = useState('')

  const flow: FlowResult | undefined = useMemo(() => {
    if (source.trim() === '') return undefined
    return parseFlow(source)
  }, [source])

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return
    void file.text().then(setSource)
  }, [])

  const copyMermaid = useCallback(() => {
    if (!flow) return
    void navigator.clipboard.writeText(flowToMermaid(flow))
  }, [flow])

  const hasGraph = flow !== undefined && flow.paragraphs.length > 0

  return (
    <div className="app" onDrop={onDrop} onDragOver={e => e.preventDefault()}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">KnowFlow</span>
          <span className="brand__tag">flujo del programa · hechos verificados por parser</span>
        </div>
        <div className="actions">
          <button onClick={() => setSource(SAMPLE)}>Cargar ejemplo</button>
          <button onClick={copyMermaid} disabled={!hasGraph}>
            Copiar Mermaid
          </button>
          <button onClick={() => setSource('')} disabled={source === ''}>
            Limpiar
          </button>
        </div>
      </header>

      {flow && (
        <div className="notices">
          {flow.fragment && (
            <span className="notice notice--warn">
              ⚠ Fragmento sin PROCEDURE DIVISION — parcialmente verificado
            </span>
          )}
          {flow.missingTargets.length > 0 && (
            <span className="notice notice--missing">
              Destinos no encontrados: {flow.missingTargets.join(', ')}
            </span>
          )}
          {flow.programId && <span className="notice">PROGRAM-ID: {flow.programId}</span>}
        </div>
      )}

      <main className="content">
        <section className="editor">
          <textarea
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder={
              'Pega aquí un programa COBOL (o un fragmento), o arrastra un fichero.\n\n' +
              'Recuerda: solo COBOL sintético o público — nunca código de clientes.'
            }
            spellCheck={false}
          />
        </section>
        <section className="canvas">
          {hasGraph ? (
            <FlowCanvas flow={flow} />
          ) : (
            <div className="empty">
              <p>El diagrama aparecerá aquí.</p>
              <p className="empty__hint">
                Todo lo que veas viene de hechos extraídos por el parser — nada lo inventa un modelo.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
