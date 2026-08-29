# KnowFlow

**Entiende un programa COBOL sin leer el código.** Le das un `.cbl` y sus copybooks `.cpy`,
KnowFlow te devuelve el flujo de ejecución, el esquema de datos, qué toca (ficheros, DB2, CICS)
y una explicación en lenguaje llano — todo anclado a la línea del fuente que lo demuestra.

Pensado para el desarrollador **junior que hereda** un programa de mainframe cuando el veterano
que lo escribió ya no está.

## Por qué existe

Las herramientas de análisis COBOL existentes están pensadas para *proyectos de migración*
(IBM watsonx, AWS Transform, consultoras): pesadas, caras, y no resuelven el problema real del
día a día — entender un programa concreto para mantenerlo. La alternativa real de un junior hoy
es pegar el código en un chat genérico, que **alucina** en dialecto mainframe (confunde
`SYSCAT.COLUMNS` con `SYSIBM.SYSCOLUMNS` en DB2 z/OS, por ejemplo) y no verifica nada de lo que
dice.

KnowFlow separa las dos cosas:

- Un **parser determinista** extrae los hechos estructurales exactos: divisiones, párrafos,
  grafo PERFORM/CALL/GO TO, resolución de COPY, niveles/PIC/OCCURS/REDEFINES/COMP, bloques
  `EXEC SQL`/`EXEC CICS`.
- La **IA solo narra** esos hechos ya verificados, en lenguaje llano — nunca ve el código fuente
  crudo, así que no puede inventar estructura que no esté verificada.

Todo resultado lleva su nivel de fidelidad: lo que el parser verificó, y lo que queda marcado
como hueco (copybook ausente, CALL dinámica, destino no encontrado) en vez de rellenarse con una
suposición.

## Uso rápido

```bash
npx knowflow
```

Abre `http://localhost:4173` en tu navegador. Arrastra tu `.cbl` (y los `.cpy` que tengas) o
carga el programa de ejemplo para ver la herramienta en marcha sin subir nada tuyo.

**Local-first / BYOK**: tu código nunca sale de tu máquina salvo la llamada al proveedor de IA
que tú mismo configures (Claude, o un endpoint corporativo compatible con OpenAI) para la capa
de explicación. Esa clave se guarda solo en tu navegador. El parser —flujo, datos,
inventario— corre siempre local y no necesita ninguna clave.

## Qué ves

| Vista | Qué responde |
|---|---|
| **Explicación** | Resumen y recorrido en lenguaje llano, generado por IA sobre los hechos del parser — cada etapa enlaza al párrafo real que la demuestra. |
| **Flujo** | Cómo se recorre el programa: párrafos, `PERFORM`/`CALL`/`GO TO`, condiciones bajo las que ocurre cada arista, caídas naturales. |
| **Datos** | El esquema de bytes: niveles, `PIC`, `OCCURS`, `REDEFINES`, `COMP-3`, niveles 88/66, offsets. |
| **Qué toca** | Ficheros con su E/S, tablas DB2, cursores, comandos CICS — extracción literal, sin interpretar qué hace una consulta. |
| **Cadena** | Qué `CALL` cruza a qué programa, cuando aportas varios fuentes a la vez. |

Activa el **modo aprendiz** para resaltar términos COBOL (`COMP-3`, `REDEFINES`, `EVALUATE`…)
con una ficha explicativa al pasar el ratón — no la genera un modelo, es un glosario propio.

## Qué NO es

- No es un traductor/migrador COBOL→Java.
- No es una plataforma de análisis de estate completo.
- No genera código ni tipos a partir de copybooks.

Cuanto más estrecho el propósito —entender UN programa para mantenerlo— mejor. El contexto
completo del producto, la arquitectura y las decisiones abiertas están en [`CONTEXT.md`](CONTEXT.md).

## Restricción importante

**Nunca** proceses COBOL de clientes/empleador con esta herramienta ni con ningún agente de IA
sobre este repo. Usa solo COBOL sintético o público (GnuCOBOL, suite NIST, repos abiertos). Es
una cuestión de propiedad intelectual, no negociable.

## Desarrollo

```bash
npm install
npm run build --prefix gui   # solo la primera vez, o tras tocar la GUI
npm run dev --prefix gui     # servidor de desarrollo con recarga en caliente
```

```bash
npm test        # suite de tests del motor (parser, flujo, inventario, cadena, explicación)
npm run verify  # typecheck + tests + build completo (motor + GUI) — lo que corre antes de publicar
```

El motor (`src/`) es una librería independiente de la GUI (`gui/`): se puede ejercitar sin
interfaz con el arnés de desarrollo en `harness/` (`npx tsx harness/flow.ts <fichero.cbl>`).

## Licencia

Apache-2.0. Ver [`docs/adr/0004-licencia-apache-2.md`](docs/adr/0004-licencia-apache-2.md) para
el porqué.
