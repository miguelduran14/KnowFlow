import { describe, expect, it } from 'vitest'
import { checkAdvisories } from '../src/advisories.js'
import { parseFlow } from '../src/flow-parser.js'
import { parseInventory } from '../src/inventory.js'
import { parse } from '../src/parser.js'
import type { AdvisoryRule } from '../src/types.js'

function analyze(source: string) {
  const data = parse(source, new Map())
  const flow = parseFlow(source)
  const inventory = parseInventory(source)
  return checkAdvisories(source, data, flow, inventory)
}

function rules(advisories: { rule: AdvisoryRule }[]): AdvisoryRule[] {
  return advisories.map(a => a.rule)
}

describe('avisos: STOP RUN en subprograma', () => {
  it('avisa cuando el programa tiene LINKAGE SECTION y un párrafo hace STOP RUN', () => {
    const source = [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. SUBPRG.',
      '       DATA DIVISION.',
      '       LINKAGE SECTION.',
      '       01 LK-PARM PIC X(1).',
      '       PROCEDURE DIVISION USING LK-PARM.',
      '       MAIN-PARA.',
      '           STOP RUN.',
    ].join('\n')
    const advisories = analyze(source)
    expect(rules(advisories)).toContain('stop-run-in-subprogram')
    const hit = advisories.find(a => a.rule === 'stop-run-in-subprogram')!
    expect(hit.paragraph).toBe('MAIN-PARA')
    expect(hit.line).toBe(8)
  })

  it('no avisa si termina con GOBACK', () => {
    const source = [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. SUBPRG.',
      '       DATA DIVISION.',
      '       LINKAGE SECTION.',
      '       01 LK-PARM PIC X(1).',
      '       PROCEDURE DIVISION USING LK-PARM.',
      '       MAIN-PARA.',
      '           GOBACK.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('stop-run-in-subprogram')
  })

  it('no avisa si el programa no tiene LINKAGE (programa principal normal)', () => {
    const source = [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. MAINPRG.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('stop-run-in-subprogram')
  })

  it('no confunde STOP RUN dentro de un literal DISPLAY con la sentencia real', () => {
    const source = [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. SUBPRG.',
      '       DATA DIVISION.',
      '       LINKAGE SECTION.',
      '       01 LK-PARM PIC X(1).',
      '       PROCEDURE DIVISION USING LK-PARM.',
      '       MAIN-PARA.',
      "           DISPLAY 'STOP RUN NO ES ESTO'",
      '           GOBACK.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('stop-run-in-subprogram')
  })
})

describe('avisos: GO TO cruza de sección', () => {
  it('avisa cuando un GO TO salta de una sección a otra', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       SECCION-A SECTION.',
      '       PARA-A.',
      '           GO TO PARA-B.',
      '       SECCION-B SECTION.',
      '       PARA-B.',
      '           STOP RUN.',
    ].join('\n')
    const advisories = analyze(source)
    expect(rules(advisories)).toContain('goto-crosses-section')
    const hit = advisories.find(a => a.rule === 'goto-crosses-section')!
    expect(hit.message).toContain('SECCION-A')
    expect(hit.message).toContain('SECCION-B')
  })

  it('no avisa cuando el GO TO se queda dentro de la misma sección', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       SECCION-A SECTION.',
      '       PARA-A.',
      '           GO TO PARA-B.',
      '       PARA-B.',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('goto-crosses-section')
  })

  it('no avisa en un programa sin SECTIONs', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       PARA-A.',
      '           GO TO PARA-B.',
      '       PARA-B.',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('goto-crosses-section')
  })

  it('avisa aunque la grafía del GO TO no coincida en mayúsculas (COBOL es case-insensitive)', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       SECCION-A SECTION.',
      '       PARA-A.',
      '           GO TO Para-B.',
      '       SECCION-B SECTION.',
      '       PARA-B.',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).toContain('goto-crosses-section')
  })
})

describe('avisos: UPDATE/DELETE sin WHERE', () => {
  it('avisa de un UPDATE sin WHERE', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL UPDATE CLIENTES SET SALDO = 0 END-EXEC.',
    ].join('\n')
    const advisories = analyze(source)
    expect(rules(advisories)).toContain('sql-write-without-where')
    expect(advisories.find(a => a.rule === 'sql-write-without-where')!.title).toBe('UPDATE sin WHERE')
  })

  it('avisa de un DELETE sin WHERE', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL DELETE FROM CLIENTES END-EXEC.',
    ].join('\n')
    expect(rules(analyze(source))).toContain('sql-write-without-where')
  })

  it('no avisa cuando el UPDATE lleva WHERE', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      "           EXEC SQL UPDATE CLIENTES SET SALDO = 0 WHERE ID = :WS-ID END-EXEC.",
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('sql-write-without-where')
  })

  it('no duplica el aviso cuando el UPDATE ya es dinámico (PREPARE/EXECUTE)', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL EXECUTE STMT END-EXEC.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('sql-write-without-where')
  })

  it('no avisa de un SELECT (solo aplica a UPDATE/DELETE)', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL SELECT COL INTO :WS-C FROM CLIENTES END-EXEC.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('sql-write-without-where')
  })
})

