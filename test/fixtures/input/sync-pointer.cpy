      * Synthetic fixture — SYNCHRONIZED alignment, POINTER/INDEX usages
      * and a level-66 RENAMES.
      *
      * SYNC aligns a binary item on its own boundary, measured from the
      * start of the 01. The slack bytes it leaves in front belong to no
      * field, but they do shift everything after them. POINTER and INDEX
      * are aligned even without SYNC written.
      *
      * Expected layout:
      *   S-FLAG    offset 0   1 byte
      *   (3 slack bytes)
      *   S-FULL    offset 4   4 bytes  (fullword, 8 digits)
      *   S-HALF    offset 8   2 bytes  (halfword, 3 digits)
      *   (6 slack bytes)
      *   S-DOUBLE  offset 16  8 bytes  (doubleword, COMP-2)
      *   S-PTR     offset 24  4 bytes  (implicitly aligned)
      *   S-IDX     offset 28  4 bytes  (implicitly aligned)
      *   S-TAIL    offset 32  2 bytes
      *   total 34 bytes
       01 SYNC-REC.
         05 S-FLAG            PIC X.
         05 S-FULL            PIC S9(8) COMP SYNC.
         05 S-HALF            PIC S9(3) COMP SYNC.
         05 S-DOUBLE          COMP-2 SYNC.
         05 S-PTR             USAGE POINTER.
         05 S-IDX             USAGE INDEX.
         05 S-TAIL            PIC X(2).
       66 S-WHOLE-TAIL RENAMES S-PTR THRU S-TAIL.
      * Un campo sin SYNC no se alinea: COMP-3 y DISPLAY nunca lo hacen.
       01 PLAIN-REC.
         05 P-FLAG            PIC X.
         05 P-PACKED          PIC S9(7)V99 COMP-3.
         05 P-BIN-NO-SYNC     PIC S9(8) COMP.
