import { describe, expect, it } from 'vitest'
import { parseFlow } from '../src/flow-parser.js'

/**
 * Regresión del hallazgo del corpus (AWS CardDemo): los nombres de párrafo
 * con prefijo numérico (0000-, 1000-, 9999-) dejaban al parser de flujo
 * viendo 1 párrafo en programas de cientos de líneas.
 */
describe('párrafos con nombre numérico', () => {
  const flow = parseFlow(
    [
      '       PROCEDURE DIVISION.',
      '       0000-MAIN.',
      '           PERFORM 1000-INIT',
      "           PERFORM 2000-LOOP UNTIL WS-EOF = 'Y'",
      '           GOBACK.',
      '       1000-INIT.',
      '           MOVE 0 TO WS-COUNT.',
      '       2000-LOOP.',
      '           PERFORM 2100-STEP THRU 2100-STEP-EXIT.',
      '       2100-STEP.',
      "           DISPLAY 'STEP'.",
      '       2100-STEP-EXIT.',
      '           EXIT.',
    ].join('\n'),
  )

  it('reconoce cada párrafo con prefijo numérico como cabecera', () => {
    expect(flow.paragraphs.map(p => p.name)).toEqual([
      '0000-MAIN',
      '1000-INIT',
      '2000-LOOP',
      '2100-STEP',
      '2100-STEP-EXIT',
    ])
    expect(flow.paragraphs.some(p => p.implicit)).toBe(false)
  })

  it('resuelve los PERFORM a destinos numéricos, incluido THRU', () => {
    const perform = flow.edges.filter(e => e.kind === 'perform')
    expect(perform.map(e => `${e.from}->${e.to}${e.thru ? ' THRU ' + e.thru : ''}`)).toEqual([
      '0000-MAIN->1000-INIT',
      '0000-MAIN->2000-LOOP',
      '2000-LOOP->2100-STEP THRU 2100-STEP-EXIT',
    ])
    expect(flow.missingTargets).toEqual([])
  })

  it('PERFORM <n> TIMES no fabrica un destino con el contador', () => {
    const f = parseFlow(
      [
        '       PROCEDURE DIVISION.',
        '       0000-MAIN.',
        '           PERFORM 3 TIMES',
        '               ADD 1 TO WS-X',
        '           END-PERFORM.',
      ].join('\n'),
    )
    // No hay párrafo "3" ni arista a "3": el 3 es el contador del bucle.
    expect(f.edges.filter(e => e.kind === 'perform')).toEqual([])
    expect(f.missingTargets).toEqual([])
  })

  it('un GO TO a destino numérico se resuelve', () => {
    const f = parseFlow(
      [
        '       PROCEDURE DIVISION.',
        '       0000-MAIN.',
        '           GO TO 9999-ABEND.',
        '       9999-ABEND.',
        "           DISPLAY 'ABEND'.",
      ].join('\n'),
    )
    const goto = f.edges.find(e => e.kind === 'goto')
    expect(goto?.to).toBe('9999-ABEND')
    expect(f.missingTargets).toEqual([])
  })
})