describe('avisos: fichero abierto sin cerrar', () => {
  it('avisa cuando un fichero de ESCRITURA (OUTPUT) queda sin CLOSE', () => {
    const source = [
      '       ENVIRONMENT DIVISION.',
      '       INPUT-OUTPUT SECTION.',
      '       FILE-CONTROL.',
      '           SELECT RPT-FILE ASSIGN TO RPTDD.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           OPEN OUTPUT RPT-FILE',
      '           STOP RUN.',
    ].join('\n')
    const advisories = analyze(source)
    expect(rules(advisories)).toContain('file-opened-not-closed')
    expect(advisories.find(a => a.rule === 'file-opened-not-closed')!.title).toBe('RPT-FILE sin CLOSE')
  })

  it('avisa también en I-O y EXTEND', () => {
    for (const mode of ['I-O', 'EXTEND']) {
      const source = [
        '       ENVIRONMENT DIVISION.',
        '       INPUT-OUTPUT SECTION.',
        '       FILE-CONTROL.',
        '           SELECT F ASSIGN TO FDD.',
        '       PROCEDURE DIVISION.',
        '       MAIN-PARA.',
        `           OPEN ${mode} F`,
        '           STOP RUN.',
      ].join('\n')
      expect(rules(analyze(source))).toContain('file-opened-not-closed')
    }
  })

  it('NO avisa de un OPEN INPUT sin CLOSE (un lector no arriesga datos)', () => {
    const source = [
      '       ENVIRONMENT DIVISION.',
      '       INPUT-OUTPUT SECTION.',
      '       FILE-CONTROL.',
      '           SELECT MOV-FILE ASSIGN TO MOVDD.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           OPEN INPUT MOV-FILE',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('file-opened-not-closed')
  })

  it('no avisa cuando el fichero de escritura se cierra', () => {
    const source = [
      '       ENVIRONMENT DIVISION.',
      '       INPUT-OUTPUT SECTION.',
      '       FILE-CONTROL.',
      '           SELECT RPT-FILE ASSIGN TO RPTDD.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           OPEN OUTPUT RPT-FILE',
      '           CLOSE RPT-FILE',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('file-opened-not-closed')
  })

  it('no avisa de un fichero declarado sin usar (sin OPEN, nada que cerrar)', () => {
    const source = [
      '       ENVIRONMENT DIVISION.',
      '       INPUT-OUTPUT SECTION.',
      '       FILE-CONTROL.',
      '           SELECT MOV-FILE ASSIGN TO MOVDD.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('file-opened-not-closed')
  })
})

describe('avisos: cursores DB2', () => {
  it('avisa de un cursor abierto sin CLOSE', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL DECLARE CLI-CUR CURSOR FOR',
      '               SELECT ID FROM CLIENTES',
      '           END-EXEC',
      '           EXEC SQL OPEN CLI-CUR END-EXEC',
      '           STOP RUN.',
    ].join('\n')
    const advisories = analyze(source)
    expect(rules(advisories)).toContain('cursor-opened-not-closed')
    const hit = advisories.find(a => a.rule === 'cursor-opened-not-closed')!
    expect(hit.line).toBe(6)
  })

  it('no avisa cuando el cursor se cierra', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL DECLARE CLI-CUR CURSOR FOR',
      '               SELECT ID FROM CLIENTES',
      '           END-EXEC',
      '           EXEC SQL OPEN CLI-CUR END-EXEC',
      '           EXEC SQL CLOSE CLI-CUR END-EXEC',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('cursor-opened-not-closed')
  })

  it('avisa de un FETCH sin OPEN cuando el cursor sí está declarado en el fuente', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL DECLARE CLI-CUR CURSOR FOR',
      '               SELECT ID FROM CLIENTES',
      '           END-EXEC',
      '           EXEC SQL FETCH CLI-CUR INTO :WS-ID END-EXEC',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).toContain('cursor-fetched-without-open')
  })

  it('no avisa de FETCH sin OPEN si el cursor tampoco está declarado (podría venir de un copybook ausente)', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL FETCH CLI-CUR INTO :WS-ID END-EXEC',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('cursor-fetched-without-open')
  })
})

describe('avisos: orden y ausencia', () => {
  it('un programa limpio no genera avisos', () => {
    const source = [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. LIMPIO.',
      '       ENVIRONMENT DIVISION.',
      '       INPUT-OUTPUT SECTION.',
      '       FILE-CONTROL.',
      '           SELECT MOV-FILE ASSIGN TO MOVDD.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           OPEN INPUT MOV-FILE',
      '           CLOSE MOV-FILE',
      '           STOP RUN.',
    ].join('\n')
    expect(analyze(source)).toEqual([])
  })

  it('los avisos salen ordenados por línea de fuente', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL DELETE FROM CLIENTES END-EXEC.',
      '           EXEC SQL UPDATE CUENTAS SET SALDO = 0 END-EXEC.',
    ].join('\n')
    const advisories = analyze(source)
    const lines = advisories.map(a => a.line)
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
  })
})

