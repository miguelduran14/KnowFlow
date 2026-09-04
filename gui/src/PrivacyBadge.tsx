import { ShieldCheck, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

/**
 * Insignia de privacidad: un chip discreto en la topbar que abre un popover
 * bien maquetado con la promesa local-first / BYOK. Es el punto de venta para
 * una audiencia corporativa —dónde va el código, qué recibe el modelo, sin
 * backend— pero breve y a un clic, no el bloque legal pesado que se retiró.
 */
export function PrivacyBadge() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Esc y clic fuera cierran el popover.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // Captura: se dispara antes de que un hijo (p. ej. el canvas de React
    // Flow) pare la propagación del mousedown, para que el clic-fuera cierre
    // el popover también sobre el lienzo.
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open])

  return (
    <div className="privacy" ref={ref}>
      <button
        className={`privacy__chip${open ? ' privacy__chip--on' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Cómo se tratan tu código y tus credenciales"
      >
        <ShieldCheck size={14} weight="fill" />
        Local-first
      </button>
      {open && (
        <div className="privacy__pop" role="dialog" aria-label="Privacidad y seguridad">
          <div className="privacy__head">
            <ShieldCheck size={15} weight="fill" />
            <span>Privacidad · local-first</span>
            <button className="privacy__close" onClick={() => setOpen(false)} aria-label="Cerrar">
              <X size={13} weight="bold" />
            </button>
          </div>
          <ul className="privacy__points">
            <li>
              <b>Tu código no sale de esta máquina</b> salvo la llamada al proveedor de IA que tú
              configures (BYOK). Las claves viven solo en este navegador.
            </li>
            <li>
              <b>El modelo recibe solo los hechos verificados</b> por el parser — nunca el código
              fuente crudo.
            </li>
            <li>
              <b>Sin backend propio:</b> KnowFlow corre entero en tu navegador.
            </li>
          </ul>
          <p className="privacy__note">
            Enviar COBOL de clientes por un endpoint sigue siendo tu decisión: úsalo solo con código
            sintético/público o por un canal sancionado para ese código.
          </p>
        </div>
      )}
    </div>
  )
}
