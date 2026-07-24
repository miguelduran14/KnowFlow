      * Synthetic fixture — callee that itself calls a third program.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. VALIDPRG.
       PROCEDURE DIVISION.
       CHECK-PARA.
           CALL 'AUDITPRG'
           GOBACK.
