# CONTEXT — KnowFlow: explicador / documentador de COBOL con IA

## Qué es
Un compañero de **comprensión y traspaso** para el desarrollador que *mantiene* código COBOL.
Le das un programa + sus copybooks y devuelve un "paquete de onboarding": resumen en lenguaje
llano, estructuras de datos legibles, grafo de llamadas, reglas de negocio embebidas y avisos
("cuidado con esto").

## Qué NO es
- NO un traductor/migrador COBOL→Java (espacio copado: IBM watsonx, AWS Transform, consultoras).
- NO una plataforma de análisis de estate completo (no compite con IBM ADDI).
- NO un generador de código/tipos desde copybooks (eso es feature de migrador).
- Cuanto más estrecho —"entender UN programa para mantenerlo"— mejor.

## Por qué existe (el hueco)
Las herramientas existentes están pensadas para *proyectos de migración* de empresas y consultoras:
pesadas y caras. Nadie sirve bien a la persona concreta que hereda un programa y necesita
entenderlo hoy. La realidad del sector es "modernizar en el sitio", no migrar → lo que falta es
comprensión y traspaso de conocimiento, justo cuando el veterano se jubila.

**La competencia real no es IBM — es el chat genérico.** Quien disputa al junior es "pego el
programa en ChatGPT". Contra eso se gana con precisión de dialecto y hechos verificados, y solo
si probar la herramienta cuesta cero fricción.

## El foso (por qué la mía es distinta)
1. **Precisión de dialecto z/OS**: los LLM genéricos alucinan en mainframe (p. ej. `SYSCAT.COLUMNS`
   vs `SYSIBM.SYSCOLUMNS` en DB2 z/OS). Codifico ese conocimiento real.
2. **Alfabetización de datos**: interpretar bien OCCURS, REDEFINES, niveles 88, COMP-3; renderizar
   copybooks como esquema legible (tabla Markdown en MVP; ver "mapa de bytes" en slice 2).
3. **Arquitectura correcta** (ver abajo).

## Principio de arquitectura
**Parsea de forma determinista, explica con IA.** Un parser real extrae los hechos estructurales
exactos (divisiones, párrafos, grafo PERFORM/CALL/GO TO, resolución de COPY, data division con
niveles/PIC/OCCURS/REDEFINES/COMP, bloques EXEC SQL / EXEC CICS). El LLM solo pone la capa de
explicación encima de esos hechos ya verificados. Nunca dejar que el modelo "adivine" la estructura.

Corolarios acordados:
- **Pipeline agnóstico al tipo de artefacto**: *artefacto → hechos estructurales → paquete de
  explicación*. COBOL es el primer tipo de artefacto; JCL será el segundo. No cerrar puertas.
- **Niveles de fidelidad**: todo resultado lleva etiqueta — (1) verificado por parser,
  (2) parcialmente verificado (fragmento), (3) solo LLM (futuro: capturas). Ver ADR-0003.
- **Regla dura de no-invención**: en modo degradado (copybook ausente), el hueco se marca
  explícitamente ("copybook no disponible, estructura desconocida"); el LLM tiene prohibido
  rellenarlo. Un hueco marcado es información honesta.
- Salidas: Markdown (humanos) + JSON interno documentado (no API pública en MVP) + grafos en dos
  formas — **lienzo interactivo en la GUI (React Flow + elkjs, MIT)** como representación
  principal, y **Mermaid como export de texto** (pegable en wikis/PRs, se renderiza sin la app).
  El motor solo expone hechos (JSON) y texto (Mermaid); quien pinta el lienzo es la GUI (ADR-0002).
  Sin Neo4j. Sin generación de JSON Schema ni tipos TS/Java.
- Local-first / BYOK: el usuario pone su clave; el código no pasa por un servidor mío.

## Usuario objetivo
**Dev junior que hereda** un programa y sufre con flujos de negocio, JCL y COBOL. Vive en ISPF
(no necesariamente en VS Code); los fuentes llegan a su PC vía FTP/FileZilla o similar. Puede
arrastrar ficheros o pegar código/fragmentos.

## Roadmap de slices
1. **Slice 1 (MVP)** — reordenado el 2026-07-23 (ver "Historial de decisiones"):
   - **Cerrado**: resolución de COPY/REPLACING + `EXEC SQL INCLUDE` + data division completa
     (niveles, PIC, OCCURS, REDEFINES, niveles 88, USAGE) → parser con modo degradado y no-invención.
   - **Cerrado**: parser de PROCEDURE DIVISION — párrafos y grafo PERFORM/CALL/GO TO — como capa
     de hechos verificados para el flujo, con diagrama interactivo y export Mermaid. Cada arista
     lleva las condiciones IF/EVALUATE bajo las que ocurre (`guards`), en texto crudo del fuente.
   - **Cerrado**: cadena entre programas — varios fuentes a la vez, resolviendo qué CALL cruza a
     qué programa; los dinámicos nunca se resuelven y los no aportados se listan.
   - **Cerrado**: capa LLM BYOK (interfaz agnóstica + adaptador Claude + proveedor falso) y
     explicación en lenguaje llano construida solo sobre los hechos verificados — el modelo nunca
     ve el fuente crudo, así que no puede deducir estructura sin verificar.
   - **Cerrado**: inventario de "qué toca el programa" — ficheros con su DD y sus operaciones,
     tablas DB2, cursores y comandos CICS, por extracción literal sin interpretación semántica.
     Lo que no se puede resolver contra el fuente aportado (un WRITE sin FD) se lista aparte.
   - **Pausado, no cancelado**: tabla Markdown exportable del esquema de datos.
   - La capa LLM (proveedor pluggable) y el paquete de explicación se construyen sobre AMBOS
     hechos —esquema de datos y grafo de flujo— para que el resumen en lenguaje llano y el
     diagrama de flujo sean fiables, no una narración libre del modelo.
