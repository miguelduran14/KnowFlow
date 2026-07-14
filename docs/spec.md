# Spec — KnowFlow: explicador / documentador de COBOL con IA

> Sintetizado de la sesión de grilling del 2026-07-14. Fuentes: `CONTEXT.md`, `docs/adr/0001`–`0004`.
> Regla de este documento: **no contiene decisiones que no se tomaran en el grilling**; lo no
> resuelto está marcado como **PENDIENTE**.

## Problem Statement

Un dev junior hereda un programa COBOL que debe mantener y no lo entiende: le cuestan los flujos
de negocio, las estructuras de datos (OCCURS, REDEFINES, niveles 88, COMP-3), el JCL que encadena
los jobs. El veterano que lo sabía se ha jubilado o está a punto. Las herramientas existentes
(IBM watsonx, AWS Transform, ADDI) sirven a proyectos de migración de empresas — pesadas, caras,
inaccesibles para la persona concreta que necesita entender *un* programa *hoy*. La alternativa
real del junior es pegar el código en un chat de IA genérico, que alucina en dialecto z/OS y se
inventa estructuras.

Ese junior vive en ISPF (no necesariamente en VS Code) y puede bajarse los fuentes a su PC por
FTP/FileZilla. Trabaja en banca/seguros: la sensibilidad de IP de su código es máxima.

## Solution

**KnowFlow**: una herramienta local que recibe un programa COBOL + sus copybooks y devuelve un
"paquete de onboarding" legible: resumen en lenguaje llano, esquema de datos muy visual, inventario
de lo que el programa toca, y avisos. Principio rector: **parsea de forma determinista, explica con
IA** — un parser propio extrae los hechos estructurales exactos y el LLM solo pone la capa de
explicación encima de hechos verificados. Nunca adivina estructura.

- **Superficie:** GUI web local (localhost, sin servidor del autor): arrastrar fichero, pegar
  código, resultado sencillo pero profesional y pulido. El motor es una librería; la GUI, una piel
  (ADR-0002).
- **Local-first / BYOK:** el código del usuario solo sale de su máquina hacia el proveedor de IA
  que el propio usuario configura con su clave.
- **Agnóstico de proveedor de IA:** capa de explicación pluggable (Claude, OpenAI/GPT u otros),
  modelo configurable. No estrictamente Anthropic.
- **Distribución:** repo público, Apache-2.0, `npx knowflow` (ADR-0004).

## User Stories

1. Como dev junior que hereda un programa COBOL, quiero arrastrar el fichero del programa y sus copybooks a una interfaz local, para obtener un paquete de onboarding sin instalar nada pesado.
2. Como dev junior, quiero pegar código COBOL directamente (programa entero o fragmento), para entender lo que tengo delante aunque no tenga los ficheros a mano.
3. Como dev junior, quiero ver la data division como un esquema legible (campo, tipo, longitud, offset, ejemplo), para entender el registro sin descifrar PIC a mano.
4. Como dev junior, quiero que los COPY (y `EXEC SQL INCLUDE`) se resuelvan automáticamente si aporto los members, para ver el registro completo y no una referencia opaca.
5. Como dev junior sin todos los copybooks a mano, quiero que la herramienta me dé lo que pueda y marque explícitamente cada hueco ("copybook no disponible, estructura desconocida"), para tener información honesta en vez de inventada.
6. Como dev junior, quiero que la propia salida me diga qué copybooks faltan para completar el esquema, para saber exactamente qué bajarme del PDS.
7. Como dev junior, quiero saber qué tablas DB2 toca el programa, cuántos cursores tiene y qué comandos CICS usa (inventario de bloques EXEC), para responder a la primera pregunta del onboarding: "¿este programa qué toca?".
8. Como dev junior, quiero un resumen del programa en lenguaje llano generado por IA sobre los hechos del parser, para orientarme antes de leer el código.
9. Como dev junior, quiero que cada resultado lleve una etiqueta de nivel de fidelidad (verificado por parser / parcialmente verificado / solo LLM), para saber cuánto confiar en cada afirmación.
10. Como dev junior, quiero pegar un trozo suelto de código y recibir una explicación honesta (etiquetada como parcialmente verificada), para resolver dudas puntuales sin montar el flujo entero.
11. Como dev junior, quiero exportar el esquema como tabla Markdown, para pegarlo en la wiki o en un traspaso.
12. Como usuario en banca/seguros, quiero que mi código no pase por ningún servidor del autor de la herramienta, para no violar las políticas de IP de mi empresa.
13. Como usuario, quiero configurar mi propia clave de API y elegir proveedor (Anthropic, OpenAI u otro) y modelo, para usar el que mi empresa tenga aprobado y controlar el coste.
14. Como dev junior, quiero lanzar la herramienta con un solo comando (`npx knowflow`), para probarla con fricción cero.
15. Como mantenedor del proyecto, quiero fixtures golden-file (COBOL de entrada → esquema esperado) que pueda juzgar sabiendo COBOL, para verificar el parser sin saber leer TypeScript.
16. Como mantenedor del proyecto, quiero que cualquier salida del LLM que afirme estructura no presente en los hechos del parser cuente como bug, para proteger la promesa de no-invención.
17. *(Slice 2)* Como dev junior, quiero ver un mapa del job JCL (job → steps → programas → datasets) explicado en lenguaje llano, para entender la cadena completa y no solo un programa.

