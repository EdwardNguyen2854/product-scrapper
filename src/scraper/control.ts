import type PQueue from 'p-queue'

export class CancelledError extends Error {
  constructor() {
    super('Job cancelled.')
    this.name = 'CancelledError'
  }
}

export type ActivePhase = 'discovering' | 'scraping'

export class JobController {
  readonly abortController = new AbortController()
  private paused = false
  private waiters: Array<() => void> = []
  private queue: PQueue | null = null
  phase: ActivePhase = 'discovering'

  get signal(): AbortSignal {
    return this.abortController.signal
  }

  get isPaused(): boolean {
    return this.paused
  }

  setQueue(queue: PQueue): void {
    this.queue = queue
  }

  pause(): void {
    if (this.signal.aborted) return
    this.paused = true
    this.queue?.pause()
  }

  resume(): void {
    if (this.signal.aborted) throw new CancelledError()
    this.paused = false
    const waiters = this.waiters.splice(0)
    for (const release of waiters) release()
    this.queue?.start()
  }

  cancel(): void {
    if (!this.signal.aborted) this.abortController.abort()
    this.paused = false
    const waiters = this.waiters.splice(0)
    for (const release of waiters) release()
    this.queue?.clear()
  }

  throwIfCancelled(): void {
    if (this.signal.aborted) throw new CancelledError()
  }

  async waitIfPaused(): Promise<void> {
    this.throwIfCancelled()
    if (!this.paused) return
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.throwIfCancelled()
  }
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new CancelledError()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new CancelledError())
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
