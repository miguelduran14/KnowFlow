/** Tipo interpretado de un campo COBOL */
export type DataType =
  | 'alphanumeric'
  | 'numeric'
  /**
   * PIC con caracteres de edición (Z, *, +, -, coma, punto, barra, B, 0,
   * CR, DB): campo de presentación, no de cálculo. Ocupa un byte por cada
   * posición de la PIC, incluidos los caracteres de inserción.
   */
  | 'numeric-edited'
  | 'packed-decimal'
  | 'binary'
  | 'float-single'
  | 'float-double'
  /** USAGE POINTER / PROCEDURE-POINTER / FUNCTION-POINTER */
  | 'pointer'
  /** USAGE INDEX */
  | 'index'
  | 'group'
  /** Hueco dejado por un COPY/EXEC SQL INCLUDE cuyo member no se aportó */
  | 'unresolved-copy'

/** Un valor de condición (nivel 88) asociado a su campo padre */
export interface ConditionValue {
  /** Nombre del nivel 88 */
  name: string
  /** Literales/tokens tal como aparecen tras VALUE(S) — incluye THRU sin resolver como rango */
  values: string[]
}

/**
 * Un nivel 66 RENAMES: nombre alternativo para un tramo contiguo de campos
 * del registro. No es almacenamiento nuevo — como REDEFINES, es otra vista
 * de bytes que ya existen — así que no vive en la jerarquía de `children`.
 */
export interface RenamesGroup {
  /** Nombre del nivel 66 */
  name: string
  /** Primer campo del tramo (RENAMES <from>) */
  from: string
  /** Último campo del tramo (THRU <thru>), si el rango lo tiene */
  thru?: string | undefined
  /**
   * Offset y longitud resueltos contra el registro. Ausentes si algún
   * extremo del rango no aparece en el fuente aportado (p. ej. está en un
   * copybook que falta): no se estiman (ADR-0003).
   */
  offset?: number | undefined
  lengthInBytes?: number | undefined
}

/** OCCURS ... DEPENDING ON — reconocido y marcado como variable, sin resolver numéricamente */
export interface OccursDepending {
  min: number
  max?: number | undefined
  dependingOn: string
}

/**
 * Sección de la DATA DIVISION de la que viene un registro 01/77. Responde
 * a "¿qué recibe el programa por parámetro?" (LINKAGE) frente a lo que es
 * suyo (WORKING-STORAGE) o de un fichero (FILE). Ausente cuando el fuente
 * es un copybook suelto sin cabecera de sección: no se adivina.
 */
export type DataSection = 'FILE' | 'WORKING-STORAGE' | 'LOCAL-STORAGE' | 'LINKAGE'

