      * Synthetic golden-file fixture for KnowFlow parser T1.
      * Trivial copybook: library checkout record.
      * Not derived from any real or client copybook.
       01 CHECKOUT-RECORD.
         05 BOOK-INFO.
           10 BOOK-ISBN         PIC X(13).
           10 BOOK-TITLE        PIC X(30).
           10 COPY-NUMBER       PIC 9(3).
         05 LOAN-INFO.
           10 BORROWER-ID       PIC 9(6).
           10 LOAN-DATE         PIC X(8).
           10 DUE-DATE          PIC X(8).
           10 FINE-BALANCE      PIC S9(7)V99 COMP-3.
           10 RENEWAL-COUNT     PIC S9(2)V   COMP-3.
