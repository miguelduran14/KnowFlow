      * Synthetic fixture — DECLARATIVES. The DECLARATIVES. and
      * END-DECLARATIVES. lines delimit the handler area: they are
      * neither paragraph headers nor statements, so they must not open
      * a synthetic entry paragraph.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DECLPRG.
       PROCEDURE DIVISION.
       DECLARATIVES.
       ERR-SECTION SECTION.
           USE AFTER STANDARD ERROR PROCEDURE ON CUST-FILE.
       ERR-PARA.
           PERFORM LOG-PARA.
       END-DECLARATIVES.
       MAIN-SECTION SECTION.
       MAIN-PARA.
           PERFORM LOG-PARA
           GOBACK.
       LOG-PARA.
           DISPLAY 'LOG'.
