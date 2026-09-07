import type { FieldReference, FieldUsage, ParseResult, ReferenceKind, ReferenceResult, SchemaField } from './types.js'
import { cleanLines, extractProgramIds, matchHeader, type SourceLine } from './source-lines.js'

/**
 * Where-used por campo: para cada data-name del esquema, dónde se LEE y
 * dónde se ESCRIBE en la PROCEDURE DIVISION, anclado a párrafo y línea.
 *
 * Misma disciplina que el resto del motor (ADR-0003): se reconoce un
 * subconjunto de verbos con reparto de roles bien definido (MOVE, COMPUTE,
 * la aritmética, SET, INITIALIZE, STRING/UNSTRING, INSPECT, READ/RETURN
 * INTO, WRITE/REWRITE FROM, PERFORM VARYING, los contextos de condición) y
 * los host variables de EXEC SQL/CICS. Todo lo demás se MARCA, no se
 * inventa:
 *   - un argumento BY REFERENCE de una CALL, un MOVE CORRESPONDING, un
 *     host variable de SQL dinámico o un homónimo del esquema → `uncertain`;
 *   - una ocurrencia real de un campo en un verbo que el motor no modela
 *     todavía → `unclassified` (se toca ahí, pero no se afirma el rol);
 *   - un nombre en posición de operando que no casa con el esquema →
 *     `unknownNames` (puede estar en un copybook ausente).
 *
 * El rol se decide por la SENTENCIA completa, no por la línea: una MOVE
 * puede repartirse en varias líneas y el operando destino está tras el TO.
 * Por eso se acumula el texto hasta el punto y se trocea por verbos, con
 * un mapa offset→línea para anclar cada token a su línea real del fuente.
 */
