      *----------------------------------------------------------------*
      * CTAMOV01                                                        *
      * Batch de liquidacion de intereses de movimientos de cuenta.    *
      * Lee el fichero de movimientos, valida cada uno con VALIDA01,   *
      * calcula el interes con la tarifa leida de DB2, formatea la     *
      * fecha con FECHA01 y escribe una linea de detalle en el informe.*
      *                                                                *
      * Programa principal de la cadena de ejemplo de KnowFlow.        *
      * Todo es sintetico: no reproduce codigo de ningun cliente,      *
      * solo patrones tipicos de un batch de banca (secuencial +       *
      * cursor DB2 + subprogramas + copybooks).                        *
      *----------------------------------------------------------------*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CTAMOV01.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT MOV-FILE ASSIGN TO MOVIN
               ORGANIZATION IS SEQUENTIAL
               FILE STATUS  IS WS-FS-MOV.
           SELECT RPT-FILE ASSIGN TO RPTOUT
               ORGANIZATION IS SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  MOV-FILE.
           COPY CTAMOVFD.
       FD  RPT-FILE.
       01  RPT-REGISTRO             PIC X(132).
       WORKING-STORAGE SECTION.
           EXEC SQL INCLUDE SQLCA END-EXEC.
           EXEC SQL
               DECLARE CUR-TARIFA CURSOR FOR
                   SELECT TAR_TASA
                     FROM TARIFAS
                    WHERE TAR_DIVISA = :WS-DIVISA
                      AND TAR_TIPO   = :WS-MOV-TIPO
           END-EXEC.
       01  WS-FS-MOV               PIC X(02).
           88  WS-FIN-MOV           VALUE '10'.
           88  WS-MOV-OK           VALUE '00'.
       01  WS-CONTADORES.
           05  WS-LEIDOS           PIC 9(07) COMP-3 VALUE 0.
           05  WS-VALIDOS          PIC 9(07) COMP-3 VALUE 0.
           05  WS-RECHAZADOS       PIC 9(07) COMP-3 VALUE 0.
       01  WS-ACUMULADORES.
           05  WS-ACU OCCURS 4 TIMES INDEXED BY WS-IX.
               10  WS-ACU-TIPO     PIC X(01).
               10  WS-ACU-IMPORTE  PIC S9(13)V99 COMP-3.
       01  WS-CALCULO.
           05  WS-BRUTO           PIC S9(13)V99 COMP-3.
           05  WS-TASA            PIC S9(01)V9(05) COMP-3.
           05  WS-INTERES         PIC S9(13)V99 COMP-3.
           05  WS-TOTAL           PIC S9(13)V99 COMP-3.
       01  WS-TOTAL-ED            PIC -Z(12)9.99.
       01  WS-DIVISA             PIC X(03).
       01  WS-MOV-TIPO           PIC X(01).
       01  WS-FECHA-JUL.
           05  WS-FJ-ANIO         PIC 9(04).
           05  WS-FJ-DIA          PIC 9(03).
       01  WS-FECHA-GREG.
           05  WS-FG-ANIO         PIC 9(04).
           05  WS-FG-MES          PIC 9(02).
           05  WS-FG-DIA          PIC 9(02).
       01  WS-FECHA-TXT          PIC X(10).
       01  WS-VALIDACION.
           COPY ESTADOS.
       PROCEDURE DIVISION.
      *================================================================*
       INICIO SECTION.
      *================================================================*
       INI-10.
           OPEN INPUT  MOV-FILE
           OPEN OUTPUT RPT-FILE
           MOVE 'EUR' TO WS-DIVISA
           EXEC SQL OPEN CUR-TARIFA END-EXEC
           MOVE SPACES TO RPT-REGISTRO
           STRING 'LIQUIDACION DE INTERESES - DIVISA ' WS-DIVISA
               DELIMITED BY SIZE INTO RPT-REGISTRO
           WRITE RPT-REGISTRO
           READ MOV-FILE.
      *================================================================*
       PROCESO SECTION.
      *================================================================*
       PRO-10.
           PERFORM UNTIL WS-FIN-MOV
               ADD 1 TO WS-LEIDOS
               IF NOT WS-MOV-OK AND NOT WS-FIN-MOV
                   GO TO ABORTAR
               END-IF
               MOVE MOV-TIPO TO WS-MOV-TIPO
               CALL 'VALIDA01' USING MOV-REGISTRO WS-VALIDACION
               IF ESTADO-VALIDO
                   PERFORM CALCULAR-INTERES
                   PERFORM ESCRIBIR-DETALLE
                   PERFORM ACUMULAR
                   ADD 1 TO WS-VALIDOS
               ELSE
                   ADD 1 TO WS-RECHAZADOS
               END-IF
               READ MOV-FILE
           END-PERFORM.

       CALCULAR-INTERES.
           MOVE MOV-IMPORTE TO WS-BRUTO
           MOVE ZEROES      TO WS-TASA
           EXEC SQL
               FETCH CUR-TARIFA INTO :WS-TASA
           END-EXEC
           COMPUTE WS-INTERES ROUNDED = WS-BRUTO * WS-TASA
           ADD WS-BRUTO WS-INTERES GIVING WS-TOTAL.

       ESCRIBIR-DETALLE.
           MOVE MOV-FECHA-JUL TO WS-FECHA-JUL
           CALL 'FECHA01' USING WS-FECHA-JUL WS-FECHA-GREG
           STRING WS-FG-ANIO '-' WS-FG-MES '-' WS-FG-DIA
               DELIMITED BY SIZE INTO WS-FECHA-TXT
           MOVE WS-TOTAL TO WS-TOTAL-ED
           MOVE SPACES   TO RPT-REGISTRO
           STRING MOV-CUENTA '  ' WS-FECHA-TXT '  ' WS-TOTAL-ED
               DELIMITED BY SIZE INTO RPT-REGISTRO
           WRITE RPT-REGISTRO.

       ACUMULAR.
           SET WS-IX TO 1
           SEARCH WS-ACU
               AT END
                   CONTINUE
               WHEN WS-ACU-TIPO(WS-IX) = MOV-TIPO
                   ADD WS-TOTAL TO WS-ACU-IMPORTE(WS-IX)
           END-SEARCH.
      *================================================================*
       FIN SECTION.
      *================================================================*
       FIN-10.
           EXEC SQL CLOSE CUR-TARIFA END-EXEC
           CLOSE MOV-FILE RPT-FILE
           DISPLAY 'CTAMOV01 OK. LEIDOS=' WS-LEIDOS
               ' VAL=' WS-VALIDOS ' RECH=' WS-RECHAZADOS
           STOP RUN.

       ABORTAR.
           DISPLAY 'CTAMOV01: ERROR E/S MOVIMIENTOS FS=' WS-FS-MOV
           CLOSE MOV-FILE RPT-FILE
           STOP RUN.
