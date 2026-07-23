      * Synthetic fixture — basic PERFORM chain with program skeleton.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLOWDEMO.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-COUNTER        PIC 9(3).
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM INIT-PARA
           PERFORM PROCESS-PARA
           PERFORM WRAP-UP-PARA
           STOP RUN.
       INIT-PARA.
           MOVE 0 TO WS-COUNTER.
       PROCESS-PARA.
           PERFORM DETAIL-PARA
           ADD 1 TO WS-COUNTER.
       DETAIL-PARA.
           DISPLAY 'PROCESSING'.
       WRAP-UP-PARA.
           DISPLAY 'DONE'.
