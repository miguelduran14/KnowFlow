# Changelog

Todos los cambios relevantes de KnowFlow. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## [Unreleased]

## [0.1.1] - 2026-09-10

Pulido de presentación y arranque. Sin cambios en el motor de análisis.

### Added

- **Portada rediseñada** en dos columnas con un robot 3D (Three.js empaquetado,
  sin CDN; respeta local-first). Se carga diferido tras el primer pintado, en su
  propio chunk, para no penalizar el arranque.
- **Integración continua** (GitHub Actions): `npm run verify` en cada push.
- **Imagen de portada** en el README y ficha del paquete lista para npm
  (`prepublishOnly`, metadatos, keywords).
- Aviso claro al arrancar si la versión de Node es < 18, con el comando para
  actualizar.

### Changed

- El subtítulo de la barra pasa a «Comprensión de COBOL verificada por parser».
- Se retira del control de versiones el tooling de agentes (`.agents/`,
  `.claude/skills/`): configuración personal, no parte del producto.

## [0.1.0] - 2026-09-07

Primer hito **listo para demo**. Reúne todo el trabajo hasta la fecha: el motor
determinista, la interfaz de análisis y la cadena de ejemplo.

### Added

- **Motor determinista de COBOL** (`knowflow`): parser de DATA DIVISION (esquema de
  bytes con offsets, `REDEFINES`, `OCCURS` / `OCCURS DEPENDING ON`, niveles 66 y 88,
  `SYNCHRONIZED`, `USAGE`, `COMP-3`), parser de PROCEDURE DIVISION (párrafos,
  secciones, aristas `PERFORM` / `CALL` / `GO TO` / caída natural / `SORT`, guardas de
  `IF` / `EVALUATE`), inventario (ficheros y su E/S, `EXEC SQL` con tablas y cursores,
  `EXEC CICS`), resolución de `COPY` / `EXEC SQL INCLUDE` y enlace de la cadena entre
  programas (`CALL` que cruza la frontera de un programa).
- **Interfaz local** (`npx knowflow`): vistas de Flujo (lienzo interactivo con
  React Flow + elk, ficha de párrafo, filtro de aristas, plegado de secciones,
  export a Mermaid / SVG / PNG), Datos (mapa de bytes proporcional + tabla), Qué
  toca, Avisos, Cadena y Explicación. Persistencia local de la sesión.
- **Explicación con IA (BYOK, agnóstica de proveedor)**: capa pluggable Claude /
  OpenAI-compatible; el modelo sólo recibe hechos ya verificados por el parser,
  nunca el fuente crudo (ADR-0003). Perfiles de conexión guardables.
- **Avisos de mantenimiento**: `stop-run-in-subprogram`, `sql-write-without-where`,
  `goto-crosses-section`, `file-opened-not-closed`, `cursor-opened-not-closed`,
  `cursor-fetched-without-open`, `alter-statement`, `unreachable-paragraph`,
  `unused-cursor`, `unused-file`.
- **Where-used por campo** (`collectReferences`): para cada dato del esquema, dónde
  se lee y dónde se escribe en la PROCEDURE DIVISION, anclado a párrafo y línea;
  incluye host variables de `EXEC SQL` / `EXEC CICS`. Panel en la ficha fijada del
  mapa de bytes y sección en el dossier.
- **Trazabilidad transitiva de datos** (`traceField`): de dónde viene y a dónde va
  el valor de un campo, encadenando `MOVE` / `COMPUTE` / aritmética / `STRING` y
  solapes `REDEFINES`. Insensible al orden de ejecución (cada arista es un flujo
  posible). Bloque en la ficha fijada y sección en el dossier.
- **Dossier de onboarding**: un `.md` autocontenido (prosa opcional de IA + diagrama
  Mermaid + esquema + usos + trazabilidad + inventario + avisos + límites de lo
  verificado), armado en el navegador.
- **Aviso de privacidad** local-first en la interfaz (badge + popover).
- **Cadena de ejemplo** en `examples/` (`ctamov01` → `valida01` / `fecha01` +
  copybooks): batch de banca sintético que ejercita todas las vistas y lleva dos
  avisos plantados a propósito. El botón «Cargar ejemplo» la inyecta entera.

### Changed

- El diagrama de Flujo reserva espacio real para las etiquetas de arista (guardas
  largas de COBOL ya no se solapan con nodos).
- La página de Explicación adopta un tono más calmado para la fidelidad parcial.

### Fixed

- Parser: `PIC` con símbolo de moneda `$`; `OCCURS … DEPENDING ON` sin `TIMES`;
  DATA DIVISION en formato libre; `COPY … OF/IN biblioteca`; `GO TO` que cruza de
  sección con distinta grafía; `file-opened-not-closed` restringido a modos de
  escritura.
- Where-used: los identificadores entre paréntesis (subíndice, longitud de
  modificación de referencia) se cuentan como lectura de índice, no como el rol del
  operando; los nombres de `INDEXED BY` ya no se listan como desconocidos.

[Unreleased]: https://github.com/miguelduran14/KnowFlow/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/miguelduran14/KnowFlow/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/miguelduran14/KnowFlow/releases/tag/v0.1.0
