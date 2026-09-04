import { useEffect, useRef, useState } from 'react'

/**
 * Resuelve tokens del tema (variables CSS de `:root`) a valores concretos y
 * se re-ejecuta cuando cambia el tema. React Flow recibe el color del trazo
 * de la arista como string inline —no CSS—, así que no hereda las variables
 * por cascada: hay que resolverlas a mano. `read` recibe un lector
 * `v('--token')` y devuelve el objeto de colores que el lienzo necesite.
 *
 * Compartido por FlowCanvas y ChainCanvas para que ambos lienzos respeten
 * el tema (claro/oscuro) sin duplicar la lógica del observador.
 */
export function useThemeTokens<T>(read: (v: (name: string) => string) => T): T {
  // `read` se guarda en un ref para que el observador use siempre la última
  // versión sin re-suscribirse en cada render.
  const readRef = useRef(read)
  readRef.current = read

  const resolve = (): T => {
    const cs = getComputedStyle(document.documentElement)
    return readRef.current(name => cs.getPropertyValue(name).trim())
  }

  const [tokens, setTokens] = useState<T>(resolve)

  useEffect(() => {
    const refresh = () => setTokens(resolve())
    // El toggle estampa data-theme en <html>; el prefers-color-scheme cubre
    // el modo "sistema" cuando el usuario no ha forzado tema.
    const obs = new MutationObserver(refresh)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', refresh)
    return () => {
      obs.disconnect()
      mq.removeEventListener('change', refresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return tokens
}