/** Campo individual del esquema */
export interface SchemaField {
  /** Número de nivel COBOL (01–49, 77) */
  level: number
  /** Nombre del campo (DATA-NAME) */
  name: string
  /** Tipo interpretado */
  type: DataType
  /**
   * Sección de la DATA DIVISION del registro. Solo en los 01/77 raíz —
   * los hijos heredan la del suyo. Ausente si el fuente no traía cabecera
   * de sección (copybook suelto).
   */
  dataSection?: DataSection | undefined
  /**
   * Valor inicial declarado (cláusula VALUE), verbatim del fuente:
   * `'ABC'`, `ZEROS`, `42`, `ALL '*'`. Ausente si el campo no lo lleva.
   * En un 88 no aparece aquí — sus valores van en `conditionValues`.
   */
  value?: string | undefined
  /** Cláusula PIC original, p. ej. "S9(7)V99". Ausente en groups y en COMP-1/COMP-2 sin PIC */
  picture?: string | undefined
  /** USAGE explícito normalizado (COMP-3, COMP, COMP-1, COMP-2, BINARY, PACKED-DECIMAL). Ausente = DISPLAY */
  usage?: string | undefined
  /** Longitud en memoria, en bytes */
  lengthInBytes: number
  /** Desplazamiento desde el inicio del registro 01, en bytes */
  offset: number
  /** Hijos directos (para ítems de grupo) */
  children: SchemaField[]
  /** Nombre del campo que este campo redefine — comparte offset, no consume memoria nueva */
  redefines?: string | undefined
  /** Repetición OCCURS fija */
  occurs?: number | undefined
  /** OCCURS ... DEPENDING ON */
  occursDepending?: OccursDepending | undefined
  /** Niveles 88 asociados a este campo. NUNCA aparecen en `children` */
  conditionValues?: ConditionValue[] | undefined
  /**
   * Niveles 66 RENAMES declarados sobre este registro. Como los 88, NUNCA
   * aparecen en `children`: no son almacenamiento nuevo.
   */
  renamesGroups?: RenamesGroup[] | undefined
  /**
   * El campo lleva SYNCHRONIZED, o es un POINTER/INDEX (que van alineados
   * de forma implícita). Su offset se ha redondeado al alto hasta el
   * límite que le toca, y los bytes de relleno que quedan delante no
   * pertenecen a ningún campo.
   */
  synchronized?: boolean | undefined
  /** Solo si type === 'unresolved-copy': el member de COPY/EXEC SQL INCLUDE que faltó */
  unresolvedCopyMember?: string | undefined
  /**
   * true si este offset (o el de un campo anterior en el mismo nivel, o el
   * tamaño de un grupo que lo contiene) descansa sobre un hueco sin
   * resolver — el número sigue calculado para no romper la aritmética,
   * pero no es un hecho verificado (ADR-0003).
   */
  offsetUnknown?: boolean | undefined
}

/** Resultado estructural del parser */
export interface ParseResult {
  /** Registros de nivel 01 (o 77) extraídos de la DATA DIVISION */
  records: SchemaField[]
  /** Members de COPY/EXEC SQL INCLUDE no resueltos — lo que falta para completar el esquema */
  missingCopybooks: string[]
}

// ── Flujo (PROCEDURE DIVISION) ──────────────────────────────────────────

/** Un párrafo o sección de la PROCEDURE DIVISION, en orden de fuente */
export interface FlowParagraph {
  name: string
  kind: 'paragraph' | 'section'
  /** Sección a la que pertenece el párrafo, si el programa usa secciones */
  section?: string | undefined
  /**
   * Línea 1-based de la cabecera en el fuente. Permite anclar cada párrafo
   * a un punto concreto del código para verificarlo. Ausente en el nodo
   * de entrada implícito, que no existe en el fuente.
   */
  line?: number | undefined
  /** Contiene STOP RUN, GOBACK o EXIT PROGRAM */
  terminates?: boolean | undefined
  /**
   * El párrafo no contiene ninguna transferencia de control incondicional
   * (STOP RUN, GOBACK, EXIT PROGRAM o GO TO fuera de toda rama), así que
   * quien llegue aquí ejecutando en línea sigue en el párrafo siguiente.
   * Ausente en el último párrafo, que no tiene siguiente.
   */
  fallsThrough?: boolean | undefined
  /**
   * El párrafo está dentro de DECLARATIVES: no se ejecuta en línea, lo
   * invoca el runtime ante la condición que declara su USE.
   */
  inDeclaratives?: boolean | undefined
  /**
   * Nodo de entrada sintético: agrupa las sentencias que aparecen antes
   * del primer párrafo declarado. No existe como párrafo en el fuente.
   */
  implicit?: boolean | undefined
}

export type FlowEdgeKind =
  | 'perform'
  | 'call'
  | 'goto'
  /**
   * Caída natural: el párrafo anterior no acaba en transferencia de
   * control, así que el que llega por orden de fuente sigue en el
   * siguiente. Ocurre de verdad cuando se llega al párrafo ejecutando en
   * línea; si se llegó por PERFORM, al final del rango se vuelve al
   * llamador. Eso depende de la ejecución, no del fuente, así que la
   * arista dice lo que sí es verificable: aquí no hay nada que corte.
   */
  | 'fall-through'
  /** SORT/MERGE ... INPUT PROCEDURE IS ... */
  | 'sort-input'
  /** SORT/MERGE ... OUTPUT PROCEDURE IS ... */
  | 'sort-output'

