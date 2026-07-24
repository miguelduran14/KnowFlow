import { parseFlow } from './flow-parser.js'
import type { CrossProgramCall, LinkedFlow, LinkedProgram } from './types.js'

/** COBOL es case-insensitive: los nombres de programa se comparan en mayúsculas */
function key(name: string): string {
  return name.toUpperCase()
}

/**
 * Encadena varios programas COBOL: extrae el flujo de cada uno y resuelve
 * qué CALL cruzan de un programa a otro de los aportados.
 *
 * Reglas de honestidad (ADR-0003):
 * - Un CALL dinámico (`CALL WS-VARIABLE`) NUNCA se resuelve, aunque exista
 *   un programa con ese nombre: el destino real depende del valor de la
 *   variable en ejecución, y elegir uno sería inventar el flujo.
 * - Un CALL literal a un programa no aportado se marca como no resuelto y
 *   se lista en `missingPrograms` — eso le dice al usuario exactamente qué
 *   fuente le falta por bajar del PDS.
 *
 * `sources` mapea nombre de fichero -> contenido. La identidad de cada
 * programa es su PROGRAM-ID si lo declara; si no, el nombre del fichero.
 */
export function linkPrograms(sources: Map<string, string>): LinkedFlow {
  const programs: LinkedProgram[] = []

  for (const [sourceName, text] of sources) {
    const flow = parseFlow(text)
    const fallback = sourceName.replace(/\.[^.]+$/, '')
    programs.push({
      name: flow.programId ?? fallback,
      sourceName,
      flow,
    })
  }

  const byName = new Set(programs.map(p => key(p.name)))
  const calls: CrossProgramCall[] = []
  const missingPrograms: string[] = []

  for (const program of programs) {
    for (const edge of program.flow.edges) {
      if (edge.kind !== 'call') continue

      const dynamic = edge.dynamic === true
      const resolved = !dynamic && byName.has(key(edge.to))

      if (!dynamic && !resolved && !missingPrograms.includes(edge.to)) {
        missingPrograms.push(edge.to)
      }

      calls.push({
        fromProgram: program.name,
        fromParagraph: edge.from,
        toProgram: edge.to,
        resolved,
        dynamic,
        line: edge.line,
      })
    }
  }

  return { programs, calls, missingPrograms }
}
