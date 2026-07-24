/** Tipo interpretado de un campo COBOL */
export type DataType =
  | 'alphanumeric'
  | 'numeric'
  | 'packed-decimal'
  | 'binary'
  | 'float-single'
  | 'float-double'
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

/** OCCURS ... DEPENDING ON — reconocido y marcado como variable, sin resolver numéricamente */
export interface OccursDepending {
  min: number
  max?: number | undefined
  dependingOn: string
}

/** Campo individual del esquema */
export interface SchemaField {
  /** Número de nivel COBOL (01–49, 77) */
  level: number
  /** Nombre del campo (DATA-NAME) */
  name: string
  /** Tipo interpretado */
  type: DataType
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
  /** Contiene STOP RUN, GOBACK o EXIT PROGRAM */
  terminates?: boolean | undefined
  /**
   * Nodo de entrada sintético: agrupa las sentencias que aparecen antes
   * del primer párrafo declarado. No existe como párrafo en el fuente.
   */
  implicit?: boolean | undefined
}

export type FlowEdgeKind = 'perform' | 'call' | 'goto'

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

/** Hechos de flujo extraídos de la PROCEDURE DIVISION */
export interface FlowResult {
  /** PROGRAM-ID si aparece en el fuente */
  programId?: string | undefined
  paragraphs: FlowParagraph[]
  edges: FlowEdge[]
  /** Destinos de PERFORM/GO TO que no corresponden a ningún párrafo del fuente */
  missingTargets: string[]
  /**
   * true si el fuente no traía cabecera PROCEDURE DIVISION y se parseó
   * como fragmento — nivel de fidelidad "parcialmente verificado"
   */
  fragment: boolean
}
