      * Synthetic fixture — CALL static and dynamic, GO TO plain and
      * DEPENDING ON, plus a target that does not exist in the source.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CALLDEMO.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-ROUTINE        PIC X(8).
       01 WS-OPTION         PIC 9(1).
       PROCEDURE DIVISION.
       MAIN-PARA.
           CALL 'SUBPROG1' USING WS-OPTION
           CALL WS-ROUTINE
           GO TO CHOICE-A CHOICE-B DEPENDING ON WS-OPTION
           GO TO FINISH-PARA.
       CHOICE-A.
           DISPLAY 'A'
           GO TO GHOST-PARA.
       CHOICE-B.
           DISPLAY 'B'.
       FINISH-PARA.
           STOP RUN.
