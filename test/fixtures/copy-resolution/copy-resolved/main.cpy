      * Synthetic fixture — COPY resolved from a provided member.
       01 MAIN-RECORD.
         05 HEADER-CODE      PIC X(4).
         COPY DETAIL-FIELDS.
         05 TRAILER-CODE     PIC X(2).
