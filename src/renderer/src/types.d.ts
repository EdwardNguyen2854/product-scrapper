import type { AppSettings, WorkerCommand, WorkerEvent } from '../../shared/types'

declare global {
  interface Window {
    aventics: {
      request<T = unknown>(command: WorkerCommand): Promise<T>
      getSettings(): Promise<AppSettings>
      setSettings(settings: AppSettings): Promise<AppSettings>
      chooseOutputDirectory(): Promise<string | null>
      openPath(path: string): Promise<boolean>
      openExternal(url: string): Promise<boolean>
      onWorkerEvent(callback: (event: WorkerEvent) => void): () => void
    }
  }
}

export {}
