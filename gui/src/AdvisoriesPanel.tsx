import type { Advisory } from '@miguelduran14/knowflow'
import { Code } from '@phosphor-icons/react'

/**
 * "Cuidado con esto" — trampas de mantenimiento COBOL ya verificadas por
 * el parser (no interpretaciones nuevas): un STOP RUN que corta el job
 * entero desde un subprograma, un UPDATE sin WHERE, un fichero o cursor
 * que se abre y nunca se cierra. Distinto del resto de paneles: aquí no
 * hay nada "no verificado" — todo esto SÍ está en el fuente, es solo
 * arriesgado. Ver `checkAdvisories` en el motor.
 */
export function AdvisoriesPanel({
  advisories,
  onJumpToParagraph,
  onOpenCode,
}: {
  advisories: Advisory[]
  onJumpToParagraph?: ((paragraph: string) => void) | undefined
  onOpenCode?: ((line: number) => void) | undefined
}) {
  if (advisories.length === 0) {
    return (
      <div className="empty">
        <p>No se ha detectado ninguna de las trampas de mantenimiento conocidas.</p>
        <p className="empty__hint">
          Se comprueban patrones concretos y verificados (STOP RUN en subprogramas, UPDATE/DELETE
          sin WHERE, GO TO entre secciones, ficheros y cursores sin cerrar) — no es una auditoría
          exhaustiva del programa.
        </p>
      </div>
    )
  }

  return (
    <div className="advisories">
      <div className="schema__fidelity schema__fidelity--partial">
        {advisories.length} {advisories.length === 1 ? 'aviso' : 'avisos'} — trampas de
        mantenimiento ya verificadas contra el fuente, no huecos de fidelidad.
      </div>
      <ul className="adv-list">
        {advisories.map((advisory, i) => (
          <li key={i} className="adv-card">
            <div className="adv-card__head">
              <span className="adv-card__title">{advisory.title}</span>
              <div className="adv-card__jumps">
                {advisory.paragraph && (
                  <button
                    type="button"
                    className="wt__para-chip"
                    onClick={() => onJumpToParagraph?.(advisory.paragraph!)}
                    title="Ver este párrafo en el diagrama de Flujo"
                  >
                    {advisory.paragraph}
                  </button>
                )}
                {advisory.line > 0 && onOpenCode && (
                  <button
                    type="button"
                    className="wt__para-chip wt__para-chip--code"
                    onClick={() => onOpenCode(advisory.line)}
                    title="Ver esta línea en el código"
                  >
                    <Code size={12} weight="bold" /> L{advisory.line}
                  </button>
                )}
                {advisory.line > 0 && !onOpenCode && !advisory.paragraph && (
                  <span className="wt__para-chip wt__para-chip--static">L{advisory.line}</span>
                )}
              </div>
            </div>
            <p className="adv-card__msg">{advisory.message}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
