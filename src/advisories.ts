import type { Advisory, FlowParagraph, FlowResult, Inventory, ParseResult, SchemaField } from './types.js'
import { cleanLines } from './source-lines.js'

/**
 * Trampas de mantenimiento COBOL conocidas, detectadas sobre hechos YA
 * verificados por el parser (datos, flujo, inventario) — nunca sobre una
 * interpretación nueva. Es una pasada determinista más, hermana de
 * `factsFidelity`: mientras esa marca lo que NO se pudo verificar, esta
 * marca lo que SÍ está verificado pero es arriesgado. Ver el tipo
 * `Advisory` en `types.ts` para la distinción completa.
 *
 * Cada regla es independiente y de alta confianza — prefiere no avisar a
 * avisar con un falso positivo. Ninguna regla necesita el fuente crudo
 * salvo la de STOP RUN (que masca literales y recorta columnas fijas con
 * las mismas utilidades que ya usan flow-parser/inventory, para no
 * duplicar esa lógica con una regex ingenua).
 */
export function checkAdvisories(
  source: string,
  data: ParseResult | undefined,
  flow: FlowResult | undefined,
  inventory: Inventory | undefined,
): Advisory[] {
  const out: Advisory[] = []

  if (flow) {
    out.push(...stopRunInSubprogram(source, data, flow))
    out.push(...gotoCrossesSection(flow))
    out.push(...alterStatements(source, flow))
    out.push(...unreachableParagraphs(source, flow))
  }
  if (inventory) {
    out.push(...sqlWriteWithoutWhere(inventory))
    out.push(...fileOpenedNotClosed(inventory))
    out.push(...cursorAdvisories(inventory))
    out.push(...unusedCursors(inventory))
    out.push(...unusedFiles(inventory))
  }

  return out.sort((a, b) => a.line - b.line)
}

const STOP_RUN_RE = /(?<![\w-])STOP\s+RUN(?![\w-])/i

function hasLinkageParams(data: ParseResult | undefined): boolean {
  const isLinkage = (f: SchemaField): boolean =>
    f.dataSection === 'LINKAGE' || f.children.some(isLinkage)
  return (data?.records ?? []).some(isLinkage)
}

/**
 * STOP RUN termina el job ENTERO, no solo el módulo actual (GOBACK/EXIT
 * PROGRAM sí devuelven al llamador). Un programa con LINKAGE SECTION
 * recibe parámetros — solo llega ahí una CALL, así que es (casi con toda
 * certeza) un subprograma. STOP RUN en un párrafo suyo es la trampa
 * clásica: quien lo mantiene ve el job entero morir por un módulo que
 * "solo" fallaba una validación.
 */
function stopRunInSubprogram(source: string, data: ParseResult | undefined, flow: FlowResult): Advisory[] {
  if (!hasLinkageParams(data)) return []
  const declared = flow.paragraphs.filter((p): p is FlowParagraph & { line: number } => !p.implicit && p.line !== undefined)
  if (declared.length === 0) return []

  const lines = cleanLines(source)
  const out: Advisory[] = []
  for (let i = 0; i < declared.length; i++) {
    const para = declared[i]!
    if (!para.terminates) continue
    const end = declared[i + 1]?.line ?? Infinity
    const hit = lines.find(l => l.line >= para.line && l.line < end && STOP_RUN_RE.test(l.masked))
    if (hit) {
      out.push({
        rule: 'stop-run-in-subprogram',
        title: 'STOP RUN en un subprograma',
        message:
          `El párrafo ${para.name} ejecuta STOP RUN, pero el programa tiene LINKAGE SECTION (recibe parámetros por CALL): parece un subprograma. ` +
          'STOP RUN termina el job ENTERO, no solo este módulo — probablemente debería ser GOBACK.',
        line: hit.line,
        paragraph: para.name,
      })
    }
  }
  return out
}

/**
 * Un GO TO que cruza de una SECTION a otra puede saltarse la limpieza o
 * inicialización propia de la sección en la que estaba (cierres de
 * fichero, ROLLBACK) — el mismo riesgo que documenta el glosario para
 * GO TO, pero aquí verificado contra el fuente: sección de origen y de
 * destino son distintas de verdad, no una suposición.
 */
