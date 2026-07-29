      * Synthetic fixture — numeric-prefixed paragraph names (0000-, 1000-,
      * 9999-), the dominant convention in real mainframe shops. Requiring a
      * letter-initial name left the parser blind to whole programs like
      * these (found running AWS CardDemo through the parser).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. NUMPARA.
       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-INIT
           PERFORM 2000-PROCESS UNTIL WS-EOF = 'Y'
           PERFORM 9000-CLEANUP
           GOBACK.
       1000-INIT.
           MOVE 0 TO WS-COUNT.
       2000-PROCESS.
           PERFORM 2100-READ THRU 2100-READ-EXIT
           IF WS-OK
               PERFORM 3 TIMES
                   ADD 1 TO WS-COUNT
               END-PERFORM
           END-IF.
       2100-READ.
           DISPLAY 'READ'.
       2100-READ-EXIT.
           EXIT.
       9000-CLEANUP.
           DISPLAY 'DONE'.