export function collectReferences(source: string, data?: ParseResult | undefined): ReferenceResult {
  const cleaned = cleanLines(source)
  const procIdx = cleaned.findIndex(l => PROCEDURE_HDR_RE.test(l.masked))
  const fragment = procIdx === -1

  // Sin esquema no hay contra qué resolver los nombres: se devuelve vacío
  // (la GUI siempre tiene `data` cuando tiene fuente).
  if (!data || data.records.length === 0) {
    return { fields: [], unknownNames: [], fragment }
  }

  // ── Índice del esquema: nombres conocidos, mapa 88→padre y homónimos ──
  const nameCounts = new Map<string, number>()
  const parentOf88 = new Map<string, string>()
  const bump = (u: string): void => {
    nameCounts.set(u, (nameCounts.get(u) ?? 0) + 1)
  }
  const walk = (f: SchemaField): void => {
    if (f.type !== 'unresolved-copy') {
      const u = f.name.toUpperCase()
      bump(u)
      for (const cv of f.conditionValues ?? []) parentOf88.set(cv.name.toUpperCase(), u)
      for (const g of f.renamesGroups ?? []) bump(g.name.toUpperCase())
    }
    for (const c of f.children) walk(c)
  }
  for (const r of data.records) walk(r)
  const known = new Set(nameCounts.keys())
  const ambiguousNames = new Set([...nameCounts].filter(([, n]) => n > 1).map(([k]) => k))

  /** Resuelve un token a un campo del esquema (o a su padre, si es un 88). */
  const resolve = (
    u: string,
  ): { name: string; via88?: string; ambiguous: boolean } | undefined => {
    if (known.has(u)) return { name: u, ambiguous: ambiguousNames.has(u) }
    const parent = parentOf88.get(u)
    if (parent) return { name: parent, via88: u, ambiguous: ambiguousNames.has(parent) }
    return undefined
  }

  const unknownNames = new Set<string>()
  const all: FieldReference[] = []
  const dedup = new Set<string>()

  // Estado del recorrido, mutado por el bucle principal.
  const ids = extractProgramIds(cleaned)
  const implicitEntry = ids[0]?.name ?? 'MAIN'
  const nestedFrom = ids[1]?.line
  let paragraph: string | undefined
  let inProcedure = false
  let procHeaderOpen = false
  // Fragmento puro (sin ninguna cabecera de división): se analiza entero
  // como cuerpo de PROCEDURE. Si hay OTRA división pero no PROCEDURE, no
  // hay nada que analizar (no es un fragmento de procedimiento).
  if (procIdx === -1 && !cleaned.some(l => OTHER_DIV_RE.test(l.masked))) inProcedure = true

  // ── Ocurrencia cruda: nombre + rol + offset en el buffer de sentencia ──
  interface Raw {
    name: string
    kind: ReferenceKind
    offset: number
    uncertain?: boolean
    via88?: string
    ambiguous?: boolean
  }

  /** Un token resuelto como una ocurrencia, o undefined si no casa. */
  const oneRef = (token: string, kind: ReferenceKind, offset: number, uncertain = false): Raw | undefined => {
    const r = resolve(token.toUpperCase())
    if (!r) return undefined
    return {
      name: r.name,
      kind,
      offset,
      ...(uncertain || r.ambiguous ? { uncertain: true } : {}),
      ...(r.via88 ? { via88: r.via88 } : {}),
      ...(r.ambiguous ? { ambiguous: true } : {}),
    }
  }

  /**
   * Todos los identificadores de `text` que resuelven a un campo, como
   * ocurrencias de `kind`. Los que no resuelven y parecen un nombre se
   * apuntan en `unknownNames` (salvo que `collectUnknown` sea false: los
   * verbos no modelados no deben ensuciar esa lista).
   */
  const refsIn = (
    text: string,
    base: number,
    kind: ReferenceKind,
    opts: { uncertain?: boolean; collectUnknown?: boolean } = {},
  ): Raw[] => {
    const out: Raw[] = []
    for (const m of text.matchAll(IDENT_RE)) {
      const tok = m[0]
      const u = tok.toUpperCase()
      if (NON_NAME.has(u)) continue
      const at = base + (m.index ?? 0)
      const o = oneRef(tok, kind, at, opts.uncertain ?? false)
      if (o) out.push(o)
      else if (opts.collectUnknown !== false && tok.length > 1) unknownNames.add(u)
    }
    return out
  }

  // ── Handlers por verbo — cada uno devuelve las ocurrencias del chunk ──
  // `chunk` es el texto enmascarado de la sentencia; `base` su offset
  // absoluto en el buffer. Las funciones de recorte trabajan sobre el
  // enmascarado (literales en blanco) para no confundir un `TO` dentro de
  // una cadena con la palabra clave.

  const moveRefs = (chunk: string, base: number): Raw[] => {
    const corr = CORRESPONDING_RE.test(chunk)
    const toI = kw(chunk, 'TO')
    if (toI < 0) return refsIn(chunk, base, 'unclassified', { collectUnknown: false })
    const opt = corr ? { uncertain: true } : {}
    return [
      ...refsIn(chunk.slice(0, toI), base, 'read', opt),
      ...refsIn(chunk.slice(toI + 2), base + toI + 2, 'write', opt),
    ]
  }

  const computeRefs = (chunk: string, base: number): Raw[] => {
    const eqI = chunk.indexOf('=')
    if (eqI < 0) return refsIn(chunk, base, 'unclassified', { collectUnknown: false })
    return [
      ...refsIn(chunk.slice(0, eqI), base, 'write'),
      ...refsIn(chunk.slice(eqI + 1), base + eqI + 1, 'read'),
    ]
  }

  const arithRefs = (verb: string, chunk: string, base: number): Raw[] => {
    const linkKws = verb === 'ADD' ? ['TO'] : verb === 'SUBTRACT' ? ['FROM'] : verb === 'MULTIPLY' ? ['BY'] : ['INTO', 'BY']
    const linkI = kwAny(chunk, linkKws)
    const givI = kw(chunk, 'GIVING')
    const remI = kw(chunk, 'REMAINDER')
    if (givI >= 0) {
      // Todo lo anterior a GIVING (fuentes + el operando TO/FROM/BY/INTO)
      // se lee; el/los operando(s) tras GIVING (y REMAINDER) se escriben.
      const out = refsIn(chunk.slice(0, givI), base, 'read')
      const wEnd = remI > givI ? remI : chunk.length
      out.push(...refsIn(chunk.slice(givI + 6, wEnd), base + givI + 6, 'write'))
      if (remI >= 0) out.push(...refsIn(chunk.slice(remI + 9), base + remI + 9, 'write'))
      return out
    }
    if (linkI >= 0) {
      const linkLen = /^[A-Za-z]+/.exec(chunk.slice(linkI))?.[0].length ?? 2
      // Sin GIVING, el operando tras TO/FROM/BY/INTO se lee Y se escribe.
      return [
        ...refsIn(chunk.slice(0, linkI), base, 'read'),
        ...refsIn(chunk.slice(linkI + linkLen), base + linkI + linkLen, 'read-write'),
      ]
    }
    return refsIn(chunk, base, 'unclassified', { collectUnknown: false })
  }

  const setRefs = (chunk: string, base: number): Raw[] => {
    const ud = /(?<![\w-])(?:UP|DOWN)\s+BY(?![\w-])/i.exec(chunk)
    if (ud) {
      const byEnd = ud.index + ud[0].length
      return [
        ...refsIn(chunk.slice(0, ud.index), base, 'read-write'),
        ...refsIn(chunk.slice(byEnd), base + byEnd, 'read'),
      ]
    }
    const toI = kw(chunk, 'TO')
    if (toI < 0) return refsIn(chunk, base, 'unclassified', { collectUnknown: false })
    const tgt = refsIn(chunk.slice(0, toI), base, 'write')
    const val = chunk.slice(toI + 2)
    // SET <88> TO TRUE/FALSE: el 88 resuelve a su campo padre (write via88);
    // no hay valor legible que leer.
    if (/(?<![\w-])(?:TRUE|FALSE)(?![\w-])/i.test(val)) return tgt
    return [...tgt, ...refsIn(val, base + toI + 2, 'read')]
  }

  const initRefs = (chunk: string, base: number): Raw[] => {
    const rI = kw(chunk, 'REPLACING')
    const out = refsIn(chunk.slice(0, rI >= 0 ? rI : chunk.length), base, 'write')
    if (rI >= 0) out.push(...refsIn(chunk.slice(rI), base + rI, 'read'))
    return out
  }

  const sideRefs = (chunk: string, base: number, stopKw: string, kind: ReferenceKind): Raw[] => {
    const i = kw(chunk, stopKw)
    return refsIn(i >= 0 ? chunk.slice(0, i) : chunk, base, kind)
  }

  const stringRefs = (chunk: string, base: number): Raw[] => {
    const intoI = kw(chunk, 'INTO')
    if (intoI < 0) return refsIn(chunk, base, 'unclassified', { collectUnknown: false })
    const out = refsIn(chunk.slice(0, intoI), base, 'read') // fuentes + operando DELIMITED BY
    const rest = chunk.slice(intoI + 4)
    const rb = base + intoI + 4
    const ptrI = kw(rest, 'POINTER')
    const ovI = kwAny(rest, ['ON', 'NOT', 'END-STRING'])
    const wEnd = ptrI >= 0 ? ptrI : ovI >= 0 ? ovI : rest.length
    out.push(...refsIn(rest.slice(0, wEnd), rb, 'write'))
    if (ptrI >= 0) {
      const pEnd = ovI > ptrI ? ovI : rest.length
      out.push(...refsIn(rest.slice(ptrI + 7, pEnd), rb + ptrI + 7, 'read-write'))
    }
    return out
  }

  const unstringRefs = (chunk: string, base: number): Raw[] => {
    const intoI = kw(chunk, 'INTO')
    if (intoI < 0) return refsIn(chunk, base, 'unclassified', { collectUnknown: false })
    const out = refsIn(chunk.slice(0, intoI), base, 'read') // UNSTRING <origen> [DELIMITED BY <d>]
    const rest = chunk.slice(intoI + 4)
    const rb = base + intoI + 4
    const ptrI = kw(rest, 'POINTER')
    const endI = kwAny(rest, ['ON', 'NOT', 'END-UNSTRING'])
    const wEnd = ptrI >= 0 ? ptrI : endI >= 0 ? endI : rest.length
    // destinos + operandos de DELIMITER IN / COUNT IN / TALLYING IN
    out.push(...refsIn(rest.slice(0, wEnd), rb, 'write'))
    if (ptrI >= 0) {
      const seg = rest.slice(ptrI + 7, endI > ptrI ? endI : rest.length)
      const tI = kw(seg, 'TALLYING')
      if (tI >= 0) {
        out.push(...refsIn(seg.slice(0, tI), rb + ptrI + 7, 'read-write'))
        out.push(...refsIn(seg.slice(tI), rb + ptrI + 7 + tI, 'write'))
      } else {
        out.push(...refsIn(seg, rb + ptrI + 7, 'read-write'))
      }
    }
    return out
  }

  const inspectRefs = (chunk: string, base: number): Raw[] => {
    const opI = kwAny(chunk, ['TALLYING', 'REPLACING', 'CONVERTING'])
    const modifies = /(?<![\w-])(?:REPLACING|CONVERTING)(?![\w-])/i.test(chunk)
    // INSPECT <x> ... — INSPECT queda fuera (NON_NAME); x se lee, y además
    // se escribe si hay REPLACING/CONVERTING.
    const out = refsIn(chunk.slice(0, opI >= 0 ? opI : chunk.length), base, modifies ? 'read-write' : 'read')
    if (opI < 0) return out
    const rest = chunk.slice(opI)
    const rb = base + opI
    if (/^\s*TALLYING(?![\w-])/i.test(rest)) {
      const forI = kw(rest, 'FOR')
      out.push(...refsIn(rest.slice(0, forI >= 0 ? forI : rest.length), rb, 'write')) // contador
      if (forI >= 0) out.push(...refsIn(rest.slice(forI), rb + forI, 'read')) // ... BEFORE/AFTER INITIAL <x>
    } else {
      out.push(...refsIn(rest, rb, 'read')) // REPLACING/CONVERTING ... : operandos identificador se leen
    }
    return out
  }

  const readRefs = (chunk: string, base: number): Raw[] => {
    const out: Raw[] = []
    const intoI = kw(chunk, 'INTO')
    if (intoI >= 0) {
      const seg = chunk.slice(intoI + 4)
      const end = kwAny(seg, ['KEY', 'AT', 'INVALID', 'NOT', 'WITH', 'END-READ'])
      out.push(...refsIn(seg.slice(0, end >= 0 ? end : seg.length), base + intoI + 4, 'write'))
    }
    const keyI = kw(chunk, 'KEY')
    if (keyI >= 0) {
      const seg = chunk.slice(keyI + 3)
      const end = kwAny(seg, ['AT', 'INVALID', 'NOT', 'END-READ'])
      out.push(...refsIn(seg.slice(0, end >= 0 ? end : seg.length), base + keyI + 3, 'read'))
    }
    return out
  }

  const returnRefs = (chunk: string, base: number): Raw[] => {
    const intoI = kw(chunk, 'INTO')
    if (intoI < 0) return []
    const seg = chunk.slice(intoI + 4)
    const end = kwAny(seg, ['AT', 'NOT', 'END-RETURN'])
    return refsIn(seg.slice(0, end >= 0 ? end : seg.length), base + intoI + 4, 'write')
  }

  const writeRefs = (chunk: string, base: number): Raw[] => {
    const fromI = kw(chunk, 'FROM')
    // Primer identificador tras WRITE/REWRITE/RELEASE = el registro → se escribe.
    const out = refsIn(chunk.slice(0, fromI >= 0 ? fromI : chunk.length), base, 'write')
    if (fromI >= 0) {
      const seg = chunk.slice(fromI + 4)
      const end = kwAny(seg, ['BEFORE', 'AFTER', 'AT', 'INVALID', 'NOT', 'END-WRITE', 'END-REWRITE'])
      out.push(...refsIn(seg.slice(0, end >= 0 ? end : seg.length), base + fromI + 4, 'read'))
    }
    return out
  }

  const performRefs = (chunk: string, base: number): Raw[] => {
    const out: Raw[] = []
    const vI = kw(chunk, 'VARYING')
    if (vI >= 0) {
      const seg = chunk.slice(vI)
      const sb = base + vI
      for (const m of seg.matchAll(/(?<![\w-])(?:VARYING|AFTER)\s+([A-Za-z][\w-]*)/gi)) {
        const nameStart = (m.index ?? 0) + m[0].length - m[1]!.length
        const o = oneRef(m[1]!, 'write', sb + nameStart)
        if (o) out.push(o)
      }
      for (const m of seg.matchAll(/(?<![\w-])(?:FROM|BY)\s+([A-Za-z][\w-]*)/gi)) {
        const nameStart = (m.index ?? 0) + m[0].length - m[1]!.length
        const o = oneRef(m[1]!, 'read', sb + nameStart)
        if (o) out.push(o)
      }
    }
    const uI = kw(chunk, 'UNTIL')
    if (uI >= 0) {
      const seg = chunk.slice(uI + 5)
      const end = kw(seg, 'END-PERFORM')
      out.push(...refsIn(seg.slice(0, end >= 0 ? end : seg.length), base + uI + 5, 'read'))
    }
    const tm = /(?<![\w-])([A-Za-z][\w-]*)\s+TIMES(?![\w-])/i.exec(chunk)
    if (tm) {
      const o = oneRef(tm[1]!, 'read', base + (tm.index ?? 0))
      if (o) out.push(o)
    }
    return out
  }

  const callRefs = (chunk: string, base: number): Raw[] => {
    const out: Raw[] = []
    const uI = kw(chunk, 'USING')
    const rI = kw(chunk, 'RETURNING')
    if (uI >= 0) {
      const argPart = chunk.slice(uI + 5, rI > uI ? rI : chunk.length)
      const ab = base + uI + 5
      // BY REFERENCE (por defecto) → el llamado puede devolver valor:
      // read-write + uncertain. BY CONTENT/VALUE → solo lectura.
      let byRef = true
      for (const m of argPart.matchAll(/(?<![\w-])(?:BY\s+(REFERENCE|CONTENT|VALUE)|([A-Za-z][\w-]*))(?![\w-])/gi)) {
        if (m[1]) {
          byRef = m[1].toUpperCase() === 'REFERENCE'
          continue
        }
        const tok = m[2]
        if (!tok || NON_NAME.has(tok.toUpperCase())) continue
        const o = oneRef(tok, byRef ? 'read-write' : 'read', ab + (m.index ?? 0), byRef)
        if (o) out.push(o)
      }
    }
    if (rI >= 0) {
      const seg = chunk.slice(rI + 9)
      const mm = /^\s*([A-Za-z][\w-]*)/.exec(seg)
      if (mm) {
        const o = oneRef(mm[1]!, 'write', base + rI + 9 + mm[0].length - mm[1]!.length)
        if (o) out.push(o)
      }
    }
    return out
  }

  const goRefs = (chunk: string, base: number): Raw[] => {
    const m = /(?<![\w-])DEPENDING\s+ON\s+([A-Za-z][\w-]*)/i.exec(chunk)
    if (!m) return []
    const o = oneRef(m[1]!, 'read', base + (m.index ?? 0) + m[0].length - m[1]!.length)
    return o ? [o] : []
  }

  const dispatch = (verb: string, chunk: string, base: number): Raw[] => {
    switch (verb) {
      case 'MOVE':
        return moveRefs(chunk, base)
      case 'COMPUTE':
        return computeRefs(chunk, base)
      case 'ADD':
      case 'SUBTRACT':
      case 'MULTIPLY':
      case 'DIVIDE':
        return arithRefs(verb, chunk, base)
      case 'SET':
        return setRefs(chunk, base)
      case 'INITIALIZE':
        return initRefs(chunk, base)
      case 'ACCEPT':
        return sideRefs(chunk, base, 'FROM', 'write')
      case 'DISPLAY':
        return sideRefs(chunk, base, 'UPON', 'read')
      case 'STRING':
        return stringRefs(chunk, base)
      case 'UNSTRING':
        return unstringRefs(chunk, base)
      case 'INSPECT':
        return inspectRefs(chunk, base)
      case 'READ':
        return readRefs(chunk, base)
      case 'RETURN':
        return returnRefs(chunk, base)
      case 'WRITE':
      case 'REWRITE':
      case 'RELEASE':
        return writeRefs(chunk, base)
      case 'PERFORM':
        return performRefs(chunk, base)
      case 'IF':
      case 'EVALUATE':
      case 'WHEN':
        return refsIn(chunk, base, 'read')
      case 'CALL':
        return callRefs(chunk, base)
      case 'GO':
        return goRefs(chunk, base)
      default:
        return refsIn(chunk, base, 'unclassified', { collectUnknown: false })
    }
  }

  // ── Emisión de referencias ──────────────────────────────────────────
  const emitRef = (o: Raw, verb: string, snippet: string, line: number): void => {
    const fr: FieldReference = {
      name: o.name,
      kind: o.kind,
      verb,
      paragraph: paragraph ?? implicitEntry,
      line,
      snippet,
      ...(paragraph === undefined ? { paragraphImplicit: true } : {}),
      ...(o.uncertain ? { uncertain: true } : {}),
      ...(o.via88 ? { via88: o.via88 } : {}),
      ...(o.ambiguous ? { ambiguous: true } : {}),
    }
    const key = `${fr.name}|${fr.kind}|${fr.line}|${fr.verb}`
    if (dedup.has(key)) return
    dedup.add(key)
    all.push(fr)
  }

  const makeLineAt = (map: { start: number; line: number }[]) => (offset: number): number => {
    let ln = map[0]?.line ?? 0
    for (const e of map) {
      if (e.start <= offset) ln = e.line
      else break
    }
    return ln
  }

  const processSentence = (masked: string, body: string, map: { start: number; line: number }[]): void => {
    const lineAt = makeLineAt(map)
    const marks: { at: number; verb: string }[] = []
    for (const m of masked.matchAll(VERB_SPLIT_RE)) marks.push({ at: m.index ?? 0, verb: m[1]!.toUpperCase() })
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i]!.at
      const end = i + 1 < marks.length ? marks[i + 1]!.at : masked.length
      const verb = marks[i]!.verb
      const occs = dispatch(verb, masked.slice(start, end), start)
      if (occs.length === 0) continue
      const snippet = collapse(body.slice(start, end))
      const label = verb === 'GO' ? 'GO TO' : verb
      for (const o of occs) emitRef(o, label, snippet, lineAt(o.offset))
    }
  }

  // ── EXEC SQL / CICS ─────────────────────────────────────────────────
  const sqlRefs = (masked: string, base: number): Raw[] => {
    const vm = /(?<![\w-])EXEC\s+SQL\s+([A-Za-z-]+)/i.exec(masked)
    const verb = vm ? vm[1]!.toUpperCase() : ''
    if (verb === 'INCLUDE') return []
    const dynamic = verb === 'PREPARE' || verb === 'EXECUTE'
    // Rangos de host-vars de un INTO (SELECT ... INTO / FETCH ... INTO),
    // NO el "INSERT INTO <tabla>".
    const intoRanges: [number, number][] = []
    for (const m of masked.matchAll(/(?<![\w-])INTO(?![\w-])/gi)) {
      const idx = m.index ?? 0
      if (/INSERT\s*$/i.test(masked.slice(Math.max(0, idx - 12), idx))) continue
      const after = masked.slice(idx + 4)
      const stop = /(?<![\w-])(?:FROM|WHERE|ORDER|GROUP|HAVING|FOR|FETCH|USING|SET|VALUES|END-EXEC)(?![\w-])/i.exec(after)
      intoRanges.push([idx + 4, idx + 4 + (stop ? (stop.index ?? after.length) : after.length)])
    }
    const out: Raw[] = []
    for (const m of masked.matchAll(/:([A-Za-z][A-Za-z0-9_-]*)\s*(?::\s*([A-Za-z][A-Za-z0-9_-]*))?/g)) {
      const idx = m.index ?? 0
      const inInto = intoRanges.some(([s, e]) => idx >= s && idx < e)
      const kind: ReferenceKind = inInto ? 'write' : 'read'
      const host = oneRef(m[1]!, kind, base + idx + 1, dynamic)
      if (host) out.push(host)
      if (m[2]) {
        const ind = oneRef(m[2], kind, base + idx + m[0].lastIndexOf(m[2]), true) // variable indicadora
        if (ind) out.push(ind)
      }
    }
    return out
  }

  const cicsRefs = (masked: string, base: number): Raw[] => {
    const out: Raw[] = []
    for (const m of masked.matchAll(/(?<![\w-])([A-Za-z][\w-]*)\s*\(\s*([A-Za-z][\w-]*)\s*\)/g)) {
      const key = m[1]!.toUpperCase()
      const op = m[2]!
      const offset = base + (m.index ?? 0) + m[0].lastIndexOf(op)
      let kind: ReferenceKind
      let uncertain = false
      if (key === 'INTO' || key === 'SET') kind = 'write'
      else if (key === 'FROM') kind = 'read'
      else if (key === 'RESP' || key === 'RESP2') kind = 'write'
      else if (key === 'LENGTH' || key === 'FLENGTH' || key === 'KEYLENGTH') {
        kind = 'read-write'
        uncertain = true
      } else kind = 'read' // FILE, DATASET, MAP, RIDFLD, QUEUE… con operando data-name: se lee
      const o = oneRef(op, kind, offset, uncertain)
      if (o) out.push(o)
    }
    return out
  }

  // ── Buffer de sentencia (se acumula hasta el punto) ─────────────────
  let bufMasked = ''
  let bufBody = ''
  let bufMap: { start: number; line: number }[] = []
  const addLine = (l: SourceLine): void => {
    bufMap.push({ start: bufMasked.length, line: l.line })
    bufMasked += l.masked + '\n'
    bufBody += l.body + '\n'
  }
  const drainSentences = (): void => {
    for (;;) {
      const m = PERIOD_RE.exec(bufMasked)
      if (!m) return
      const cut = m.index
      processSentence(bufMasked.slice(0, cut), bufBody.slice(0, cut), bufMap)
      const rem = cut + 1
      bufMasked = bufMasked.slice(rem)
      bufBody = bufBody.slice(rem)
      bufMap = bufMap.map(e => ({ start: Math.max(0, e.start - rem), line: e.line }))
    }
  }
  const flushBuffer = (): void => {
    if (bufMasked.trim() !== '') processSentence(bufMasked, bufBody, bufMap)
    bufMasked = ''
    bufBody = ''
    bufMap = []
  }

  // ── Buffer de bloque EXEC ──────────────────────────────────────────
  let execMasked = ''
  let execBody = ''
  let execMap: { start: number; line: number }[] = []
  let execOpen = false
  const addExecLine = (l: SourceLine): void => {
    execMap.push({ start: execMasked.length, line: l.line })
    execMasked += l.masked + '\n'
    execBody += l.body + '\n'
  }
  const finishExec = (): void => {
    const isCics = /(?<![\w-])EXEC\s+CICS(?![\w-])/i.test(execMasked)
    const occs = isCics ? cicsRefs(execMasked, 0) : sqlRefs(execMasked, 0)
    if (occs.length > 0) {
      const lineAt = makeLineAt(execMap)
      const vm = /(?<![\w-])EXEC\s+SQL\s+([A-Za-z-]+)/i.exec(execMasked)
      const label = isCics ? 'EXEC CICS' : vm ? `EXEC SQL ${vm[1]!.toUpperCase()}` : 'EXEC SQL'
      const snippet = collapse(execBody)
      for (const o of occs) emitRef(o, label, snippet, lineAt(o.offset))
    }
    execMasked = ''
    execBody = ''
    execMap = []
  }

  // ── Bucle principal ────────────────────────────────────────────────
  for (const l of cleaned) {
    if (END_PROGRAM_RE.test(l.masked)) break
    if (nestedFrom !== undefined && l.line >= nestedFrom) break

    if (!inProcedure) {
      if (PROCEDURE_HDR_RE.test(l.masked)) {
        inProcedure = true
        // "PROCEDURE DIVISION [USING ...]." puede seguir en varias líneas
        // hasta su punto: nada de eso son sentencias.
        procHeaderOpen = !/\.\s*$/.test(l.masked)
      }
      continue
    }
    if (procHeaderOpen) {
      if (/\.\s*$/.test(l.masked)) procHeaderOpen = false
      continue
    }

    if (execOpen) {
      addExecLine(l)
      if (END_EXEC_RE.test(l.masked)) {
        finishExec()
        execOpen = false
      }
      continue
    }

    const hdr = matchHeader(l.masked)
    if (hdr) {
      flushBuffer()
      paragraph = hdr.name
      continue
    }

    if (EXEC_START_RE.test(l.masked)) {
      flushBuffer()
      addExecLine(l)
      if (END_EXEC_RE.test(l.masked)) finishExec()
      else execOpen = true
      continue
    }

    addLine(l)
    drainSentences()
  }
  flushBuffer()

  // ── Agrupar por nombre ────────────────────────────────────────────
  const byName = new Map<string, FieldUsage>()
  for (const fr of all) {
    let u = byName.get(fr.name)
    if (!u) {
      u = { name: fr.name, reads: [], writes: [], unclassified: [] }
      byName.set(fr.name, u)
    }
    if (fr.kind === 'read') u.reads.push(fr)
    else if (fr.kind === 'write') u.writes.push(fr)
    else if (fr.kind === 'read-write') {
      u.reads.push(fr)
      u.writes.push(fr)
    } else u.unclassified.push(fr)
  }
  const byLine = (a: FieldReference, b: FieldReference): number => a.line - b.line
  const fields = [...byName.values()]
    .map(u => ({
      name: u.name,
      reads: u.reads.sort(byLine),
      writes: u.writes.sort(byLine),
      unclassified: u.unclassified.sort(byLine),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { fields, unknownNames: [...unknownNames].sort(), fragment }
}

// ── Utilidades y constantes de módulo ────────────────────────────────

const PROCEDURE_HDR_RE = /^\s*PROCEDURE\s+DIVISION/i
const OTHER_DIV_RE = /^\s*(?:IDENTIFICATION|ID|ENVIRONMENT|DATA)\s+DIVISION/i
const END_PROGRAM_RE = /^\s*END\s+PROGRAM\b/i
const EXEC_START_RE = /(?<![\w-])EXEC\s+(?:SQL|CICS)(?![\w-])/i
const END_EXEC_RE = /(?<![\w-])END-EXEC(?![\w-])/i
// Un punto cierra la sentencia; el lookahead evita el punto decimal de un
// literal numérico (MOVE 1.5 TO ...).
const PERIOD_RE = /\.(?![0-9])/
const IDENT_RE = /[A-Za-z][A-Za-z0-9-]*/g
const CORRESPONDING_RE = /(?<![\w-])(?:CORRESPONDING|CORR)(?![\w-])/i

// Verbos y palabras de control que arrancan (o delimitan) una sentencia:
// se usan para trocear la sentencia en statements. Incluye verbos que no
// se modelan (SEARCH, SORT, OPEN…) para que actúen de frontera y su
// contenido caiga en el handler por defecto (`unclassified`).
const VERB_SPLIT_RE =
  /(?<![\w-])(MOVE|COMPUTE|ADD|SUBTRACT|MULTIPLY|DIVIDE|SET|INITIALIZE|ACCEPT|DISPLAY|STRING|UNSTRING|INSPECT|REWRITE|READ|RETURN|WRITE|RELEASE|PERFORM|EVALUATE|WHEN|IF|CALL|GO|SEARCH|SORT|MERGE|UNLOCK|START|DELETE|CANCEL|OPEN|CLOSE)(?![\w-])/gi

/** Índice del primer `kw` (palabra completa, case-insensitive) en `t`, o -1. */
function kw(t: string, k: string): number {
  const m = new RegExp(`(?<![\\w-])${k}(?![\\w-])`, 'i').exec(t)
  return m ? m.index : -1
}

/** El menor índice entre varias palabras clave, o -1 si ninguna aparece. */
function kwAny(t: string, ks: string[]): number {
  let best = -1
  for (const k of ks) {
    const i = kw(t, k)
    if (i >= 0 && (best < 0 || i < best)) best = i
  }
  return best
}

/** Colapsa a una línea y recorta — el snippet de contexto de la ficha. */
function collapse(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 140 ? one.slice(0, 137) + '…' : one
}

/**
 * Palabras reservadas y estructurales que aparecen en posición de operando
 * y NO son data-names: se excluyen tanto de las referencias como de
 * `unknownNames`. No hace falta que sea exhaustiva — el camino principal
 * se protege casando cada token contra los nombres reales del esquema;
 * esta lista sobre todo evita ruido en `unknownNames` y ubica bien los
 * repartos de rol (dónde corta TO/GIVING/INTO…).
 */
const NON_NAME = new Set<string>([
  // Verbos
  'MOVE', 'COMPUTE', 'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'SET', 'INITIALIZE', 'ACCEPT', 'DISPLAY',
  'STRING', 'UNSTRING', 'INSPECT', 'READ', 'RETURN', 'WRITE', 'REWRITE', 'RELEASE', 'PERFORM', 'EVALUATE',
  'WHEN', 'IF', 'ELSE', 'CALL', 'GO', 'GOBACK', 'STOP', 'EXIT', 'CONTINUE', 'SEARCH', 'SORT', 'MERGE',
  'UNLOCK', 'START', 'DELETE', 'CANCEL', 'OPEN', 'CLOSE', 'NEXT', 'SENTENCE', 'RUN',
  // Estructura de sentencia
  'TO', 'FROM', 'BY', 'INTO', 'GIVING', 'USING', 'RETURNING', 'THRU', 'THROUGH', 'ROUNDED', 'REMAINDER',
  'DEPENDING', 'ON', 'VARYING', 'UNTIL', 'TIMES', 'CORRESPONDING', 'CORR', 'OF', 'IN', 'IS', 'ARE', 'THEN',
  'END-IF', 'END-EVALUATE', 'END-PERFORM', 'END-STRING', 'END-UNSTRING', 'END-CALL', 'END-READ', 'END-WRITE',
  'END-REWRITE', 'END-DELETE', 'END-START', 'END-ADD', 'END-SUBTRACT', 'END-MULTIPLY', 'END-DIVIDE',
  'END-COMPUTE', 'END-SEARCH', 'END-RETURN', 'END-ACCEPT', 'END-DISPLAY', 'END-EXEC',
  // Condiciones y relaciones
  'NOT', 'AND', 'OR', 'EQUAL', 'EQUALS', 'GREATER', 'LESS', 'THAN', 'EXCEEDS', 'ZERO', 'ZEROS', 'ZEROES',
  'ZEROED', 'SPACE', 'SPACES', 'HIGH-VALUE', 'HIGH-VALUES', 'LOW-VALUE', 'LOW-VALUES', 'QUOTE', 'QUOTES',
  'NULL', 'NULLS', 'TRUE', 'FALSE', 'OTHER', 'ALSO', 'ANY', 'POSITIVE', 'NEGATIVE', 'NUMERIC', 'ALPHABETIC',
  'ALPHABETIC-LOWER', 'ALPHABETIC-UPPER', 'OMITTED', 'ADDRESS',
  // Cláusulas
  'DELIMITED', 'DELIMITER', 'COUNT', 'POINTER', 'TALLYING', 'REPLACING', 'CONVERTING', 'FOR', 'WITH',
  'MODE', 'KEY', 'LENGTH', 'REFERENCE', 'CONTENT', 'VALUE', 'SIZE', 'ERROR', 'OVERFLOW', 'EXCEPTION',
  'AT', 'INVALID', 'END', 'EOP', 'END-OF-PAGE', 'ADVANCING', 'NO', 'PAGE', 'LINE', 'LINES', 'UP', 'DOWN',
  'INITIAL', 'CHARACTER', 'CHARACTERS', 'ALL', 'LEADING', 'TRAILING', 'FIRST', 'BEFORE', 'AFTER',
  'STANDARD', 'OPTIONAL', 'PRIOR', 'LOCK', 'REWIND', 'REEL', 'UNIT', 'REMOVAL', 'DATA', 'RECORD',
  // SQL / CICS que puedan colarse como token suelto
  'EXEC', 'SQL', 'CICS', 'SELECT', 'INSERT', 'UPDATE', 'FETCH', 'DECLARE', 'CURSOR', 'ORDER', 'GROUP',
  'HAVING', 'WHERE', 'VALUES', 'RESP', 'RESP2', 'INDICATOR', 'CIC',
])
