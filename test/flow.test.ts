import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFlow } from '../src/flow-parser.js'
import { flowToMermaid } from '../src/mermaid.js'

const CASES_DIR = join(import.meta.dirname, 'fixtures', 'flow')

const cases = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)

describe('procedure-division flow fixtures', () => {
  for (const caseName of cases) {
    const caseDir = join(CASES_DIR, caseName)

    it(caseName, () => {
      const source = readFileSync(join(caseDir, 'main.cbl'), 'utf-8')
      const expected = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf-8'))
      expect(parseFlow(source)).toEqual(expected)
    })

    if (existsSync(join(caseDir, 'expected.mmd'))) {
      it(`${caseName} (mermaid)`, () => {
        const source = readFileSync(join(caseDir, 'main.cbl'), 'utf-8')
        const expected = readFileSync(join(caseDir, 'expected.mmd'), 'utf-8')
        expect(flowToMermaid(parseFlow(source))).toBe(expected)
      })
    }
  }
})
