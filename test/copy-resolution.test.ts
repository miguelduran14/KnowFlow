import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.js'

const CASES_DIR = join(import.meta.dirname, 'fixtures', 'copy-resolution')

const cases = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)

describe('COPY / EXEC SQL INCLUDE resolution fixtures', () => {
  for (const caseName of cases) {
    it(caseName, () => {
      const caseDir = join(CASES_DIR, caseName)
      const main = readFileSync(join(caseDir, 'main.cpy'), 'utf-8')

      const copybooks = new Map<string, string>()
      const membersDir = join(caseDir, 'members')
      if (existsSync(membersDir)) {
        for (const file of readdirSync(membersDir)) {
          const memberName = file.replace(/\.cpy$/, '').toUpperCase()
          copybooks.set(memberName, readFileSync(join(membersDir, file), 'utf-8'))
        }
      }

      const expected = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf-8'))
      const result = parse(main, copybooks)
      expect(result).toEqual(expected)
    })
  }
})
