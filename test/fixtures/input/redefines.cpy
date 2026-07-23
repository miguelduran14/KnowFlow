      * Synthetic golden-file fixture for KnowFlow parser T2.
      * REDEFINES: two views over the same bytes, no business meaning.
       01 SAMPLE-AREA.
         05 RAW-BYTES        PIC X(10).
         05 NUMERIC-VIEW REDEFINES RAW-BYTES PIC 9(10).
         05 NEXT-FIELD       PIC X(4).
