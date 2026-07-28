      * Synthetic fixture — edited PIC clauses (report fields).
      * Each character in an edited PIC occupies one byte in DISPLAY:
      * Z, *, +, -, comma, period, slash, B, 0 are insertion/replacement
      * characters that take real storage.
       01 REPORT-LINE.
         05 RPT-AMOUNT        PIC ZZ,ZZ9.99.
         05 RPT-STARS          PIC ****9.
         05 RPT-SIGNED         PIC +9(5).
         05 RPT-CR             PIC 9(5)CR.
         05 RPT-DATE           PIC 99/99/9999.
         05 RPT-SPACED         PIC 9B9B9.
         05 RPT-ZERO-INS       PIC 909.
