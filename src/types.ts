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
