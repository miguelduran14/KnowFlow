      *----------------------------------------------------------------*
      * VALIDA01                                                        *
      * Subprograma de validacion de un movimiento. Recibe el registro *
      * y devuelve el estado ('V' valido / 'R' rechazado). Segundo      *
      * eslabon de la cadena, invocado por CTAMOV01 en cada registro.  *
      *                                                                *
      * OJO (esto lo marca KnowFlow en "Avisos"): el parrafo de        *
      * rechazo hace STOP RUN. Como este es un SUBprograma (tiene      *
      * LINKAGE SECTION, solo se llega por CALL), STOP RUN mata el job *
      * ENTERO, no solo este modulo. Deberia ser GOBACK.               *
      *                                                                *
      * Ejemplo sintetico de KnowFlow. No es codigo de ningun cliente. *
      *----------------------------------------------------------------*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. VALIDA01.
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-LIMITE-IMPORTE   PIC S9(11)V99 COMP-3 VALUE 5000000.00.
       LINKAGE SECTION.
       01  LK-MOV-REGISTRO.
           05  LK-MOV-CUENTA     PIC X(12).
           05  FILLER           PIC X(07).
           05  LK-MOV-TIPO      PIC X(01).
           05  LK-MOV-IMPORTE   PIC S9(11)V99 COMP-3.
       01  LK-ESTADO.
           COPY ESTADOS.
       PROCEDURE DIVISION USING LK-MOV-REGISTRO LK-ESTADO.
       VALIDAR.
           SET ESTADO-VALIDO TO TRUE
           EVALUATE TRUE
               WHEN LK-MOV-IMPORTE > WS-LIMITE-IMPORTE
                   PERFORM RECHAZAR
               WHEN LK-MOV-TIPO NOT = 'A' AND LK-MOV-TIPO NOT = 'C'
                                         AND LK-MOV-TIPO NOT = 'T'
                   PERFORM RECHAZAR
           END-EVALUATE
           GOBACK.
       RECHAZAR.
           SET ESTADO-RECHAZADO TO TRUE
           DISPLAY 'VALIDA01: MOVIMIENTO RECHAZADO CTA=' LK-MOV-CUENTA
           STOP RUN.
