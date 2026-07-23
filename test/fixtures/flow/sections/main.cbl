      * Synthetic fixture — sections grouping paragraphs; PERFORM of a
      * whole section.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SECTDEMO.
       PROCEDURE DIVISION.
       CONTROL-SECTION SECTION.
       MAIN-PARA.
           PERFORM IO-SECTION
           STOP RUN.
       IO-SECTION SECTION.
       READ-PARA.
           DISPLAY 'READ'.
       WRITE-PARA.
           DISPLAY 'WRITE'.
