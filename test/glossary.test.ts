import { describe, expect, it } from 'vitest'
import { GLOSSARY_BY_ID, segmentText } from '../src/glossary.js'

/** "type|texto" — la forma más rápida de leer un segmento en una aserción. */
function serialize(text: string): string[] {
  return segmentText(text).map(s => (s.term ? `${s.term.id}|${s.text}` : `_|${s.text}`))
}

describe('detector de términos del glosario', () => {
  it('marca los términos más específicos primero (COMP-3 gana a COMP)', () => {
    expect(serialize('Un COMP-3 no es un COMP.')).toEqual([
      '_|Un ',
      'comp3|COMP-3',
      '_| no es un ',
      'comp|COMP',
      '_|.',
    ])
  })

  it('respeta las palabras COBOL: READ dentro de 2100-READ no cuenta', () => {
    const s = serialize('PERFORM 2100-READ THRU READ-NEXT-EXIT')
    expect(s.find(x => x.startsWith('read|'))).toBeUndefined()
    // pero el PERFORM sí se marca
    expect(s.find(x => x.startsWith('perform|'))).toBe('perform|PERFORM')
  })

  it('detecta multi-palabra: GO TO, EXEC SQL, STOP RUN', () => {
    expect(serialize('GO TO 9999-ABEND')[0]).toBe('goto|GO TO')
    expect(serialize('el bloque EXEC SQL SELECT')[1]).toBe('execsql|EXEC SQL')
    expect(serialize('acaba con STOP RUN')[1]).toBe('ends|STOP RUN')
  })

  it('PIC X(11) se marca entero, con paréntesis y dígitos', () => {
    const s = serialize('el campo PIC X(11) es la clave')
    expect(s.find(x => x.startsWith('picx|'))).toBe('picx|PIC X(11)')
  })

  it('los términos en español (niveles 88) también se detectan', () => {
    const s = serialize('El estado usa niveles 88 para legibilidad')
    expect(s.find(x => x.startsWith('level88|'))).toBe('level88|niveles 88')
  })

  it('un texto sin términos devuelve un solo segmento plano', () => {
    const s = segmentText('esto es texto sin nada especial')
    expect(s).toEqual([{ text: 'esto es texto sin nada especial' }])
  })

  it('el índice por id permite recuperar la ficha completa', () => {
    expect(GLOSSARY_BY_ID['comp3']?.term).toBe('COMP-3')
    expect(GLOSSARY_BY_ID['comp3']?.short).toMatch(/decimal/i)
    expect(GLOSSARY_BY_ID['level88']?.example).toContain('88')
  })
})
