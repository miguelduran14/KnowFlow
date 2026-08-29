import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.js'
import type { SchemaField } from '../src/types.js'

/** Parsea un copybook/programa y devuelve sus registros 01/77 raíz. */
function records(...lines: string[]): SchemaField[] {
  return parse(lines.join('\n')).records
}

/** "NOMBRE@offset+bytes" — la forma más corta de leer un layout. */
function layout(record: SchemaField): string[] {
  return record.children.map(f => `${f.name}@${f.offset}+${f.lengthInBytes}`)
}

// Regresiones de los bugs de alta severidad de la auditoría del parser.
// Cada caso reproduce un fallo confirmado antes de arreglarlo.

describe('regresión: PIC con símbolo de moneda ($)', () => {
  it('un PIC editado con $ se reconoce (no se degrada a grupo de 0 bytes)', () => {
    const [rec] = records('       01 WS-AMT PIC $$,$$9.99.')
    expect(rec!.type).toBe('numeric-edited')
    // $ $ , $ $ 9 . 9 9 = 9 bytes de presentación
    expect(rec!.lengthInBytes).toBe(9)
    expect(rec!.picture).toBe('$$,$$9.99')
  })

  it('un $ fijo de moneda cuenta como byte', () => {
    const [rec] = records('       01 WS-AMT PIC $9(5).')
    expect(rec!.type).toBe('numeric-edited')
    expect(rec!.lengthInBytes).toBe(6)
  })

  it('un campo con $ no descuadra los offsets de los que le siguen', () => {
    const [rec] = records(
      '       01 R.',
      '         05 A PIC $$9.99.',
      '         05 B PIC X(3).',
    )
    // A = $ $ 9 . 9 9 = 6 bytes → B empieza en 6
    expect(layout(rec!)).toEqual(['A@0+6', 'B@6+3'])
  })
})

describe('regresión: OCCURS DEPENDING ON sin TIMES', () => {
  it('reconoce el OCCURS variable escrito sin la palabra TIMES', () => {
    const [rec] = records(
      '       01 T.',
      '         05 WS-CNT PIC S9(4) COMP.',
      '         05 WS-ITEM OCCURS 1 TO 10 DEPENDING ON WS-CNT PIC X(3).',
      '         05 WS-AFTER PIC X(2).',
    )
    const item = rec!.children.find(c => c.name === 'WS-ITEM')!
    expect(item.occursDepending).toEqual({ min: 1, max: 10, dependingOn: 'WS-CNT' })
    // El offset del campo siguiente reserva el máximo: 2 (cnt) + 10*3 = 32
    const after = rec!.children.find(c => c.name === 'WS-AFTER')!
    expect(after.offset).toBe(32)
  })

  it('sigue reconociendo el OCCURS variable con TIMES', () => {
    const [rec] = records(
      '       01 T.',
      '         05 C PIC S9(4) COMP.',
      '         05 I OCCURS 1 TO 10 TIMES DEPENDING ON C PIC X(3).',
      '         05 AFT PIC X(2).',
    )
    expect(rec!.children.find(c => c.name === 'AFT')!.offset).toBe(32)
  })

  it('OCCURS fijo sin TIMES no rompe (queda como una sola ocurrencia sin count)', () => {
    // `OCCURS 5` sin TIMES: se acepta como repetición fija.
    const [rec] = records('       01 R.', '         05 A OCCURS 5 PIC X(2).')
    expect(rec!.children[0]!.occurs).toBe(5)
    expect(rec!.children[0]!.lengthInBytes).toBe(10)
  })
})

describe('regresión: COPY ... OF/IN biblioteca', () => {
  it('un COPY con OF library ausente se marca como hueco, no se pierde', () => {
    const result = parse(
      ['       01 WS-X.', '         05 A PIC X.', '       COPY CUSTREC OF MYLIB.'].join('\n'),
    )
    expect(result.missingCopybooks).toContain('CUSTREC')
  })

  it('acepta la variante IN library', () => {
    const result = parse('       COPY CUSTREC IN MYLIB.')
    expect(result.missingCopybooks).toContain('CUSTREC')
  })

  it('resuelve un COPY OF cuando el member sí está aportado', () => {
    const result = parse('       COPY CUSTREC OF MYLIB.', new Map([['CUSTREC', '       01 C PIC X(4).']]))
    expect(result.missingCopybooks).toEqual([])
    expect(result.records.map(r => r.name)).toEqual(['C'])
  })
})

describe('regresión: DATA DIVISION en formato libre', () => {
  it('parsea el esquema cuando el código empieza en la columna 1', () => {
    const result = parse(['01 WS-REC.', '   05 WS-A PIC X(5).', '   05 WS-B PIC S9(4) COMP.'].join('\n'))
    expect(result.records).toHaveLength(1)
    const rec = result.records[0]!
    expect(rec.name).toBe('WS-REC')
    expect(layout(rec)).toEqual(['WS-A@0+5', 'WS-B@5+2'])
  })

  it('sigue parseando el formato fijo (cols de secuencia 1-6) sin cambios', () => {
    const result = parse(['000100 01 WS-REC.', '000200    05 WS-A PIC X(5).'].join('\n'))
    expect(result.records[0]!.name).toBe('WS-REC')
    expect(result.records[0]!.children[0]!.name).toBe('WS-A')
  })
})
