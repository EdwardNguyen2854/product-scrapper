import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import PQueue from 'p-queue'
import pino from 'pino'
import type {
  AnalysisResult,
  BatchRecord,
  JobRecord,
  ProductRecord,
  WorkerEvent,
  WorkerMessage,
  WorkerRequest,
  WorkerResponse
} from '../shared/types'
import { aventicsSeriesUrlSchema, exportRequestSchema, jobOptionsSchema, productQuerySchema } from '../shared/schemas'
import { ScraperDatabase } from './db'
import { BrowserSession } from './browser'
import { buildScrapeContext, scrapeWithRetries } from './scrape'
import { CancelledError, JobController, sleep } from './control'
import { EmersonAdapter } from './adapters/emerson'
import { evaluateProductQuality } from './quality/validator'
import { compareJobs } from './comparison/compare'
import { exportJob, exportSchema } from './export'

const userData = process.env.AVENTICS_USER_DATA || join(process.cwd(), '.aventics-data')
const appVersion = process.env.AVENTICS_APP_VERSION || '0.2.6'
mkdirSync(userData, { recursive: true })
const logger = pino(pino.destination(join(userData, 'scraper.log')))
const db = new ScraperDatabase(userData)
db.markInterruptedJobs()

interface ActiveRun { controller: JobController; promise: Promise<void> }
interface ActiveBatch { id: string; paused: boolean; cancelled: boolean; promise: Promise<void> }
const activeRuns = new Map<string, ActiveRun>()
let activeBatch: ActiveBatch | null = null

function send(message: WorkerMessage): void { if (process.send) process.send(message) }
function emit(event: WorkerEvent): void { send({ event }) }
function log(level: 'info' | 'warn' | 'error', message: string, jobId?: string): void {
  logger[level]({ jobId }, message)
  emit({ type: 'log', level, message, jobId, at: new Date().toISOString() })
}
function emitJob(jobId: string): JobRecord {
  const job = db.getJob(jobId); if (!job) throw new Error(`Job ${jobId} was not found.`)
  emit({ type: 'job', job }); return job
}
function emitBatch(batchId: string): BatchRecord {
  const batch = db.getBatch(batchId); if (!batch) throw new Error(`Batch ${batchId} was not found.`)
  emit({ type: 'batch', batch }); return batch
}
function emitProduct(jobId: string, product: ProductRecord): void { emit({ type: 'product', jobId, product }) }

function filteredAssets(job: JobRecord, assets: ProductRecord['assets'] | Awaited<ReturnType<typeof scrapeWithRetries>>['data']['assets']) {
  return assets.filter((asset) => {
    if (asset.type === 'image') return job.extractImages
    if (asset.type === 'document') return job.extractDocuments
    if (asset.type === 'cad') return job.extractCad
    return false
  })
}

