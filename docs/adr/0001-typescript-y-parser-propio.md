# TypeScript de punta a punta y parser propio del subconjunto

---
status: accepted
---

El motor, el arnés CLI y la GUI web local se escriben en TypeScript/Node — un solo lenguaje que
aprender (el autor no domina ni Python ni Node; la GUI iba a ser JS/TS sí o sí), y el compilador
de TS actúa como red de seguridad sobre código escrito mayormente por agentes de IA. El parser
del slice 1 (COPY/REPLACING + `EXEC SQL INCLUDE` + data division) es **propio**, no un wrapper.

## Considered Options

- **ProLeap / Koopa (Java)** — rechazados: exigen JVM en la máquina del usuario, puente
  inter-proceso a mantener, ProLeap es AGPL (hipoteca la licencia) y está semi-abandonado.
- **Python** — rechazado: obligaría a aprender dos lenguajes/runtimes a la vez con 5–10 h/semana.
- **Rust/Go** — rechazados: optimizan la parte ya instantánea (parseo); el cuello de botella es la
  llamada al LLM. Curva de aprendizaje máxima para revisión mínima.

## Consequences

- El subconjunto parseado crece slice a slice; se reevalúa parser externo solo si el grafo PERFORM
  completo lo exige.
- La corrección se verifica con **fixtures golden-file** (COBOL de entrada → esquema esperado),
  que el autor puede juzgar porque son COBOL, no TS.
