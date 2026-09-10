import ExcelJS from 'exceljs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportFieldSelection, JobDetail, ProductRecord } from '../shared/types'

const CORE_FIELDS = ['SKU', 'Product Name', 'Description', 'Product URL', 'Status', 'Quality', 'Quality Score', 'Change Status', 'Source Method', 'Scraped At'] as const
const ASSET_FIELDS = ['Image URL', 'Document URLs', 'CAD URLs'] as const
const COMPARISON_FIELDS = ['Changed Fields'] as const

function safeFilePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 100) || 'AVENTICS'
}
function dateStamp(iso: string): string { return new Date(iso).toISOString().slice(0, 10) }
function uniqueSpecificationNames(products: ProductRecord[]): string[] {
  const seen = new Set<string>(); const names: string[] = []
  for (const p of products) for (const name of Object.keys(p.specifications)) if (!seen.has(name)) { seen.add(name); names.push(name) }
  return names
}
function applySheetBasics(sheet: ExcelJS.Worksheet): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (sheet.rowCount > 0) sheet.autoFilter = sheet.dimensions
  const header = sheet.getRow(1); header.font = { bold: true }; header.alignment = { vertical: 'middle' }; header.height = 22
  sheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true } })
}
function fitColumns(sheet: ExcelJS.Worksheet, max = 55): void {
  sheet.columns.forEach((column) => {
    let width = 10
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const raw = cell.value
      const text = typeof raw === 'object' && raw && 'text' in raw ? String((raw as { text?: string }).text ?? '') : String(raw ?? '')
      width = Math.max(width, Math.min(max, text.length + 2))
    })
    column.width = width
  })
}

function coreValue(product: ProductRecord, field: string): string | number {
  switch (field) {
    case 'SKU': return product.sku
    case 'Product Name': return product.name
    case 'Description': return product.description
    case 'Product URL': return product.url
    case 'Status': return product.status
    case 'Quality': return product.quality.status
    case 'Quality Score': return product.quality.score
    case 'Change Status': return product.changeStatus
    case 'Source Method': return product.sourceMethod ?? ''
    case 'Scraped At': return product.scrapedAt ?? ''
    default: return ''
  }
}
function assetValue(product: ProductRecord, field: string): string {
  if (field === 'Image URL') return product.assets.find((a) => a.type === 'image')?.url ?? ''
  if (field === 'Document URLs') return product.assets.filter((a) => a.type === 'document').map((a) => a.url).join('\n')
  if (field === 'CAD URLs') return product.assets.filter((a) => a.type === 'cad').map((a) => a.url).join('\n')
  return ''
}
function changedFields(detail: JobDetail, sku: string): string {
  return (detail.comparison?.changes ?? [])
    .filter((c) => c.sku === sku && ['field_changed', 'asset_added', 'asset_removed'].includes(c.changeType))
    .map((c) => c.field || c.changeType)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('; ')
}

export function defaultExportSelection(detail: JobDetail): ExportFieldSelection {
  return {
    core: [...CORE_FIELDS],
    specifications: uniqueSpecificationNames(detail.products),
    assets: [...ASSET_FIELDS],
    comparison: detail.comparison ? [...COMPARISON_FIELDS] : []
  }
}

export function exportSchema(detail: JobDetail) {
  return { core: [...CORE_FIELDS], specifications: uniqueSpecificationNames(detail.products), assets: [...ASSET_FIELDS], comparison: [...COMPARISON_FIELDS] }
}