describe('avisos: ALTER', () => {
  it('avisa de un ALTER, con su párrafo y su línea', () => {
    const source = [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. LEGACY.',
      '       PROCEDURE DIVISION.',
      '       MAIN.',
      '           ALTER SW-PARA TO PROCEED TO ROUTINE-B.',
      '           GO TO SW-PARA.',
      '       SW-PARA.',
      '           GO TO ROUTINE-A.',
      '       ROUTINE-A.',
      "           DISPLAY 'A'.",
      '       ROUTINE-B.',
      "           DISPLAY 'B'.",
    ].join('\n')
    const advisories = analyze(source)
    expect(rules(advisories)).toContain('alter-statement')
    const hit = advisories.find(a => a.rule === 'alter-statement')!
    expect(hit.paragraph).toBe('MAIN')
    expect(hit.line).toBe(5)
  })

  it('reconoce ALTER sin PROCEED TO', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN.',
      '           ALTER SW TO ROUTINE-B.',
    ].join('\n')
    expect(rules(analyze(source))).toContain('alter-statement')
  })

  it('no avisa cuando no hay ALTER', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN.',
      '           GO TO ROUTINE-A.',
      '       ROUTINE-A.',
      "           DISPLAY 'A'.",
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('alter-statement')
  })
})

describe('avisos: código muerto', () => {
  it('marca un párrafo inalcanzable', () => {
    const source = [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. DEAD.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           PERFORM USED-PARA',
      '           STOP RUN.',
      '       USED-PARA.',
      "           DISPLAY 'X'",
      '           GOBACK.',
      '       DEAD-PARA.',
      "           DISPLAY 'DEAD'.",
    ].join('\n')
    const advisories = analyze(source)
    expect(rules(advisories)).toContain('unreachable-paragraph')
    const hit = advisories.find(a => a.rule === 'unreachable-paragraph')!
    expect(hit.paragraph).toBe('DEAD-PARA')
  })

  it('no marca un párrafo alcanzable por caída natural', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           PERFORM A-PARA',
      '           STOP RUN.',
      '       A-PARA.',
      "           DISPLAY 'A'.",
      '       B-PARA.',
      "           DISPLAY 'B'.",
    ].join('\n')
    // B-PARA se alcanza por caída natural desde A-PARA.
    expect(rules(analyze(source))).not.toContain('unreachable-paragraph')
  })

  it('no marca inalcanzables si la PROCEDURE tiene un COPY (flujo incompleto)', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           COPY EXTRA.',
      '           STOP RUN.',
      '       DEAD-PARA.',
      "           DISPLAY 'D'.",
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('unreachable-paragraph')
  })

  it('no marca inalcanzables si hay un ALTER (redirige en ejecución)', () => {
    const source = [
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           ALTER SW TO PROCEED TO DEAD-PARA',
      '           STOP RUN.',
      '       DEAD-PARA.',
      "           DISPLAY 'D'.",
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('unreachable-paragraph')
  })

  it('marca un cursor declarado y sin usar', () => {
    const source = [
      '       WORKING-STORAGE SECTION.',
      '           EXEC SQL DECLARE C1 CURSOR FOR SELECT A FROM T END-EXEC.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).toContain('unused-cursor')
  })

  it('no marca un cursor que sí se usa', () => {
    const source = [
      '       WORKING-STORAGE SECTION.',
      '           EXEC SQL DECLARE C1 CURSOR FOR SELECT A FROM T END-EXEC.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           EXEC SQL OPEN C1 END-EXEC',
      '           EXEC SQL FETCH C1 INTO :WS-A END-EXEC',
      '           EXEC SQL CLOSE C1 END-EXEC',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('unused-cursor')
  })

  it('marca un fichero declarado y sin operaciones', () => {
    const source = [
      '       ENVIRONMENT DIVISION.',
      '       INPUT-OUTPUT SECTION.',
      '       FILE-CONTROL.',
      '           SELECT UNUSED-FILE ASSIGN TO UNUDD.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           STOP RUN.',
    ].join('\n')
    const advisories = analyze(source)
    expect(rules(advisories)).toContain('unused-file')
    expect(advisories.find(a => a.rule === 'unused-file')!.title).toContain('UNUSED-FILE')
  })

  it('no marca un fichero que sí se usa', () => {
    const source = [
      '       ENVIRONMENT DIVISION.',
      '       INPUT-OUTPUT SECTION.',
      '       FILE-CONTROL.',
      '           SELECT MOV-FILE ASSIGN TO MOVDD.',
      '       PROCEDURE DIVISION.',
      '       MAIN-PARA.',
      '           OPEN INPUT MOV-FILE',
      '           STOP RUN.',
    ].join('\n')
    expect(rules(analyze(source))).not.toContain('unused-file')
  })
})
