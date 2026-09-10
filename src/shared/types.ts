export type ScrapeMode = 'listing' | 'full'

export type JobStatus =
  | 'analyzing'
  | 'ready'
  | 'discovering'
  | 'scraping'
  | 'validating'
  | 'comparing'
  | 'paused'
  | 'completed'
  | 'completed_with_errors'
  | 'cancelled'
  | 'failed'
  | 'interrupted'

export type BatchStatus = 'pending' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'cancelled'
export type ProductStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
export type SourceMethod = 'listing' | 'api' | 'http' | 'browser' | null
export type QualityStatus = 'complete' | 'incomplete' | 'failed' | 'not_evaluated'
export type ChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'not_compared'
export type AssetType = 'image' | 'document' | 'cad'
export type AssetCategory =
  | 'product_image'
  | 'datasheet'
  | 'manual'
  | 'certificate'
  | 'technical_document'
  | 'cad_portal'
  | 'step'
  | 'sat'
  | 'iges'
  | 'other'

export interface AnalysisResult {
  url: string
  seriesName: string
  totalProducts: number | null
  supported: boolean
  warnings: string[]
}

export interface JobOptions {
  mode: ScrapeMode
  concurrency: number
  retryAttempts: number
  timeoutMs: number
  extractImages: boolean
  extractDocuments: boolean
  extractCad: boolean
  runQualityValidation: boolean
  autoCompare: boolean
  developerDiagnostics: boolean
}

export interface JobRecord {
  id: string
  batchId: string | null
  sourceUrl: string
  normalizedSourceUrl: string
  seriesName: string
  expectedTotal: number | null
  status: JobStatus
  mode: ScrapeMode
  concurrency: number
  retryAttempts: number
  timeoutMs: number
  extractImages: boolean
  extractDocuments: boolean
  extractCad: boolean
  runQualityValidation: boolean
  autoCompare: boolean
  developerDiagnostics: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  completedCount: number
  failedCount: number
  incompleteCount: number
  productCount: number
  outputPath: string | null
  errorMessage: string | null
  comparedToJobId: string | null
}

export interface BatchRecord {
  id: string
  name: string
  status: BatchStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  jobCount: number
  completedJobs: number
  failedJobs: number
  totalProducts: number
  completedProducts: number
}

export interface ProductSeed {
  sku: string
  name: string
  url: string
  specifications?: Record<string, string>
}

export interface AssetRecord {
  id: number
  productId: number
  type: AssetType
  category: AssetCategory
  title: string
  url: string
  format: string
  source: SourceMethod
  detectedAt: string
}

export interface QualityIssue {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export interface QualityResult {
  status: QualityStatus
  score: number
  issues: QualityIssue[]
  evaluatedAt: string | null
}

export interface ProductRecord extends ProductSeed {
  id: number
  jobId: string
  description: string
  status: ProductStatus
  attempts: number
  sourceMethod: SourceMethod
  errorMessage: string | null
  scrapedAt: string | null
  specifications: Record<string, string>
  assets: AssetRecord[]
  quality: QualityResult
  changeStatus: ChangeStatus
}

export interface ProductChange {
  id: number
  comparisonJobId: string
  previousJobId: string | null
  sku: string
  changeType: 'product_added' | 'product_removed' | 'field_changed' | 'asset_added' | 'asset_removed'
  field: string
  previousValue: string
  currentValue: string
}

export interface ComparisonSummary {
  currentJobId: string
  previousJobId: string | null
  added: number
  removed: number
  changed: number
  unchanged: number
  changes: ProductChange[]
}

export interface JobDetail {
  job: JobRecord
  products: ProductRecord[]
  comparison: ComparisonSummary | null
}

export interface AppSettings {
  outputDirectory: string
  concurrency: number
  retryAttempts: number
  timeoutMs: number
  headless: boolean
  browserChannel: 'msedge'
  autoCompare: boolean
  runQualityValidation: boolean
  extractImages: boolean
  extractDocuments: boolean
  extractCad: boolean
  developerDiagnostics: boolean
}

export type ExportFormat = 'xlsx' | 'csv' | 'json'

export interface ExportFieldSelection {
  core: string[]
  specifications: string[]
  assets: string[]
  comparison: string[]
}

export interface ExportPreset {
  id: string
  name: string
  format: ExportFormat
  selection: ExportFieldSelection
  builtin: boolean
  createdAt: string
  updatedAt: string
}

export interface ExportRequest {
  jobId: string
  outputDirectory: string
  format: ExportFormat
  presetId?: string
  selection?: ExportFieldSelection
}

export interface ExportSchema {
  core: string[]
  specifications: string[]
  assets: string[]
  comparison: string[]
}

export interface ProductQuery {
  search?: string
  series?: string
  quality?: QualityStatus | 'all'
  change?: ChangeStatus | 'all'
  sourceMethod?: SourceMethod | 'all'
  hasImage?: boolean | null
  hasDocument?: boolean | null
  hasCad?: boolean | null
  limit?: number
  offset?: number
}

export interface ProductQueryResult {
  products: ProductRecord[]
  total: number
}

export type WorkerCommand =
  | { type: 'analyze'; url: string; headless: boolean }
  | { type: 'start'; analysis: AnalysisResult; options: JobOptions; headless: boolean }
  | { type: 'startBatch'; analyses: AnalysisResult[]; options: JobOptions; headless: boolean; name?: string }
  | { type: 'pause'; jobId: string }
  | { type: 'resume'; jobId: string; headless: boolean }
  | { type: 'cancel'; jobId: string }
  | { type: 'retryFailed'; jobId: string; headless: boolean; includeIncomplete?: boolean }
  | { type: 'listJobs' }
  | { type: 'listBatches' }
  | { type: 'getBatch'; batchId: string }
  | { type: 'pauseBatch'; batchId: string }
  | { type: 'resumeBatch'; batchId: string; headless: boolean }
  | { type: 'cancelBatch'; batchId: string }
  | { type: 'getJob'; jobId: string }
  | { type: 'queryProducts'; query: ProductQuery }
  | { type: 'deleteJob'; jobId: string }
  | { type: 'getExportSchema'; jobId: string }
  | { type: 'listPresets' }
  | { type: 'savePreset'; preset: Omit<ExportPreset, 'createdAt' | 'updatedAt' | 'builtin'> & { builtin?: boolean } }
  | { type: 'deletePreset'; presetId: string }
  | { type: 'export'; request: ExportRequest }
  | { type: 'compare'; jobId: string; previousJobId?: string }
  | { type: 'shutdown' }

export interface WorkerRequest {
  requestId: string
  command: WorkerCommand
}

export interface WorkerResponse {
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

export type WorkerEvent =
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; jobId?: string; at: string }
  | { type: 'job'; job: JobRecord }
  | { type: 'batch'; batch: BatchRecord }
  | { type: 'product'; jobId: string; product: ProductRecord }
  | {
      type: 'discoveryProgress'
      jobId: string
      discovered: number
      expected: number | null
      page: number
    }
  | { type: 'comparison'; jobId: string; summary: ComparisonSummary }

export type WorkerMessage = WorkerResponse | { event: WorkerEvent }
