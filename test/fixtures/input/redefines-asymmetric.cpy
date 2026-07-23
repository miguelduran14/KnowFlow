      * Synthetic golden-file fixture for KnowFlow parser T2.
      * REDEFINES where the redefining view is LARGER than the base field:
      * storage must reserve the max of both views before the next field.
       01 SAMPLE-WIDE-VIEW.
         05 SHORT-VIEW           PIC X(5).
         05 WIDE-VIEW REDEFINES SHORT-VIEW PIC X(12).
         05 AFTER-REDEFINES      PIC X(3).