### Slice 2 / Roadmap

- Como dev junior, quiero un esquema MUY visual — mapa de bytes con campos proporcionales a su tamaño real, REDEFINES como capas superpuestas sobre la misma memoria, OCCURS como bloques repetidos, COMP-3 con su tamaño empaquetado —, para entender de un vistazo lo que tres párrafos no explican. *(Movida del MVP a slice 2.)*
- **Nota (ex-criterio de éxito 8): PENDIENTE** — el diseño concreto del mapa de bytes se ratifica con un prototipo visual delante; la dirección (barra proporcional, capas, bloques) está acordada.

## Implementation Decisions

Tomadas en el grilling y registradas como ADRs; aquí la vista consolidada:

1. **Stack: TypeScript/Node de punta a punta** (ADR-0001). Un solo lenguaje para motor, arnés y
   GUI; TS estricto como red de seguridad sobre código escrito mayormente por agentes de IA.
2. **Parser propio del subconjunto** (ADR-0001). Sin JVM, sin ProLeap/Koopa (Java, AGPL,
   semi-abandonado). Subconjunto del slice 1: COPY/REPLACING + `EXEC SQL INCLUDE` + data division
   (niveles, PIC, OCCURS, REDEFINES, COMP-*). Parser externo solo se reevalúa si el grafo PERFORM
   completo lo exige.
3. **Arquitectura: pipeline agnóstico al tipo de artefacto** — *artefacto → hechos estructurales →
   paquete de explicación*. COBOL es el primer artefacto; JCL será el segundo. El pipeline no
   asume "esto solo traga COBOL".
4. **El motor es una librería; la GUI es una piel** (ADR-0002). El core no sabe que existe la GUI.
   Durante el desarrollo se ejercita con un arnés CLI no-producto (feo a propósito, cero horas de
   UX). La GUI web local se construye encima cuando el core produce algo digno.
5. **Niveles de fidelidad + regla dura de no-invención** (ADR-0003). Tres niveles: verificado por
   parser / parcialmente verificado (fragmento) / solo LLM (futuro: capturas). En modo degradado,
   los huecos se marcan explícitamente y el LLM tiene prohibido por prompt y por contrato
   rellenarlos.
6. **EXEC SQL/CICS — corte en tres alturas:** `EXEC SQL INCLUDE` dentro del slice 1 (obligatorio,
   es un COPY con otro disfraz); inventario de bloques EXEC (tablas, cursores, comandos CICS) en el
   MVP sin interpretación; semántica profunda (lógica de cursores, flujo CICS) en slice posterior.
7. **Salidas:** renderizado visual en GUI + tabla Markdown exportable. JSON solo como formato
   interno documentado — no es API pública en el MVP. **Sin** generación de JSON Schema ni tipos
   TS/Java (eso es feature de migrador; el consumidor "generar código" no existe en este producto).
8. **Capa de IA agnóstica de proveedor, BYOK.** Interfaz genérica de "proveedor de explicación"
   con adaptadores por proveedor (Claude, GPT, …); modelo configurable; la clave la pone el usuario
   y las llamadas van directas de su máquina al proveedor.
9. **Licencia Apache-2.0, repo público, `npx knowflow`** (ADR-0004). Apuesta por
   adopción/reputación; open-core diferido a que exista señal de negocio real (módulos nuevos
   podrían nacer cerrados; lo publicado no se des-regala). AGPL descartada: prohibida por política
   en los departamentos legales del sector objetivo.
10. **Corpus de validación en tres pisos:** NIST COBOL85 + tests de GnuCOBOL (tortura del parser);
    AWS CardDemo + curso COBOL del Open Mainframe Project (realismo; calidad de explicación juzgada
    por el autor); sintéticos de patrón escritos desde descripciones verbales (jamás código
    copiado).

## Testing Decisions

- **Qué es un buen test aquí:** verifica comportamiento externo en la costura de la librería core
  — *fuentes COBOL de entrada → esquema/hechos de salida* —, nunca detalles internos del parser.
