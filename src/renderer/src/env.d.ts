import type { WikiApi } from '../../shared/types'

declare global {
  interface Window {
    wiki: WikiApi
  }
  /** Version aus package.json, per Vite eingesetzt */
  const __APP_VERSION__: string
}
