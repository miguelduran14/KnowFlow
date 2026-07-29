      * Synthetic fixture — SORT with INPUT/OUTPUT PROCEDURE, and I/O
      * handlers (AT END / INVALID KEY / ON SIZE ERROR) as branches.
      * The handler edges carry the handler phrase as a guard; an inline
      * PERFORM VARYING marks its body as running in a loop.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SORTPRG.
       PROCEDURE DIVISION.
       MAIN-PARA.
           SORT WORK-FILE ON ASCENDING KEY WK-KEY
               INPUT PROCEDURE IS LOAD-PARA
               OUTPUT PROCEDURE IS EMIT-PARA THRU EMIT-EXIT
           STOP RUN.
       LOAD-PARA.
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 100
               READ IN-FILE
                   AT END PERFORM MARK-DONE-PARA
                   NOT AT END RELEASE WORK-REC
               END-READ
           END-PERFORM
           GOBACK.
       MARK-DONE-PARA.
           MOVE 'Y' TO WS-DONE.
       EMIT-PARA.
           RETURN WORK-FILE
               AT END GO TO EMIT-EXIT
           END-RETURN
           WRITE OUT-REC
               INVALID KEY PERFORM BAD-KEY-PARA
           END-WRITE
           COMPUTE WS-T = WS-A * WS-B
               ON SIZE ERROR PERFORM OVERFLOW-PARA
           END-COMPUTE.
       BAD-KEY-PARA.
           DISPLAY 'BAD KEY'.
       OVERFLOW-PARA.
           DISPLAY 'OVERFLOW'.
       EMIT-EXIT.
           GOBACK.
