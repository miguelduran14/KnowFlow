/** Tipo interpretado de un campo COBOL */
export type DataType =
  | 'alphanumeric'
  | 'numeric'
  | 'packed-decimal'
  | 'group'

/** Campo individual del esquema */
export interface SchemaField {
  /** Número de nivel COBOL (01–49, 77) */
  level: number
  /** Nombre del campo (DATA-NAME) */
  name: string
  /** Tipo interpretado */
  type: DataType
  /** Cláusula PIC original, p. ej. "S9(7)V99". Ausente en groups */
  picture?: string | undefined
  /** USAGE explícito (COMP-3…). Ausente = DISPLAY */
  usage?: string | undefined
  /** Longitud en memoria, en bytes */
  lengthInBytes: number
  /** Desplazamiento desde el inicio del registro 01, en bytes */
  offset: number
  /** Hijos directos (para ítems de grupo) */
  children: SchemaField[]
}

/** Resultado estructural del parser */
export interface ParseResult {
  /** Registros de nivel 01 (o 77) extraídos de la DATA DIVISION */
  records: SchemaField[]
}
