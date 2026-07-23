import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.js'

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures')
const INPUT_DIR = join(FIXTURES_DIR, 'input')
const EXPECTED_DIR = join(FIXTURES_DIR, 'expected')

const fixtures = readdirSync(INPUT_DIR)
  .filter(f => f.endsWith('.cbl') || f.endsWith('.cpy'))

describe('parser golden-file fixtures', () => {
  if (fixtures.length === 0) {
    it.todo('no fixtures yet — add a .cbl/.cpy file to test/fixtures/input/')
    return
  }

  for (const file of fixtures) {
    const baseName = file.replace(/\.(cbl|cpy)$/, '')
    it(`${baseName}`, () => {
      const source = readFileSync(join(INPUT_DIR, file), 'utf-8')
      const expectedPath = join(EXPECTED_DIR, `${baseName}.json`)
      const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'))

      const result = parse(source)
      expect(result).toEqual(expected)
    })
  }
})