- **Golden-file fixtures como mecanismo central:** ficheros COBOL de entrada y su esquema esperado
  en ficheros legibles. El autor los puede juzgar porque son COBOL (su dominio), no TypeScript.
  Los fixtures son los "puntos de decisión" que `AGENTS.md` exige testear antes de cerrar nada.
- **Costura secundaria:** la interfaz agnóstica de proveedor de la capa LLM — permite testear el
  pipeline completo con un proveedor falso, sin llamadas reales ni claves.
- **La GUI no tiene costura de test en el slice 1** (es una piel; se testea cuando exista).
- **La regla de no-invención es testeable:** salida del LLM que afirme estructura ausente de los
  hechos del parser = bug (ADR-0003).
- **Prior art:** no hay tests previos en el repo (proyecto nuevo); estos fixtures fundan la
  convención.

## Dentro del MVP (slice 1)

- Resolución de COPY/REPLACING y `EXEC SQL INCLUDE` (con modo degradado marcando huecos).
- Data division → esquema legible como tabla Markdown exportable.
- Inventario de bloques EXEC SQL/CICS (qué toca el programa), sin interpretación semántica.
- Entrada por fichero (arrastrar) y por código pegado (programa o fragmento).
- Etiquetas de nivel de fidelidad en toda salida.
- Capa LLM pluggable BYOK con al menos los adaptadores Claude y OpenAI/GPT.
- GUI web local sencilla y pulida; arnés CLI de desarrollo (no-producto).

## Out of Scope

- **Traducción/migración COBOL→Java** y generación de código/tipos desde copybooks — feature de
  migrador; este producto no es eso.
- **Análisis de estate completo** (no compite con IBM ADDI).
- **JCL** (explicar y encadenar job → programas → datasets) — fuera del MVP; es el **slice 2**
  explícito del roadmap.
- **Mapa de bytes visual** (proporcional, REDEFINES como capas, OCCURS como bloques) — slice 2.
- **Interpretación semántica profunda de EXEC SQL/CICS** (cursores, flujo CICS,
  pseudo-conversacional) — slice posterior.
- **Capturas de pantalla como entrada** (nivel 3 de fidelidad) — feature posterior.
- **Grafo PERFORM completo** de la procedure division — slice posterior.
- **API pública / JSON versionado para terceros** — el JSON es interno hasta que alguien pida lo
  contrario.
- **Panel de VS Code y CLI como producto** — descartados como superficie del MVP.

## Criterios de éxito del primer slice

El slice 1 se considera cerrado cuando:

1. **Parser correcto en su subconjunto:** dado un programa + copybooks del corpus, el esquema
   producido (campos, tipos, longitudes en bytes, offsets, OCCURS, REDEFINES, COMP-*) coincide con
   el golden file esperado — incluida la aritmética de empaquetado de COMP-3, primera prueba del
   foso frente a los LLM genéricos.
2. **COPY/REPLACING y `EXEC SQL INCLUDE` se resuelven** cuando los members están disponibles.
3. **El modo degradado degrada con honestidad:** sin un copybook, la salida marca el hueco
   explícitamente, lista qué falta, y ninguna parte de la salida inventa la estructura ausente.
4. **El inventario EXEC responde "¿qué toca este programa?":** tablas nombradas, número de
   cursores, comandos CICS presentes.
5. **Fixtures en verde sobre el corpus:** casos límite de NIST/GnuCOBOL para el subconjunto del
   slice + al menos programas reales de CardDemo pasando de punta a punta.
6. **La explicación LLM es juzgada correcta por el autor** sobre programas de CardDemo (él lee el
   original y la explicación, y no encuentra afirmaciones falsas), con etiquetas de fidelidad
   presentes en la salida.
7. **La restricción de IP se mantiene intacta:** cero código corporativo en el repo, en los
   fixtures y en cualquier sesión de agente.

## Further Notes / PENDIENTE

Decisiones que el grilling dejó explícitamente abiertas — no cerrarlas por cuenta propia
(`AGENTS.md`):

- **PENDIENTE — Diseño concreto del mapa de bytes.** Dirección acordada (barra horizontal, capas
  para REDEFINES, bloques para OCCURS); ratificar con prototipo visual.
- **PENDIENTE — Momento de la interpretación semántica profunda de EXEC SQL/CICS** (post-slice 2;
  sin fecha ni alcance cerrado).
- **PENDIENTE — Capturas de pantalla como entrada:** alcance y momento; solo está decidido que es
  posterior al MVP y que será nivel 3 de fidelidad.
- **PENDIENTE — Open-core:** solo si aparece señal de negocio real; no diseñar para ello todavía.
- **PENDIENTE — Orden y contenido exacto de las sesiones de trabajo del slice 1** (se propuso
  empezar por esqueleto TS + modelo de dominio + primer fixture trivial, pero no quedó ratificado).
