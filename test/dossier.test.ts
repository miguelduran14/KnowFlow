import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAdvisories } from '../src/advisories.js'
import { renderDossier } from '../src/dossier.js'
import type { Explanation } from '../src/explain/explain.js'
import { parseFlow } from '../src/flow-parser.js'
import { parseInventory } from '../src/inventory.js'
import { parse } from '../src/parser.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), 'utf-8')
}

function analyze(source: string, copybooks = new Map<string, string>()) {
  const data = parse(source, copybooks)
  const flow = parseFlow(source)
  const inventory = parseInventory(source)
  const advisories = checkAdvisories(source, data, flow, inventory)
  return { data, flow, inventory, advisories }
}

describe('renderDossier', () => {
  it('assembles a full onboarding document from the verified facts', () => {
    const source = readFixture('input', 'full-program.cbl')
    const md = renderDossier(analyze(source))

    // Encabezado con el PROGRAM-ID y la etiqueta de fidelidad.
    expect(md).toContain('# Dossier de onboarding — FULLDEMO')
    expect(md).toContain('Fidelidad: verificado por parser')

    // Flujo como bloque Mermaid renderizable.
    expect(md).toContain('## Flujo')
    expect(md).toContain('```mermaid')
    expect(md).toContain('flowchart TD')
    expect(md).toContain('MAIN_PARA')

    // Esquema de datos como tabla Markdown (T4) con cabecera y campos.
    expect(md).toContain('## Datos')
    expect(md).toContain('| Campo | Nivel | PIC / tipo | USAGE | Bytes | Offset | Notas |')
    expect(md).toContain('WS-REGISTRO')
    expect(md).toContain('S9(7)V99')
    expect(md).toContain('COMP-3')
    // Un nivel 88 sale como fila propia con sus valores.
    expect(md).toContain('88 WS-ACTIVO')
  })

  it('leads with the AI prose when an explanation is provided', () => {
    const source = readFixture('input', 'full-program.cbl')
    const explanation: Explanation = {
      summary: 'Recorre un registro y muestra el detalle.',
      walkthrough: [
        { text: 'Arranca el proceso.', paragraph: 'MAIN-PARA', line: 15 },
        { text: 'Escribe el detalle.', paragraph: 'DETAIL-PARA', line: 18, branches: true },
      ],
      raw: '{}',
      structured: true,
    }
    const md = renderDossier({ ...analyze(source), explanation })

    expect(md).toContain('## Resumen')
    expect(md).toContain('Recorre un registro y muestra el detalle.')
    expect(md).toContain('## Recorrido')
    expect(md).toContain('1. Arranca el proceso. — `MAIN-PARA` (L15)')
    expect(md).toContain('rama condicional')
    // El resumen va ANTES del flujo.
    expect(md.indexOf('## Resumen')).toBeLessThan(md.indexOf('## Flujo'))
  })

  it('works without an explanation (parser facts are enough)', () => {
    const source = readFixture('input', 'full-program.cbl')
    const md = renderDossier(analyze(source))
    expect(md).not.toContain('## Resumen')
    expect(md).not.toContain('## Recorrido')
    expect(md).toContain('## Datos')
  })

  it('renders the "what it touches" inventory with files, cursors and advisories', () => {
    const source = readFixture('inventory', 'files-sql-cics', 'main.cbl')
    const md = renderDossier(analyze(source))

    expect(md).toContain('## Qué toca el programa')
    expect(md).toContain('### Ficheros')
    expect(md).toContain('CUST-FILE')
    expect(md).toContain('Tablas DB2:')
    expect(md).toContain('### Cursores')
    expect(md).toContain('ORD-CUR')
    expect(md).toContain('Comandos CICS:')
  })

  it('declares verification limits honestly', () => {
    const source = readFixture('copy-resolution', 'copy-missing', 'main.cpy')
    const data = parse(source, new Map())
    const md = renderDossier({ data })

    expect(md).toContain('parcialmente verificado')
    expect(md).toContain('## Límites de lo verificado')
    expect(md).toContain('MISSING-DETAIL')
  })

  it('marks an UPDATE-without-WHERE advisory in the dossier', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL UPDATE CLIENTES SET SALDO = 0 END-EXEC.',
    ].join('\n')
    const md = renderDossier(analyze(source))
    expect(md).toContain('## Avisos — cuidado con esto')
    expect(md).toContain('UPDATE sin WHERE')
  })

  it('falls back to sourceName when there is no PROGRAM-ID', () => {
    const source = ['       PROCEDURE DIVISION.', '       MAIN-PARA.', '           STOP RUN.'].join('\n')
    const md = renderDossier({ ...analyze(source), sourceName: 'PEGADO.cbl' })
    expect(md).toContain('# Dossier de onboarding — PEGADO.cbl')
  })
})
