// Arnés de desarrollo (no-producto, ADR-0002): imprime los hechos de
// flujo y el diagrama Mermaid de un fichero COBOL.
//   npx tsx harness/flow.ts <fichero.cbl> [--json]
import { readFileSync } from 'node:fs'
import { parseFlow } from '../src/flow-parser.js'
import { flowToMermaid } from '../src/mermaid.js'

const [file, flag] = process.argv.slice(2)
if (!file) {
  console.error('uso: npx tsx harness/flow.ts <fichero.cbl> [--json]')
  process.exit(1)
}

const flow = parseFlow(readFileSync(file, 'utf-8'))

if (flag === '--json') {
  console.log(JSON.stringify(flow, null, 2))
} else {
  console.log(flowToMermaid(flow))
  if (flow.fragment) console.error('aviso: fragmento sin PROCEDURE DIVISION — parcialmente verificado')
  if (flow.missingTargets.length > 0) console.error(`aviso: destinos no encontrados: ${flow.missingTargets.join(', ')}`)
}
