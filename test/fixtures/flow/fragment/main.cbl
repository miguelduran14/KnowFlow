      * Synthetic fixture — pasted fragment without PROCEDURE DIVISION
      * header: statements before any paragraph, parsed as fragment.
           PERFORM VALIDATE-PARA
           IF WS-OK = 'Y'
               PERFORM APPLY-PARA
           END-IF.
       VALIDATE-PARA.
           DISPLAY 'VALIDATING'.
       APPLY-PARA.
           DISPLAY 'APPLYING'.
