import type { AssignmentEdge, ReferenceResult, TracePath, TraceResult, TraceStep } from './types.js'

/**
 * Traza transitiva de datos (P7): a partir de las aristas de propagación
 * de `collectReferences`, sigue de dónde VIENE el valor de un campo
 * (`upstream`) o a dónde VA (`downstream`), encadenando MOVE/COMPUTE/…
 * y los solapes REDEFINES.
 *
 * Insensible al orden de ejecución (decisión ratificada): cada arista es
 * un flujo POSIBLE en el fuente, no el que gana al final. La GUI lo rotula
 * "puede venir de / puede ir a". No modela el grafo de PERFORM/GO TO.
 *
 * Función pura: solo consume `ReferenceResult`. Con topes de profundidad
 * y de número de caminos, y detección de ciclos (COBOL tiene `ADD A TO A`
 * y realimentaciones A→B→A a cascoporro).
 */

const MAX_DEPTH = 8
const MAX_PATHS = 60

export function traceField(
  references: ReferenceResult,
  name: string,
  direction: 'upstream' | 'downstream',
): TraceResult {
  const target = name.toUpperCase()

  // Adyacencia por el extremo que toca al campo pedido: aguas arriba se
  // indexa por `to` y se salta a `from`; aguas abajo, al revés.
  const adj = new Map<string, AssignmentEdge[]>()
  const seen = new Set<string>()
  for (const edge of references.assignments) {
    const key = `${edge.from}|${edge.to}|${edge.verb}|${edge.line}|${edge.kind ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const pivot = direction === 'upstream' ? edge.to : edge.from
    const list = adj.get(pivot)
    if (list) list.push(edge)
    else adj.set(pivot, [edge])
  }

  const other = (edge: AssignmentEdge): string => (direction === 'upstream' ? edge.from : edge.to)

  const stepOf = (edge: AssignmentEdge): TraceStep => ({
    from: edge.from,
    to: edge.to,
    verb: edge.verb,
    line: edge.line,
    ...(edge.paragraph ? { paragraph: edge.paragraph } : {}),
    ...(edge.uncertain ? { uncertain: true } : {}),
    ...(edge.kind === 'redefines' ? { redefines: true } : {}),
  })

  const direct = (adj.get(target) ?? []).map(stepOf)

  const paths: TracePath[] = []
  let truncated = false

  const finish = (nodes: string[], steps: TraceStep[], extra: Partial<TracePath> = {}): void => {
    paths.push({
      nodes,
      steps,
      ...(steps.some(s => s.uncertain || s.redefines) ? { uncertain: true } : {}),
      ...extra,
    })
  }

  const walk = (node: string, nodes: string[], steps: TraceStep[]): void => {
    if (paths.length >= MAX_PATHS) {
      truncated = true
      return
    }
    const outs = adj.get(node) ?? []
    if (outs.length === 0) {
      if (steps.length > 0) finish(nodes, steps)
      return
    }
    if (steps.length >= MAX_DEPTH) {
      finish(nodes, steps, { truncated: true })
      return
    }
    for (const edge of outs) {
      if (paths.length >= MAX_PATHS) {
        truncated = true
        return
      }
      const nxt = other(edge)
      const step = stepOf(edge)
      if (nodes.includes(nxt)) {
        finish([...nodes, nxt], [...steps, step], { cyclic: true })
        continue
      }
      walk(nxt, [...nodes, nxt], [...steps, step])
    }
  }
  walk(target, [target], [])

  return { direct, paths, truncated }
}
