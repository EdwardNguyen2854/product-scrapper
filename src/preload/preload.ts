import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppSettings, WorkerCommand, WorkerEvent } from '../shared/types'

const api = {
  request: <T = unknown>(command: WorkerCommand): Promise<T> => ipcRenderer.invoke(IPC.workerRequest, command),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsSet, settings),
  chooseOutputDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseOutput),
  openPath: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.openPath, path),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.openExternal, url),
  onWorkerEvent: (callback: (event: WorkerEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: WorkerEvent) => callback(payload)
    ipcRenderer.on(IPC.workerEvent, handler)
    return () => ipcRenderer.removeListener(IPC.workerEvent, handler)
  }
}

contextBridge.exposeInMainWorld('aventics', api)
