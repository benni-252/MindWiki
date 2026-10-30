import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import pkg from './package.json'

// Strenge Content-Security-Policy nur im fertigen Build; im Dev-Modus braucht React-Refresh Inline-Skripte.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' wikiimg: data: blob:; font-src 'self' data:; connect-src 'self'"

function cspPlugin(): Plugin {
  return {
    name: 'mindwiki-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [react(), cspPlugin()]
  }
})
