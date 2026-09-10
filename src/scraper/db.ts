import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AssetRecord,
  BatchRecord,
  BatchStatus,
  ChangeStatus,
  ComparisonSummary,
  ExportPreset,
  JobDetail,
  JobOptions,
  JobRecord,
  JobStatus,
  ProductChange,
  ProductQuery,
  ProductQueryResult,
  ProductRecord,
  ProductSeed,
  ProductStatus,
  QualityResult,
  SourceMethod
} from '../shared/types'

interface JobRow {
  id: string
  batch_id: string | null
  source_url: string
  normalized_source_url: string
  series_name: string
  expected_total: number | null
  status: JobStatus
  mode: 'listing' | 'full'
  concurrency: number
  retry_attempts: number
  timeout_ms: number
  extract_images: number
  extract_documents: number
  extract_cad: number
  run_quality_validation: number
  auto_compare: number
  developer_diagnostics: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  completed_count: number
  failed_count: number
  incomplete_count: number
  output_path: string | null
  error_message: string | null
  compared_to_job_id: string | null
}

interface ProductRow {
  id: number
  job_id: string
  sku: string
  name: string
  description: string
  url: string
  status: ProductStatus
  attempts: number
  source_method: SourceMethod
  error_message: string | null
  scraped_at: string | null
  change_status: ChangeStatus
}

interface SpecRow { product_id: number; name: string; value: string }
interface AssetRow {
  id: number
  product_id: number
  type: AssetRecord['type']
  category: AssetRecord['category']
  title: string
  url: string
  format: string
  source: SourceMethod
  detected_at: string
}
interface QualityRow { product_id: number; status: QualityResult['status']; score: number; issues_json: string; evaluated_at: string | null }
interface BatchRow {
  id: string
  name: string
  status: BatchStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
}
interface ChangeRow {
  id: number
  comparison_job_id: string
  previous_job_id: string | null
  sku: string
  change_type: ProductChange['changeType']
  field: string
  previous_value: string
  current_value: string
}
interface PresetRow {
  id: string
  name: string
  format: ExportPreset['format']
  selection_json: string
  builtin: number
  created_at: string
  updated_at: string
}

const DEFAULT_QUALITY: QualityResult = { status: 'not_evaluated', score: 0, issues: [], evaluatedAt: null }

function normalizedUrl(input: string): string {
  const u = new URL(input)
  u.hash = ''
  u.search = ''
  u.pathname = u.pathname.replace(/\/+$/, '').toLowerCase()
  return u.toString()
}

export class ScraperDatabase {
  private readonly db: Database.Database
  private readonly path: string

