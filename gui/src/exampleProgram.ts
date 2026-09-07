// La cadena de ejemplo vive en `examples/` (raíz del repo), para que sea
// descubrible en GitHub y la compartan los tests del motor. Aquí se
// empaqueta con `?raw` — el botón "Cargar ejemplo" la inyecta por la
// misma vía que un drag-drop del usuario.
import ctamov01 from '../../examples/ctamov01.cbl?raw'
import ctamovfd from '../../examples/ctamovfd.cpy?raw'
import estados from '../../examples/estados.cpy?raw'
import fecha01 from '../../examples/fecha01.cbl?raw'
import sqlca from '../../examples/sqlca.cpy?raw'
import valida01 from '../../examples/valida01.cbl?raw'

export interface ExampleSet {
  /** Programa principal (el que va a `source`) */
  source: string
  /** Copybooks por nombre de member (en MAYÚSCULAS, como los indexa la app) */
  copybooks: Record<string, string>
  /** Otros programas de la cadena, por nombre de fichero */
  others: Record<string, string>
}

export const EXAMPLE: ExampleSet = {
  source: ctamov01,
  copybooks: { CTAMOVFD: ctamovfd, ESTADOS: estados, SQLCA: sqlca },
  others: { 'valida01.cbl': valida01, 'fecha01.cbl': fecha01 },
}