async function executeJob(jobId: string, headless: boolean, retryOnly = false): Promise<void> {
  if (activeRuns.has(jobId)) throw new Error('This job is already active.')
  if (activeRuns.size > 0) throw new Error('Only one series scrape can run at a time.')

  const controller = new JobController()
  const browser = new BrowserSession(headless)

  const promise = (async () => {
    try {
      let job = db.getJob(jobId)
      if (!job) throw new Error('Job not found.')
      await browser.start()
      log('info', `Mode: ${job.mode === 'full' ? 'FULL specifications' : 'LISTING only'}.`, jobId)

      // Listing-only retries/resumes re-run discovery because there are no detail
      // scrape tasks to retry. Full-mode retries keep the existing product inventory.
      if (!retryOnly || job.mode === 'listing') {
        controller.phase = 'discovering'
        db.setJobStatus(jobId, 'discovering'); emitJob(jobId)
        log('info', `Discovering products for ${job.seriesName}.`, jobId)
        const discovered = await EmersonAdapter.discoverProducts(job.sourceUrl, job.expectedTotal, browser, controller, async (products, pageNo) => {
          for (const seed of products) emitProduct(jobId, db.upsertProduct(jobId, seed))
          const discoveredCount = db.countProducts(jobId)
          emit({ type: 'discoveryProgress', jobId, discovered: discoveredCount, expected: job?.expectedTotal ?? null, page: pageNo })
          if (job?.developerDiagnostics) log('info', `[diag] discovery page ${pageNo}: +${products.length} products, total=${discoveredCount}${job.expectedTotal ? `/${job.expectedTotal}` : ''}`, jobId)
          emitJob(jobId)
        }, job.developerDiagnostics ? (message) => log('info', message, jobId) : undefined)
        if (!discovered.length) throw new Error('No products were discovered. The Emerson series page structure may have changed.')
        log('info', `Discovery complete: ${db.countProducts(jobId)} unique products.`, jobId)

        if (job.mode === 'listing') {
          db.markListingProductsSuccess(jobId)
          if (job.runQualityValidation) {
            db.setJobStatus(jobId, 'validating'); emitJob(jobId)
            for (const p of db.listProducts(jobId)) {
              const quality = evaluateProductQuality(p, 'listing'); db.saveQuality(p.id, quality); emitProduct(jobId, db.getProductById(p.id)!)
            }
          }
          await finishJob(jobId)
          return
        }
      }

      job = db.getJob(jobId)!
      controller.phase = 'scraping'
      db.setJobStatus(jobId, 'scraping'); emitJob(jobId)
      log('info', `Starting detail scrape: ${db.countProducts(jobId)} products.`, jobId)
      const queue = new PQueue({ concurrency: job.concurrency })
      controller.setQueue(queue)
      const scrapeContext = await buildScrapeContext(browser, controller, job.timeoutMs, job.sourceUrl)
      const targets = db.listProductsByStatus(jobId, ['pending', 'failed', 'cancelled'])
      log('info', `Scraping ${targets.length} product detail pages with concurrency ${job.concurrency}.`, jobId)

      for (const product of targets) {
        queue.add(async () => {
          controller.throwIfCancelled(); await controller.waitIfPaused()
          let current = product
          try {
            const result = await scrapeWithRetries(current, job!.retryAttempts, scrapeContext, () => {
              current = db.beginProductAttempt(current.id); emitProduct(jobId, current)
            })
            const saved = db.saveProductSuccess(current.id, {
              name: result.data.name || current.name,
              description: result.data.description,
              specifications: result.data.specifications,
              assets: filteredAssets(job!, result.data.assets)
            }, result.sourceMethod)
            if (job!.runQualityValidation) db.saveQuality(saved.id, evaluateProductQuality(db.getProductById(saved.id)!, 'full'))
            const finalProduct = db.getProductById(saved.id)!
            if (job!.developerDiagnostics) log('info', `[diag] ${finalProduct.sku}: method=${result.sourceMethod}, specs=${Object.keys(finalProduct.specifications).length}, assets=${finalProduct.assets.length}, quality=${finalProduct.quality.status}/${finalProduct.quality.score}`, jobId)
            emitProduct(jobId, finalProduct)
            emitJob(jobId)
          } catch (error) {
            if (error instanceof CancelledError) return
            const message = error instanceof Error ? error.message : String(error)
            const failed = db.saveProductFailure(current.id, message)
            emitProduct(jobId, failed); emitJob(jobId); log('warn', `${current.sku} failed: ${message}`, jobId)
          }
        }).catch((error) => log('error', `Queue task failed: ${error instanceof Error ? error.message : String(error)}`, jobId))
      }

      await queue.onIdle()
      controller.throwIfCancelled()
      await finishJob(jobId)
    } catch (error) {
      if (error instanceof CancelledError) {
        db.setJobStatus(jobId, 'cancelled'); emitJob(jobId); log('warn', 'Job cancelled; completed product data was preserved.', jobId)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        db.setJobStatus(jobId, 'failed', message); emitJob(jobId); log('error', message, jobId)
      }
    } finally {
      await browser.close()
      activeRuns.delete(jobId)
    }
  })()

  activeRuns.set(jobId, { controller, promise })
  await promise
}

async function finishJob(jobId: string): Promise<void> {
  let job = db.getJob(jobId)!
  if (job.autoCompare) {
    db.setJobStatus(jobId, 'comparing'); emitJob(jobId)
    try {
      const summary = compareJobs(db, jobId)
      if (summary.previousJobId) {
        emit({ type: 'comparison', jobId, summary })
        const scope = job.mode === 'listing' ? 'Listing inventory comparison' : 'Full-data comparison'
        log('info', `${scope}: +${summary.added} -${summary.removed} ~${summary.changed}, ${summary.unchanged} unchanged.`, jobId)
      } else log('info', 'No previous completed scrape exists for comparison.', jobId)
    } catch (error) {
      log('warn', `Comparison could not be completed: ${error instanceof Error ? error.message : String(error)}`, jobId)
    }
  }
  job = db.getJob(jobId)!
  const terminal = job.failedCount > 0 || job.incompleteCount > 0 ? 'completed_with_errors' : 'completed'
  db.setJobStatus(jobId, terminal); emitJob(jobId)
  log('info', `Job complete: ${Math.max(0, job.completedCount - job.incompleteCount)} complete, ${job.incompleteCount} incomplete, ${job.failedCount} failed.`, jobId)
}

