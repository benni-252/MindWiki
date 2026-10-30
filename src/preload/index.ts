import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { RPC_METHODS, type WikiApi, type WikiEvent } from '../shared/types'

const api: Record<string, unknown> = Object.fromEntries(
  RPC_METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(`wiki:${name}`, ...args)])
)

api.onEvent = (listener: (event: WikiEvent) => void) => {
  const handler = (_event: IpcRendererEvent, payload: WikiEvent): void => listener(payload)
  ipcRenderer.on('wiki:event', handler)
  return () => {
    ipcRenderer.removeListener('wiki:event', handler)
  }
}

contextBridge.exposeInMainWorld('wiki', api as WikiApi)
