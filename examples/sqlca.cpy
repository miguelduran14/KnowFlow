      *----------------------------------------------------------------*
      * SQLCA.CPY                                                       *
      * Area de comunicacion de SQL (DB2). En un entorno real la       *
      * aporta el precompilador; aqui se incluye una version minima    *
      * para que el ejemplo sea autocontenido y no deje "copybook      *
      * ausente" en la demo.                                           *
      *----------------------------------------------------------------*
       01  SQLCA.
           05  SQLCAID       PIC X(08).
           05  SQLCABC       PIC S9(09) COMP-5.
           05  SQLCODE       PIC S9(09) COMP-5.
           05  SQLERRM.
               49  SQLERRML  PIC S9(04) COMP-5.
               49  SQLERRMC  PIC X(70).
           05  SQLERRP       PIC X(08).
           05  SQLERRD       OCCURS 6 TIMES PIC S9(09) COMP-5.
           05  SQLWARN.
               10  SQLWARN0  PIC X(01).
               10  SQLWARN1  PIC X(01).
               10  SQLWARN2  PIC X(01).
               10  SQLWARN3  PIC X(01).
               10  SQLWARN4  PIC X(01).
               10  SQLWARN5  PIC X(01).
               10  SQLWARN6  PIC X(01).
               10  SQLWARN7  PIC X(01).
           05  SQLSTATE      PIC X(05).
