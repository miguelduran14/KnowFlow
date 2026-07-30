/**
 * Glosario COBOL — capa determinista, no generada por IA.
 *
 * Es el diferenciador: mientras la explicación de UN programa cambia con
 * cada fuente y la produce el LLM, "qué significa COMP-3" es siempre lo
 * mismo y lo escribimos una vez. Ventajas: coste y latencia cero, nunca
 * alucina, y la calidad la garantizas tú, no un modelo.
 *
 * Cada entrada tiene:
 *  - `short`: una línea para el tooltip (el 80% de las dudas se resuelven aquí).
 *  - `what` / `why` / `gotcha`: la ficha completa que aparece en el cajón.
 *  - `example`: código real, corto, que ilustra la idea.
 *  - `pattern`: cómo detectar el término en un texto ya escrito.
 *
 * El orden en el que aparecen aquí determina la precedencia de detección:
 * las alternativas más largas van antes para que "PIC X" no gane a "PIC".
 */

export interface GlossaryEntry {
  id: string
  term: string
  /** Subtítulo bajo el nombre en el cajón */
  sub: string
  /** Una línea para el hover */
  short: string
  /** Párrafo "Qué es" */
  what: string
  /** Párrafo "Por qué existe" */
  why: string
  /** Aviso al mantenedor (opcional) */
  gotcha?: string
  /** Ejemplo COBOL corto */
  example: string
  /** Detección en texto libre; word-boundary de COBOL (respeta guiones) */
  pattern: RegExp
}

/**
 * Palabra-COBOL boundary: en COBOL el guion forma parte del identificador,
 * así que `\b` no basta. `READ` dentro de `READ-NEXT-PARA` NO debe cazar.
 * Cada envoltura vive en una función distinta para dejar claro qué se
 * escapa y qué no.
 *
 * `cobolWord` es para *literales*: escapa los metacaracteres de regex, así
 * que el llamador escribe "COMP-3" o "GO TO" tal cual.
 */
function cobolWord(alternatives: string[]): RegExp {
  const alt = alternatives
    .map(a => a.replace(/([.*+?^${}()|[\]\\])/g, '\\$1').replace(/\s+/g, '\\s+'))
    .join('|')
  return new RegExp(`(?<![A-Za-z0-9-])(?:${alt})(?![A-Za-z0-9-])`, 'gi')
}

/**
 * `cobolPattern` es para expresiones ya-regex: no toca lo que le pasas.
 * Úsalo cuando el término lleva grupos opcionales (p. ej. `PIC X(n)?`).
 */
