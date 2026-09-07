      *----------------------------------------------------------------*
      * FECHA01                                                         *
      * Utilidad: convierte una fecha juliana AAAA/DDD a Gregoriana    *
      * AAAA-MM-DD. Subprograma sin E/S: solo aritmetica sobre los     *
      * campos que recibe por LINKAGE. Tercer eslabon de la cadena     *
      * CTAMOV01 -> VALIDA01 / FECHA01.                                *
      *                                                                *
      * Ejemplo sintetico de KnowFlow. No es codigo de ningun cliente. *
      *----------------------------------------------------------------*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. FECHA01.
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-DIAS-ACUM.
           05  FILLER  PIC 9(03) VALUE 000.
           05  FILLER  PIC 9(03) VALUE 031.
           05  FILLER  PIC 9(03) VALUE 059.
           05  FILLER  PIC 9(03) VALUE 090.
           05  FILLER  PIC 9(03) VALUE 120.
           05  FILLER  PIC 9(03) VALUE 151.
           05  FILLER  PIC 9(03) VALUE 181.
           05  FILLER  PIC 9(03) VALUE 212.
           05  FILLER  PIC 9(03) VALUE 243.
           05  FILLER  PIC 9(03) VALUE 273.
           05  FILLER  PIC 9(03) VALUE 304.
           05  FILLER  PIC 9(03) VALUE 334.
       01  WS-DIAS-TAB  REDEFINES WS-DIAS-ACUM.
           05  WS-DIAS-MES  PIC 9(03) OCCURS 12 TIMES INDEXED BY WS-M.
       01  WS-DIA-RESTANTE   PIC 9(03).
       01  WS-BISIESTO       PIC 9(01).
           88  ES-BISIESTO     VALUE 1.
       LINKAGE SECTION.
       01  LK-FECHA-JUL.
           05  LK-JUL-ANIO      PIC 9(04).
           05  LK-JUL-DIA       PIC 9(03).
       01  LK-FECHA-GREG.
           05  LK-GREG-ANIO     PIC 9(04).
           05  LK-GREG-MES      PIC 9(02).
           05  LK-GREG-DIA      PIC 9(02).
       PROCEDURE DIVISION USING LK-FECHA-JUL LK-FECHA-GREG.
       CONVERTIR.
           MOVE LK-JUL-ANIO   TO LK-GREG-ANIO
           MOVE LK-JUL-DIA    TO WS-DIA-RESTANTE
           PERFORM DETERMINAR-BISIESTO
           MOVE 12 TO LK-GREG-MES
           PERFORM VARYING WS-M FROM 12 BY -1 UNTIL WS-M < 1
               IF LK-JUL-DIA > WS-DIAS-MES(WS-M)
                   MOVE WS-M TO LK-GREG-MES
                   COMPUTE WS-DIA-RESTANTE =
                       LK-JUL-DIA - WS-DIAS-MES(WS-M)
                   MOVE 1 TO WS-M
               END-IF
           END-PERFORM
           MOVE WS-DIA-RESTANTE TO LK-GREG-DIA
           GOBACK.
       DETERMINAR-BISIESTO.
           MOVE 0 TO WS-BISIESTO
           IF FUNCTION MOD (LK-JUL-ANIO 4) = 0
               MOVE 1 TO WS-BISIESTO
           END-IF.