async function executeBatch(batchId: string, headless: boolean): Promise<void> {
  if (activeBatch) throw new Error('Another batch is already active.')
  const state: ActiveBatch = { id: batchId, paused: false, cancelled: false, promise: Promise.resolve() }
  activeBatch = state
  const promise = (async () => {
    try {
      db.setBatchStatus(batchId, 'running'); emitBatch(batchId)
      const jobs = db.listBatchJobs(batchId)
      for (const job of jobs) {
        while (state.paused && !state.cancelled) await sleep(250)
        if (state.cancelled) break
        const current = db.getJob(job.id)!
        if (['completed', 'completed_with_errors'].includes(current.status)) continue
        await executeJob(job.id, headless, current.productCount > 0)
        emitBatch(batchId)
      }
      if (state.cancelled) db.setBatchStatus(batchId, 'cancelled')
      else {
        const jobsAfter = db.listBatchJobs(batchId)
        const hasErrors = jobsAfter.some((j) => ['failed', 'completed_with_errors', 'cancelled'].includes(j.status))
        db.setBatchStatus(batchId, hasErrors ? 'completed_with_errors' : 'completed')
      }
      emitBatch(batchId)
    } finally {
      if (activeBatch?.id === batchId) activeBatch = null
    }
  })()
  state.promise = promise
  await promise
}

