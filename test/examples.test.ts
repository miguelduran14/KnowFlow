import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAdvisories } from '../src/advisories.js'
import { traceField } from '../src/dataflow.js'
import { parseFlow } from '../src/flow-parser.js'
import { parseInventory } from '../src/inventory.js'
import { linkPrograms } from '../src/linker.js'
import { parse } from '../src/parser.js'
import { collectReferences } from '../src/references.js'

/**
 * La cadena de ejemplo de `examples/` es la demo: tiene que analizarse
 * LIMPIA (cero huecos de fidelidad) y disparar exactamente los avisos que
 * lleva plantados a propósito. Si el motor o los ejemplos derivan, salta
 * aquí.
 */
const DIR = join(import.meta.dirname, '..', 'examples')
const read = (f: string): string => readFileSync(join(DIR, f), 'utf-8')

const CTAMOV01 = read('ctamov01.cbl')
const VALIDA01 = read('valida01.cbl')
const FECHA01 = read('fecha01.cbl')
const COPYBOOKS = new Map([
  ['CTAMOVFD', read('ctamovfd.cpy')],
  ['ESTADOS', read('estados.cpy')],
  ['SQLCA', read('sqlca.cpy')],
])

function analyze(src: string, copybooks = new Map<string, string>()) {
  const data = parse(src, copybooks)
  const flow = parseFlow(src)
  const inventory = parseInventory(src)
  return { data, flow, inventory, advisories: checkAdvisories(src, data, flow, inventory), references: collectReferences(src, data) }
}

describe('ejemplos: la cadena de demo se analiza sin huecos', () => {
  const cases: [string, string, Map<string, string>][] = [
    ['CTAMOV01', CTAMOV01, COPYBOOKS],
    ['VALIDA01', VALIDA01, new Map([['ESTADOS', read('estados.cpy')]])],
    ['FECHA01', FECHA01, new Map()],
  ]

  for (const [name, src, cb] of cases) {
    it(`${name}: cero copybooks/destinos ausentes, cero nombres sin resolver`, () => {
      const { data, flow, references } = analyze(src, cb)
      expect(data.missingCopybooks).toEqual([])
      expect(flow.fragment).toBe(false)
      expect(flow.missingTargets).toEqual([])
      expect(flow.nestedPrograms).toEqual([])
      expect(references.unknownNames).toEqual([])
    })
  }
})

describe('ejemplos: avisos plantados', () => {
  it('CTAMOV01 dispara SOLO goto-crosses-section (GO TO de PROCESO a FIN)', () => {
    const { advisories } = analyze(CTAMOV01, COPYBOOKS)
    expect(advisories.map(a => a.rule)).toEqual(['goto-crosses-section'])
  })

  it('VALIDA01 dispara SOLO stop-run-in-subprogram (STOP RUN en RECHAZAR)', () => {
    const { advisories } = analyze(VALIDA01, new Map([['ESTADOS', read('estados.cpy')]]))
    expect(advisories.map(a => a.rule)).toEqual(['stop-run-in-subprogram'])
    expect(advisories[0]!.paragraph).toBe('RECHAZAR')
  })

  it('FECHA01 no dispara ningún aviso', () => {
    expect(analyze(FECHA01).advisories).toEqual([])
  })
})

describe('ejemplos: inventario de CTAMOV01', () => {
  const { inventory, flow } = analyze(CTAMOV01, COPYBOOKS)

  it('dos ficheros con OPEN y CLOSE, y un cursor DB2 completo', () => {
    expect(inventory.files.map(f => f.name).sort()).toEqual(['MOV-FILE', 'RPT-FILE'])
    for (const file of inventory.files) {
      const verbs = new Set(file.operations.map(o => o.verb))
      expect(verbs.has('OPEN')).toBe(true)
      expect(verbs.has('CLOSE')).toBe(true)
    }
    expect(inventory.tables).toEqual(['TARIFAS'])
    const cur = inventory.cursors.find(c => c.name === 'CUR-TARIFA')!
    expect([cur.declared, cur.opened, cur.fetched, cur.closed]).toEqual([true, true, true, true])
  })

  it('usa SECTIONs (INICIO / PROCESO / FIN)', () => {
    const sections = flow.paragraphs.filter(p => p.kind === 'section').map(p => p.name)
    expect(sections).toEqual(['INICIO', 'PROCESO', 'FIN'])
  })
})

describe('ejemplos: la cadena entre programas enlaza', () => {
  it('CTAMOV01 llama a VALIDA01 y a FECHA01, ambos resueltos', () => {
    const linked = linkPrograms(
      new Map([
        ['ctamov01.cbl', CTAMOV01],
        ['valida01.cbl', VALIDA01],
        ['fecha01.cbl', FECHA01],
      ]),
    )
    expect(linked.programs.map(p => p.name).sort()).toEqual(['CTAMOV01', 'FECHA01', 'VALIDA01'])
    expect(linked.missingPrograms).toEqual([])
    const targets = linked.calls.filter(c => c.fromProgram === 'CTAMOV01').map(c => c.toProgram).sort()
    expect(targets).toEqual(['FECHA01', 'VALIDA01'])
    expect(linked.calls.every(c => c.resolved)).toBe(true)
  })
})

describe('ejemplos: la traza de datos recorre la cadena de cálculo', () => {
  const { references } = analyze(CTAMOV01, COPYBOOKS)

  it('el importe del registro llega hasta la línea del informe', () => {
    const down = traceField(references, 'MOV-IMPORTE', 'downstream')
    const full = down.paths.find(p => p.nodes.includes('RPT-REGISTRO'))!
    expect(full.nodes).toEqual([
      'MOV-IMPORTE',
      'WS-BRUTO',
      'WS-INTERES',
      'WS-TOTAL',
      'WS-TOTAL-ED',
      'RPT-REGISTRO',
    ])
  })

  it('RPT-REGISTRO tiene varios orígenes, uno de ellos MOV-IMPORTE', () => {
    const up = traceField(references, 'RPT-REGISTRO', 'upstream')
    const roots = new Set(up.paths.map(p => p.nodes[p.nodes.length - 1]))
    expect(roots.has('MOV-IMPORTE')).toBe(true)
  })
})