function cobolPattern(patterns: string[]): RegExp {
  return new RegExp(`(?<![A-Za-z0-9-])(?:${patterns.join('|')})(?![A-Za-z0-9-])`, 'gi')
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  // ── Tipos de dato / USAGE ────────────────────────────────────────────
  {
    id: 'comp3',
    term: 'COMP-3',
    sub: 'USAGE COMPUTATIONAL-3 · decimal empaquetado',
    short: 'Decimal empaquetado: 2 dígitos por byte y el último medio-byte es el signo.',
    what: 'Guarda un número decimal empaquetado: dos dígitos por byte, y el último medio-byte (nibble) es el signo. Un PIC S9(10)V99 COMP-3 son 6 bytes, no 12.',
    why: 'Ahorra la mitad de espacio frente a DISPLAY (un byte por dígito) y las operaciones aritméticas son más rápidas en el hardware. Por eso casi todos los importes en COBOL son COMP-3.',
    gotcha: 'No puedes volcarlo a un campo alfanumérico con MOVE y leerlo: son bytes empaquetados, no caracteres. Sale basura. Y comparar dos COMP-3 con distinto tamaño requiere un campo intermedio.',
    example: '05 ACCT-BALANCE PIC S9(10)V99 COMP-3.\n*  12 dígitos → 6 bytes',
    pattern: cobolWord(['COMP-3', 'COMPUTATIONAL-3', 'PACKED-DECIMAL']),
  },
  {
    id: 'comp',
    term: 'COMP',
    sub: 'USAGE COMPUTATIONAL · binario',
    short: 'Entero binario del hardware: 2, 4 u 8 bytes según los dígitos.',
    what: 'Guarda un entero binario tal cual lo entiende la CPU (halfword, fullword o doubleword). PIC S9(4) COMP son 2 bytes; S9(8) COMP son 4; S9(18) COMP son 8.',
    why: 'Es el tipo más rápido para contadores, subíndices e índices de tabla porque no necesita conversión.',
    gotcha: 'El límite superior lo pone el número de dígitos declarados en PIC, no los bytes: S9(4) COMP acepta hasta ±9999 aunque el fullword daría para más.',
    example: '05 WS-COUNT PIC S9(4) COMP.\n*  hasta ±9999, 2 bytes',
    pattern: cobolWord(['COMP', 'COMPUTATIONAL', 'BINARY']),
  },
  {
    id: 'picx',
    term: 'PIC X(n)',
    sub: 'campo alfanumérico',
    short: 'Alfanumérico de n caracteres, un byte por carácter.',
    what: 'Reserva n caracteres, un byte cada uno. Guarda cualquier texto: letras, dígitos como texto, espacios, símbolos. Se rellena con espacios por la derecha si el valor es más corto.',
    why: 'Es el tipo por defecto para lo que no es numérico de cálculo: claves, códigos, nombres, indicadores de una letra.',
    gotcha: 'PIC X(4) con valor "7" guarda "7   " (con 3 espacios). Comparar contra "7" sin más da falso: hay que contar con el relleno o usar TRIM equivalente.',
    example: '05 ACCT-ID PIC X(11).\n*  "00000000042" ocupa 11 bytes',
    pattern: cobolPattern(['PIC\\s+X(?:\\(\\d+\\))?', 'PICTURE\\s+X(?:\\(\\d+\\))?']),
  },
  {
    id: 'pic9',
    term: 'PIC 9(n)',
    sub: 'campo numérico DISPLAY',
    short: 'Numérico de n dígitos, un byte por dígito (formato texto).',
    what: 'Reserva n dígitos, un byte cada uno. Sin USAGE explícito es DISPLAY: cada dígito es un carácter ASCII/EBCDIC. Se rellena con ceros por la izquierda.',
    why: 'Es la forma más legible y la que se lee directamente en un dump. Los importes que no necesitan velocidad y los campos de fichero secuencial suelen ser 9 DISPLAY.',
    gotcha: 'Ocupa mucho más que un COMP-3 equivalente. Un PIC 9(10) DISPLAY son 10 bytes; el COMP-3 son 6.',
    example: '05 WS-COUNT PIC 9(4).\n*  4 bytes en DISPLAY',
    pattern: cobolPattern(['PIC\\s+9(?:\\(\\d+\\))?', 'PICTURE\\s+9(?:\\(\\d+\\))?']),
  },
  {
    id: 'picedit',
    term: 'PIC editado',
    sub: 'campo de presentación',
    short: 'Campo para mostrar: cada Z, *, coma, punto o barra ocupa un byte real.',
    what: 'Un PIC con caracteres de edición (Z, *, +, -, coma, punto, barra, B, 0, CR, DB): cada uno ocupa un byte de la memoria real. ZZ,ZZ9.99 son 9 bytes.',
    why: 'Es como se preparan los importes para imprimir o mostrar: quita ceros a la izquierda, mete separadores, alinea el signo. No sirve para cálculo.',
    gotcha: 'No puedes hacer ADD sobre un PIC editado. Y su tamaño no coincide con el del campo numérico que representa: no confundir 6 bytes de COMP-3 con los 9 de su presentación.',
    example: '05 IMP-EDITADO PIC ZZ,ZZ9.99.\n*  9 bytes',
    pattern: cobolWord(['numeric-edited']),
  },

  // ── Niveles especiales ───────────────────────────────────────────────
  {
    id: 'level88',
    term: 'Nivel 88',
    sub: 'condición con nombre',
    short: 'Nombre legible para un valor concreto de un campo (una condición).',
    what: 'No es un campo: es un nombre legible para un valor (o rango) del campo padre. CUENTA-ACTIVA es cierto cuando ACCT-STATUS = "A".',
    why: 'Deja preguntar por el significado (IF CUENTA-ACTIVA) en vez de por la letra (IF ACCT-STATUS = "A"). Más legible, más difícil de romper y busca-fácil.',
    gotcha: 'No ocupa memoria y no aparece en el layout de bytes. Si borras el campo padre, todos sus 88 desaparecen.',
    example: '05 ACCT-STATUS PIC X.\n   88 CUENTA-ACTIVA  VALUE "A".\n   88 CUENTA-CERRADA VALUE "C".',
    pattern: /(?<![A-Za-z0-9-])(?:niveles?\s+88|88\s+level|level\s+88)(?![A-Za-z0-9-])/gi,
  },
  {
    id: 'level66',
    term: 'Nivel 66',
    sub: 'RENAMES · vista alternativa',
    short: 'Nombre alternativo para un tramo contiguo del registro (no reserva memoria).',
    what: 'Renombra un tramo contiguo de campos del registro con un solo nombre. Como REDEFINES, es otra vista de bytes que ya existen; no reserva memoria nueva.',
    why: 'Útil cuando parte de un registro representa un concepto que quieres tratar como un bloque (una clave compuesta, una zona de trabajo).',
    gotcha: 'El rango tiene que ser contiguo. Si el fuente que aportas no tiene los dos extremos, el offset queda "no verificable".',
    example: '01 REGISTRO.\n   05 F1 PIC X(2).\n   05 F2 PIC X(3).\n66 CLAVE-ENTERA RENAMES F1 THRU F2.',
    pattern: /(?<![A-Za-z0-9-])(?:niveles?\s+66|RENAMES)(?![A-Za-z0-9-])/gi,
  },

  // ── Estructura de datos ──────────────────────────────────────────────
  {
    id: 'redefines',
    term: 'REDEFINES',
    sub: 'misma memoria, otra vista',
    short: 'Otra vista sobre los mismos bytes: no reserva memoria nueva.',
    what: 'Un campo con REDEFINES ocupa los mismos bytes que otro (o los mismos que un grupo). Ver los datos de dos formas distintas sin copiarlos.',
    why: 'Común para tratar el mismo registro como texto o como campos numéricos, o para leer un fichero cuyas variantes ocupan el mismo espacio (unión).',
    gotcha: 'Los REDEFINES no se pueden anidar libremente, y siempre van pegados al campo que redefinen. Si el original es más corto que el REDEFINES, COBOL reserva el máximo de los dos.',
    example: '05 FECHA PIC 9(8).\n05 FECHA-PARTES REDEFINES FECHA.\n   10 F-ANIO PIC 9(4).\n   10 F-MES  PIC 9(2).\n   10 F-DIA  PIC 9(2).',
    pattern: cobolWord(['REDEFINES']),
  },
  {
    id: 'occurs',
    term: 'OCCURS',
    sub: 'tabla / array',
    short: 'Repite un campo o grupo N veces (array).',
    what: 'Un campo con OCCURS 10 es una tabla de 10 elementos consecutivos en memoria. Se accede con un subíndice: TABLA (I).',
    why: 'Es la forma que tiene COBOL de declarar arrays. La variante DEPENDING ON hace la tabla de longitud variable.',
    gotcha: 'El subíndice empieza en 1, no en 0. Y el compilador no comprueba límites: acceder a TABLA(99) en una tabla de 10 lee memoria contigua sin error.',
    example: '05 TABLA OCCURS 10 TIMES.\n   10 T-ID  PIC X(4).\n   10 T-IMP PIC S9(7)V99 COMP-3.',
    pattern: cobolWord(['OCCURS']),
  },
  {
    id: 'sync',
    term: 'SYNCHRONIZED',
    sub: 'alineación en memoria',
    short: 'Alinea el campo a su frontera natural (puede añadir bytes de relleno).',
    what: 'Fuerza al compilador a alinear un binario o un flotante a su frontera natural (2/4/8 bytes desde el inicio del 01). Puede dejar bytes de relleno vacíos delante.',
    why: 'Necesario para que el hardware pueda leer una palabra completa de golpe sin penalización. Los punteros van alineados aunque no se escriba SYNC.',
    gotcha: 'Si añades un SYNC a un registro existente, todos los offsets siguientes pueden desplazarse por los bytes de relleno. El parser te lo marca con la etiqueta "alineado".',
    example: '05 WS-FLAG PIC X.\n05 WS-BIN  PIC S9(8) COMP SYNC.\n*  offset 4, con 3 bytes de relleno',
    pattern: cobolWord(['SYNCHRONIZED', 'SYNC']),
  },
  {
    id: 'fd',
    term: 'FD',
    sub: 'File Description',
    short: 'Describe un fichero y el formato de sus registros (FILE SECTION).',
    what: 'Bajo la FD se declaran los 01 que definen el layout de los registros del fichero. Es el puente entre el fichero físico y la estructura en memoria.',
    why: 'El nombre del FD conecta con el SELECT ... ASSIGN, y este con el ddname del JCL. El fichero físico real lo decide el JCL, no el programa.',
    gotcha: 'El nombre del FD es el interno del programa, no el ddname del JCL. Y un fichero puede tener varios 01 alternativos si tiene varios tipos de registro.',
    example: 'FD  ACCTFILE.\n01  ACCT-RECORD.\n    05 ACCT-ID PIC X(11).',
    pattern: cobolWord(['FD', 'SD']),
  },

  // ── E/S y flujo ──────────────────────────────────────────────────────
  {
    id: 'read',
    term: 'READ ... INTO',
    sub: 'lectura de un registro',
    short: 'Lee el siguiente registro del fichero. AT END marca el fin.',
    what: 'Lee el siguiente registro del fichero y lo copia en una estructura de la WORKING-STORAGE. La cláusula AT END dispara cuando ya no quedan registros.',
    why: 'Es el verbo con el que un batch recorre un fichero secuencial: un READ por vuelta del bucle, hasta que AT END pone el flag de fin.',
    gotcha: 'Sin cláusula AT END (o NOT AT END), un READ tras el fin de fichero da un error de ejecución. Siempre hay que manejar el fin.',
    example: 'READ ACCTFILE INTO WS-ACCOUNT\n   AT END SET FIN-FICHERO TO TRUE\nEND-READ',
    pattern: cobolWord(['READ INTO', 'READ', 'REWRITE', 'START']),
  },
  {
    id: 'perform',
    term: 'PERFORM',
    sub: 'llamar a un párrafo · bucle',
    short: 'Ejecuta un párrafo (y vuelve al terminar) o repite un bloque.',
    what: 'Con destino: ejecuta ese párrafo/rango y devuelve el control al que llamó al terminar. En su forma inline (UNTIL/VARYING/N TIMES ... END-PERFORM) es un bucle.',
    why: 'Es la forma estructurada de llamar a subrutinas dentro del programa. Distinto de GO TO, que no vuelve.',
    gotcha: 'PERFORM A THRU B ejecuta desde A hasta el fin de B: cualquier párrafo que caiga en medio también se ejecuta, aunque no lo veas al llamarlo.',
    example: 'PERFORM 2100-READ\nPERFORM 2000-LOOP UNTIL WS-EOF = "Y"\nPERFORM 3 TIMES\n    ADD 1 TO WS-COUNT\nEND-PERFORM',
    pattern: cobolWord(['PERFORM']),
  },
  {
    id: 'call',
    term: 'CALL',
    sub: 'llamar a otro programa',
    short: 'Llama a otro programa (módulo). Si el destino es una variable, es dinámica.',
    what: 'Transfiere el control a otro programa COBOL. Con literal ("VALIDMOD") el destino es fijo; con nombre de variable, el destino solo se sabe en ejecución (dinámica).',
    why: 'Es como se descompone una aplicación en módulos separados. USING pasa parámetros por referencia (o por valor, con BY VALUE).',
    gotcha: 'Con CALL dinámico, el fichero JCL que da nombre al módulo real puede cambiar sin que el fuente del que llama cambie. El parser lo marca con "dinámico".',
    example: 'CALL "VALIDMOD" USING WS-REGISTRO\nCALL WS-PGM-NAME USING WS-DATA',
    pattern: cobolWord(['CALL']),
  },
  {
    id: 'goto',
    term: 'GO TO',
    sub: 'salto sin retorno',
    short: 'Salta a otro párrafo sin volver. En COBOL moderno, evitar.',
    what: 'Transfiere el control a otro párrafo y NO vuelve al llamador. GO TO ... DEPENDING ON es una tabla de saltos según un valor.',
    why: 'Es el único salto no estructurado de COBOL. Sobrevive por compatibilidad y porque a veces simplifica salidas de emergencia.',
    gotcha: 'Un GO TO fuera de la sección/párrafo actual puede saltarse limpiezas críticas (cierres de fichero, ROLLBACK). Trátalos con lupa.',
    example: 'IF WS-ERROR-GRAVE\n    GO TO 9999-ABEND\nEND-IF',
    pattern: cobolWord(['GO TO', 'GOTO']),
  },
  {
    id: 'ends',
    term: 'STOP RUN / GOBACK',
    sub: 'fin del programa',
    short: 'STOP RUN termina el job; GOBACK devuelve al llamador (o al SO si es raíz).',
    what: 'STOP RUN termina la ejecución del job entero. GOBACK devuelve el control: al que llamó con CALL, o al sistema si es el programa raíz. EXIT PROGRAM = GOBACK.',
    why: 'GOBACK es lo correcto en un módulo llamado (permite que el que te llamó siga); STOP RUN es lo correcto en el programa principal.',
    gotcha: 'STOP RUN en un módulo llamado cierra el job entero, no solo tu módulo. Suele ser un bug.',
    example: '9000-CLEANUP.\n    CLOSE ACCTFILE.\n    GOBACK.',
    pattern: cobolWord(['STOP RUN', 'GOBACK', 'EXIT PROGRAM']),
  },

  // ── Condicionales ────────────────────────────────────────────────────
  {
    id: 'evaluate',
    term: 'EVALUATE',
    sub: 'switch estructurado',
    short: 'Como un switch: WHEN por WHEN, con OTHER como default.',
    what: 'Evalúa un sujeto (o TRUE) y elige la primera rama WHEN cuya condición se cumpla. WHEN OTHER es el "por defecto".',
    why: 'Mucho más legible que un ELSE encadenado. Y EVALUATE TRUE deja escribir condiciones complejas sin anidar.',
    gotcha: 'Solo se ejecuta la primera rama que casa; no hay "fall-through" como en C. Y sin WHEN OTHER, si nada casa, no pasa nada (silencio).',
    example: 'EVALUATE WS-TIPO\n    WHEN "A" PERFORM DO-A\n    WHEN "B" WHEN "C" PERFORM DO-BC\n    WHEN OTHER PERFORM DO-REST\nEND-EVALUATE',
    pattern: cobolWord(['EVALUATE']),
  },

  // ── Recursos externos ────────────────────────────────────────────────
  {
    id: 'execsql',
    term: 'EXEC SQL',
    sub: 'DB2 embebido',
    short: 'Bloque SQL para DB2 embebido en el fuente COBOL.',
    what: 'Un bloque SQL delimitado por EXEC SQL ... END-EXEC. El preprocesador DB2 lo traduce a llamadas al runtime antes de compilar.',
    why: 'Es como COBOL habla con DB2. Las host variables (`:WS-NAME`) mueven datos entre el programa y la base.',
    gotcha: 'Hay que comprobar SQLCODE tras cada bloque, no solo tras el fallo. Un SQL dinámico (PREPARE/EXECUTE) es como CALL dinámico: no sabes qué tabla toca leyendo el fuente.',
    example: 'EXEC SQL\n    SELECT NAME INTO :WS-NAME\n    FROM CUSTOMER\n    WHERE ID = :WS-ID\nEND-EXEC',
    pattern: /(?<![A-Za-z0-9-])EXEC\s+SQL(?![A-Za-z0-9-])/gi,
  },
  {
    id: 'execcics',
    term: 'EXEC CICS',
    sub: 'transacción CICS',
    short: 'Bloque CICS: envía maps, llama a programas, lee ficheros online.',
    what: 'Un bloque CICS delimitado por EXEC CICS ... END-EXEC. Habla con el monitor CICS: pantallas (SEND MAP), programas (LINK), ficheros VSAM, colas.',
    why: 'Es lo que convierte un programa COBOL en una transacción online. Sin CICS solo tienes batch.',
    gotcha: 'El campo EIBRESP tras cada bloque dice si fue bien. Un HANDLE CONDITION captura errores para toda la transacción, así que un error puede resurgir lejos de donde ocurrió.',
    example: 'EXEC CICS SEND MAP("MENU1") MAPSET("MENUSET") END-EXEC\nEXEC CICS LINK PROGRAM("SUBPRG") END-EXEC',
    pattern: /(?<![A-Za-z0-9-])EXEC\s+CICS(?![A-Za-z0-9-])/gi,
  },
  {
    id: 'copy',
    term: 'COPY',
    sub: 'inclusión de copybook',
    short: 'Incluye un fragmento COBOL (copybook) tal cual.',
    what: 'El preprocesador COBOL sustituye el COPY por el contenido del member. Con REPLACING, cambia identificadores sobre la marcha.',
    why: 'Es la forma clásica de compartir estructuras de datos entre programas: un registro define el layout una sola vez y lo importan los que lo necesitan.',
    gotcha: 'Si el copybook cambia, todos los programas que lo usan hay que recompilarlos. Y COPY REPLACING sustituye texto, no símbolos: puede romper cosas por accidente.',
    example: 'WORKING-STORAGE SECTION.\n    COPY CUSTREC.\n\n*  con REPLACING\nCOPY CUSTREC REPLACING ==:PFX:== BY ==WS==.',
    pattern: cobolWord(['COPY']),
  },

  // ── Secciones ────────────────────────────────────────────────────────
  {
    id: 'linkage',
    term: 'LINKAGE SECTION',
    sub: 'parámetros de entrada',
    short: 'Lo que el programa recibe cuando otro lo llama con CALL.',
    what: 'Declara los datos que llegan como parámetros. No reserva memoria: apunta a la memoria del programa que llamó.',
    why: 'Es la contrapartida del USING de la CALL. Todo lo que quieres que un módulo pueda recibir va aquí.',
    gotcha: 'Tocar la LINKAGE sin haber sido llamado (o desde el batch inicial) da un error de acceso a memoria. Y modificar un campo LINKAGE cambia el valor en el que llamó.',
    example: 'LINKAGE SECTION.\n01  LK-PARM.\n    05 LK-CODIGO PIC X(3).\nPROCEDURE DIVISION USING LK-PARM.',
    pattern: /(?<![A-Za-z0-9-])LINKAGE(?:\s+SECTION)?(?![A-Za-z0-9-])/gi,
  },
  {
    id: 'workingstorage',
    term: 'WORKING-STORAGE',
    sub: 'memoria propia',
    short: 'Memoria del programa: variables locales, contadores, buffers.',
    what: 'Zona de datos propia del programa. Se inicializa una vez (con VALUE) y se mantiene entre invocaciones si el programa se llama varias veces.',
    why: 'Es donde vive todo lo que el programa necesita para trabajar: contadores, flags, estructuras temporales, copias de registros de fichero.',
    example: 'WORKING-STORAGE SECTION.\n01  WS-COUNT   PIC S9(4) COMP VALUE 0.\n01  WS-FIN-EOF PIC X       VALUE "N".',
    pattern: /(?<![A-Za-z0-9-])WORKING-STORAGE(?:\s+SECTION)?(?![A-Za-z0-9-])/gi,
  },
]

