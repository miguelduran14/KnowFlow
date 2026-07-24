import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { explainProgram, SYSTEM_PROMPT } from '../src/explain/explain.js'
import { factsFidelity, renderFacts } from '../src/explain/facts.js'
import { createFakeProvider } from '../src/explain/fake.js'
import { parseFlow } from '../src/flow-parser.js'
import { parse } from '../src/parser.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES, ...segments), 'utf-8')
}

describe('renderFacts', () => {
  it('renders data schema facts with byte lengths and offsets', () => {
    const data = parse(readFixture('input', 'library-checkout.cpy'))
    const facts = renderFacts(data, undefined)

    expect(facts).toContain('## DATOS (verificado por parser)')
    expect(facts).toContain('01 CHECKOUT-RECORD')
    expect(facts).toContain('10 FINE-BALANCE | PIC S9(7)V99 | USAGE COMP-3 | 5 bytes | offset 68')
  })

  it('renders flow facts with edges anchored to source lines', () => {
    const flow = parseFlow(readFixture('flow', 'perform-basic', 'main.cbl'))
    const facts = renderFacts(undefined, flow)

    expect(facts).toContain('PROGRAM-ID: FLOWDEMO')
    expect(facts).toContain('- MAIN-PARA [termina el programa]')
    expect(facts).toContain('- L9: MAIN-PARA -> INIT-PARA (PERFORM)')
  })

  it('declares every verification limit in a dedicated section', () => {
    const data = parse(readFixture('copy-resolution', 'copy-missing', 'main.cpy'))
    const flow = parseFlow(readFixture('flow', 'call-goto', 'main.cbl'))
    const facts = renderFacts(data, flow)

    expect(facts).toContain('## LÍMITES DE LO VERIFICADO')
    expect(facts).toContain('Copybook MISSING-DETAIL NO disponible')
    expect(facts).toContain('El destino GHOST-PARA no existe en el fuente aportado')
    expect(facts).toContain('CALL dinámica en L12')
    expect(facts).toContain('[HUECO] COPY MISSING-DETAIL no disponible — estructura desconocida')
    expect(facts).toContain('offset NO verificable')
  })

  it('marks fragments as partially verified', () => {
    const flow = parseFlow(readFixture('flow', 'fragment', 'main.cbl'))
    const facts = renderFacts(undefined, flow)

    expect(facts).toContain('FRAGMENTO sin PROCEDURE DIVISION')
  })
})

describe('factsFidelity', () => {
  it('reports verified when nothing is missing', () => {
    const flow = parseFlow(readFixture('flow', 'perform-basic', 'main.cbl'))
    const data = parse(readFixture('input', 'library-checkout.cpy'))

    expect(factsFidelity(data, flow)).toEqual({ level: 'verified', reasons: [] })
  })

  it('drops to partial and names every reason', () => {
    const data = parse(readFixture('copy-resolution', 'copy-missing', 'main.cpy'))
    const flow = parseFlow(readFixture('flow', 'call-goto', 'main.cbl'))

    const fidelity = factsFidelity(data, flow)

    expect(fidelity.level).toBe('partial')
    expect(fidelity.reasons).toContain('copybooks ausentes: MISSING-DETAIL')
    expect(fidelity.reasons).toContain('destinos no encontrados: GHOST-PARA')
    expect(fidelity.reasons).toContain('hay CALL dinámicas sin destino verificable')
  })

  it('flags a fragment as partial', () => {
    const flow = parseFlow(readFixture('flow', 'fragment', 'main.cbl'))

    expect(factsFidelity(undefined, flow)).toEqual({
      level: 'partial',
      reasons: ['fragmento sin PROCEDURE DIVISION'],
    })
  })
})

describe('explainProgram', () => {
  it('sends the no-invention contract and the rendered facts to the provider', async () => {
    const provider = createFakeProvider('respuesta simulada')
    const flow = parseFlow(readFixture('flow', 'perform-basic', 'main.cbl'))

    const result = await explainProgram({ flow }, provider)

    expect(result).toBe('respuesta simulada')
    expect(provider.calls).toHaveLength(1)
    const call = provider.calls[0]!
    expect(call.system).toBe(SYSTEM_PROMPT)
    expect(call.user).toContain('- L9: MAIN-PARA -> INIT-PARA (PERFORM)')
  })

  it('never sends raw source, only rendered facts', async () => {
    const provider = createFakeProvider()
    const source = readFixture('flow', 'perform-basic', 'main.cbl')

    await explainProgram({ flow: parseFlow(source) }, provider)

    const sent = provider.calls[0]!.user
    // Sentencias que solo existen en el fuente crudo: si aparecieran, el
    // modelo podría deducir estructura sin verificar (ADR-0003).
    expect(sent).not.toContain('MOVE 0 TO WS-COUNTER')
    expect(sent).not.toContain("DISPLAY 'PROCESSING'")
    expect(sent).not.toContain('WORKING-STORAGE')
    expect(sent).not.toContain(source)
  })

  it('refuses to explain when there are no facts', async () => {
    const provider = createFakeProvider()
    await expect(explainProgram({}, provider)).rejects.toThrow('No hay hechos que explicar')
    expect(provider.calls).toHaveLength(0)
  })

  it('refuses to explain a source with no extractable facts', async () => {
    const provider = createFakeProvider()
    // Texto que no es COBOL: el parser no extrae ni un párrafo ni un campo.
    const flow = parseFlow('esto no es cobol\nni de lejos\n')
    const data = parse('esto no es cobol\nni de lejos\n')

    await expect(explainProgram({ data, flow }, provider)).rejects.toThrow('No hay hechos que explicar')
    expect(provider.calls).toHaveLength(0)
  })
})
