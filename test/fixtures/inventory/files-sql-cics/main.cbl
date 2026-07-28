      * Synthetic fixture — what the program touches: two files with
      * their DD names, a DB2 cursor with its table, an UPDATE, and a
      * handful of CICS commands. WRITE UNKNOWN-REC has no FD in this
      * source, so it must stay unresolved instead of being attributed.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVPRG.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CUST-FILE ASSIGN TO CUSTDD
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC.
           SELECT RPT-FILE ASSIGN TO RPTDD
               ORGANIZATION IS SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  CUST-FILE.
       01  CUST-REC            PIC X(200).
       FD  RPT-FILE.
       01  RPT-REC             PIC X(133).
       WORKING-STORAGE SECTION.
           EXEC SQL INCLUDE SQLCA END-EXEC.
           EXEC SQL
               DECLARE ORD-CUR CURSOR FOR
                   SELECT ORD-ID, ORD-AMT
                     FROM SCHEMA1.ORDERS
                    WHERE ORD-STATUS = 'O'
           END-EXEC.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT CUST-FILE OUTPUT RPT-FILE
           EXEC SQL OPEN ORD-CUR END-EXEC
           PERFORM READ-LOOP
           EXEC SQL CLOSE ORD-CUR END-EXEC
           CLOSE CUST-FILE RPT-FILE
           GOBACK.
       READ-LOOP.
           READ CUST-FILE
           EXEC SQL FETCH ORD-CUR INTO :WS-ID, :WS-AMT END-EXEC
           EXEC SQL
               UPDATE CUSTOMER
                  SET CUS-SEEN = CURRENT DATE
                WHERE CUS-ID = :WS-ID
           END-EXEC
           WRITE RPT-REC
           WRITE UNKNOWN-REC.
       SCREEN-PARA.
           EXEC CICS SEND MAP('MENU1') MAPSET('MENUSET') END-EXEC
           EXEC CICS LINK PROGRAM('SUBPRG') END-EXEC
           EXEC CICS READ FILE('ACCTFILE') END-EXEC.