/** Un segmento de texto: o es texto plano, o casa con un término del glosario. */
export type Segment = { text: string; term?: GlossaryEntry | undefined }

/** Índice por id para el cajón (busca la ficha completa por su clave). */
export const GLOSSARY_BY_ID: Readonly<Record<string, GlossaryEntry>> = Object.freeze(
  Object.fromEntries(GLOSSARY.map(e => [e.id, e])),
)

/**
 * Trocea un texto en segmentos, marcando los que casan con un término del
 * glosario. Los patrones más específicos ganan a los más generales (`COMP-3`
 * antes que `COMP`) porque están antes en el array.
 *
 * Un mismo trozo del texto NO puede casar con dos términos: en cuanto un
 * carácter queda cubierto por un match, los demás no lo tocan. Sin eso,
 * "COMP-3" abriría el tooltip de "COMP-3" pero también el de "COMP" al
 * pasar por sus cuatro primeras letras.
 */
export function segmentText(text: string): Segment[] {
  interface Hit {
    start: number
    end: number
    term: GlossaryEntry
  }
  const hits: Hit[] = []
  const claimed: boolean[] = new Array(text.length).fill(false)

  for (const entry of GLOSSARY) {
    // Los patrones globales llevan estado interno: nuevo RegExp por vuelta.
    const re = new RegExp(entry.pattern.source, entry.pattern.flags)
    for (const m of text.matchAll(re)) {
      const start = m.index
      const end = start + m[0].length
      // Si algún carácter del match ya está reclamado por un término anterior,
      // este cede: la especificidad se resuelve por orden en GLOSSARY.
      let free = true
      for (let i = start; i < end; i++) {
        if (claimed[i]) { free = false; break }
      }
      if (!free) continue
      for (let i = start; i < end; i++) claimed[i] = true
      hits.push({ start, end, term: entry })
    }
  }

  hits.sort((a, b) => a.start - b.start)

  const out: Segment[] = []
  let cursor = 0
  for (const h of hits) {
    if (h.start > cursor) out.push({ text: text.slice(cursor, h.start) })
    out.push({ text: text.slice(h.start, h.end), term: h.term })
    cursor = h.end
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) })
  return out
}