/** Una arista de flujo extraída de una sentencia concreta del fuente */
export interface FlowEdge {
  /** Párrafo (o nodo implícito) donde aparece la sentencia */
  from: string
  /** Destino: párrafo/sección (perform, goto) o programa (call) */
  to: string
  kind: FlowEdgeKind
  /** PERFORM A THRU B */
  thru?: string | undefined
  /** PERFORM A n TIMES */
  times?: number | undefined
  /** Texto crudo de la condición: "UNTIL ..." o "DEPENDING ON ..." */
  condition?: string | undefined
  /** CALL con variable: el programa destino no es verificable en el fuente */
  dynamic?: boolean | undefined
  /**
   * Condiciones IF/EVALUATE abiertas en el punto de la sentencia, de la más
   * externa a la más interna — la sentencia solo se ejecuta si TODAS se
   * cumplen. Texto crudo del fuente ("WS-TIPO = 'A'", "NOT (WS-FIN)"),
   * sin interpretar: el parser dice bajo qué condición ocurre la arista,
   * no qué significa. Ausente = la sentencia es incondicional.
   */
  guards?: string[] | undefined
  /** Línea del fuente (1-based) donde aparece la sentencia — trazabilidad */
  line: number
}

// ── Cadena entre programas ──────────────────────────────────────────────

/** Un programa aportado por el usuario, con su flujo interno ya extraído */
export interface LinkedProgram {
  /** Nombre con el que se identifica: PROGRAM-ID si existe, si no el del fichero */
  name: string
  /** Nombre del fichero tal como lo aportó el usuario */
  sourceName: string
  flow: FlowResult
}

/** Una llamada que cruza la frontera de un programa */
export interface CrossProgramCall {
  fromProgram: string
  fromParagraph: string
  /** Programa destino, o el nombre de la variable si la llamada es dinámica */
  toProgram: string
  /** true si el destino está entre los programas aportados */
  resolved: boolean
  /** CALL con variable: el destino real solo se conoce en ejecución */
  dynamic: boolean
  line: number
}

/** Grafo de llamadas entre los programas aportados */
export interface LinkedFlow {
  programs: LinkedProgram[]
  calls: CrossProgramCall[]
  /** Programas llamados con literal pero no aportados — qué falta por bajar */
  missingPrograms: string[]
}

// ── Inventario: qué toca el programa ────────────────────────────────────

export type FileVerb = 'OPEN' | 'CLOSE' | 'READ' | 'WRITE' | 'REWRITE' | 'DELETE' | 'START'

/** Una operación de E/S sobre un fichero, anclada a su línea de fuente */
export interface FileOperation {
  verb: FileVerb
  /** Modo del OPEN tal como aparece (INPUT, OUTPUT, I-O, EXTEND) */
  mode?: string | undefined
  /** Párrafo donde aparece la sentencia */
  paragraph: string
  /**
   * El nombre de `paragraph` es el del nodo de entrada sintético, no el de
   * un párrafo declarado en el fuente: la sentencia aparece antes de la
   * primera cabecera de párrafo. Mismo criterio que `FlowParagraph.implicit`
   * — se marca en vez de hacerlo pasar por un hecho del fuente (ADR-0003).
   */
  paragraphImplicit?: boolean | undefined
  line: number
}

