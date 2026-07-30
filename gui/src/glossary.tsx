import { GLOSSARY_BY_ID, segmentText, type GlossaryEntry } from 'knowflow'
import { motion, useReducedMotion } from 'framer-motion'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Contexto del glosario: dos únicos objetos compartidos por toda la app.
 * `openTerm` abre el cajón lateral con la ficha completa; `learn` controla
 * si los términos llevan afordancia visual (highlight menta) o solo hover.
 * Vive alto en el árbol para que el cajón sea uno solo (no uno por
 * componente) y se mantenga al cambiar de pestaña.
 */
interface GlossaryCtx {
  openTerm: (id: string) => void
  learn: boolean
  setLearn: (v: boolean) => void
}

const Ctx = createContext<GlossaryCtx | undefined>(undefined)

const LEARN_STORAGE = 'knowflow.learnMode'

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | undefined>()
  const [learn, setLearnState] = useState<boolean>(() => {
    const stored = localStorage.getItem(LEARN_STORAGE)
    return stored === null ? true : stored === '1'
  })
  const reduce = useReducedMotion()

  const setLearn = (v: boolean) => {
    setLearnState(v)
    localStorage.setItem(LEARN_STORAGE, v ? '1' : '0')
  }

  // Escape cierra el cajón — comportamiento estándar de un dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(undefined)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const entry = openId ? GLOSSARY_BY_ID[openId] : undefined

  return (
    <Ctx.Provider value={{ openTerm: setOpenId, learn, setLearn }}>
      {children}
      {/* Sin AnimatePresence: cuando cerraba el drawer, AnimatePresence
          mantenía el elemento en el DOM esperando el "exit" y ese exit
          nunca terminaba (bug conocido con motion.aside + spring hacia
          x:'100%'). Prefiero cierre inmediato garantizado a una salida
          suave que a veces no ocurre. La ENTRADA sigue con motion (spring
          desde la derecha), que es la que aporta el gesto Framer Motion
          real; en la salida el CSS decide (opacity 0 vía clase, si acaso).
      */}
      {entry && (
        <motion.div
          key="scrim"
          className="glo-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
          onClick={() => setOpenId(undefined)}
        />
      )}
      {entry && (
        <motion.aside
          key={`drawer-${entry.id}`}
          className="glo-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`Ficha del término ${entry.term}`}
          initial={reduce ? false : { x: '100%', opacity: 0.3 }}
          animate={{ x: 0, opacity: 1 }}
          transition={
            reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }
          }
        >
              <button
                type="button"
                className="glo-drawer__close"
                onClick={() => setOpenId(undefined)}
                aria-label="Cerrar"
              >
                ×
              </button>
              <div className="glo-drawer__eyebrow">Glosario COBOL</div>
              <h3 className="glo-drawer__term">{entry.term}</h3>
              <div className="glo-drawer__sub">{entry.sub}</div>

              <h4>Qué es</h4>
              <p>{entry.what}</p>

              <h4>Por qué existe</h4>
              <p>{entry.why}</p>

              <h4>Ejemplo</h4>
              <pre className="glo-drawer__ex">{entry.example}</pre>

              {entry.gotcha && (
                <>
                  <h4>Ojo si lo mantienes</h4>
                  <div className="glo-drawer__gotcha">{entry.gotcha}</div>
                </>
              )}
        </motion.aside>
      )}
    </Ctx.Provider>
  )
}

/** Hook local: se lanza en cualquier componente dentro del provider. */
export function useGlossary(): GlossaryCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useGlossary debe llamarse dentro de <GlossaryProvider>')
  return ctx
}

/**
 * Botón para un solo término, con tooltip nativo por hover.
 * En modo aprendiz lleva un highlight menta que anuncia "aquí hay algo"
 * (sin interrogante, como pidió Miguel); apagado se ve como texto normal
 * y solo revela la ayuda al pasar el ratón.
 */
function TermButton({ entry, text }: { entry: GlossaryEntry; text: string }) {
  const { openTerm, learn } = useGlossary()
  return (
    <button
      type="button"
      className={learn ? 'term term--learn' : 'term'}
      onClick={() => openTerm(entry.id)}
      title={entry.short}
    >
      {text}
    </button>
  )
}

/**
 * Renderiza un texto libre convirtiendo los términos del glosario en
 * botones. Fuera del provider degrada a texto plano — importante para no
 * romper si algún componente se monta antes que el provider.
 */
export function GlossaryText({ text }: { text: string }) {
  const ctx = useContext(Ctx)
  if (!ctx) return <>{text}</>
  const segs = segmentText(text)
  return (
    <>
      {segs.map((s, i) =>
        s.term ? <TermButton key={i} entry={s.term} text={s.text} /> : <span key={i}>{s.text}</span>,
      )}
    </>
  )
}
