import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.js'
import { parseFlow } from '../src/flow-parser.js'
import type { SchemaField } from '../src/types.js'

function cpy(...lines: string[]): SchemaField[] {
  return parse(lines.join('\n')).records
}

/** "NOMBRE@offset+bytes" — la forma más corta de leer un layout */
function layout(record: SchemaField): string[] {
  return record.children.map(f => `${f.name}@${f.offset}+${f.lengthInBytes}`)
}

describe('alineación (SYNCHRONIZED y punteros)', () => {
  it('SYNC empuja el binario a su frontera y desplaza lo que sigue', () => {
    const [rec] = cpy(
      '       01 R.',
      '         05 A PIC X.',
      '         05 B PIC S9(8) COMP SYNC.',
      '         05 C PIC X.',
    )
    // B es palabra completa: va al 4, dejando 3 bytes de relleno tras A.
    expect(layout(rec!)).toEqual(['A@0+1', 'B@4+4', 'C@8+1'])
    expect(rec!.lengthInBytes).toBe(9)
  })

  it('sin SYNC no se alinea nada', () => {
    const [rec] = cpy(
      '       01 R.',
      '         05 A PIC X.',
      '         05 B PIC S9(8) COMP.',
    )
    expect(layout(rec!)).toEqual(['A@0+1', 'B@1+4'])
  })

  it('SYNC no afecta a COMP-3 ni a DISPLAY', () => {
    const [rec] = cpy(
      '       01 R.',
      '         05 A PIC X.',
      '         05 B PIC S9(5) COMP-3 SYNC.',
      '         05 C PIC 9(4) SYNC.',
    )
    expect(layout(rec!)).toEqual(['A@0+1', 'B@1+3', 'C@4+4'])
  })

  it('POINTER e INDEX se alinean aunque no lleven SYNC escrito', () => {
    const [rec] = cpy(
      '       01 R.',
      '         05 A PIC X.',
      '         05 P USAGE POINTER.',
      '         05 I USAGE INDEX.',
    )
    expect(layout(rec!)).toEqual(['A@0+1', 'P@4+4', 'I@8+4'])
    expect(rec!.children[1]!.type).toBe('pointer')
    expect(rec!.children[2]!.type).toBe('index')
  })

  it('un grupo con OCCURS rellena para que cada ocurrencia empiece alineada', () => {
    const [rec] = cpy(
      '       01 R.',
      '         05 T OCCURS 2 TIMES.',
      '           10 A PIC X.',
      '           10 B PIC S9(8) COMP SYNC.',
    )
    // Cada ocurrencia mide 8 (1 + 3 de relleno + 4), no 5.
    expect(rec!.children[0]!.lengthInBytes).toBe(16)
    expect(rec!.lengthInBytes).toBe(16)
  })

  it('un VALUE con texto de palabra reservada no fabrica un USAGE', () => {
    const [rec] = cpy(
      '       01 R.',
      "         05 A PIC X(5) VALUE 'INDEX'.",
      "         05 B PIC X(6) VALUE 'COMP-3'.",
    )
    expect(rec!.children.map(f => [f.type, f.lengthInBytes, f.usage])).toEqual([
      ['alphanumeric', 5, undefined],
      ['alphanumeric', 6, undefined],
    ])
  })
})

describe('nivel 66 RENAMES', () => {
  it('no entra en la jerarquía ni destruye la longitud del campo anterior', () => {
    const [rec] = cpy(
      '       01 R.',
      '         05 F1 PIC X(2).',
      '         05 F2 PIC X(3).',
      '       66 TODO RENAMES F1 THRU F2.',
    )
    // Antes el 66 colgaba de F2 y F2 tomaba la longitud de sus hijos (0).
    expect(layout(rec!)).toEqual(['F1@0+2', 'F2@2+3'])
    expect(rec!.lengthInBytes).toBe(5)
    expect(rec!.renamesGroups).toEqual([
      { name: 'TODO', from: 'F1', thru: 'F2', offset: 0, lengthInBytes: 5 },
    ])
  })

  it('RENAMES de un solo campo cubre ese campo', () => {
    const [rec] = cpy(
      '       01 R.',
      '         05 F1 PIC X(2).',
      '         05 F2 PIC X(3).',
      '       66 SOLO RENAMES F2.',
    )
    expect(rec!.renamesGroups).toEqual([
      { name: 'SOLO', from: 'F2', offset: 2, lengthInBytes: 3 },
    ])
  })

  it('un extremo que no está en el fuente deja el tramo sin resolver', () => {
    const [rec] = cpy(
      '       01 R.',
      '         05 F1 PIC X(2).',
      '       66 ROTO RENAMES F1 THRU NO-EXISTE.',
    )
    // Ni offset ni longitud: no se estima lo que no se puede verificar.
    expect(rec!.renamesGroups).toEqual([{ name: 'ROTO', from: 'F1', thru: 'NO-EXISTE' }])
  })
})

describe('límites del fuente en el flujo', () => {
  it('un programa anidado no mezcla sus párrafos y se declara como límite', () => {
    const flow = parseFlow(
      [
        '       IDENTIFICATION DIVISION.',
        '       PROGRAM-ID. EXTERNO.',
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        "           CALL 'INTERNO'.",
        '       IDENTIFICATION DIVISION.',
        '       PROGRAM-ID. INTERNO.',
        '       PROCEDURE DIVISION.',
        '       SUB-PARA.',
        '           DISPLAY 1.',
        '       END PROGRAM INTERNO.',
      ].join('\n'),
    )
    expect(flow.programId).toBe('EXTERNO')
    expect(flow.nestedPrograms).toEqual(['INTERNO'])
    expect(flow.paragraphs.map(p => p.name)).toEqual(['MAIN-PARA'])
  })

  it('DECLARATIVES no abre un párrafo de entrada implícito', () => {
    const flow = parseFlow(
      [
        '       PROCEDURE DIVISION.',
        '       DECLARATIVES.',
        '       ERR-SECTION SECTION.',
        '           USE AFTER STANDARD ERROR PROCEDURE ON F.',
        '       ERR-PARA.',
        '           DISPLAY 1.',
        '       END-DECLARATIVES.',
        '       MAIN-SECTION SECTION.',
        '       MAIN-PARA.',
        '           DISPLAY 2.',
      ].join('\n'),
    )
    expect(flow.paragraphs.some(p => p.implicit)).toBe(false)
    expect(flow.paragraphs.map(p => p.name)).toEqual([
      'ERR-SECTION',
      'ERR-PARA',
      'MAIN-SECTION',
      'MAIN-PARA',
    ])
  })
})
