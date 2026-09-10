import type { ParseResult, ReferenceResult } from '@miguelduran14/knowflow'
import { useState } from 'react'
import { ByteMap } from './ByteMap.js'
import { SchemaTable } from './SchemaTable.js'

type Mode = 'map' | 'table'

/**
 * Vista Datos: alterna entre el MAPA DE BYTES (representación estrella del
 * esquema, por defecto) y la TABLA clásica (alternativa accesible, siempre
 * disponible — regla de data-viz: el gráfico no sustituye a la tabla).
 *
 * `references` (where-used por campo) alimenta el panel de usos que aparece
 * en la ficha FIJADA del Mapa de bytes: al fijar un campo se ve dónde se
 * lee y dónde se escribe, con saltos a Flujo y al código.
 */
export function DataPanel({
  data,
  references,
  onJumpToParagraph,
  onOpenCode,
}: {
  data: ParseResult
  references?: ReferenceResult | undefined
  onJumpToParagraph?: ((name: string) => void) | undefined
  onOpenCode?: ((line: number) => void) | undefined
}) {
  const [mode, setMode] = useState<Mode>('map')
  return (
    <div className="datapanel">
      <div className="datapanel__toggle" role="group" aria-label="Vista de datos">
        <button
          className={mode === 'map' ? 'seg-btn seg-btn--on' : 'seg-btn'}
          aria-pressed={mode === 'map'}
          onClick={() => setMode('map')}
        >
          Mapa de bytes
        </button>
        <button
          className={mode === 'table' ? 'seg-btn seg-btn--on' : 'seg-btn'}
          aria-pressed={mode === 'table'}
          onClick={() => setMode('table')}
        >
          Tabla
        </button>
      </div>
      {mode === 'map' ? (
        <ByteMap
          data={data}
          references={references}
          onJumpToParagraph={onJumpToParagraph}
          onOpenCode={onOpenCode}
        />
      ) : (
        <SchemaTable data={data} />
      )}
    </div>
  )
}
