// elkjs no publica tipos para la ruta del bundle de navegador;
// re-usamos los del paquete principal.
declare module 'elkjs/lib/elk.bundled.js' {
  import ELK from 'elkjs'
  export * from 'elkjs'
  export default ELK
}