function gotoCrossesSection(flow: FlowResult): Advisory[] {
  // COBOL es case-insensitive: el mapa y las consultas van en mayúsculas para
  // que un `GO TO Para-B` case contra el párrafo `PARA-B`. Sin normalizar, una
  // diferencia de grafía dejaba el aviso sin disparar (falso negativo).
  const sectionOf = new Map<string, string>()
  for (const p of flow.paragraphs) {
    if (p.section) sectionOf.set(p.name.toUpperCase(), p.section)
  }
  if (sectionOf.size === 0) return []

  const out: Advisory[] = []
  for (const edge of flow.edges) {
    if (edge.kind !== 'goto') continue
    const from = sectionOf.get(edge.from.toUpperCase())
    const to = sectionOf.get(edge.to.toUpperCase())
    if (from && to && from !== to) {
      out.push({
        rule: 'goto-crosses-section',
        title: 'GO TO cruza de sección',
        message: `GO TO ${edge.to} salta de la sección ${from} a ${to}: puede saltarse un cierre o una inicialización propia de ${from} que el mantenedor da por hecha.`,
        line: edge.line,
        paragraph: edge.from,
      })
    }
  }
  return out
}

const ALTER_RE = /(?<![\w-])ALTER\s+([\w-]+)\s+TO\s+(?:PROCEED\s+TO\s+)?([\w-]+)/i

/**
 * ALTER cambia en tiempo de ejecución el destino de un GO TO (`ALTER X TO
 * PROCEED TO Y`): el mismo párrafo salta a sitios distintos según lo que se
 * haya ALTERado antes. Es de las construcciones más traicioneras que quedan
 * en COBOL legacy —el diagrama de flujo NO puede mostrar el destino real,
 * porque depende de la ejecución— así que se marca como aviso en vez de
 * fingir una arista que el fuente no fija (ADR-0003). Deprecada desde el 85;
 * su sola presencia ya es una señal para quien mantiene.
 */
function alterStatements(source: string, flow: FlowResult): Advisory[] {
  const declared = flow.paragraphs
    .filter((p): p is FlowParagraph & { line: number } => !p.implicit && p.line !== undefined)
    .sort((a, b) => a.line - b.line)
  // Párrafo que contiene una línea dada: el último cuya cabecera está en o
  // antes de esa línea.
  const paragraphAt = (line: number): string | undefined => {
    let name: string | undefined
    for (const p of declared) {
      if (p.line <= line) name = p.name
      else break
    }
    return name
  }

  const out: Advisory[] = []
  for (const { masked, line } of cleanLines(source)) {
    const m = ALTER_RE.exec(masked)
    if (!m) continue
    const paragraph = paragraphAt(line)
    out.push({
      rule: 'alter-statement',
      title: 'ALTER cambia un GO TO en ejecución',
      message:
        `ALTER ${m[1]} TO ${m[2]}: cambia en ejecución el destino del GO TO de ${m[1]}, así que el flujo real depende de qué se haya ALTERado antes — el diagrama no puede mostrarlo. ` +
        'ALTER está deprecado; considera reescribir la lógica con EVALUATE/PERFORM.',
      line,
      ...(paragraph ? { paragraph } : {}),
    })
  }
  return out
}

const WHERE_RE = /(?<![\w-])WHERE(?![\w-])/i

/**
 * UPDATE/DELETE sin WHERE visible afecta a TODA la tabla, no a una fila —
 * el error clásico de un SQL embebido mal probado. Si el recurso ya es
 * dinámico, el motor lo marca aparte (no se conoce ni la tabla): no
 * duplicamos el aviso para no ensuciar con dos mensajes la misma duda.
 */
function sqlWriteWithoutWhere(inventory: Inventory): Advisory[] {
  const out: Advisory[] = []
  for (const exec of inventory.execs) {
    if (exec.kind !== 'sql' || exec.dynamic) continue
    const verb = exec.verb.toUpperCase()
    if (verb !== 'UPDATE' && verb !== 'DELETE') continue
    if (WHERE_RE.test(exec.text)) continue
    out.push({
      rule: 'sql-write-without-where',
      title: `${verb} sin WHERE`,
      message: `${verb} sin cláusula WHERE visible en el bloque: afecta a TODAS las filas de la tabla, no a una — confirma si es intencional.`,
      line: exec.line,
      paragraph: exec.paragraph,
    })
  }
  return out
}

