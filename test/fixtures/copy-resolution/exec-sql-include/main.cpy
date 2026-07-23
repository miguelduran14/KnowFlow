      * Synthetic fixture — EXEC SQL INCLUDE resolved like a COPY.
       01 MAIN-RECORD.
         05 REC-ID           PIC 9(5).
         EXEC SQL INCLUDE SQL-ROW END-EXEC.
