# CONTEXT — Explicador / documentador de COBOL con IA

## Qué es
Un compañero de **comprensión y traspaso** para el desarrollador que *mantiene* código COBOL.
Le das un programa + sus copybooks y devuelve un "paquete de onboarding": resumen en lenguaje
llano, estructuras de datos legibles, grafo de llamadas, reglas de negocio embebidas y avisos
("cuidado con esto").

## Qué NO es
- NO un traductor/migrador COBOL→Java (espacio copado: IBM watsonx, AWS Transform, consultoras).
- NO una plataforma de análisis de estate completo (no compite con IBM ADDI).
- Cuanto más estrecho —"entender UN programa para mantenerlo"— mejor.

## Por qué existe (el hueco)
Las herramientas existentes están pensadas para *proyectos de migración* de empresas y consultoras:
pesadas y caras. Nadie sirve bien a la persona concreta que hereda un programa y necesita
entenderlo hoy, en su IDE. La realidad del sector es "modernizar en el sitio", no migrar → lo que
falta es comprensión y traspaso de conocimiento, justo cuando el veterano se jubila.

## El foso (por qué la mía es distinta)
1. **Precisión de dialecto z/OS**: los LLM genéricos alucinan en mainframe (p. ej. `SYSCAT.COLUMNS`
   vs `SYSIBM.SYSCOLUMNS` en DB2 z/OS). Codifico ese conocimiento real.
2. **Alfabetización de datos**: interpretar bien OCCURS, REDEFINES, niveles 88, COMP-3; renderizar
   copybooks como esquema legible con layout de registro de ejemplo.
3. **Arquitectura correcta** (ver abajo).

## Principio de arquitectura
**Parsea de forma determinista, explica con IA.** Un parser real extrae los hechos estructurales
exactos (divisiones, párrafos, grafo PERFORM/CALL/GO TO, resolución de COPY, data division con
niveles/PIC/OCCURS/REDEFINES/COMP, bloques EXEC SQL / EXEC CICS). El LLM solo pone la capa de
explicación encima de esos hechos ya verificados. Nunca dejar que el modelo "adivine" la estructura.

- Salidas: Markdown (humanos) + JSON (máquina) + Mermaid (grafos, sin Neo4j).
- Local-first / BYOK: el usuario pone su clave; el código no pasa por un servidor mío.

## Primer slice (una sesión)
El núcleo que resuelve copybooks (COPY) y convierte la data division en un **esquema legible**
(campo, tipo, longitud, OCCURS, REDEFINES, ejemplo). Es la base de todo lo demás. **La superficie
con la que se expone (CLI, interfaz gráfica o panel de VS Code) es una decisión abierta** — ver abajo.

## Restricciones DURAS (no negociables)
- **Nunca** usar código COBOL de clientes de mi empleador. Solo COBOL sintético o público
  (GnuCOBOL, suite NIST, repos abiertos). Es un tema de IP/legal, no negociable.
- Diseño local-first por la sensibilidad de IP del sector.
- Solo, 5–10 h/semana. Prioridad: **portfolio + reputación**; ingreso directo es secundario.

## Inclinaciones técnicas (a validar, NO cerradas)
- Motor en Python o Node envolviendo un parser existente (ProLeap/ANTLR o Koopa).
- **Capa de explicación agnóstica de proveedor**: pluggable entre Claude (Anthropic), OpenAI/GPT u
  otros; modelo configurable, BYOK. Nada de acoplar el producto a un único proveedor.
- **Neutral entre agentes de desarrollo**: se trabaja con Claude Code y Codex. La config del agente
  vive en `AGENTS.md` (estándar que Codex y otros leen) además de `CLAUDE.md`; evitar depender de
  features exclusivas de un solo agente.

## Decisiones ABIERTAS — aquí es donde quiero que me grilles
- **Superficie del MVP**: ¿CLI, interfaz gráfica (web local o app de escritorio) o panel de VS Code?
  *Preferencia personal: interfaz gráfica.* Contrapeso a sopesar: una GUI es más atractiva y mejor
  para portfolio, pero más esfuerzo para un primer slice con 5–10 h/semana. Que el grilling decida
  el punto de partida.
- ¿Python o Node? ¿ProLeap o Koopa u otro parser? ¿O un parser propio ligero para el subconjunto?
- Formato exacto del esquema de salida: ¿tabla Markdown? ¿JSON Schema? ¿tipos TS/Java?
- EXEC SQL y EXEC CICS embebidos en el MVP: ¿ignorar, extraer o explicar?
- Segmento objetivo real: ¿dev junior que hereda? ¿veterano? ¿consultora pequeña?
- Distribución y licencia: ¿AGPL (como ProLeap)? ¿MIT? ¿core abierto + tier pro?
- Cómo valido "la explicación es correcta" sin arriesgar IP: qué corpus concreto.
- Dónde está la línea entre "gratis open-source" y una posible cola de ingreso.