async function handle(request: WorkerRequest): Promise<unknown> {
  const { command } = request
  switch (command.type) {
    case 'analyze': {
      const url = aventicsSeriesUrlSchema.parse(command.url)
      log('info', `Analyzing ${url}`)
      return EmersonAdapter.analyzeSeries(url, command.headless)
    }
    case 'start': {
      aventicsSeriesUrlSchema.parse(command.analysis.url)
      const options = jobOptionsSchema.parse(command.options)
      if (!command.analysis.supported) throw new Error('This URL is not supported.')
      if (activeRuns.size || activeBatch) throw new Error('Another scrape is already active.')
      const id = randomUUID(); const job = db.createJob(id, command.analysis.url, command.analysis.seriesName, command.analysis.totalProducts, options)
      emit({ type: 'job', job }); void executeJob(id, command.headless); return job
    }
    case 'startBatch': {
      const options = jobOptionsSchema.parse(command.options)
      if (activeRuns.size || activeBatch) throw new Error('Another scrape is already active.')
      if (!command.analyses.length) throw new Error('Add at least one series to the batch.')
      for (const a of command.analyses) { aventicsSeriesUrlSchema.parse(a.url); if (!a.supported) throw new Error(`Unsupported URL: ${a.url}`) }
      const batchId = randomUUID(); const batch = db.createBatch(batchId, command.name?.trim() || `Batch ${new Date().toLocaleString()}`)
      command.analyses.forEach((analysis, index) => {
        const jobId = randomUUID(); const job = db.createJob(jobId, analysis.url, analysis.seriesName, analysis.totalProducts, options, batchId)
        db.attachJobToBatch(batchId, jobId, index); emit({ type: 'job', job })
      })
      emit({ type: 'batch', batch: db.getBatch(batchId)! }); void executeBatch(batchId, command.headless); return db.getBatch(batchId)
    }
    case 'pause': {
      const active = activeRuns.get(command.jobId); if (!active) throw new Error('The job is not currently running.')
      active.controller.pause(); const paused = db.setJobStatus(command.jobId, 'paused'); emit({ type: 'job', job: paused })
      if (paused.batchId && activeBatch?.id === paused.batchId) { activeBatch.paused = true; const batch = db.setBatchStatus(paused.batchId, 'paused'); emit({ type: 'batch', batch }) }
      return paused
    }
    case 'resume': {
      const active = activeRuns.get(command.jobId)
      if (active) {
        active.controller.resume(); const resumed = db.setJobStatus(command.jobId, active.controller.phase === 'discovering' ? 'discovering' : 'scraping'); emit({ type: 'job', job: resumed })
        if (resumed.batchId && activeBatch?.id === resumed.batchId) { activeBatch.paused = false; const batch = db.setBatchStatus(resumed.batchId, 'running'); emit({ type: 'batch', batch }) }
        return resumed
      }
      if (activeRuns.size || activeBatch) throw new Error('Another scrape is already active.')
      const job = db.getJob(command.jobId); if (!job) throw new Error('Job not found.')
      void executeJob(command.jobId, command.headless, job.productCount > 0); return job
    }
    case 'cancel': {
      const active = activeRuns.get(command.jobId); if (active) { active.controller.cancel(); return db.getJob(command.jobId) }
      const cancelled = db.setJobStatus(command.jobId, 'cancelled'); emit({ type: 'job', job: cancelled }); return cancelled
    }
    case 'pauseBatch': {
      if (!activeBatch || activeBatch.id !== command.batchId) throw new Error('This batch is not active.')
      activeBatch.paused = true
      for (const [jobId, run] of activeRuns) { run.controller.pause(); const job = db.setJobStatus(jobId, 'paused'); emit({ type: 'job', job }) }
      const batch = db.setBatchStatus(command.batchId, 'paused'); emit({ type: 'batch', batch }); return batch
    }
    case 'resumeBatch': {
      const batch = db.getBatch(command.batchId); if (!batch) throw new Error('Batch not found.')
      if (activeBatch?.id === command.batchId) {
        activeBatch.paused = false
        for (const [jobId, run] of activeRuns) { run.controller.resume(); const job = db.setJobStatus(jobId, run.controller.phase === 'discovering' ? 'discovering' : 'scraping'); emit({ type: 'job', job }) }
        const b=db.setBatchStatus(command.batchId,'running'); emit({type:'batch',batch:b}); return b
      }
      if (activeBatch || activeRuns.size) throw new Error('Another scrape is already active.')
      void executeBatch(command.batchId, command.headless); return batch
    }
    case 'cancelBatch': {
      if (activeBatch?.id === command.batchId) { activeBatch.cancelled = true; activeBatch.paused = false; for (const run of activeRuns.values()) run.controller.cancel() }
      const batch = db.setBatchStatus(command.batchId, 'cancelled'); emit({ type: 'batch', batch }); return batch
    }
    case 'retryFailed': {
      const job = db.getJob(command.jobId); if (!job) throw new Error('Job not found.')
      if (activeRuns.size || activeBatch) throw new Error('Another scrape is already active.')
      db.resetFailed(command.jobId)
      if (command.includeIncomplete) { const ids = db.listIncompleteProductIds(command.jobId); db.resetProducts(ids) }
      void executeJob(command.jobId, command.headless, true); return db.getJob(command.jobId)
    }
    case 'listJobs': return db.listJobs()
    case 'listBatches': return db.listBatches()
    case 'getBatch': { const batch=db.getBatch(command.batchId); if(!batch) throw new Error('Batch not found.'); return {batch,jobs:db.listBatchJobs(command.batchId)} }
    case 'getJob': { const detail = db.getJobDetail(command.jobId); if (!detail) throw new Error('Job not found.'); return detail }
    case 'queryProducts': return db.queryProducts(productQuerySchema.parse(command.query))
    case 'deleteJob': { if (activeRuns.has(command.jobId)) throw new Error('Stop the active job before deleting it.'); db.deleteJob(command.jobId); return true }
    case 'getExportSchema': { const detail=db.getJobDetail(command.jobId); if(!detail) throw new Error('Job not found.'); return exportSchema(detail) }
    case 'listPresets': return db.listPresets()
    case 'savePreset': return db.savePreset(command.preset)
    case 'deletePreset': db.deletePreset(command.presetId); return true
    case 'export': {
      const exportRequest=exportRequestSchema.parse(command.request); const detail=db.getJobDetail(exportRequest.jobId); if(!detail) throw new Error('Job not found.')
      const path=await exportJob(db,detail,exportRequest,appVersion); const job=db.setOutputPath(exportRequest.jobId,path); emit({type:'job',job}); log('info',`${exportRequest.format.toUpperCase()} exported to ${path}`,exportRequest.jobId); return path
    }
    case 'compare': {
      const summary=compareJobs(db,command.jobId,command.previousJobId); emit({type:'comparison',jobId:command.jobId,summary}); emitJob(command.jobId); return summary
    }
    case 'shutdown': {
      if (activeBatch) { activeBatch.cancelled=true; activeBatch.paused=false }
      for (const run of activeRuns.values()) run.controller.cancel()
      await Promise.allSettled([...activeRuns.values()].map((run)=>run.promise))
      if (activeBatch) await Promise.race([activeBatch.promise,sleep(2500)]).catch(()=>undefined)
      db.close(); setTimeout(()=>process.exit(0),25); return true
    }
  }
}

process.on('message', (incoming) => {
  const raw = incoming as WorkerRequest; if (!raw?.requestId || !raw.command) return
  void handle(raw).then((result) => send({ requestId: raw.requestId, ok: true, result } as WorkerResponse)).catch((error) => send({ requestId: raw.requestId, ok: false, error: error instanceof Error ? error.message : String(error) } as WorkerResponse))
})
process.on('uncaughtException',(error)=>{logger.error(error,'uncaughtException');emit({type:'log',level:'error',message:error.message,at:new Date().toISOString()})})
process.on('unhandledRejection',(error)=>{logger.error(error,'unhandledRejection');emit({type:'log',level:'error',message:error instanceof Error?error.message:String(error),at:new Date().toISOString()})})