  constructor(userDataDirectory: string) {
    mkdirSync(userDataDirectory, { recursive: true })
    this.path = join(userDataDirectory, 'aventics-scraper.db')
    this.db = new Database(this.path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
    this.ensureBuiltinPresets()
  }

  private tableExists(name: string): boolean {
    const row = this.db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as { ok: number } | undefined
    return !!row
  }

  private columns(table: string): Set<string> {
    if (!this.tableExists(table)) return new Set()
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return new Set(rows.map((row) => row.name))
  }

  private addColumn(table: string, name: string, definition: string): void {
    if (!this.columns(table).has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }

  private migrate(): void {
    const version = Number(this.db.pragma('user_version', { simple: true }) || 0)

    if (version === 0 && this.tableExists('jobs') && existsSync(this.path)) {
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        copyFileSync(this.path, `${this.path}.v0.1-backup-${stamp}`)
      } catch {
        // Backup is best effort. Migration itself remains transactional.
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        batch_id TEXT,
        source_url TEXT NOT NULL,
        normalized_source_url TEXT NOT NULL DEFAULT '',
        series_name TEXT NOT NULL,
        expected_total INTEGER,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        concurrency INTEGER NOT NULL,
        retry_attempts INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        extract_images INTEGER NOT NULL DEFAULT 1,
        extract_documents INTEGER NOT NULL DEFAULT 1,
        extract_cad INTEGER NOT NULL DEFAULT 1,
        run_quality_validation INTEGER NOT NULL DEFAULT 1,
        auto_compare INTEGER NOT NULL DEFAULT 1,
        developer_diagnostics INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        completed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        incomplete_count INTEGER NOT NULL DEFAULT 0,
        output_path TEXT,
        error_message TEXT,
        compared_to_job_id TEXT
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        sku TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        source_method TEXT,
        error_message TEXT,
        scraped_at TEXT,
        change_status TEXT NOT NULL DEFAULT 'not_compared',
        UNIQUE(job_id, sku)
      );

      CREATE TABLE IF NOT EXISTS specifications (
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY(product_id, name)
      );

      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT '',
        source TEXT,
        detected_at TEXT NOT NULL,
        UNIQUE(product_id, type, url)
      );

      CREATE TABLE IF NOT EXISTS quality_results (
        product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        score INTEGER NOT NULL,
        issues_json TEXT NOT NULL,
        evaluated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS batch_jobs (
        batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY(batch_id, job_id)
      );

      CREATE TABLE IF NOT EXISTS product_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comparison_job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        previous_job_id TEXT,
        sku TEXT NOT NULL,
        change_type TEXT NOT NULL,
        field TEXT NOT NULL DEFAULT '',
        previous_value TEXT NOT NULL DEFAULT '',
        current_value TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS export_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        format TEXT NOT NULL,
        selection_json TEXT NOT NULL,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_products_job_status ON products(job_id, status);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_specs_product ON specifications(product_id);
      CREATE INDEX IF NOT EXISTS idx_assets_product ON assets(product_id);
      CREATE INDEX IF NOT EXISTS idx_changes_job ON product_changes(comparison_job_id);
    `)

    // Upgrade columns from the v0.1 schema if CREATE TABLE did not add them.
    this.addColumn('jobs', 'batch_id', 'TEXT')
    this.addColumn('jobs', 'normalized_source_url', "TEXT NOT NULL DEFAULT ''")
    this.addColumn('jobs', 'extract_images', 'INTEGER NOT NULL DEFAULT 1')
    this.addColumn('jobs', 'extract_documents', 'INTEGER NOT NULL DEFAULT 1')
    this.addColumn('jobs', 'extract_cad', 'INTEGER NOT NULL DEFAULT 1')
    this.addColumn('jobs', 'run_quality_validation', 'INTEGER NOT NULL DEFAULT 1')
    this.addColumn('jobs', 'auto_compare', 'INTEGER NOT NULL DEFAULT 1')
    this.addColumn('jobs', 'developer_diagnostics', 'INTEGER NOT NULL DEFAULT 0')
    this.addColumn('jobs', 'incomplete_count', 'INTEGER NOT NULL DEFAULT 0')
    this.addColumn('jobs', 'compared_to_job_id', 'TEXT')
    this.addColumn('products', 'change_status', "TEXT NOT NULL DEFAULT 'not_compared'")

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_products_change ON products(change_status);
      CREATE INDEX IF NOT EXISTS idx_jobs_source_created ON jobs(normalized_source_url, created_at DESC);
    `)

    this.db.prepare("UPDATE jobs SET normalized_source_url = source_url WHERE normalized_source_url = '' OR normalized_source_url IS NULL").run()
    const rows = this.db.prepare('SELECT id, source_url FROM jobs').all() as Array<{ id: string; source_url: string }>
    const update = this.db.prepare('UPDATE jobs SET normalized_source_url=? WHERE id=?')
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        try { update.run(normalizedUrl(row.source_url), row.id) } catch { update.run(row.source_url, row.id) }
      }
    })
    tx()
    this.db.pragma('user_version = 2')
  }

  private ensureBuiltinPresets(): void {
    const now = new Date().toISOString()
    const defaults: ExportPreset[] = [
      { id: 'builtin-full', name: 'Full Export', format: 'xlsx', builtin: true, createdAt: now, updatedAt: now, selection: { core: ['SKU','Product Name','Description','Product URL','Status','Quality','Change Status'], specifications: ['*'], assets: ['Image URL','Document URLs','CAD URLs'], comparison: ['Changed Fields'] } },
      { id: 'builtin-overview', name: 'Product Overview', format: 'xlsx', builtin: true, createdAt: now, updatedAt: now, selection: { core: ['SKU','Product Name','Product URL','Quality','Change Status'], specifications: [], assets: ['Image URL'], comparison: [] } },
      { id: 'builtin-cad', name: 'CAD Overview', format: 'xlsx', builtin: true, createdAt: now, updatedAt: now, selection: { core: ['SKU','Product Name','Product URL'], specifications: [], assets: ['Document URLs','CAD URLs'], comparison: [] } },
      { id: 'builtin-changes', name: 'Changes', format: 'xlsx', builtin: true, createdAt: now, updatedAt: now, selection: { core: ['SKU','Product Name','Change Status'], specifications: [], assets: [], comparison: ['Changed Fields'] } }
    ]
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO export_presets (id,name,format,selection_json,builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    const tx = this.db.transaction(() => defaults.forEach((p) => stmt.run(p.id,p.name,p.format,JSON.stringify(p.selection),1,p.createdAt,p.updatedAt)))
    tx()
  }

  markInterruptedJobs(): void {
    this.db.prepare(`UPDATE jobs SET status='interrupted' WHERE status IN ('discovering','scraping','validating','comparing','analyzing')`).run()
    this.db.prepare(`UPDATE products SET status='pending' WHERE status='running'`).run()
    this.db.prepare(`UPDATE batches SET status='paused' WHERE status='running'`).run()
  }

  createBatch(id: string, name: string): BatchRecord {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO batches(id,name,status,created_at,started_at) VALUES(?,?,'pending',?,?)`).run(id,name,now,now)
    return this.getBatch(id)!
  }

  attachJobToBatch(batchId: string, jobId: string, position: number): void {
    this.db.prepare('INSERT OR REPLACE INTO batch_jobs(batch_id,job_id,position) VALUES(?,?,?)').run(batchId,jobId,position)
    this.db.prepare('UPDATE jobs SET batch_id=? WHERE id=?').run(batchId,jobId)
  }

  setBatchStatus(batchId: string, status: BatchStatus): BatchRecord {
    const terminal = ['completed','completed_with_errors','cancelled'].includes(status)
    this.db.prepare(`UPDATE batches SET status=?, finished_at=CASE WHEN ? THEN ? ELSE finished_at END WHERE id=?`).run(status,terminal?1:0,terminal?new Date().toISOString():null,batchId)
    return this.getBatch(batchId)!
  }

  getBatch(batchId: string): BatchRecord | null {
    const row = this.db.prepare('SELECT * FROM batches WHERE id=?').get(batchId) as BatchRow | undefined
    return row ? this.mapBatch(row) : null
  }

  listBatches(): BatchRecord[] {
    return (this.db.prepare('SELECT * FROM batches ORDER BY created_at DESC').all() as BatchRow[]).map((r)=>this.mapBatch(r))
  }

  listBatchJobs(batchId: string): JobRecord[] {
    const rows = this.db.prepare(`SELECT j.* FROM jobs j JOIN batch_jobs bj ON bj.job_id=j.id WHERE bj.batch_id=? ORDER BY bj.position`).all(batchId) as JobRow[]
    return rows.map((r)=>this.mapJob(r))
  }

  createJob(id: string, sourceUrl: string, seriesName: string, expectedTotal: number | null, options: JobOptions, batchId: string | null = null): JobRecord {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO jobs (
        id,batch_id,source_url,normalized_source_url,series_name,expected_total,status,mode,concurrency,retry_attempts,timeout_ms,
        extract_images,extract_documents,extract_cad,run_quality_validation,auto_compare,developer_diagnostics,created_at,started_at
      ) VALUES (?,?,?,?,?,?,'ready',?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,batchId,sourceUrl,normalizedUrl(sourceUrl),seriesName,expectedTotal,options.mode,options.concurrency,options.retryAttempts,options.timeoutMs,
      options.extractImages?1:0,options.extractDocuments?1:0,options.extractCad?1:0,options.runQualityValidation?1:0,options.autoCompare?1:0,options.developerDiagnostics?1:0,now,now
    )
    return this.getJob(id)!
  }

  setJobStatus(jobId: string, status: JobStatus, errorMessage: string | null = null): JobRecord {
    const terminal = ['completed','completed_with_errors','cancelled','failed'].includes(status)
    this.db.prepare(`UPDATE jobs SET status=?, error_message=?, finished_at=CASE WHEN ? THEN ? ELSE finished_at END WHERE id=?`).run(status,errorMessage,terminal?1:0,terminal?new Date().toISOString():null,jobId)
    this.recomputeCounts(jobId)
    return this.getJob(jobId)!
  }

  setComparedTo(jobId: string, previousJobId: string | null): void {
    this.db.prepare('UPDATE jobs SET compared_to_job_id=? WHERE id=?').run(previousJobId,jobId)
  }

  setOutputPath(jobId: string, outputPath: string): JobRecord {
    this.db.prepare('UPDATE jobs SET output_path=? WHERE id=?').run(outputPath,jobId)
    return this.getJob(jobId)!
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId) as JobRow | undefined
    return row ? this.mapJob(row) : null
  }

  listJobs(): JobRecord[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRow[]).map((r)=>this.mapJob(r))
  }

  deleteJob(jobId: string): void { this.db.prepare('DELETE FROM jobs WHERE id=?').run(jobId) }

  previousComparableJob(jobId: string): JobRecord | null {
    const current = this.getJob(jobId)
    if (!current) return null
    const row = this.db.prepare(`
      SELECT * FROM jobs WHERE id<>? AND normalized_source_url=? AND status IN ('completed','completed_with_errors') AND created_at<?
      ORDER BY created_at DESC LIMIT 1
    `).get(jobId,current.normalizedSourceUrl,current.createdAt) as JobRow | undefined
    return row ? this.mapJob(row) : null
  }

  upsertProduct(jobId: string, seed: ProductSeed): ProductRecord {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO products(job_id,sku,name,url,status,source_method) VALUES(?,?,?,?,'pending','listing')
        ON CONFLICT(job_id,sku) DO UPDATE SET name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE products.name END,url=excluded.url
      `).run(jobId,seed.sku,seed.name||'',seed.url)
      const row = this.db.prepare('SELECT id FROM products WHERE job_id=? AND sku=?').get(jobId,seed.sku) as {id:number}
      if (seed.specifications && Object.keys(seed.specifications).length) this.replaceSpecs(row.id,seed.specifications)
    })
    tx()
    return this.getProductBySku(jobId,seed.sku)!
  }

  getProductBySku(jobId: string, sku: string): ProductRecord | null {
    const row = this.db.prepare('SELECT * FROM products WHERE job_id=? AND sku=?').get(jobId,sku) as ProductRow | undefined
    return row ? this.hydrateProducts([row])[0] : null
  }

  getProductById(productId: number): ProductRecord | null {
    const row = this.db.prepare('SELECT * FROM products WHERE id=?').get(productId) as ProductRow | undefined
    return row ? this.hydrateProducts([row])[0] : null
  }

  listProducts(jobId: string): ProductRecord[] {
    const rows = this.db.prepare('SELECT * FROM products WHERE job_id=? ORDER BY id').all(jobId) as ProductRow[]
    return this.hydrateProducts(rows)
  }

  listProductsByStatus(jobId: string, statuses: ProductStatus[]): ProductRecord[] {
    if (!statuses.length) return []
    const placeholders = statuses.map(()=>'?').join(',')
    const rows = this.db.prepare(`SELECT * FROM products WHERE job_id=? AND status IN (${placeholders}) ORDER BY id`).all(jobId,...statuses) as ProductRow[]
    return this.hydrateProducts(rows)
  }

  listIncompleteProductIds(jobId: string): number[] {
    const rows = this.db.prepare(`SELECT p.id FROM products p JOIN quality_results q ON q.product_id=p.id WHERE p.job_id=? AND q.status='incomplete'`).all(jobId) as Array<{id:number}>
    return rows.map((r)=>r.id)
  }

  resetProducts(productIds: number[]): void {
    if (!productIds.length) return
    const placeholders = productIds.map(()=>'?').join(',')
    this.db.prepare(`UPDATE products SET status='pending',error_message=NULL WHERE id IN (${placeholders})`).run(...productIds)
  }

  countProducts(jobId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM products WHERE job_id=?').get(jobId) as {count:number}).count
  }

  markListingProductsSuccess(jobId: string): void {
    this.db.prepare(`UPDATE products SET status='success',source_method='listing',scraped_at=?,error_message=NULL WHERE job_id=?`).run(new Date().toISOString(),jobId)
    this.recomputeCounts(jobId)
  }

  beginProductAttempt(productId: number): ProductRecord {
    this.db.prepare(`UPDATE products SET status='running',attempts=attempts+1,error_message=NULL WHERE id=?`).run(productId)
    return this.getProductById(productId)!
  }

  saveProductSuccess(productId: number, data: {name:string;description:string;specifications:Record<string,string>;assets:Array<Omit<AssetRecord,'id'|'productId'|'detectedAt'>>}, sourceMethod: Exclude<SourceMethod,null>): ProductRecord {
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE products SET name=?,description=?,status='success',source_method=?,error_message=NULL,scraped_at=? WHERE id=?`).run(data.name,data.description,sourceMethod,new Date().toISOString(),productId)
      this.replaceSpecs(productId,data.specifications)
      this.replaceAssets(productId,data.assets,sourceMethod)
    })
    tx()
    const product = this.getProductById(productId)!
    this.recomputeCounts(product.jobId)
    return product
  }

  saveProductFailure(productId: number, errorMessage: string): ProductRecord {
    this.db.prepare(`UPDATE products SET status='failed',error_message=? WHERE id=?`).run(errorMessage,productId)
    this.saveQuality(productId,{status:'failed',score:0,issues:[{code:'SCRAPE_FAILED',severity:'error',message:errorMessage}],evaluatedAt:new Date().toISOString()})
    const product = this.getProductById(productId)!
    this.recomputeCounts(product.jobId)
    return product
  }

  resetFailed(jobId: string): void {
    this.db.prepare(`UPDATE products SET status='pending',error_message=NULL WHERE job_id=? AND status IN ('failed','cancelled')`).run(jobId)
    this.recomputeCounts(jobId)
  }

  saveQuality(productId: number, result: QualityResult): void {
    this.db.prepare(`
      INSERT INTO quality_results(product_id,status,score,issues_json,evaluated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET status=excluded.status,score=excluded.score,issues_json=excluded.issues_json,evaluated_at=excluded.evaluated_at
    `).run(productId,result.status,result.score,JSON.stringify(result.issues),result.evaluatedAt)
    const product = this.getProductById(productId)
    if (product) this.recomputeCounts(product.jobId)
  }

  replaceChanges(jobId: string, previousJobId: string | null, changes: Array<Omit<ProductChange,'id'|'comparisonJobId'|'previousJobId'>>): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM product_changes WHERE comparison_job_id=?').run(jobId)
      this.db.prepare(`UPDATE products SET change_status='not_compared' WHERE job_id=?`).run(jobId)
      const ins = this.db.prepare(`INSERT INTO product_changes(comparison_job_id,previous_job_id,sku,change_type,field,previous_value,current_value) VALUES(?,?,?,?,?,?,?)`)
      for (const c of changes) ins.run(jobId,previousJobId,c.sku,c.changeType,c.field,c.previousValue,c.currentValue)
    })
    tx()
  }

  setProductChangeStatuses(jobId: string, statuses: Map<string, ChangeStatus>): void {
    const stmt = this.db.prepare('UPDATE products SET change_status=? WHERE job_id=? AND sku=?')
    const tx = this.db.transaction(() => { for (const [sku,status] of statuses) stmt.run(status,jobId,sku) })
    tx()
  }

  getComparison(jobId: string): ComparisonSummary | null {
    const job = this.getJob(jobId)
    if (!job || !job.comparedToJobId) return null
    const changes = (this.db.prepare('SELECT * FROM product_changes WHERE comparison_job_id=? ORDER BY id').all(jobId) as ChangeRow[]).map((r)=>this.mapChange(r))
    const products = this.listProducts(jobId)
    return {
      currentJobId: jobId,
      previousJobId: job.comparedToJobId,
      added: products.filter((p)=>p.changeStatus==='added').length,
      removed: changes.filter((c)=>c.changeType==='product_removed').length,
      changed: products.filter((p)=>p.changeStatus==='changed').length,
      unchanged: products.filter((p)=>p.changeStatus==='unchanged').length,
      changes
    }
  }

  getJobDetail(jobId: string): JobDetail | null {
    const job = this.getJob(jobId)
    return job ? {job,products:this.listProducts(jobId),comparison:this.getComparison(jobId)} : null
  }

  queryProducts(query: ProductQuery): ProductQueryResult {
    const where: string[] = []
    const args: unknown[] = []
    if (query.search?.trim()) { where.push('(p.sku LIKE ? OR p.name LIKE ? OR p.description LIKE ?)'); const q=`%${query.search.trim()}%`; args.push(q,q,q) }
    if (query.series?.trim()) { where.push('j.series_name=?'); args.push(query.series.trim()) }
    if (query.quality && query.quality!=='all') { where.push("COALESCE(q.status,'not_evaluated')=?"); args.push(query.quality) }
    if (query.change && query.change!=='all') { where.push('p.change_status=?'); args.push(query.change) }
    if (query.sourceMethod && query.sourceMethod!=='all') { where.push('p.source_method=?'); args.push(query.sourceMethod) }
    if (query.hasImage != null) where.push(`${query.hasImage?'':'NOT '}EXISTS(SELECT 1 FROM assets ai WHERE ai.product_id=p.id AND ai.type='image')`)
    if (query.hasDocument != null) where.push(`${query.hasDocument?'':'NOT '}EXISTS(SELECT 1 FROM assets ad WHERE ad.product_id=p.id AND ad.type='document')`)
    if (query.hasCad != null) where.push(`${query.hasCad?'':'NOT '}EXISTS(SELECT 1 FROM assets ac WHERE ac.product_id=p.id AND ac.type='cad')`)
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM products p JOIN jobs j ON j.id=p.job_id LEFT JOIN quality_results q ON q.product_id=p.id ${clause}`).get(...args) as {count:number}).count
    const limit = Math.min(2000,Math.max(1,query.limit??500)); const offset=Math.max(0,query.offset??0)
    const rows = this.db.prepare(`SELECT p.* FROM products p JOIN jobs j ON j.id=p.job_id LEFT JOIN quality_results q ON q.product_id=p.id ${clause} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...args,limit,offset) as ProductRow[]
    return {products:this.hydrateProducts(rows),total}
  }

  listPresets(): ExportPreset[] {
    return (this.db.prepare('SELECT * FROM export_presets ORDER BY builtin DESC,name').all() as PresetRow[]).map((r)=>this.mapPreset(r))
  }

  getPreset(id: string): ExportPreset | null {
    const row=this.db.prepare('SELECT * FROM export_presets WHERE id=?').get(id) as PresetRow|undefined
    return row?this.mapPreset(row):null
  }

  savePreset(preset: Omit<ExportPreset,'createdAt'|'updatedAt'|'builtin'> & {builtin?:boolean}): ExportPreset {
    const existing=this.getPreset(preset.id); if(existing?.builtin) throw new Error('Built-in presets cannot be overwritten.')
    const now=new Date().toISOString(); const created=existing?.createdAt??now
    this.db.prepare(`INSERT INTO export_presets(id,name,format,selection_json,builtin,created_at,updated_at) VALUES(?,?,?,?,0,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,format=excluded.format,selection_json=excluded.selection_json,updated_at=excluded.updated_at`).run(preset.id,preset.name,preset.format,JSON.stringify(preset.selection),created,now)
    return this.getPreset(preset.id)!
  }

  deletePreset(id:string):void { const p=this.getPreset(id); if(!p) return; if(p.builtin) throw new Error('Built-in presets cannot be deleted.'); this.db.prepare('DELETE FROM export_presets WHERE id=?').run(id) }

  private replaceSpecs(productId:number,specs:Record<string,string>):void {
    this.db.prepare('DELETE FROM specifications WHERE product_id=?').run(productId)
    const stmt=this.db.prepare('INSERT INTO specifications(product_id,name,value) VALUES(?,?,?)')
    for(const [name,value] of Object.entries(specs)) stmt.run(productId,name,value)
  }

  private replaceAssets(productId:number,assets:Array<Omit<AssetRecord,'id'|'productId'|'detectedAt'>>,sourceMethod:SourceMethod):void {
    this.db.prepare('DELETE FROM assets WHERE product_id=?').run(productId)
    const stmt=this.db.prepare(`INSERT OR IGNORE INTO assets(product_id,type,category,title,url,format,source,detected_at) VALUES(?,?,?,?,?,?,?,?)`)
    const now=new Date().toISOString()
    for(const a of assets) stmt.run(productId,a.type,a.category,a.title||'',a.url,a.format||'',a.source??sourceMethod,now)
  }

  private recomputeCounts(jobId:string):void {
    const c=this.db.prepare(`SELECT COUNT(*) product_count,SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) completed_count,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_count FROM products WHERE job_id=?`).get(jobId) as {product_count:number;completed_count:number|null;failed_count:number|null}
    const q=this.db.prepare(`SELECT COUNT(*) AS incomplete_count FROM quality_results q JOIN products p ON p.id=q.product_id WHERE p.job_id=? AND q.status='incomplete'`).get(jobId) as {incomplete_count:number}
    this.db.prepare(`UPDATE jobs SET completed_count=?,failed_count=?,incomplete_count=? WHERE id=?`).run(c.completed_count??0,c.failed_count??0,q.incomplete_count??0,jobId)
  }

  private hydrateProducts(rows:ProductRow[]):ProductRecord[] {
    if(!rows.length) return []
    const ids=rows.map((r)=>r.id); const ph=ids.map(()=>'?').join(',')
    const specs=this.db.prepare(`SELECT product_id,name,value FROM specifications WHERE product_id IN (${ph}) ORDER BY rowid`).all(...ids) as SpecRow[]
    const assets=this.db.prepare(`SELECT * FROM assets WHERE product_id IN (${ph}) ORDER BY id`).all(...ids) as AssetRow[]
    const qualities=this.db.prepare(`SELECT * FROM quality_results WHERE product_id IN (${ph})`).all(...ids) as QualityRow[]
    const specMap=new Map<number,Record<string,string>>(); for(const s of specs){const x=specMap.get(s.product_id)??{};x[s.name]=s.value;specMap.set(s.product_id,x)}
    const assetMap=new Map<number,AssetRecord[]>(); for(const a of assets){const x=assetMap.get(a.product_id)??[];x.push(this.mapAsset(a));assetMap.set(a.product_id,x)}
    const qualityMap=new Map<number,QualityResult>(); for(const q of qualities) qualityMap.set(q.product_id,this.mapQuality(q))
    return rows.map((r)=>this.mapProduct(r,specMap.get(r.id)??{},assetMap.get(r.id)??[],qualityMap.get(r.id)??DEFAULT_QUALITY))
  }

  private mapJob(r:JobRow):JobRecord {
    const productCount=(this.db.prepare('SELECT COUNT(*) AS count FROM products WHERE job_id=?').get(r.id) as {count:number}).count
    return {id:r.id,batchId:r.batch_id??null,sourceUrl:r.source_url,normalizedSourceUrl:r.normalized_source_url||r.source_url,seriesName:r.series_name,expectedTotal:r.expected_total,status:r.status,mode:r.mode,concurrency:r.concurrency,retryAttempts:r.retry_attempts,timeoutMs:r.timeout_ms,extractImages:!!r.extract_images,extractDocuments:!!r.extract_documents,extractCad:!!r.extract_cad,runQualityValidation:!!r.run_quality_validation,autoCompare:!!r.auto_compare,developerDiagnostics:!!r.developer_diagnostics,createdAt:r.created_at,startedAt:r.started_at,finishedAt:r.finished_at,completedCount:r.completed_count??0,failedCount:r.failed_count??0,incompleteCount:r.incomplete_count??0,productCount,outputPath:r.output_path,errorMessage:r.error_message,comparedToJobId:r.compared_to_job_id??null}
  }

  private mapProduct(r:ProductRow,specifications:Record<string,string>={},assets:AssetRecord[]=[],quality:QualityResult=DEFAULT_QUALITY):ProductRecord {
    return {id:r.id,jobId:r.job_id,sku:r.sku,name:r.name,description:r.description,url:r.url,status:r.status,attempts:r.attempts,sourceMethod:r.source_method,errorMessage:r.error_message,scrapedAt:r.scraped_at,specifications,assets,quality,changeStatus:r.change_status??'not_compared'}
  }

  private mapAsset(r:AssetRow):AssetRecord { return {id:r.id,productId:r.product_id,type:r.type,category:r.category,title:r.title,url:r.url,format:r.format,source:r.source,detectedAt:r.detected_at} }
  private mapQuality(r:QualityRow):QualityResult { let issues=[] as QualityResult['issues']; try{issues=JSON.parse(r.issues_json)}catch{} return {status:r.status,score:r.score,issues,evaluatedAt:r.evaluated_at} }
  private mapChange(r:ChangeRow):ProductChange { return {id:r.id,comparisonJobId:r.comparison_job_id,previousJobId:r.previous_job_id,sku:r.sku,changeType:r.change_type,field:r.field,previousValue:r.previous_value,currentValue:r.current_value} }
  private mapPreset(r:PresetRow):ExportPreset { return {id:r.id,name:r.name,format:r.format,selection:JSON.parse(r.selection_json),builtin:!!r.builtin,createdAt:r.created_at,updatedAt:r.updated_at} }

  private mapBatch(r:BatchRow):BatchRecord {
    const jobs=this.listBatchJobsRaw(r.id)
    const totalProducts=jobs.reduce((n,j)=>n+(j.expected_total??this.countProducts(j.id)),0)
    const completedProducts=jobs.reduce((n,j)=>n+(j.completed_count??0)+(j.failed_count??0),0)
    return {id:r.id,name:r.name,status:r.status,createdAt:r.created_at,startedAt:r.started_at,finishedAt:r.finished_at,jobCount:jobs.length,completedJobs:jobs.filter((j)=>['completed','completed_with_errors'].includes(j.status)).length,failedJobs:jobs.filter((j)=>j.status==='failed').length,totalProducts,completedProducts}
  }

  private listBatchJobsRaw(batchId:string):JobRow[] { return this.db.prepare(`SELECT j.* FROM jobs j JOIN batch_jobs bj ON bj.job_id=j.id WHERE bj.batch_id=? ORDER BY bj.position`).all(batchId) as JobRow[] }

  close():void { this.db.close() }
}