2. **Slice 2**: JCL — explicar y encadenar job → steps → programas → datasets (mapa del job en
   Mermaid), con el mismo principio: parser de hechos primero, diagrama y explicación encima.
   Junto con esto, el **mapa de bytes visual** (ver "Superficie" abajo).
3. **Después**: interpretación semántica profunda de SQL/CICS, capturas de pantalla (nivel 3 de
   fidelidad).

## Superficie
**GUI web local** (localhost, sin servidor propio): arrastrar fichero, pegar código, resultado
sencillo pero profesional y pulido. **El motor es una librería; la GUI es una piel** — durante el
desarrollo el core se ejercita con un arnés CLI no-producto (cero horas de UX). Ver ADR-0002.

**Slice 2 — mapa de bytes:** la representación visual estrella del esquema — el registro como barra
horizontal, campos proporcionales a su tamaño real, REDEFINES como capas superpuestas sobre la
misma memoria, OCCURS como bloques repetidos, COMP-3 con su tamaño empaquetado. Fuera del MVP;
dirección acordada, diseño concreto pendiente de ratificar con un prototipo visual.

## Stack
**TypeScript/Node de punta a punta. Parser propio del subconjunto.** Sin JVM, sin ProLeap/Koopa
(Java, AGPL, semi-abandonado). Ver ADR-0001. Verificación mediante **fixtures golden-file**
(copybook de entrada → esquema esperado) que el autor puede juzgar porque son COBOL.

- **Capa de explicación agnóstica de proveedor**: pluggable entre Claude (Anthropic), OpenAI/GPT u
  otros; modelo configurable, BYOK. Nada de acoplar el producto a un único proveedor.
- **Neutral entre agentes de desarrollo**: se trabaja con Claude Code y Codex. La config del agente
  vive en `AGENTS.md` (estándar que Codex y otros leen) además de `CLAUDE.md`; evitar depender de
  features exclusivas de un solo agente.

## Corpus de validación (tres pisos)
1. **NIST COBOL85 + tests de GnuCOBOL** — tortura del parser (fixtures deterministas, casos límite).
2. **AWS CardDemo + curso COBOL del Open Mainframe Project** — realismo de aplicación; calidad de
   la explicación juzgada por el autor.
3. **Sintéticos de patrón** — programas nuevos escritos desde descripciones verbales de patrones
   reales (convenciones de nombres, idiomas de shop). Jamás código copiado.

## Restricciones DURAS (no negociables)
- **Nunca** usar código COBOL de clientes de mi empleador — ni pegado, ni procesado, ni "solo en
  local". Los agentes de IA y la propia herramienta envían lo que leen a un proveedor: la violación
  ocurre en el primer read, no en el push. El conocimiento del autor entra solo como **descripciones
  verbales de patrones**, desde las que se escribe código sintético nuevo.
- Diseño local-first por la sensibilidad de IP del sector.
- Solo, 5–10 h/semana. Prioridad: **portfolio + reputación**; ingreso directo es secundario.

## Licencia y distribución
**Apache-2.0** (cláusula de patentes + pasa revisiones legales corporativas; AGPL está prohibido
por política en la banca — mataría al usuario real). Repo público en GitHub; distribución
`npx knowflow` que levanta la web local. Apuesta por adopción/reputación; si algún día hay señal
de negocio, los **módulos nuevos** pueden nacer open-core — lo publicado no se des-regala, pero lo
futuro no está regalado. La marca/nombre se conserva. Ver ADR-0004.

## Decisiones que QUEDAN abiertas
- Diseño concreto del mapa de bytes de slice 2 (dirección acordada; ratificar con prototipo visual).
- Cuándo entra la interpretación semántica profunda de EXEC SQL/CICS (post-slice 2).
- Capturas de pantalla como entrada (nivel 3 de fidelidad): alcance y momento.
- Open-core: solo si aparece señal de negocio real; no diseñar para ello todavía.

## Historial de decisiones
Las decisiones cerradas el 2026-07-14 (sesión de grilling) están registradas como ADRs en
`docs/adr/`. Ante una decisión abierta, pregunta — no la cierres por tu cuenta (`AGENTS.md`).

