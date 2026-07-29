      * Synthetic fixture — a nested program. Only the outer program's
      * flow is analysed; INTERNO's paragraphs must NOT leak into it.
      * The nested program is declared as a limit instead.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. EXTERNO.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM PREP-PARA
           CALL 'INTERNO'
           GOBACK.
       PREP-PARA.
           DISPLAY 'PREP'.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTERNO.
       PROCEDURE DIVISION.
       SUB-PARA.
           PERFORM OTRO-PARA.
       OTRO-PARA.
           DISPLAY 'INTERNO'.
       END PROGRAM INTERNO.
       END PROGRAM EXTERNO.
