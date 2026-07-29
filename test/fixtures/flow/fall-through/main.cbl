      * Synthetic fixture — natural fall-through between paragraphs, the
      * classic COBOL gotcha. A paragraph that ends without an
      * unconditional transfer of control (GO TO, STOP RUN, GOBACK) lets
      * execution slide into the next one in source order.
      *
      * DRIVER-PARA ends in STOP RUN, so it does NOT fall through.
      * STEP-ONE and STEP-TWO have no transfer, so they fall into the
      * next paragraph — STEP-ONE into STEP-TWO, STEP-TWO into DEAD-PARA,
      * which is only reachable this way (nobody PERFORMs it).
       IDENTIFICATION DIVISION.
       PROGRAM-ID. FALLPRG.
       PROCEDURE DIVISION.
       DRIVER-PARA.
           PERFORM STEP-ONE
           STOP RUN.
       STEP-ONE.
           MOVE 1 TO WS-X.
       STEP-TWO.
           MOVE 2 TO WS-X.
       DEAD-PARA.
           DISPLAY 'REACHED BY FALL-THROUGH'.
