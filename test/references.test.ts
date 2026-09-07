import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.js'
import { collectReferences } from '../src/references.js'
import type { FieldUsage, ReferenceResult } from '../src/types.js'

/** Programa mínimo con esquema + PROCEDURE; devuelve el where-used. */
function prog(dataLines: string[], procLines: string[]): ReferenceResult {
  const src = [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. TESTP.',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    ...dataLines,
    '       PROCEDURE DIVISION.',
    ...procLines,
  ].join('\n')
  return collectReferences(src, parse(src))
}

function usage(r: ReferenceResult, name: string): FieldUsage | undefined {
  return r.fields.find(f => f.name === name)
}

const SCHEMA = [
  '       01  WS-A            PIC S9(5).',
  '       01  WS-B            PIC S9(5).',
  '       01  WS-C            PIC S9(5).',
  '       01  WS-IX           PIC S9(4) COMP.',
  '       01  WS-TXT          PIC X(40).',
  '       01  WS-ESTADO       PIC X.',
  "           88  WS-ACTIVO   VALUE 'A'.",
]

describe('references: MOVE', () => {
  it('reparte fuente (lectura) y destinos (escritura)', () => {
    const r = prog(SCHEMA, ['       P.', '           MOVE WS-A TO WS-B WS-C.'])
    expect(usage(r, 'WS-A')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-A')!.writes).toHaveLength(0)
    expect(usage(r, 'WS-B')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-C')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-B')!.writes[0]!.verb).toBe('MOVE')
    expect(usage(r, 'WS-B')!.writes[0]!.paragraph).toBe('P')
  })

  it('ancla cada token a su línea real cuando la sentencia se parte en varias líneas', () => {
    // Esquema (7 líneas) + cabeceras (4) → PROCEDURE en L12, P. en L13,
    // MOVE en L14, la continuación con TO en L15.
    const r = prog(SCHEMA, ['       P.', '           MOVE WS-A', '               TO WS-B.'])
    expect(usage(r, 'WS-A')!.reads[0]!.line).toBe(14)
    expect(usage(r, 'WS-B')!.writes[0]!.line).toBe(15)
  })

  it('MOVE CORRESPONDING se registra pero marcado como incierto', () => {
    const r = prog(
      ['       01  G1.', '         05 X PIC X.', '       01  G2.', '         05 X2 PIC X.'],
      ['       P.', '           MOVE CORRESPONDING G1 TO G2.'],
    )
    expect(usage(r, 'G1')!.reads[0]!.uncertain).toBe(true)
    expect(usage(r, 'G2')!.writes[0]!.uncertain).toBe(true)
  })
})

