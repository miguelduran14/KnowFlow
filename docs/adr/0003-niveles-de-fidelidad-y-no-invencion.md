# Niveles de fidelidad y regla dura de no-invención

---
status: accepted
---

Todo resultado lleva etiqueta de **nivel de fidelidad**: (1) verificado por parser, (2) parcialmente
verificado (fragmento de código pegado), (3) solo LLM (futuro: capturas de pantalla). En **modo
degradado** (copybook o `EXEC SQL INCLUDE` no disponible) el parser da lo que puede y cada hueco se
marca explícitamente — "CLIENTE: copybook no disponible, estructura desconocida" — y el LLM tiene
**prohibido por prompt y por contrato** rellenar el hueco con conjeturas.

## Consequences

- Un hueco marcado es información honesta y además *vende* el modo completo: la salida dice qué
  copybooks faltan para completar el esquema.
- El etiquetado nace en el MVP (el modo fragmento ya lo necesita); las capturas, cuando lleguen,
  son solo un nivel más de una escala existente.
- Cualquier salida del LLM que afirme estructura no presente en los hechos del parser es un bug,
  no una feature.