/** Un fichero declarado en FILE-CONTROL con lo que el programa hace con él */
export interface FileUsage {
  /** Nombre lógico COBOL (SELECT <nombre>) */
  name: string
  /**
   * Nombre de sistema del `ASSIGN TO`, tal cual aparece. NO se interpreta:
   * en z/OS suele contener el ddname del JCL (a veces con prefijos como
   * `UT-S-`), pero deducir cuál es la parte del DD sería una convención,
   * no un hecho del fuente.
   */
  assignTo?: string | undefined
  /** ORGANIZATION IS ... tal cual, sin interpretar */
  organization?: string | undefined
  /** ACCESS MODE IS ... tal cual, sin interpretar */
  access?: string | undefined
  /** Nombres de registro 01 bajo su FD — cómo se resuelve un WRITE */
  records: string[]
  operations: FileOperation[]
}

/** Bloque EXEC SQL o EXEC CICS, extraído sin interpretación semántica */
export interface ExecBlock {
  kind: 'sql' | 'cics'
  /** SQL: primer verbo (SELECT, DECLARE, FETCH…). CICS: comando (SEND, LINK…) */
  verb: string
  /** Párrafo donde aparece; ausente si el bloque está en la DATA DIVISION */
  paragraph?: string | undefined
  /** Ver `FileOperation.paragraphImplicit` */
  paragraphImplicit?: boolean | undefined
  line: number
  /** Texto del bloque colapsado a una línea, EXEC/END-EXEC incluidos */
  text: string
  /** SQL: tablas nombradas tras FROM/JOIN/INSERT INTO/UPDATE. Vacío en CICS */
  tables: string[]
  /** CICS: opciones con valor literal, como `FILE(CUSTFILE)`. Vacío en SQL */
  options: string[]
  /** SQL: cursor nombrado por el bloque (DECLARE/OPEN/FETCH/CLOSE) */
  cursor?: string | undefined
  /**
   * El recurso real solo se conoce en ejecución: SQL dinámico
   * (PREPARE/EXECUTE, la sentencia viaja en una host variable) o un EXEC
   * CICS cuyo recurso (FILE, PROGRAM, MAP…) es un data-name en vez de un
   * literal. Como una CALL dinámica, se marca en vez de resolverse a
   * ciegas (ADR-0003).
   */
  dynamic?: boolean | undefined
}

/** Un cursor DB2 y qué hace el programa con él */
export interface CursorUsage {
  name: string
  /** Aparece un DECLARE ... CURSOR en el fuente aportado */
  declared: boolean
  opened: boolean
  fetched: boolean
  closed: boolean
  /** Tablas nombradas en su DECLARE */
  tables: string[]
}

/** Respuesta a "¿este programa qué toca?" — ficheros, tablas, CICS */
export interface Inventory {
  files: FileUsage[]
  /**
   * Operaciones de E/S cuyo fichero no se pudo resolver: el SELECT o el FD
   * están en un copybook no aportado, o el nombre no aparece en el fuente.
   * Se listan aparte en vez de asignarlas a un fichero inventado (ADR-0003).
   */
  unresolvedFileOps: (FileOperation & { target: string })[]
  execs: ExecBlock[]
  /** Tablas DB2 distintas nombradas en algún EXEC SQL, en orden de aparición */
  tables: string[]
  cursors: CursorUsage[]
  /** Comandos CICS distintos con cuántas veces aparecen */
  cicsCommands: { command: string; count: number }[]
}

/** Hechos de flujo extraídos de la PROCEDURE DIVISION */
export interface FlowResult {
  /** PROGRAM-ID si aparece en el fuente */
  programId?: string | undefined
  paragraphs: FlowParagraph[]
  edges: FlowEdge[]
  /** Destinos de PERFORM/GO TO que no corresponden a ningún párrafo del fuente */
  missingTargets: string[]
  /**
   * PROGRAM-ID de los programas anidados dentro de este fuente. Su flujo
   * NO está en `paragraphs` ni en `edges`: son programas distintos y
   * mezclarlos daría un grafo que no existe. Se declaran para que quede
   * dicho que el fuente contiene más de lo que se ha analizado.
   */
  nestedPrograms: string[]
  /**
   * true si el fuente no traía cabecera PROCEDURE DIVISION y se parseó
   * como fragmento — nivel de fidelidad "parcialmente verificado"
   */
  fragment: boolean
}