describe('references: aritmética', () => {
  it('ADD ... TO x deja x como lectura-escritura (cuenta en ambos lados)', () => {
    const r = prog(SCHEMA, ['       P.', '           ADD WS-A TO WS-B.'])
    expect(usage(r, 'WS-A')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-A')!.writes).toHaveLength(0)
    expect(usage(r, 'WS-B')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-B')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-B')!.writes[0]!.kind).toBe('read-write')
  })

  it('ADD ... GIVING x deja x solo como escritura', () => {
    const r = prog(SCHEMA, ['       P.', '           ADD WS-A WS-B GIVING WS-C.'])
    expect(usage(r, 'WS-A')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-B')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-C')!.reads).toHaveLength(0)
    expect(usage(r, 'WS-C')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-C')!.writes[0]!.kind).toBe('write')
  })

  it('COMPUTE: destinos a la izquierda del =, operandos de la derecha se leen', () => {
    const r = prog(SCHEMA, ['       P.', '           COMPUTE WS-C = WS-A + WS-B * 2.'])
    expect(usage(r, 'WS-C')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-C')!.reads).toHaveLength(0)
    expect(usage(r, 'WS-A')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-B')!.reads).toHaveLength(1)
  })

  it('SUBTRACT ... GIVING y DIVIDE ... INTO', () => {
    const r = prog(SCHEMA, [
      '       P.',
      '           SUBTRACT WS-A FROM WS-B GIVING WS-C.',
      '           DIVIDE WS-A INTO WS-B.',
    ])
    expect(usage(r, 'WS-C')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-C')!.reads).toHaveLength(0)
    // DIVIDE WS-A INTO WS-B: WS-B es lectura-escritura
    expect(usage(r, 'WS-B')!.writes.some(x => x.verb === 'DIVIDE')).toBe(true)
    expect(usage(r, 'WS-B')!.reads.some(x => x.verb === 'DIVIDE')).toBe(true)
  })
})

describe('references: SET', () => {
  it('SET x UP BY n deja x como lectura-escritura', () => {
    const r = prog(SCHEMA, ['       P.', '           SET WS-IX UP BY 1.'])
    expect(usage(r, 'WS-IX')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-IX')!.writes).toHaveLength(1)
  })

  it('SET <88> TO TRUE cuenta como escritura del campo padre, vía 88', () => {
    const r = prog(SCHEMA, ['       P.', '           SET WS-ACTIVO TO TRUE.'])
    expect(usage(r, 'WS-ACTIVO')).toBeUndefined()
    const est = usage(r, 'WS-ESTADO')!
    expect(est.writes).toHaveLength(1)
    expect(est.writes[0]!.via88).toBe('WS-ACTIVO')
  })
})

describe('references: condiciones y bucles', () => {
  it('IF con nombre de nivel 88 se atribuye al campo padre como lectura', () => {
    const r = prog(SCHEMA, ['       P.', '           IF WS-ACTIVO', '               MOVE WS-A TO WS-B', '           END-IF.'])
    const est = usage(r, 'WS-ESTADO')!
    expect(est.reads).toHaveLength(1)
    expect(est.reads[0]!.via88).toBe('WS-ACTIVO')
    expect(est.reads[0]!.verb).toBe('IF')
  })

  it('PERFORM VARYING: la variable de control se escribe; FROM/BY/UNTIL se leen', () => {
    const r = prog(SCHEMA, [
      '       P.',
      '           PERFORM Q VARYING WS-IX FROM WS-A BY 1 UNTIL WS-IX > WS-B.',
      '       Q.',
      '           CONTINUE.',
    ])
    expect(usage(r, 'WS-IX')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-A')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-B')!.reads).toHaveLength(1)
  })
})

describe('references: E/S de registro', () => {
  it('READ ... INTO x → x escritura; WRITE rec FROM x → rec escritura, x lectura', () => {
    const r = prog(
      [
        '       01  WS-BUF          PIC X(80).',
        '       01  RPT-REC         PIC X(80).',
        '       01  WS-LINE         PIC X(80).',
      ],
      [
        '       P.',
        '           READ IN-FILE INTO WS-BUF.',
        '           WRITE RPT-REC FROM WS-LINE.',
      ],
    )
    expect(usage(r, 'WS-BUF')!.writes).toHaveLength(1)
    expect(usage(r, 'RPT-REC')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-LINE')!.reads).toHaveLength(1)
  })
})

describe('references: CALL', () => {
  it('argumentos BY REFERENCE → lectura-escritura + incierto; BY CONTENT → lectura', () => {
    const r = prog(SCHEMA, [
      '       P.',
      "           CALL 'SUB' USING WS-A BY CONTENT WS-B RETURNING WS-C.",
    ])
    expect(usage(r, 'WS-A')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-A')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-A')!.writes[0]!.uncertain).toBe(true)
    expect(usage(r, 'WS-B')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-B')!.writes).toHaveLength(0)
    expect(usage(r, 'WS-C')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-C')!.writes[0]!.kind).toBe('write')
  })
})

describe('references: EXEC SQL', () => {
  it('host variables: INTO → escritura; el resto (WHERE) → lectura', () => {
    const r = prog(
      ['       01  WS-SALDO        PIC S9(9).', '       01  WS-ID           PIC X(6).'],
      [
        '       P.',
        '           EXEC SQL',
        '               SELECT SALDO INTO :WS-SALDO',
        '                 FROM CUENTAS',
        '                WHERE ID = :WS-ID',
        '           END-EXEC.',
      ],
    )
    expect(usage(r, 'WS-SALDO')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-SALDO')!.writes[0]!.verb).toBe('EXEC SQL SELECT')
    expect(usage(r, 'WS-ID')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-ID')!.writes).toHaveLength(0)
  })

  it('SQL dinámico marca sus host variables como inciertas', () => {
    const r = prog(
      ['       01  WS-STMT         PIC X(200).', '       01  WS-P            PIC X(4).'],
      [
        '       P.',
        '           EXEC SQL EXECUTE IMMEDIATE :WS-STMT END-EXEC.',
        '           EXEC SQL PREPARE S FROM :WS-P END-EXEC.',
      ],
    )
    expect(usage(r, 'WS-STMT')!.reads[0]!.uncertain).toBe(true)
    expect(usage(r, 'WS-P')!.reads[0]!.uncertain).toBe(true)
  })
})

describe('references: honestidad (ADR-0003)', () => {
  it('un verbo no modelado deja la ocurrencia como "sin clasificar"', () => {
    const r = prog(
      ['       01  WS-TMP          PIC X(20).', '       01  WS-KEY          PIC X(4).'],
      ['       P.', '           SORT WS-TMP ASCENDING KEY WS-KEY.'],
    )
    expect(usage(r, 'WS-TMP')!.unclassified).toHaveLength(1)
    expect(usage(r, 'WS-TMP')!.reads).toHaveLength(0)
    expect(usage(r, 'WS-TMP')!.writes).toHaveLength(0)
    expect(usage(r, 'WS-TMP')!.unclassified[0]!.kind).toBe('unclassified')
  })

  it('un nombre en posición de operando que no casa con el esquema va a unknownNames', () => {
    const r = prog(SCHEMA, ['       P.', '           MOVE WS-A TO WS-NO-EXISTE.'])
    expect(r.unknownNames).toContain('WS-NO-EXISTE')
    expect(usage(r, 'WS-NO-EXISTE')).toBeUndefined()
  })

  it('homónimos del esquema se marcan como ambiguos', () => {
    const r = prog(
      ['       01  G-A.', '         05 DUP PIC X.', '       01  G-B.', '         05 DUP PIC 9.'],
      ['       P.', '           MOVE SPACE TO DUP.'],
    )
    const dup = usage(r, 'DUP')!
    expect(dup.writes[0]!.ambiguous).toBe(true)
    expect(dup.writes[0]!.uncertain).toBe(true)
  })

  it('sentencias antes de la primera cabecera caen en el nodo de entrada implícito', () => {
    const r = prog(SCHEMA, ['           MOVE WS-A TO WS-B.', '       MAIN-PARA.', '           MOVE WS-B TO WS-C.'])
    expect(usage(r, 'WS-B')!.writes[0]!.paragraph).toBe('TESTP')
    expect(usage(r, 'WS-B')!.writes[0]!.paragraphImplicit).toBe(true)
    expect(usage(r, 'WS-C')!.writes[0]!.paragraph).toBe('MAIN-PARA')
    expect(usage(r, 'WS-C')!.writes[0]!.paragraphImplicit).toBeUndefined()
  })

  it('un fuente sin PROCEDURE DIVISION queda como fragmento, sin campos', () => {
    const src = ['       01  WS-A PIC X.', '       01  WS-B PIC X.'].join('\n')
    const r = collectReferences(src, parse(src))
    expect(r.fragment).toBe(true)
    expect(r.fields).toEqual([])
  })
})

describe('references: otros verbos', () => {
  it('INITIALIZE escribe; DISPLAY lee; ACCEPT escribe', () => {
    const r = prog(SCHEMA, [
      '       P.',
      '           INITIALIZE WS-A WS-B.',
      '           DISPLAY WS-A WS-B.',
      '           ACCEPT WS-C.',
    ])
    expect(usage(r, 'WS-A')!.writes.some(x => x.verb === 'INITIALIZE')).toBe(true)
    expect(usage(r, 'WS-A')!.reads.some(x => x.verb === 'DISPLAY')).toBe(true)
    expect(usage(r, 'WS-C')!.writes.some(x => x.verb === 'ACCEPT')).toBe(true)
  })

  it('STRING ... INTO x → x escritura; UNSTRING x INTO ... → x lectura', () => {
    const r = prog(
      [
        '       01  WS-OUT          PIC X(60).',
        '       01  WS-IN           PIC X(60).',
        '       01  WS-P1           PIC X(20).',
        '       01  WS-P2           PIC X(20).',
      ],
      [
        '       P.',
        "           STRING WS-P1 WS-P2 DELIMITED BY SPACE INTO WS-OUT.",
        '           UNSTRING WS-IN DELIMITED BY SPACE INTO WS-P1 WS-P2.',
      ],
    )
    expect(usage(r, 'WS-OUT')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-P1')!.reads.some(x => x.verb === 'STRING')).toBe(true)
    expect(usage(r, 'WS-IN')!.reads.some(x => x.verb === 'UNSTRING')).toBe(true)
    expect(usage(r, 'WS-P1')!.writes.some(x => x.verb === 'UNSTRING')).toBe(true)
  })
})

describe('references: snippet', () => {
  it('cada referencia lleva la sentencia colapsada como contexto', () => {
    const r = prog(SCHEMA, ['       P.', '           MOVE WS-A TO WS-B.'])
    expect(usage(r, 'WS-B')!.writes[0]!.snippet).toBe('MOVE WS-A TO WS-B')
  })
})

describe('references: subíndices y modificación de referencia', () => {
  it('el subíndice de un destino se LEE, no se escribe (MOVE A TO B(I))', () => {
    const r = prog(
      [
        '       01  WS-A     PIC X.',
        '       01  WS-I     PIC 9(4) COMP.',
        '       01  WS-T.',
        '         05 WS-EL   PIC X OCCURS 10.',
      ],
      ['       P.', '           MOVE WS-A TO WS-EL(WS-I).'],
    )
    expect(usage(r, 'WS-EL')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-I')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-I')!.writes).toHaveLength(0)
  })

  it('la longitud de una modificación de referencia se lee', () => {
    const r = prog(
      ['       01  WS-A   PIC X(20).', '       01  WS-B   PIC X(20).', '       01  WS-L   PIC 9(4) COMP.'],
      ['       P.', '           MOVE WS-A TO WS-B(1:WS-L).'],
    )
    expect(usage(r, 'WS-B')!.writes).toHaveLength(1)
    expect(usage(r, 'WS-L')!.reads).toHaveLength(1)
    expect(usage(r, 'WS-L')!.writes).toHaveLength(0)
  })
})

describe('references: aristas de asignación (P7)', () => {
  const edge = (r: ReferenceResult, from: string, to: string) =>
    r.assignments.find(e => e.from === from && e.to === to)

  it('MOVE A TO B produce una arista A→B', () => {
    const r = prog(SCHEMA, ['       P.', '           MOVE WS-A TO WS-B.'])
    const e = edge(r, 'WS-A', 'WS-B')!
    expect(e).toBeDefined()
    expect(e.verb).toBe('MOVE')
    expect(e.kind).toBe('statement')
    expect(e.line).toBe(14) // SCHEMA (7) + cabeceras (4) + P. → MOVE en L14
  })

  it('COMPUTE C = A + B produce A→C y B→C', () => {
    const r = prog(SCHEMA, ['       P.', '           COMPUTE WS-C = WS-A + WS-B.'])
    expect(edge(r, 'WS-A', 'WS-C')).toBeDefined()
    expect(edge(r, 'WS-B', 'WS-C')).toBeDefined()
  })

  it('ADD A TO B produce A→B (aunque B sea también lectura-escritura)', () => {
    const r = prog(SCHEMA, ['       P.', '           ADD WS-A TO WS-B.'])
    expect(edge(r, 'WS-A', 'WS-B')).toBeDefined()
    expect(edge(r, 'WS-B', 'WS-B')).toBeUndefined() // sin auto-aristas
  })

  it('WRITE rec FROM x produce x→rec', () => {
    const r = prog(
      ['       01  RPT-REC  PIC X(80).', '       01  WS-LINEA PIC X(80).'],
      ['       P.', '           WRITE RPT-REC FROM WS-LINEA.'],
    )
    expect(edge(r, 'WS-LINEA', 'RPT-REC')).toBeDefined()
  })

  it('IF, READ y PERFORM NO producen aristas de asignación', () => {
    const r = prog(SCHEMA, [
      '       P.',
      '           IF WS-A = WS-B',
      '               CONTINUE',
      '           END-IF',
      '           READ IN-FILE INTO WS-C.',
    ])
    expect(r.assignments.filter(e => e.kind === 'statement')).toHaveLength(0)
  })

  it('el subíndice no es origen de una arista (MOVE A TO B(I) no da I→B)', () => {
    const r = prog(
      [
        '       01  WS-A     PIC X.',
        '       01  WS-I     PIC 9(4) COMP.',
        '       01  WS-T.',
        '         05 WS-EL   PIC X OCCURS 10.',
      ],
      ['       P.', '           MOVE WS-A TO WS-EL(WS-I).'],
    )
    expect(edge(r, 'WS-A', 'WS-EL')).toBeDefined()
    expect(edge(r, 'WS-I', 'WS-EL')).toBeUndefined()
  })

  it('REDEFINES genera aristas de solape bidireccionales marcadas', () => {
    const r = prog(
      [
        '       01  WS-REC.',
        '         05 WS-RAW   PIC X(4).',
        '         05 WS-NUM REDEFINES WS-RAW PIC 9(4).',
      ],
      ['       P.', '           CONTINUE.'],
    )
    const ab = edge(r, 'WS-RAW', 'WS-NUM')!
    const ba = edge(r, 'WS-NUM', 'WS-RAW')!
    expect(ab.kind).toBe('redefines')
    expect(ab.uncertain).toBe(true)
    expect(ab.line).toBe(0)
    expect(ba.kind).toBe('redefines')
  })

  it('MOVE CORRESPONDING marca la arista como incierta', () => {
    const r = prog(
      ['       01  G1.', '         05 X PIC X.', '       01  G2.', '         05 X2 PIC X.'],
      ['       P.', '           MOVE CORRESPONDING G1 TO G2.'],
    )
    expect(edge(r, 'G1', 'G2')!.uncertain).toBe(true)
  })
})
