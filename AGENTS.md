# AGENTS.md — Explicador / documentador de COBOL con IA

Fuente de verdad para cualquier agente (Claude Code, Codex, Cursor…). `CLAUDE.md` importa este fichero;
no dupliques instrucciones — edítalas aquí.

## El proyecto en una línea
Herramienta de comprensión y traspaso para quien *mantiene* COBOL: programa + copybooks → paquete de
onboarding legible. Contexto completo, arquitectura y decisiones abiertas en `CONTEXT.md`.

## Restricciones duras (no negociables)
- **Nunca** incluir, pegar ni procesar COBOL de clientes de mi empleador. Solo COBOL sintético o
  público (GnuCOBOL, suite NIST, repos abiertos). Es un tema de IP/legal.
- **Local-first / BYOK**: el código del usuario no sale a terceros salvo la llamada al proveedor de
  IA que el propio usuario configure.
- **Agnóstico de proveedor**: la capa de IA es pluggable (Claude, OpenAI/GPT u otros). No acoplar el
  producto a un único proveedor.

## Neutralidad de agente
- Este `AGENTS.md` es canónico; lo leen Codex, Cursor y otros. `CLAUDE.md` solo lo importa (`@AGENTS.md`).
- No dependas de features exclusivas de un solo agente en el código ni en los scripts del proyecto.

## Cómo trabajar aquí
- Pasos pequeños y deliberados; el ritmo lo marca la velocidad de feedback. No abarques tareas
  demasiado grandes.
- Ante una decisión de diseño abierta (ver `CONTEXT.md`), pregunta — no la cierres por tu cuenta.
- Actualiza tests en los puntos de decisión antes de dar algo por cerrado.

---
> El bloque de *issue tracker* lo añadirá `setup-matt-pocock-skills` al ejecutarlo. Déjale sitio aquí
> abajo; si lo escribe también en `CLAUDE.md`, consolida ese bloque en este fichero.