**2026-07-29 (2) — el flujo cuenta cómo se recorre de verdad el programa.** Segunda tanda de la
misma auditoría, sobre el grafo de flujo. (a) **Caída natural**: un párrafo que no acaba en
transferencia incondicional (STOP RUN/GOBACK/EXIT PROGRAM o GO TO fuera de rama) cae en el
siguiente por orden de fuente — EL malentendido clásico del que hereda COBOL. Se dibuja explícita,
con flecha punteada y en gris, y marcada como caída, no como sentencia. (b) `SORT/MERGE
INPUT/OUTPUT PROCEDURE`: aristas propias a los párrafos de entrada y salida. (c) `AT END`,
`NOT AT END`, `INVALID KEY`, `ON SIZE ERROR`, `ON OVERFLOW`, `ON EXCEPTION` y sus terminadores de
ámbito (`END-READ`, `END-COMPUTE`…): ramas con guarda, como IF/EVALUATE. (d) `PERFORM` en línea
(`UNTIL`/`VARYING`/`n TIMES`/`FOREVER`): su cuerpo se marca con la guarda "en bucle (…)". Límite
conocido y documentado en el tipo `fall-through`: si a un párrafo se llegó por PERFORM o SORT, al
final del rango se vuelve al llamador; la caída solo ocurre de verdad al llegar ejecutando en
línea. Queda pendiente el grupo C: de qué sección de la DATA DIVISION viene cada 01, `VALUE`
inicial, y recursos CICS/SQL dinámicos marcados.

**2026-07-29 — cerradas las construcciones en las que el parser mentía en silencio.** Auditoría
del parser contra 13 construcciones sin cubrir. Se corrigen las cinco que daban un número falso
sin marcarlo, que es lo que ADR-0003 prohíbe: `SYNCHRONIZED` (los bytes de relleno desplazan todo
lo que sigue; antes se ignoraban), `USAGE POINTER`/`INDEX` (salían como grupo de 0 bytes),
nivel 66 `RENAMES` (se colaba como hijo del último campo y le borraba la longitud — un registro
de 5 bytes salía como 2), programas anidados (mezclaban sus párrafos con los del programa
externo) y `DECLARATIVES` (abría un párrafo de entrada fantasma).

**2026-07-28 — el inventario incluye E/S de ficheros, y las aristas de flujo llevan guarda.**
El spec del grilling solo pedía "inventario de bloques EXEC SQL/CICS". Al construirlo se amplía a
los **ficheros** (SELECT/ASSIGN + OPEN/READ/WRITE/CLOSE, con los registros del FD para resolver un
WRITE): responde a la misma pregunta de onboarding ("¿este programa qué toca?") y sin ella la
respuesta queda coja en un batch, que es el caso típico del usuario real. Sigue siendo extracción
literal — nada de interpretar qué hace una consulta. En paralelo, el grafo de flujo pasa a marcar
bajo qué condiciones IF/EVALUATE ocurre cada arista (`guards`, texto crudo del fuente) en vez de
crear nodos de decisión, que serían estructura que el fuente no declara.
*Pendiente de ratificar por el autor:* (a) esta ampliación del alcance del inventario; (b) si el
ciclo de vida de cursor que muestra la GUI (DECLARE/OPEN/FETCH/CLOSE, con los pasos ausentes
tachados) cruza la línea de "interpretación semántica profunda de EXEC SQL/CICS", que el spec
sitúa fuera del MVP.

**2026-07-23 — renderizado de grafos: React Flow + elkjs en la GUI; Mermaid queda como export.**
Tras investigar alternativas (GoJS y yFiles descartados por licencia comercial de pago —
incompatible con un proyecto Apache-2.0 distribuido por npx; JointJS y D3 viables pero con más
peso/curva), se decide: el lienzo interactivo de la GUI usa **React Flow (`@xyflow/react`, MIT)**
con layout automático de **elkjs** (Eclipse Layout Kernel, puerto JS mantenido; dagre está
semi-abandonado). Mermaid **no se elimina**: cubre el caso "pegar el diagrama como texto en una
wiki o PR y que se renderice solo". Reparto por capas fiel a ADR-0002: el motor expone hechos
(`FlowResult` JSON) y texto (Mermaid); el lienzo React Flow es exclusivamente de la GUI.

**2026-07-23 — reordenación del roadmap de slice 1.** Tras completar el parser de data division
(T1-T3), se audita el estado del proyecto y se confirma que la prioridad real del autor es que la
herramienta explique el *comportamiento* del programa (lenguaje natural + diagramas) para un
junior, no solo su esquema de datos. Esto reabre la decisión del grilling que dejaba el "grafo
PERFORM completo" fuera del MVP. Decisión: el parser de PROCEDURE DIVISION (párrafos,
PERFORM/CALL/GO TO) pasa a ser la siguiente pieza a construir, por delante de la tabla Markdown
exportable (T4) y el inventario EXEC SQL/CICS (T5), que quedan pausados sin cancelarse. Razón:
la explicación en lenguaje natural del flujo necesita hechos verificados por parser antes de que
el LLM narre nada — igual que ya se exige para los datos (principio de arquitectura, no
negociable). El orden JCL-después-de-COBOL no cambia.
