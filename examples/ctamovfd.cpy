      *----------------------------------------------------------------*
      * CTAMOVFD.CPY                                                    *
      * Registro del fichero secuencial de movimientos de cuenta.      *
      * Patron tipico de banca: clave de cuenta partida en oficina +   *
      * numero (via REDEFINES), fecha juliana, importe empaquetado.    *
      *                                                                *
      * Ejemplo sintetico de KnowFlow. No es codigo de ningun cliente. *
      *----------------------------------------------------------------*
       01  MOV-REGISTRO.
           05  MOV-CUENTA             PIC X(12).
           05  MOV-CUENTA-DESGLOSE  REDEFINES MOV-CUENTA.
               10  MOV-CTA-OFICINA     PIC X(04).
               10  MOV-CTA-NUMERO      PIC X(08).
           05  MOV-FECHA-JUL.
               10  MOV-FJ-ANIO         PIC 9(04).
               10  MOV-FJ-DIA          PIC 9(03).
           05  MOV-TIPO               PIC X(01).
           05  MOV-IMPORTE            PIC S9(11)V99 COMP-3.
           05  MOV-DIVISA             PIC X(03).
           05  FILLER                 PIC X(20).
