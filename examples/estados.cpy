      *----------------------------------------------------------------*
      * ESTADOS.CPY                                                     *
      * Codigo de estado de un movimiento y sus nombres de condicion.  *
      * Copybook FRAGMENTO (empieza en nivel 05): se COPIA dentro de   *
      * un grupo. Compartido por CTAMOV01 y VALIDA01, para que el      *
      * mismo juego de niveles 88 signifique lo mismo en los dos.      *
      *                                                                *
      * Ejemplo sintetico de KnowFlow. No es codigo de ningun cliente. *
      *----------------------------------------------------------------*
           05  MOV-ESTADO              PIC X(01).
               88  ESTADO-VALIDO         VALUE 'V'.
               88  ESTADO-RECHAZADO      VALUE 'R'.
               88  ESTADO-PENDIENTE      VALUE 'P'.
               88  ESTADO-CONOCIDO       VALUE 'V' 'R' 'P'.
