      * Synthetic fixture — an unresolved COPY right after a nested group
      * closes must nest inside the open group, never inside its last
      * elementary leaf field (structurally impossible in real COBOL).
       01 A-RECORD.
         05 SUB-GROUP.
           10 LEAF-FIELD    PIC X(1).
         COPY MISSING-AFTER-GROUP.
         05 AFTER-COPY      PIC X(2).
