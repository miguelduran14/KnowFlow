import { describe, expect, it } from 'vitest'
import { traceField } from '../src/dataflow.js'
import { parse } from '../src/parser.js'
import { collectReferences } from '../src/references.js'
import type { ReferenceResult } from '../src/types.js'

function refs(dataLines: string[], procLines: string[]): ReferenceResult {
  const src = [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. DF.',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    ...dataLines,
    '       PROCEDURE DIVISION.',
    ...procLines,
  ].join('\n')
  return collectReferences(src, parse(src))
}

const S = [
  '       01  WS-A   PIC S9(5).',
  '       01  WS-B   PIC S9(5).',
  '       01  WS-C   PIC S9(5).',
  '       01  WS-D   PIC S9(5).',
]

describe('traceField: aguas arriba (de dónde viene)', () => {
  it('encadena MOVE A→B→C: la traza de C llega hasta A', () => {
    const r = refs(S, ['       P.', '           MOVE WS-A TO WS-B.', '           MOVE WS-B TO WS-C.'])
    const t = traceField(r, 'WS-C', 'upstream')
    expect(t.direct.map(s => s.from)).toEqual(['WS-B'])
    // Un camino WS-C ← WS-B ← WS-A
    const full = t.paths.find(p => p.nodes.length === 3)!
    expect(full.nodes).toEqual(['WS-C', 'WS-B', 'WS-A'])
    expect(full.steps.map(s => `${s.from}->${s.to}`)).toEqual(['WS-B->WS-C', 'WS-A->WS-B'])
  })

  it('un campo sin origen no tiene caminos', () => {
    const r = refs(S, ['       P.', '           MOVE WS-A TO WS-B.'])
    const t = traceField(r, 'WS-A', 'upstream')
    expect(t.direct).toEqual([])
    expect(t.paths).toEqual([])
  })
})

describe('traceField: aguas abajo (a dónde va)', () => {
  it('sigue A→B→C y A→D en dos caminos', () => {
    const r = refs(S, [
      '       P.',
      '           MOVE WS-A TO WS-B.',
      '           MOVE WS-B TO WS-C.',
      '           MOVE WS-A TO WS-D.',
    ])
    const t = traceField(r, 'WS-A', 'downstream')
    expect(new Set(t.direct.map(s => s.to))).toEqual(new Set(['WS-B', 'WS-D']))
    const nodes = t.paths.map(p => p.nodes.join('>')).sort()
    expect(nodes).toContain('WS-A>WS-B>WS-C')
    expect(nodes).toContain('WS-A>WS-D')
  })
})

describe('traceField: ciclos', () => {
  it('A→B→A no cuelga: el camino se cierra marcado como cíclico', () => {
    const r = refs(S, ['       P.', '           MOVE WS-A TO WS-B.', '           MOVE WS-B TO WS-A.'])
    const t = traceField(r, 'WS-A', 'upstream')
    const cyclic = t.paths.find(p => p.cyclic)
    expect(cyclic).toBeDefined()
    expect(cyclic!.nodes[cyclic!.nodes.length - 1]).toBe('WS-A')
  })
})

describe('traceField: incertidumbre', () => {
  it('un tramo MOVE CORRESPONDING marca el camino como incierto', () => {
    const r = refs(
      [
        '       01  G1.',
        '         05 X PIC X.',
        '       01  G2.',
        '         05 Y PIC X.',
        '       01  G3.',
        '         05 Z PIC X.',
      ],
      ['       P.', '           MOVE CORRESPONDING G1 TO G2.', '           MOVE G2 TO G3.'],
    )
    const t = traceField(r, 'G3', 'upstream')
    const full = t.paths.find(p => p.nodes.includes('G1'))!
    expect(full.uncertain).toBe(true)
  })

  it('un solape REDEFINES aparece como tramo de la traza, marcado', () => {
    const r = refs(
      [
        '       01  WS-REC.',
        '         05 WS-RAW  PIC X(4).',
        '         05 WS-NUM REDEFINES WS-RAW PIC 9(4).',
        '       01  WS-SRC   PIC X(4).',
      ],
      ['       P.', '           MOVE WS-SRC TO WS-RAW.'],
    )
    // WS-NUM ← (solape) WS-RAW ← WS-SRC
    const t = traceField(r, 'WS-NUM', 'upstream')
    const viaRedef = t.paths.find(p => p.steps.some(s => s.redefines))
    expect(viaRedef).toBeDefined()
    expect(viaRedef!.nodes).toContain('WS-SRC')
    expect(viaRedef!.uncertain).toBe(true)
  })
})