export async function exportJobToExcel(detail: JobDetail, outputDirectory: string, appVersion: string, selection?: ExportFieldSelection): Promise<string> {
  await mkdir(outputDirectory, { recursive: true })
  const selected = selection ?? defaultExportSelection(detail)
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'AVENTICS Product Scraper'; workbook.created = new Date(); workbook.modified = new Date()

  const productsSheet = workbook.addWorksheet('Products')
  const headers = [...selected.core, ...selected.specifications, ...selected.assets, ...selected.comparison]
  productsSheet.addRow(headers)
  for (const product of detail.products) {
    const row = productsSheet.addRow([
      ...selected.core.map((f) => coreValue(product, f)),
      ...selected.specifications.map((f) => product.specifications[f] ?? ''),
      ...selected.assets.map((f) => assetValue(product, f)),
      ...selected.comparison.map((f) => f === 'Changed Fields' ? changedFields(detail, product.sku) : '')
    ])
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i]
      const cell = row.getCell(i + 1)
      if ((header === 'Product URL' || header === 'Image URL') && typeof cell.value === 'string' && cell.value.startsWith('http')) {
        cell.value = { text: cell.value, hyperlink: cell.value }
      }
    }
  }
  applySheetBasics(productsSheet); fitColumns(productsSheet)

  const specsSheet = workbook.addWorksheet('Specifications'); specsSheet.addRow(['SKU', 'Specification', 'Value'])
  for (const p of detail.products) for (const [name, value] of Object.entries(p.specifications)) specsSheet.addRow([p.sku, name, value])
  applySheetBasics(specsSheet); fitColumns(specsSheet)

  const assetsSheet = workbook.addWorksheet('Assets'); assetsSheet.addRow(['SKU', 'Type', 'Category', 'Title', 'Format', 'URL', 'Source'])
  for (const p of detail.products) for (const a of p.assets) {
    const row = assetsSheet.addRow([p.sku, a.type, a.category, a.title, a.format, a.url, a.source ?? ''])
    row.getCell(6).value = { text: a.url, hyperlink: a.url }
  }
  applySheetBasics(assetsSheet); fitColumns(assetsSheet)

  const changesSheet = workbook.addWorksheet('Changes'); changesSheet.addRow(['Change Type', 'SKU', 'Field', 'Previous', 'Current'])
  for (const c of detail.comparison?.changes ?? []) changesSheet.addRow([c.changeType, c.sku, c.field, c.previousValue, c.currentValue])
  applySheetBasics(changesSheet); fitColumns(changesSheet)

  const errorsSheet = workbook.addWorksheet('Errors'); errorsSheet.addRow(['Type', 'SKU', 'Product URL', 'Attempts', 'Message'])
  for (const p of detail.products) {
    if (p.status === 'failed') {
      const row = errorsSheet.addRow(['Scrape failure', p.sku, p.url, p.attempts, p.errorMessage ?? 'Unknown error'])
      row.getCell(3).value = { text: p.url, hyperlink: p.url }
    }
    for (const issue of p.quality.issues.filter((i) => i.severity !== 'info')) errorsSheet.addRow([`Quality ${issue.severity}`, p.sku, p.url, p.attempts, issue.message])
  }
  applySheetBasics(errorsSheet); fitColumns(errorsSheet)

  const metadataSheet = workbook.addWorksheet('Metadata'); metadataSheet.addRow(['Field', 'Value'])
  const metadata: Array<[string, string | number]> = [
    ['Series', detail.job.seriesName], ['Series URL', detail.job.sourceUrl], ['Expected products', detail.job.expectedTotal ?? ''],
    ['Discovered products', detail.job.productCount], ['Scraped successfully', detail.job.completedCount], ['Quality complete', Math.max(0, detail.job.completedCount - detail.job.incompleteCount)], ['Incomplete', detail.job.incompleteCount], ['Failed', detail.job.failedCount],
    ['Status', detail.job.status], ['Scrape mode', detail.job.mode], ['HTTP concurrency', detail.job.concurrency], ['Retry attempts', detail.job.retryAttempts],
    ['Images extracted', detail.products.reduce((n,p)=>n+p.assets.filter((a)=>a.type==='image').length,0)],
    ['Documents extracted', detail.products.reduce((n,p)=>n+p.assets.filter((a)=>a.type==='document').length,0)],
    ['CAD links extracted', detail.products.reduce((n,p)=>n+p.assets.filter((a)=>a.type==='cad').length,0)],
    ['Compared to job', detail.job.comparedToJobId ?? ''], ['Added', detail.comparison?.added ?? 0], ['Removed', detail.comparison?.removed ?? 0], ['Changed', detail.comparison?.changed ?? 0],
    ['Started', detail.job.startedAt ?? ''], ['Finished', detail.job.finishedAt ?? ''], ['App version', appVersion], ['Database schema', '2']
  ]
  for (const pair of metadata) metadataSheet.addRow(pair)
  metadataSheet.getCell('B3').value = { text: detail.job.sourceUrl, hyperlink: detail.job.sourceUrl }
  applySheetBasics(metadataSheet); fitColumns(metadataSheet)

  const filename = `${safeFilePart(detail.job.seriesName)}_${dateStamp(detail.job.createdAt)}.xlsx`
  let path = join(outputDirectory, filename)
  try { await workbook.xlsx.writeFile(path) } catch (error) {
    if (error instanceof Error && /EBUSY|EPERM|permission|used by another process/i.test(error.message)) {
      path = join(outputDirectory, `${safeFilePart(detail.job.seriesName)}_${dateStamp(detail.job.createdAt)}_${Date.now()}.xlsx`)
      await workbook.xlsx.writeFile(path)
    } else throw error
  }
  return path
}
