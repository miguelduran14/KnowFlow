import { describe, expect, it } from 'vitest'
import { parseFlow } from '../src/flow-parser.js'
import type { FlowEdge } from '../src/types.js'

function flowOf(...lines: string[]) {
  return parseFlow(['       PROCEDURE DIVISION.', ...lines].join('\n'))
}

/** "A->B" para aristas de un tipo, en orden */
function edgesOf(edges: FlowEdge[], kind: FlowEdge['kind']): string[] {
  return edges.filter(e => e.kind === kind).map(e => `${e.from}->${e.to}`)
}

describe('caída natural entre párrafos', () => {
  it('un párrafo sin transferencia cae en el siguiente', () => {
    const flow = flowOf(
      '       A-PARA.',
      '           MOVE 1 TO WS-X.',
      '       B-PARA.',
      '           MOVE 2 TO WS-X.',
    )
    expect(edgesOf(flow.edges, 'fall-through')).toEqual(['A-PARA->B-PARA'])
    expect(flow.paragraphs.find(p => p.name === 'A-PARA')?.fallsThrough).toBe(true)
    // El último párrafo no tiene siguiente: no cae.
    expect(flow.paragraphs.find(p => p.name === 'B-PARA')?.fallsThrough).toBeUndefined()
  })

  it('STOP RUN / GOBACK cortan la caída', () => {
    const flow = flowOf(
      '       A-PARA.',
      '           GOBACK.',
      '       B-PARA.',
      '           DISPLAY 1.',
    )
    expect(edgesOf(flow.edges, 'fall-through')).toEqual([])
  })

  it('un GO TO incondicional corta, pero uno bajo IF no', () => {
    const cut = flowOf('       A-PARA.', '           GO TO B-PARA.', '       B-PARA.', '           DISPLAY 1.')
    expect(edgesOf(cut.edges, 'fall-through')).toEqual([])

    const noCut = flowOf(
      '       A-PARA.',
      '           IF WS-E = 1 GO TO B-PARA.',
      '       B-PARA.',
      '           DISPLAY 1.',
    )
    // El GO TO es condicional: si WS-E no es 1, A-PARA cae en B-PARA.
    expect(edgesOf(noCut.edges, 'fall-through')).toEqual(['A-PARA->B-PARA'])
  })
})

describe('SORT INPUT/OUTPUT PROCEDURE', () => {
  it('genera aristas a los párrafos de entrada y salida', () => {
    const flow = flowOf(
      '       MAIN-PARA.',
      '           SORT W ON ASCENDING KEY K',
      '               INPUT PROCEDURE IS ENT-PARA',
      '               OUTPUT PROCEDURE IS SAL-PARA THRU SAL-FIN',
      '           STOP RUN.',
      '       ENT-PARA.',
      '           DISPLAY 1.',
      '       SAL-PARA.',
      '           DISPLAY 2.',
      '       SAL-FIN.',
      '           DISPLAY 3.',
    )
    expect(edgesOf(flow.edges, 'sort-input')).toEqual(['MAIN-PARA->ENT-PARA'])
    const output = flow.edges.find(e => e.kind === 'sort-output')
    expect(output).toMatchObject({ from: 'MAIN-PARA', to: 'SAL-PARA', thru: 'SAL-FIN' })
  })
})

describe('manejadores como ramas', () => {
  it('AT END y NOT AT END guardan sus sentencias', () => {
    const flow = flowOf(
      '       MAIN-PARA.',
      '           READ F',
      '               AT END PERFORM FIN-PARA',
      '               NOT AT END PERFORM SIGUE-PARA',
      '           END-READ',
      '           PERFORM SIEMPRE-PARA.',
      '       FIN-PARA.',
      '           DISPLAY 1.',
      '       SIGUE-PARA.',
      '           DISPLAY 2.',
      '       SIEMPRE-PARA.',
      '           DISPLAY 3.',
    )
    const performs = flow.edges.filter(e => e.kind === 'perform')
    expect(performs.map(e => `${e.to}:${e.guards?.join(',') ?? '-'}`)).toEqual([
      'FIN-PARA:AT END',
      'SIGUE-PARA:NOT AT END',
      // Tras END-READ la sentencia vuelve a ser incondicional.
      'SIEMPRE-PARA:-',
    ])
  })

  it('ON SIZE ERROR e INVALID KEY también son guardas', () => {
    const size = flowOf(
      '       MAIN-PARA.',
      '           COMPUTE R = A / B',
      '               ON SIZE ERROR PERFORM ERR-PARA',
      '           END-COMPUTE.',
      '       ERR-PARA.',
      '           DISPLAY 1.',
    )
    expect(size.edges.find(e => e.to === 'ERR-PARA')?.guards).toEqual(['ON SIZE ERROR'])
  })
})

describe('PERFORM en línea (bucle)', () => {
  it('marca su cuerpo como ejecutado en bucle', () => {
    const flow = flowOf(
      '       MAIN-PARA.',
      '           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 10',
      '               PERFORM PASO-PARA',
      '           END-PERFORM',
      '           PERFORM FINAL-PARA.',
      '       PASO-PARA.',
      '           DISPLAY 1.',
      '       FINAL-PARA.',
      '           DISPLAY 2.',
    )
    const paso = flow.edges.find(e => e.to === 'PASO-PARA')
    expect(paso?.guards).toEqual(['en bucle (VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 10)'])
    // Tras END-PERFORM, FINAL-PARA ya no está en el bucle.
    expect(flow.edges.find(e => e.to === 'FINAL-PARA')?.guards).toBeUndefined()
  })

  it('un PERFORM con destino no abre bucle', () => {
    const flow = flowOf('       MAIN-PARA.', '           PERFORM OTRO-PARA.', '       OTRO-PARA.', '           DISPLAY 1.')
    expect(flow.edges.find(e => e.to === 'OTRO-PARA')?.guards).toBeUndefined()
  })
})

describe('DECLARATIVES', () => {
  it('sus párrafos se marcan y no caen en el cuerpo', () => {
    const flow = flowOf(
      '       DECLARATIVES.',
      '       ERR-SECTION SECTION.',
      '           USE AFTER STANDARD ERROR PROCEDURE ON F.',
      '       ERR-PARA.',
      '           DISPLAY 1.',
      '       END-DECLARATIVES.',
      '       MAIN-SECTION SECTION.',
      '       MAIN-PARA.',
      '           DISPLAY 2.',
    )
    expect(flow.paragraphs.find(p => p.name === 'ERR-PARA')?.inDeclaratives).toBe(true)
    expect(flow.paragraphs.find(p => p.name === 'MAIN-PARA')?.inDeclaratives).toBeUndefined()
    // Ninguna caída natural cruza END-DECLARATIVES.
    const crossing = flow.edges.find(e => e.kind === 'fall-through' && e.from === 'ERR-PARA')
    expect(crossing).toBeUndefined()
  })
})
