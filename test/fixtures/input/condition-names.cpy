      * Synthetic golden-file fixture for KnowFlow parser T2.
      * Level 88 condition names attached to their parent field.
       01 SAMPLE-STATUS.
         05 STATUS-CODE      PIC X(1).
           88 STATUS-ACTIVE    VALUE 'A'.
           88 STATUS-PENDING   VALUE 'P'.
           88 STATUS-CLOSED    VALUE 'C' 'X'.
           88 STATUS-UNKNOWN   VALUE 'U', 'Z'.
