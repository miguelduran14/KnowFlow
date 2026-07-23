      * Synthetic golden-file fixture for KnowFlow parser T2.
      * OCCURS fixed and OCCURS ... DEPENDING ON, no business meaning.
       01 SAMPLE-TABLE.
         05 FIXED-COUNT      PIC 9(2).
         05 FIXED-ITEM OCCURS 3 TIMES PIC X(4).
         05 VAR-COUNT        PIC 9(2).
         05 VAR-ITEM OCCURS 1 TO 5 TIMES DEPENDING ON VAR-COUNT PIC X(6).
