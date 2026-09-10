# Publicar una versión

Cómo sacar una versión nueva de KnowFlow: subir el número, dejar GitHub y npm
alineados, y publicar. El paquete de npm es el que hace funcionar `npx knowflow`.

## Requisitos (una vez)

- Node ≥ 18 y dependencias instaladas: `npm install` y `npm install --prefix gui`.
- Sesión de npm iniciada con permiso sobre el paquete `knowflow`: `npm login`.

## Pasos

1. **Subir la versión** (raíz + GUI, sin que npm cree commit ni tag todavía):

   ```bash
   npm version patch --no-git-tag-version
   npm version patch --no-git-tag-version --prefix gui
   ```

   Usa `minor` en vez de `patch` si hay funcionalidad nueva, `major` si rompes
   compatibilidad ([SemVer](https://semver.org/lang/es/)).

2. **Anotar el cambio** en [`CHANGELOG.md`](CHANGELOG.md): mueve lo de
   `[Unreleased]` a una sección nueva `[x.y.z] - AAAA-MM-DD` y actualiza los
   enlaces de comparación del final.

3. **Un commit y un tag** con la versión:

   ```bash
   git add -A
   git commit -m "x.y.z"
   git tag -a vx.y.z -m "KnowFlow x.y.z — <resumen>"
   ```

4. **Subir rama y tag**:

   ```bash
   git push --follow-tags
   ```

5. **Publicar en npm**. `prepublishOnly` reconstruye y pasa `verify` (typecheck +
   tests + build) automáticamente; si algo falla, no se publica:

   ```bash
   npm publish
   ```

6. **Crear la Release en GitHub** apuntando al tag:

   ```bash
   gh release create vx.y.z --title "KnowFlow x.y.z — <resumen>" \
     --notes "<qué cambia; enlaza al CHANGELOG>"
   ```

## Comprobaciones

- Qué se empaqueta, sin publicar: `npm publish --dry-run` (debe listar solo
  `dist/` + `gui/dist/` + `package.json` + `README.md` + `LICENSE`; el `src/`,
  los tests y `examples/` NO viajan — los ejemplos van embebidos en el bundle).
- Tras publicar: `npx knowflow@latest` en una carpeta limpia debe abrir la app en
  `http://localhost:4173`.

## Notas

- La imagen del README usa una URL absoluta de `raw.githubusercontent.com` para
  que se vea también en la página de npm (los enlaces relativos solo valen en
  GitHub).
- El tooling de agentes (`.agents/`, `.claude/skills/`) está en `.gitignore`: no
  debe volver a versionarse.
