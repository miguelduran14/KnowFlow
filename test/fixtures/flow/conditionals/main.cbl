      * Synthetic fixture — IF/ELSE and EVALUATE branching. Every edge
      * inside a branch carries the raw condition text as a guard; the
      * statements after END-IF/END-EVALUATE carry none.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONDPRG.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM INIT-PARA
           IF WS-FLAG = 'Y'
               PERFORM PATH-A
           ELSE
               PERFORM PATH-B
           END-IF
           EVALUATE WS-TIPO
               WHEN 'A'
                   PERFORM DO-A
               WHEN 'B'
               WHEN 'C'
                   PERFORM DO-BC
               WHEN OTHER
                   PERFORM DO-REST
           END-EVALUATE
           PERFORM CLOSE-PARA.
       INIT-PARA.
           IF WS-COUNT > 0
              AND WS-READY = 'Y'
               IF WS-DEEP = 1
                   CALL 'SUBPRG'
               END-IF
               PERFORM MID-PARA
           END-IF.
       PATH-A.
           DISPLAY 'A'.
       PATH-B.
           DISPLAY 'B'.
       DO-A.
           DISPLAY 'DO A'.
       DO-BC.
           DISPLAY 'DO BC'.
       DO-REST.
           DISPLAY 'DO REST'.
       MID-PARA.
           DISPLAY 'MID'.
       CLOSE-PARA.
           GOBACK.
