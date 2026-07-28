import { describe, expect, it } from 'vitest'
import { parseFlow } from '../src/flow-parser.js'
import type { FlowEdge } from '../src/types.js'

/** Aristas como "DESTINO [guarda AND guarda]" — legible de un vistazo */
function summarize(edges: FlowEdge[]): string[] {
  return edges.map(e => (e.guards ? `${e.to} [${e.guards.join(' AND ')}]` : e.to))
}

function flowOf(...lines: string[]): FlowEdge[] {
  return parseFlow(['       PROCEDURE DIVISION.', '       MAIN-PARA.', ...lines].join('\n')).edges
}

describe('guardas IF/EVALUATE en las aristas de flujo', () => {
  it('el punto cierra un IF sin END-IF', () => {
    const edges = flowOf(
      "           IF WS-A = 1 PERFORM P-ONE ELSE PERFORM P-TWO.",
      '           PERFORM P-THREE.',
    )
    expect(summarize(edges)).toEqual([
      'P-ONE [WS-A = 1]',
      'P-TWO [NOT (WS-A = 1)]',
      'P-THREE',
    ])
  })

  it('una condición partida en varias líneas se acumula entera', () => {
    const edges = flowOf(
      '           IF WS-A = 1',
      '              AND WS-B NOT = SPACES',
      '               PERFORM BOTH',
      '           END-IF.',
    )
    expect(summarize(edges)).toEqual(['BOTH [WS-A = 1 AND WS-B NOT = SPACES]'])
  })

  it('varios WHEN seguidos comparten rama y se unen con OR', () => {
    const edges = flowOf(
      '           EVALUATE WS-TIPO',
      "               WHEN 'B'",
      "               WHEN 'C'",
      '                   PERFORM DO-BC',
      '           END-EVALUATE.',
    )
    expect(summarize(edges)).toEqual(["DO-BC [WS-TIPO = 'B' OR WS-TIPO = 'C']"])
  })

  it('EVALUATE TRUE usa la condición del WHEN tal cual', () => {
    const edges = flowOf(
      '           EVALUATE TRUE',
      '               WHEN WS-N > 100',
      '                   PERFORM BIG',
      '           END-EVALUATE.',
    )
    expect(summarize(edges)).toEqual(['BIG [WS-N > 100]'])
  })

  // El enmascarado de literales ya protege los verbos; aquí se comprueba
  // que también protege los tokens de control — un IF citado en un DISPLAY
  // no puede abrir una rama que el programa no tiene (ADR-0003).
  it('un IF dentro de un literal no abre rama', () => {
    const edges = flowOf(
      "           DISPLAY 'IF WS-A = 1'",
      '           PERFORM P-ONE.',
    )
    expect(summarize(edges)).toEqual(['P-ONE'])
  })

  it('un WHEN fuera de EVALUATE (SEARCH) no inventa guarda', () => {
    const edges = flowOf(
      '           SEARCH WS-TABLA',
      '               WHEN WS-ITEM = WS-CLAVE',
      '                   PERFORM FOUND',
      '           END-SEARCH.',
    )
    expect(summarize(edges)).toEqual(['FOUND'])
  })

  it('una sentencia fuera de toda rama no lleva guardas', () => {
    const edges = flowOf(
      '           IF WS-A = 1',
      '               PERFORM INSIDE',
      '           END-IF',
      '           PERFORM OUTSIDE.',
    )
    const outside = edges.find(e => e.to === 'OUTSIDE')
    expect(outside?.guards).toBeUndefined()
  })
})
