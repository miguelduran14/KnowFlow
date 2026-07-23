      * Synthetic fixture — PERFORM variants: THRU, TIMES, UNTIL, inline.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. VARDEMO.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM SETUP-PARA THRU SETUP-EXIT
           PERFORM COUNT-PARA 3 TIMES
           PERFORM READ-PARA UNTIL WS-EOF = 'Y'
           PERFORM UNTIL WS-DONE = 'Y'
               ADD 1 TO WS-TOTAL
           END-PERFORM
           GOBACK.
       SETUP-PARA.
           DISPLAY 'SETUP'.
       SETUP-EXIT.
           EXIT.
       COUNT-PARA.
           ADD 1 TO WS-COUNT.
       READ-PARA.
           DISPLAY 'READ'.
