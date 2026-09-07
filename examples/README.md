# Ejemplo — cadena de liquidación de intereses

Programa COBOL de ejemplo de KnowFlow: un batch de banca **sintético**, escrito desde
patrones típicos (fichero secuencial + cursor DB2 + subprogramas + copybooks). **No
reproduce código de ningún cliente** — es material propio, bajo la misma licencia
Apache-2.0 que el resto del repo.

Es lo que carga el botón **«Cargar ejemplo»** de la interfaz.

## Los ficheros

| Fichero | Rol | Qué luce en KnowFlow |
| --- | --- | --- |
| `ctamov01.cbl` | Batch principal | Flujo con **SECTIONs** (INICIO / PROCESO / FIN), `PERFORM UNTIL`, `EVALUATE`, un `GO TO` de salida. Inventario: 2 ficheros (`MOVIN`, `RPTOUT`) y un cursor DB2 completo sobre `TARIFAS`. |
| `valida01.cbl` | Subprograma de validación | Recibe el movimiento por `LINKAGE`, devuelve el estado. Segundo nodo de la vista **Cadena**. |
| `fecha01.cbl` | Utilidad de fecha | Juliana → Gregoriana, sólo aritmética sobre `LINKAGE`. Tercer nodo de la cadena. |
| `ctamovfd.cpy` | Layout del registro de movimiento (FD) | Clave de cuenta partida en oficina + número vía **REDEFINES**, importe **COMP-3**. |
| `estados.cpy` | Códigos de estado + niveles **88** | Copybook *fragmento* (empieza en `05`), compartido por `ctamov01` y `valida01`. |
| `sqlca.cpy` | Área de comunicación SQL | Para que el ejemplo sea autocontenido (en producción la aporta el precompilador). |

## Trazabilidad de datos (vista Datos → fijar un campo)

El importe recorre toda la cadena de cálculo:

```
MOV-IMPORTE → WS-BRUTO → WS-INTERES → WS-TOTAL → WS-TOTAL-ED → RPT-REGISTRO
```

## Avisos plantados a propósito

- **`ctamov01.cbl`** — un `GO TO ABORTAR` salta de la SECTION `PROCESO` a la SECTION `FIN`: se
  salta el `CLOSE` del cursor y de los ficheros que hace `FIN-10`. KnowFlow lo marca como
  *«GO TO cruza de sección»*.
- **`valida01.cbl`** — `RECHAZAR` termina en `STOP RUN`. Como `VALIDA01` es un **subprograma**
  (tiene `LINKAGE SECTION`, sólo se llega por `CALL`), `STOP RUN` mata el job **entero**, no
  sólo este módulo — debería ser `GOBACK`. Es la trampa clásica de mantenimiento.
