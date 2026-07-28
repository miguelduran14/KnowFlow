import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInventory } from '../src/inventory.js'

const CASES_DIR = join(import.meta.dirname, 'fixtures', 'inventory')

const cases = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)

describe('inventario golden-file', () => {
  for (const caseName of cases) {
    it(caseName, () => {
      const dir = join(CASES_DIR, caseName)
      const source = readFileSync(join(dir, 'main.cbl'), 'utf-8')
      const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf-8'))
      expect(parseInventory(source)).toEqual(expected)
    })
  }
})

describe('inventario: honestidad de lo no resuelto', () => {
  it('un WRITE sin FD que lo respalde no se atribuye a ningún fichero', () => {
    const inv = parseInventory(
      [
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        '           WRITE HUERFANO-REC.',
      ].join('\n'),
    )
    expect(inv.files).toEqual([])
    expect(inv.unresolvedFileOps).toEqual([
      { verb: 'WRITE', target: 'HUERFANO-REC', paragraph: 'MAIN-PARA', line: 3 },
    ])
  })

  it('un fichero declarado y nunca usado se lista igual, sin operaciones', () => {
    const inv = parseInventory(
      [
        '       ENVIRONMENT DIVISION.',
        '       INPUT-OUTPUT SECTION.',
        '       FILE-CONTROL.',
        '           SELECT LOG-FILE ASSIGN TO LOGDD.',
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        '           GOBACK.',
      ].join('\n'),
    )
    expect(inv.files).toEqual([
      { name: 'LOG-FILE', assignTo: 'LOGDD', records: [], operations: [] },
    ])
  })

  it('un FROM dentro de un literal no cuenta como tabla', () => {
    const inv = parseInventory(
      [
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        "           DISPLAY 'SELECT * FROM SECRETA'",
        '           EXEC SQL SELECT COL INTO :WS-C FROM REAL_TABLE END-EXEC.',
      ].join('\n'),
    )
    expect(inv.tables).toEqual(['REAL_TABLE'])
  })

  it('INTO de host variables no se confunde con INSERT INTO', () => {
    const inv = parseInventory(
      [
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        '           EXEC SQL SELECT NAME INTO :WS-NAME FROM CUSTOMER END-EXEC',
        '           EXEC SQL INSERT INTO AUDIT_LOG VALUES (:WS-NAME) END-EXEC.',
      ].join('\n'),
    )
    expect(inv.tables).toEqual(['CUSTOMER', 'AUDIT_LOG'])
  })

  it('los verbos de E/S dentro de un EXEC CICS no son E/S de fichero COBOL', () => {
    const inv = parseInventory(
      [
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        "           EXEC CICS READ FILE('ACCTFILE') END-EXEC.",
      ].join('\n'),
    )
    expect(inv.unresolvedFileOps).toEqual([])
    expect(inv.cicsCommands).toEqual([{ command: 'READ', count: 1 }])
    expect(inv.execs[0]?.names).toEqual(['FILE(ACCTFILE)'])
  })
})
