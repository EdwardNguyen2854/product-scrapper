import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { WorkerCommand, WorkerEvent, WorkerMessage, WorkerRequest } from '../shared/types'

export class ScraperWorkerClient {
  private child: ChildProcess | null = null
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout }
  >()
  private listeners = new Set<(event: WorkerEvent) => void>()

  constructor(
    private readonly userDataDirectory: string,
    private readonly appVersion: string
  ) {}

  start(): void {
    if (this.child) return

    const workerPath = join(__dirname, 'worker.js')
    const child = fork(workerPath, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AVENTICS_USER_DATA: this.userDataDirectory,
        AVENTICS_APP_VERSION: this.appVersion
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })

    child.stdout?.on('data', (data) => console.log(`[scraper] ${String(data).trimEnd()}`))
    child.stderr?.on('data', (data) => console.error(`[scraper] ${String(data).trimEnd()}`))

    child.on('message', (incoming) => {
      const raw = incoming as WorkerMessage
      if (!raw || typeof raw !== 'object') return
      if ('event' in raw) {
        for (const listener of this.listeners) listener(raw.event)
        return
      }
      const waiter = this.pending.get(raw.requestId)
      if (!waiter) return
      clearTimeout(waiter.timer)
      this.pending.delete(raw.requestId)
      raw.ok ? waiter.resolve(raw.result) : waiter.reject(new Error(raw.error || 'Worker request failed.'))
    })

    child.on('exit', (code, signal) => {
      const error = new Error(`Scraper worker exited (${code ?? 'no code'}, ${signal ?? 'no signal'}).`)
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
      this.pending.clear()
      this.child = null
    })

    this.child = child
  }

  onEvent(listener: (event: WorkerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async request<T = unknown>(command: WorkerCommand, timeoutMs = 120000): Promise<T> {
    this.start()
    if (!this.child?.connected) throw new Error('Scraper worker is not connected.')

    const requestId = randomUUID()
    const request: WorkerRequest = { requestId, command }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Worker request timed out: ${command.type}`))
      }, timeoutMs)

      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      this.child?.send(request)
    })
  }

  async shutdown(): Promise<void> {
    if (!this.child) return
    try {
      await this.request({ type: 'shutdown' }, 5000)
    } catch {
      // Best-effort graceful shutdown.
    }
    this.child?.kill()
    this.child = null
  }
}