// Modos de OPEN que escriben: si uno de estos queda sin CLOSE, hay buffers de
// salida que pueden perderse. Un OPEN INPUT sin CLOSE es mucho menos grave
// —COBOL cierra los ficheros implícitamente al STOP RUN, y un lector no tiene
// nada que volcar— así que avisar de él es casi siempre ruido.
const WRITE_OPEN_MODES = new Set(['OUTPUT', 'I-O', 'EXTEND'])

/**
 * Un fichero abierto para ESCRITURA (OUTPUT/I-O/EXTEND) y nunca cerrado en el
 * fuente aportado puede dejar buffers sin volcar o el dataset inconsistente si
 * el programa termina sin pasar por el CLOSE. Se restringe a los modos de
 * escritura para no inundar con avisos de lectores sin CLOSE, que COBOL cierra
 * de todos modos al terminar. Se ancla al OPEN que abre la duda.
 */
function fileOpenedNotClosed(inventory: Inventory): Advisory[] {
  const out: Advisory[] = []
  for (const file of inventory.files) {
    const writeOpen = file.operations.find(
      op => op.verb === 'OPEN' && op.mode !== undefined && WRITE_OPEN_MODES.has(op.mode),
    )
    const closed = file.operations.some(op => op.verb === 'CLOSE')
    if (writeOpen && !closed) {
      out.push({
        rule: 'file-opened-not-closed',
        title: `${file.name} sin CLOSE`,
        message: `${file.name} se abre para escritura (OPEN ${writeOpen.mode}) pero no aparece un CLOSE en el fuente aportado. Si el programa termina sin cerrarlo, puede dejar buffers sin volcar.`,
        line: writeOpen.line,
        paragraph: writeOpen.paragraphImplicit ? undefined : writeOpen.paragraph,
      })
    }
  }
  return out
}

/**
 * Mismo riesgo que un fichero sin CLOSE, pero para cursores DB2 — deja el
 * cursor ocupando recursos hasta el fin de la unidad de trabajo. Y un
 * FETCH sin OPEN previo (con el cursor declarado en el fuente aportado,
 * para no acusar un OPEN que en realidad vive en un copybook ausente)
 * fallaría en ejecución. La línea de anclaje sale del bloque EXEC que
 * disparó cada operación — `CursorUsage` es un agregado sin línea propia.
 */
function cursorAdvisories(inventory: Inventory): Advisory[] {
  const out: Advisory[] = []
  for (const cursor of inventory.cursors) {
    const execFor = (verb: string) => inventory.execs.find(e => e.cursor === cursor.name && e.verb === verb)

    if (cursor.opened && !cursor.closed) {
      const open = execFor('OPEN')
      out.push({
        rule: 'cursor-opened-not-closed',
        title: `Cursor ${cursor.name} sin CLOSE`,
        message: `El cursor ${cursor.name} se abre (OPEN) pero no se cierra (CLOSE) en el fuente aportado: queda ocupando recursos en DB2 hasta el fin de la unidad de trabajo.`,
        line: open?.line ?? 0,
        paragraph: open?.paragraphImplicit ? undefined : open?.paragraph,
      })
    }
    if (cursor.fetched && !cursor.opened && cursor.declared) {
      const fetch = execFor('FETCH')
      out.push({
        rule: 'cursor-fetched-without-open',
        title: `Cursor ${cursor.name}: FETCH sin OPEN`,
        message: `El cursor ${cursor.name} tiene FETCH pero no OPEN en el fuente aportado — si el OPEN no está en un copybook ausente, el FETCH fallaría en ejecución.`,
        line: fetch?.line ?? 0,
        paragraph: fetch?.paragraphImplicit ? undefined : fetch?.paragraph,
      })
    }
  }
  return out
}

// COBOL es case-insensitive: los nombres de párrafo se comparan en mayúsculas.
const upper = (name: string): string => name.toUpperCase()

/** ¿La PROCEDURE DIVISION contiene un COPY? Un COPY puede inyectar PERFORMs
 *  que el parser de flujo no ve (no expande copybooks), así que la
 *  alcanzabilidad deja de ser fiable. */
function procedureHasCopy(source: string): boolean {
  let inProcedure = false
  for (const { masked } of cleanLines(source)) {
    if (/^\s*PROCEDURE\s+DIVISION/i.test(masked)) {
      inProcedure = true
      continue
    }
    if (inProcedure && /(?<![\w-])COPY\s+[A-Za-z0-9]/i.test(masked)) return true
  }
  return false
}

