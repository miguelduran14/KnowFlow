import type { ParseResult } from 'knowflow'
import { useState } from 'react'
import { ByteMap } from './ByteMap.js'
import { SchemaTable } from './SchemaTable.js'

type Mode = 'map' | 'table'

/**
 * Vista Datos: alterna entre el MAPA DE BYTES (representación estrella del
 * esquema, por defecto) y la TABLA clásica (alternativa accesible, siempre
 * disponible — regla de data-viz: el gráfico no sustituye a la tabla).
 */
export function DataPanel({ data }: { data: ParseResult }) {
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
      {mode === 'map' ? <ByteMap data={data} /> : <SchemaTable data={data} />}
    </div>
  )
}
