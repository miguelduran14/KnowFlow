import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],
  // `src/exampleProgram.ts` importa los .cbl/.cpy de `examples/` (un nivel
  // por encima de `gui/`) con `?raw`. El servidor de desarrollo restringe
  // la lectura al workspace; hay que permitir el padre.
  server: { fs: { allow: ['..'] } },
  // El motor (`knowflow`) se enlaza con `file:..`, así que sus imports se
  // resuelven desde el directorio padre. Sin forzar una única instancia,
  // Vite carga dos copias de React (la de la GUI y la que arrastra
  // framer-motion), lo que rompe los hooks ("Invalid hook call"). El alias
  // apunta cada import de react/react-dom a la copia física de la GUI.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: here('./node_modules/react'),
      'react-dom': here('./node_modules/react-dom'),
    },
  },
  optimizeDeps: { include: ['react', 'react-dom', 'react/jsx-runtime', 'framer-motion'] },
  build: {
    // El chunk grande (~1,4 MB) es elk + React Flow, la semilla del grafo.
    // NO está en el arranque: solo lo importan FlowCanvas y ChainCanvas, que
    // van con lazy(), así que la portada no lo descarga — solo se baja al
    // abrir Flujo/Cadena. Se deja el troceo automático de Vite (forzar un
    // manualChunk para React Flow hacía que Vite lo enganchara al entry y
    // acababa cargándose en la portada, que es justo lo que no queremos).
    // Solo se sube el umbral del aviso: ese peso es correcto por diseño y
    // está fuera de la ruta crítica.
    chunkSizeWarningLimit: 1700,
  },
})
