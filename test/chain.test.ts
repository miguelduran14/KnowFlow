import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { linkPrograms } from '../src/linker.js'
import { linkedFlowToMermaid } from '../src/mermaid.js'

const CASES_DIR = join(import.meta.dirname, 'fixtures', 'chain')

function loadCase(name: string): Map<string, string> {
  const dir = join(CASES_DIR, name)
  const sources = new Map<string, string>()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.cbl')) continue
    sources.set(file, readFileSync(join(dir, file), 'utf-8'))
  }
  return sources
}

describe('linkPrograms', () => {
  it('identifies each program by its PROGRAM-ID', () => {
    const linked = linkPrograms(loadCase('three-programs'))

    expect(linked.programs.map(p => p.name).sort()).toEqual(['AUDITPRG', 'MAINPROG', 'VALIDPRG'])
  })

  it('resolves calls that reach a supplied program', () => {
    const linked = linkPrograms(loadCase('three-programs'))

    const mainToValid = linked.calls.find(
      c => c.fromProgram === 'MAINPROG' && c.toProgram === 'VALIDPRG',
    )
    expect(mainToValid).toMatchObject({ resolved: true, dynamic: false, fromParagraph: 'MAIN-PARA' })

    const validToAudit = linked.calls.find(
      c => c.fromProgram === 'VALIDPRG' && c.toProgram === 'AUDITPRG',
    )
    expect(validToAudit).toMatchObject({ resolved: true, fromParagraph: 'CHECK-PARA' })
  })

  it('lists literal calls whose source was not supplied', () => {
    const linked = linkPrograms(loadCase('three-programs'))

    expect(linked.missingPrograms).toEqual(['ABSENTPR'])
    const absent = linked.calls.find(c => c.toProgram === 'ABSENTPR')
    expect(absent).toMatchObject({ resolved: false, dynamic: false })
  })

  it('never resolves a dynamic call, and keeps it out of missingPrograms', () => {
    const linked = linkPrograms(loadCase('three-programs'))

    const dynamic = linked.calls.find(c => c.dynamic)
    expect(dynamic).toMatchObject({ toProgram: 'WS-NEXT-PROG', resolved: false })
    // El destino real depende de una variable: no es un programa que falte
    // por aportar, así que no puede aparecer como tal.
    expect(linked.missingPrograms).not.toContain('WS-NEXT-PROG')
  })

  it('does not resolve a dynamic call even when a program of that name exists', () => {
    const sources = new Map([
      [
        'CALLER.cbl',
        [
          '       IDENTIFICATION DIVISION.',
          '       PROGRAM-ID. CALLER.',
          '       PROCEDURE DIVISION.',
          '       MAIN-PARA.',
          '           CALL WS-TARGET.',
        ].join('\n'),
      ],
      [
        'WS-TARGET.cbl',
        [
          '       IDENTIFICATION DIVISION.',
          '       PROGRAM-ID. WS-TARGET.',
          '       PROCEDURE DIVISION.',
          '       ONLY-PARA.',
          '           GOBACK.',
        ].join('\n'),
      ],
    ])

    const linked = linkPrograms(sources)
    const call = linked.calls.find(c => c.dynamic)

    expect(call).toMatchObject({ toProgram: 'WS-TARGET', resolved: false })
  })

  it('falls back to the file name when a program declares no PROGRAM-ID', () => {
    const sources = new Map([['NOIDPROG.cbl', '       PROCEDURE DIVISION.\n       ONLY-PARA.\n           GOBACK.\n']])

    const linked = linkPrograms(sources)

    expect(linked.programs[0]).toMatchObject({ name: 'NOIDPROG', sourceName: 'NOIDPROG.cbl' })
  })
})

describe('linkedFlowToMermaid', () => {
  it('renders every program and marks unresolved destinations', () => {
    const mermaid = linkedFlowToMermaid(linkPrograms(loadCase('three-programs')))

    expect(mermaid).toContain('flowchart LR')
    expect(mermaid).toContain('MAINPROG["MAINPROG"]')
    expect(mermaid).toContain('ABSENTPR["ABSENTPR — fuente no aportado"]')
    expect(mermaid).toContain('WS_NEXT_PROG["WS-NEXT-PROG — destino dinámico"]')
    expect(mermaid).toContain('MAINPROG -->|"CALL (MAIN-PARA)"| VALIDPRG')
    expect(mermaid).toContain('MAINPROG -->|"CALL dinámica (REPORT-PARA)"| WS_NEXT_PROG')
  })
})
