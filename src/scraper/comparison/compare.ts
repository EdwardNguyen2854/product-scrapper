import type { ChangeStatus, ComparisonSummary, ProductChange, ProductRecord } from '../../shared/types'
import type { ScraperDatabase } from '../db'

const norm = (value: string): string => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

function assetSet(product: ProductRecord): Map<string, string> {
  const map = new Map<string, string>()
  for (const asset of product.assets) {
    const key = `${asset.type}:${asset.category}:${norm(asset.title).toLowerCase()}`
    map.set(key, norm(asset.url))
  }
  return map
}

export function compareJobs(db: ScraperDatabase, currentJobId: string, previousJobId?: string): ComparisonSummary {
  const current = db.getJobDetail(currentJobId)
  if (!current) throw new Error('Current job was not found.')
  const previousJob = previousJobId
    ? db.getJob(previousJobId)
    : db.listJobs()
        .filter((job) =>
          job.id !== currentJobId &&
          job.normalizedSourceUrl === current.job.normalizedSourceUrl &&
          job.mode === current.job.mode &&
          ['completed', 'completed_with_errors'].includes(job.status) &&
          job.createdAt < current.job.createdAt
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  if (!previousJob) {
    db.setComparedTo(currentJobId, null)
    return { currentJobId, previousJobId: null, added: 0, removed: 0, changed: 0, unchanged: 0, changes: [] }
  }
  const previous = db.getJobDetail(previousJob.id)
  if (!previous) throw new Error('Previous job was not found.')
  if (previous.job.mode !== current.job.mode) {
    throw new Error(`Cannot compare ${current.job.mode} mode with ${previous.job.mode} mode. Choose a run with the same scrape mode.`)
  }

  const compareDetails = current.job.mode === 'full'
  const currentMap = new Map(current.products.map((p) => [p.sku.toUpperCase(), p]))
  const previousMap = new Map(previous.products.map((p) => [p.sku.toUpperCase(), p]))
  const changes: Array<Omit<ProductChange, 'id' | 'comparisonJobId' | 'previousJobId'>> = []
  const statuses = new Map<string, ChangeStatus>()

  for (const [sku, product] of currentMap) {
    if (!previousMap.has(sku)) {
      statuses.set(product.sku, 'added')
      changes.push({ sku: product.sku, changeType: 'product_added', field: '', previousValue: '', currentValue: product.name })
    }
  }

  for (const [sku, product] of previousMap) {
    if (!currentMap.has(sku)) {
      changes.push({ sku: product.sku, changeType: 'product_removed', field: '', previousValue: product.name, currentValue: '' })
    }
  }

  for (const [sku, currentProduct] of currentMap) {
    const previousProduct = previousMap.get(sku)
    if (!previousProduct) continue

    if (currentProduct.status !== 'success' || previousProduct.status !== 'success') {
      statuses.set(currentProduct.sku, 'not_compared')
      continue
    }

    let changed = false
    if (compareDetails) {
      const specKeys = new Set([...Object.keys(previousProduct.specifications), ...Object.keys(currentProduct.specifications)])
      for (const field of specKeys) {
        const before = norm(previousProduct.specifications[field] ?? '')
        const after = norm(currentProduct.specifications[field] ?? '')
        if (before === after) continue
        changed = true
        changes.push({ sku: currentProduct.sku, changeType: 'field_changed', field, previousValue: before, currentValue: after })
      }

      const beforeAssets = assetSet(previousProduct)
      const afterAssets = assetSet(currentProduct)
      for (const [key, url] of afterAssets) {
        if (!beforeAssets.has(key)) {
          changed = true
          changes.push({ sku: currentProduct.sku, changeType: 'asset_added', field: key, previousValue: '', currentValue: url })
        } else if (beforeAssets.get(key) !== url) {
          changed = true
          changes.push({ sku: currentProduct.sku, changeType: 'asset_removed', field: key, previousValue: beforeAssets.get(key) || '', currentValue: '' })
          changes.push({ sku: currentProduct.sku, changeType: 'asset_added', field: key, previousValue: '', currentValue: url })
        }
      }
      for (const [key, url] of beforeAssets) {
        if (!afterAssets.has(key)) {
          changed = true
          changes.push({ sku: currentProduct.sku, changeType: 'asset_removed', field: key, previousValue: url, currentValue: '' })
        }
      }
    }

    // Listing-only comparison is deliberately inventory-only. A common SKU is
    // unchanged; specification/asset differences are only meaningful in full mode.
    statuses.set(currentProduct.sku, changed ? 'changed' : 'unchanged')
  }

  db.replaceChanges(currentJobId, previousJob.id, changes)
  db.setProductChangeStatuses(currentJobId, statuses)
  db.setComparedTo(currentJobId, previousJob.id)
  const saved = db.getComparison(currentJobId)
  if (!saved) throw new Error('Comparison result could not be loaded after saving.')
  return saved
}
