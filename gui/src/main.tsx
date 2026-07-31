// Fira auto-hospedada (sin red, respeta el diseño local-first). Fira Sans
// para texto de interfaz; Fira Code para código, datos y nombres COBOL.
import '@fontsource/fira-sans/300.css'
import '@fontsource/fira-sans/400.css'
import '@fontsource/fira-sans/500.css'
import '@fontsource/fira-sans/600.css'
import '@fontsource/fira-sans/700.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/500.css'
import '@fontsource/fira-code/600.css'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
