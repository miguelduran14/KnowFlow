      * Synthetic fixture — caller with a static CALL to a supplied
      * program, a static CALL to one NOT supplied, and a dynamic CALL.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. MAINPROG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-NEXT-PROG      PIC X(8).
       PROCEDURE DIVISION.
       MAIN-PARA.
           CALL 'VALIDPRG'
           PERFORM REPORT-PARA
           STOP RUN.
       REPORT-PARA.
           CALL 'ABSENTPR'
           CALL WS-NEXT-PROG.
