import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.js'
import { parseInventory } from '../src/inventory.js'
import type { SchemaField } from '../src/types.js'

function records(...lines: string[]): SchemaField[] {
  return parse(lines.join('\n')).records
}

describe('C1 — sección de la DATA DIVISION de cada 01', () => {
  it('etiqueta cada registro con su sección', () => {
    const recs = records(
      '       DATA DIVISION.',
      '       FILE SECTION.',
      '       FD  F.',
      '       01  FILE-REC   PIC X(10).',
      '       WORKING-STORAGE SECTION.',
      '       01  WS-A       PIC 9(3).',
      '       LINKAGE SECTION.',
      '       01  LK-P       PIC X(2).',
    )
    expect(recs.map(r => [r.name, r.dataSection])).toEqual([
      ['FILE-REC', 'FILE'],
      ['WS-A', 'WORKING-STORAGE'],
      ['LK-P', 'LINKAGE'],
    ])
  })

  it('un copybook suelto sin cabecera de sección no la inventa', () => {
    const [rec] = records('       01 REC.', '         05 F PIC X(3).')
    expect(rec!.dataSection).toBeUndefined()
  })

  it('la sección solo está en el 01 raíz, no en los hijos', () => {
    const [rec] = records(
      '       LINKAGE SECTION.',
      '       01  LK-P.',
      '         05 LK-C PIC X(3).',
    )
    expect(rec!.dataSection).toBe('LINKAGE')
    expect(rec!.children[0]!.dataSection).toBeUndefined()
  })

  it('REPORT/SCREEN quedan sin determinar en vez de mal etiquetadas', () => {
    const [rec] = records(
      '       REPORT SECTION.',
      '       01  RPT-LINE PIC X(80).',
    )
    // No es ninguna de las cuatro de almacenamiento: sección desconocida.
    expect(rec!.dataSection).toBeUndefined()
  })
})

describe('C2 — VALUE como valor inicial', () => {
  it('captura literal, figurativa, número, decimal y ALL', () => {
    const [rec] = records(
      '       01 R.',
      "         05 A PIC X(3) VALUE 'ABC'.",
      '         05 B PIC 9(4) VALUE ZEROS.',
      '         05 C PIC 9V99 VALUE 1.05.',
      "         05 D PIC X(5) VALUE ALL '*'.",
      '         05 E PIC S9(3) VALUE -12.',
    )
    expect(rec!.children.map(f => f.value)).toEqual(["'ABC'", 'ZEROS', '1.05', "ALL '*'", '-12'])
  })

  it('el VALUE de un 88 no se confunde con el del campo padre', () => {
    const [rec] = records(
      '       01 R.',
      "         05 WS-ST PIC X VALUE 'N'.",
      "           88 DONE   VALUE 'Y'.",
    )
    expect(rec!.children[0]!.value).toBe("'N'")
    expect(rec!.children[0]!.conditionValues).toEqual([{ name: 'DONE', values: ["'Y'"] }])
  })

  it('un campo sin VALUE no lo lleva', () => {
    const [rec] = records('       01 R.', '         05 A PIC X(3).')
    expect(rec!.children[0]!.value).toBeUndefined()
  })
})

describe('C3 — EXEC SQL/CICS dinámicos', () => {
  it('PREPARE y EXECUTE se marcan dinámicos', () => {
    const inv = parseInventory(
      [
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        '           EXEC SQL PREPARE S1 FROM :WS-TXT END-EXEC',
        '           EXEC SQL EXECUTE S1 END-EXEC.',
      ].join('\n'),
    )
    expect(inv.execs.map(e => [e.verb, e.dynamic ?? false])).toEqual([
      ['PREPARE', true],
      ['EXECUTE', true],
    ])
  })

  it('un CICS con recurso en variable es dinámico; con literal, no', () => {
    const inv = parseInventory(
      [
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        "           EXEC CICS READ FILE('ACCTFILE') END-EXEC",
        '           EXEC CICS READ FILE(WS-NAME) END-EXEC.',
      ].join('\n'),
    )
    expect(inv.execs[0]!.dynamic ?? false).toBe(false)
    expect(inv.execs[0]!.options).toEqual(['FILE(ACCTFILE)'])
    expect(inv.execs[1]!.dynamic).toBe(true)
    expect(inv.execs[1]!.options).toEqual(['FILE(WS-NAME)'])
  })

  it('un SELECT estático no es dinámico', () => {
    const inv = parseInventory(
      [
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        '           EXEC SQL SELECT N INTO :WS-N FROM CUSTOMER END-EXEC.',
      ].join('\n'),
    )
    expect(inv.execs[0]!.dynamic ?? false).toBe(false)
    expect(inv.tables).toEqual(['CUSTOMER'])
  })
})
