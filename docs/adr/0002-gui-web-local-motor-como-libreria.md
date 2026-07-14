# GUI web local; el motor es una librería, la GUI una piel

---
status: accepted
---

La superficie del producto es una **web local** (localhost, sin servidor propio — coherente con
local-first/BYOK): arrastrar fichero, pegar código, resultado pulido. El usuario objetivo (junior
que vive en ISPF, no en VS Code) descarta el panel de VS Code como superficie principal; la
prioridad de portfolio descarta la CLI como producto. **El core (parser + esquema + capa LLM) es
una librería que no sabe que la GUI existe**; durante el desarrollo se ejercita con un arnés CLI
no-producto, sin pulir, cero horas de UX.

## Consequences

- Las horas van primero al foso (parser, esquema) y luego al escaparate (GUI), sin refactor entre
  medias.
- El pipeline interno es *artefacto → hechos estructurales → explicación*, agnóstico al tipo de
  artefacto: COBOL primero, JCL después, sin asumir "esto solo traga COBOL".
