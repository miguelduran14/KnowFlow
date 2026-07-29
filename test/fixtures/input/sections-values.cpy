      * Synthetic fixture — DATA DIVISION sections and VALUE clauses.
      * Each 01 records which section it came from (FILE / WORKING-STORAGE
      * / LINKAGE); LINKAGE answers "what does the program receive as a
      * parameter?". Normal fields record their initial VALUE verbatim.
       DATA DIVISION.
       FILE SECTION.
       FD  CUST-FILE.
       01  CUST-REC              PIC X(80).
       WORKING-STORAGE SECTION.
       01  WS-GREETING          PIC X(5) VALUE 'HOLA'.
       01  WS-COUNTER           PIC 9(4) VALUE ZEROS.
       01  WS-BORDER            PIC X(10) VALUE ALL '*'.
       01  WS-RATE              PIC 9V99 VALUE 1.05.
       01  WS-STATE             PIC X(1) VALUE 'N'.
           88  IS-DONE            VALUE 'Y'.
       LINKAGE SECTION.
       01  LK-PARM.
         05  LK-CODE            PIC X(3).
         05  LK-AMOUNT          PIC S9(5) COMP-3.
