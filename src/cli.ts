#!/usr/bin/env node
// Punto de entrada `npx knowflow`: sirve la GUI ya compilada (gui/dist) en
// localhost y abre el navegador. Sin dependencias de servidor — un archivo
// estático servido a mano es toda la superficie que necesita esta app (no
// hay backend propio, ADR-0002). Local-first: nada de lo servido sale de
// esta máquina; la única llamada de red la hace el navegador, directa al
// proveedor de IA que el usuario configure en la GUI.
import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
// Publicado: dist/cli.js junto a gui/dist (ver "files" en package.json).
const GUI_DIST = resolve(here, '..', 'gui', 'dist')
const INDEX_HTML = join(GUI_DIST, 'index.html')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(cmd, () => {
    // Si falla (entorno sin GUI, contenedor…), el usuario ya tiene la URL
    // impresa en consola — no es un error que deba cortar el arranque.
  })
}

async function serveFile(path: string): Promise<{ body: Buffer; type: string } | undefined> {
  try {
    const body = await readFile(path)
    return { body, type: MIME[extname(path)] ?? 'application/octet-stream' }
  } catch {
    return undefined
  }
}

// Versión mínima de Node (coincide con "engines" en package.json). Este
// aviso solo puede saltar si Node EXISTE pero es viejo — sin Node instalado
// no hay intérprete que lo muestre; para ese caso, el README indica cómo
// instalarlo. Aquí se convierte un fallo por sintaxis/API moderna en un
// mensaje claro con el comando para actualizar.
const MIN_NODE = 18

function checkNodeVersion(): boolean {
  const major = Number(process.versions.node.split('.')[0])
  if (major >= MIN_NODE) return true
  console.error(
    `\nKnowFlow necesita Node ${MIN_NODE} o superior. Estás usando Node ${process.versions.node}.\n\n` +
      'Actualiza Node (elige uno):\n' +
      '  • Instalador LTS:  https://nodejs.org\n' +
      '  • Windows (winget): winget install OpenJS.NodeJS.LTS\n' +
      '  • macOS (brew):     brew install node\n' +
      '  • Con nvm:          nvm install --lts\n\n' +
      "Luego vuelve a ejecutar 'npx knowflow'.\n",
  )
  return false
}

async function main(): Promise<void> {
  if (!checkNodeVersion()) {
    process.exitCode = 1
    return
  }

  if (!existsSync(INDEX_HTML)) {
    console.error(
      'No se encuentra la GUI compilada (gui/dist/index.html).\n' +
        'Si trabajas desde el repo de desarrollo: npm run build\n' +
        'Si instalaste el paquete publicado, esto es un bug — abre un issue.',
    )
    process.exitCode = 1
    return
  }

  const port = Number(process.env.PORT) || Number(process.argv[2]) || 4173

  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!)
    const requested = resolve(GUI_DIST, '.' + (urlPath === '/' ? '/index.html' : urlPath))

    // Guarda contra path traversal: cualquier ruta resuelta debe seguir
    // dentro de GUI_DIST.
    const safe = requested === GUI_DIST || requested.startsWith(GUI_DIST + '\\') || requested.startsWith(GUI_DIST + '/')
    const target = safe ? requested : INDEX_HTML

    void serveFile(target).then(async hit => {
      // SPA fallback: cualquier ruta no encontrada (recarga en una vista
      // que no es un fichero real) sirve index.html en vez de 404.
      const resolved = hit ?? (await serveFile(INDEX_HTML))
      if (!resolved) {
        res.writeHead(404).end('No encontrado')
        return
      }
      res.writeHead(200, { 'Content-Type': resolved.type })
      res.end(resolved.body)
    })
  })

  server.listen(port, () => {
    const url = `http://localhost:${port}`
    console.log(`KnowFlow corriendo en ${url}`)
    console.log(
      'Local-first: el código que analices no sale de esta máquina, salvo la llamada al proveedor de IA que tú configures dentro de la app.',
    )
    openBrowser(url)
  })
}

void main()