/** ¿Hay algún ALTER? ALTER cambia el destino de un GO TO en ejecución, así
 *  que un párrafo podría alcanzarse por una vía que el grafo no modela. */
function sourceHasAlter(source: string): boolean {
  return cleanLines(source).some(l => /(?<![\w-])ALTER\s+[A-Za-z0-9]/i.test(l.masked))
}

/**
 * Párrafos que ningún camino de ejecución alcanza: código muerto. Se hace un
 * recorrido desde las entradas (el primer párrafo, el nodo de entrada
 * implícito y los párrafos de DECLARATIVES, que invoca el runtime) siguiendo
 * PERFORM/GO TO/caída natural/SORT — las CALL no cuentan (van a otro
 * programa). Un párrafo declarado que no se alcanza parece eliminable.
 *
 * Honestidad (ADR-0003): si el flujo puede estar incompleto —un COPY en la
 * PROCEDURE que inyecte PERFORMs no vistos, o un ALTER que redirija un GO TO—
 * NO se acusa a nadie: prefiere no avisar a un falso positivo.
 */
function unreachableParagraphs(source: string, flow: FlowResult): Advisory[] {
  if (procedureHasCopy(source) || sourceHasAlter(source)) return []
  if (flow.paragraphs.length === 0) return []

  // Adyacencia por nombre (mayúsculas): destino de cada arista a un párrafo.
  const adj = new Map<string, string[]>()
  for (const edge of flow.edges) {
    if (edge.kind === 'call') continue
    const from = upper(edge.from)
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from)!.push(upper(edge.to))
  }

  // Entradas del programa.
  const entries = new Set<string>()
  entries.add(upper(flow.paragraphs[0]!.name))
  for (const p of flow.paragraphs) {
    if (p.implicit || p.inDeclaratives) entries.add(upper(p.name))
  }

  const reachable = new Set<string>(entries)
  const stack = [...entries]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const next of adj.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next)
        stack.push(next)
      }
    }
  }

  const out: Advisory[] = []
  for (const para of flow.paragraphs) {
    if (para.implicit || para.inDeclaratives || para.line === undefined) continue
    if (reachable.has(upper(para.name))) continue
    out.push({
      rule: 'unreachable-paragraph',
      title: `${para.name} inalcanzable`,
      message: `Ningún PERFORM, GO TO ni caída natural llega a ${para.name} en el fuente aportado: parece código muerto. Confirma que no lo referencia un copybook no aportado antes de eliminarlo.`,
      line: para.line,
      paragraph: para.name,
    })
  }
  return out
}

/**
 * Cursor DB2 declarado y sin usar: un DECLARE sin OPEN/FETCH/CLOSE en el
 * fuente aportado. O sobra, o su uso vive en un copybook ausente.
 */
function unusedCursors(inventory: Inventory): Advisory[] {
  const out: Advisory[] = []
  for (const cursor of inventory.cursors) {
    if (cursor.declared && !cursor.opened && !cursor.fetched && !cursor.closed) {
      const declare = inventory.execs.find(e => e.cursor === cursor.name && e.verb === 'DECLARE')
      out.push({
        rule: 'unused-cursor',
        title: `Cursor ${cursor.name} sin usar`,
        message: `El cursor ${cursor.name} se declara (DECLARE) pero no se abre, lee ni cierra en el fuente aportado: parece declarado y sin uso.`,
        line: declare?.line ?? 0,
        ...(declare && !declare.paragraphImplicit && declare.paragraph ? { paragraph: declare.paragraph } : {}),
      })
    }
  }
  return out
}

/**
 * Fichero declarado en FILE-CONTROL (SELECT) y sin ninguna operación de E/S
 * en el fuente aportado: o sobra el SELECT, o el uso está en un copybook
 * ausente. No lleva línea propia (el SELECT no se ancla a una).
 */
function unusedFiles(inventory: Inventory): Advisory[] {
  const out: Advisory[] = []
  for (const file of inventory.files) {
    if (file.operations.length === 0) {
      out.push({
        rule: 'unused-file',
        title: `${file.name} declarado y sin usar`,
        message: `El fichero ${file.name} se declara en FILE-CONTROL (SELECT) pero no aparece ninguna operación (OPEN/READ/WRITE…) sobre él en el fuente aportado.`,
        line: 0,
      })
    }
  }
  return out
}
