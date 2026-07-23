      * Synthetic fixture — verbs inside string literals must not create
      * edges or termination facts (no-invention rule).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LITDEMO.
       PROCEDURE DIVISION.
       MAIN-PARA.
           DISPLAY 'PERFORM GHOST-PARA'
           MOVE 'CALL FAKE' TO WS-MSG
           DISPLAY 'GOBACK'
           CALL 'REALPROG'
           PERFORM REAL-PARA.
       REAL-PARA.
           DISPLAY 'DONE'.
