      *HEADER: formato fijo con zona de identificacion en cols 73-80 (estilo NIST).
000100 IDENTIFICATION DIVISION.                                         FIXCOL.1
000200 PROGRAM-ID.                                                      FIXCOL.1
000300     FIXCOL.                                                      FIXCOL.1
000400 PROCEDURE DIVISION.                                              FIXCOL.1
000500 0000-MAIN.                                                       FIXCOL.1
000600     PERFORM 1000-INIT                                            FIXCOL.1
000700     PERFORM 2000-PROCESS UNTIL WS-EOF = 'Y'                      FIXCOL.1
000800     GOBACK.                                                      FIXCOL.1
000900 1000-INIT.                                                       FIXCOL.1
001000     MOVE 0 TO WS-COUNT.                                          FIXCOL.1
001100 2000-PROCESS.                                                    FIXCOL.1
001200     DISPLAY 'P'.                                                 FIXCOL.1
