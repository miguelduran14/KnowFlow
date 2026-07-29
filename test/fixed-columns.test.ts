import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.js'
import { parseFlow } from '../src/flow-parser.js'

/**
 * Regresión del hallazgo del corpus (ProLeap/NIST): el COBOL de formato
 * fijo clásico rellena las columnas 73-80 con una zona de identificación
 * (p. ej. "CM2014.2") que el compilador ignora. Sin recortarla, ninguna
 * cabecera ni el "PROCEDURE DIVISION." acababan en punto y el parser de
 * flujo perdía programas enteros (450 de 495 fixtures salían vacías).
 */

/** Construye una línea de formato fijo: cols 1-6 secuencia, 7 indicador,
 *  8-72 código, 73-80 zona de identificación. */
function fixed(seq: number, code: string, ident = 'PROG.1'): string {
  const s = String(seq).padStart(6, '0')
  const area = (' ' + code).padEnd(66, ' ').slice(0, 66) // col 7..72
  return s + area + ident
}

describe('formato fijo con zona de identificación (cols 73-80)', () => {
  const source = [
    fixed(100, 'IDENTIFICATION DIVISION.'),
    fixed(200, 'PROGRAM-ID.'),
    fixed(300, '    ACCTPROC.'),
    fixed(400, 'DATA DIVISION.'),
    fixed(500, 'WORKING-STORAGE SECTION.'),
    fixed(600, "01  WS-GREETING  PIC X(5) VALUE 'HOLA'."),
    fixed(700, '01  WS-COUNT     PIC 9(4) VALUE ZERO.'),
    fixed(800, 'PROCEDURE DIVISION.'),
    fixed(900, '0000-MAIN.'),
    fixed(1000, '    PERFORM 1000-INIT.'),
    fixed(1100, '    GOBACK.'),
    fixed(1200, '1000-INIT.'),
    fixed(1300, '    MOVE 0 TO WS-COUNT.'),
  ].join('\n')

  it('recorta las cols 73-80 y ve los párrafos y aristas', () => {
    const flow = parseFlow(source)
    expect(flow.fragment).toBe(false)
    expect(flow.paragraphs.map(p => p.name)).toEqual(['0000-MAIN', '1000-INIT'])
    expect(flow.edges.map(e => `${e.from}->${e.to}`)).toContain('0000-MAIN->1000-INIT')
  })

  it('detecta el PROGRAM-ID aunque el nombre vaya en la línea siguiente', () => {
    expect(parseFlow(source).programId).toBe('ACCTPROC')
  })

  it('el VALUE no arrastra la zona de identificación', () => {
    const recs = parse(source).records
    // Sin el recorte, WS-GREETING valdría "'HOLA'. PROG.1" o similar.
    expect(recs[0]!.value).toBe("'HOLA'")
    expect(recs[1]!.value).toBe('ZERO')
    expect(recs[0]!.dataSection).toBe('WORKING-STORAGE')
  })

  it('el nombre de campo tampoco arrastra basura de cols 73-80', () => {
    const recs = parse(source).records
    expect(recs.map(f => f.name)).toEqual(['WS-GREETING', 'WS-COUNT'])
    expect(recs[0]!.lengthInBytes).toBe(5)
  })
})
