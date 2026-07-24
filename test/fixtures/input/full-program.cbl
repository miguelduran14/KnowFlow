      * Synthetic fixture — a FULL program (all divisions): the data
      * parser must stop at PROCEDURE DIVISION and never swallow
      * procedure statements into a VALUE clause.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. FULLDEMO.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REGISTRO.
         05 WS-CLAVE          PIC X(8).
         05 WS-IMPORTE        PIC S9(7)V99 COMP-3.
         05 WS-ESTADO         PIC X(1).
           88 WS-ACTIVO         VALUE 'A'.
           88 WS-CERRADO        VALUE 'C'.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM DETAIL-PARA
           STOP RUN.
       DETAIL-PARA.
           DISPLAY 'X'.
