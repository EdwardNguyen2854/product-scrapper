import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportFieldSelection, JobDetail, ProductRecord } from '../../shared/types'

const esc = (value: unknown): string => {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const line = (values: unknown[]) => values.map(esc).join(',')
const safe = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').slice(0, 100)

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
  if (field === 'Document URLs') return product.assets.filter((a) => a.type === 'document').map((a) => a.url).join('; ')
  if (field === 'CAD URLs') return product.assets.filter((a) => a.type === 'cad').map((a) => a.url).join('; ')
  return ''
}
function changedFields(detail: JobDetail, sku: string): string {
  return (detail.comparison?.changes ?? [])
    .filter((c) => c.sku === sku && ['field_changed', 'asset_added', 'asset_removed'].includes(c.changeType))
    .map((c) => c.field || c.changeType)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('; ')
}

export async function exportJobToCsv(detail: JobDetail, outputDirectory: string, selection: ExportFieldSelection): Promise<string> {
  const folder = join(outputDirectory, `${safe(detail.job.seriesName)}_${detail.job.createdAt.slice(0,10)}_csv`)
  await mkdir(folder, { recursive: true })

  const headers = [...selection.core, ...selection.specifications, ...selection.assets, ...selection.comparison]
  const products = [line(headers)]
  for (const p of detail.products) {
    products.push(line([
      ...selection.core.map((f) => coreValue(p, f)),
      ...selection.specifications.map((f) => p.specifications[f] ?? ''),
      ...selection.assets.map((f) => assetValue(p, f)),
      ...selection.comparison.map((f) => f === 'Changed Fields' ? changedFields(detail, p.sku) : '')
    ]))
  }
  await writeFile(join(folder,'products.csv'),products.join('\r\n'),'utf8')

  const specs=[line(['SKU','Specification','Value'])]
  for(const p of detail.products) for(const [k,v] of Object.entries(p.specifications)) specs.push(line([p.sku,k,v]))
  await writeFile(join(folder,'specifications.csv'),specs.join('\r\n'),'utf8')

  const assets=[line(['SKU','Type','Category','Title','Format','URL','Source'])]
  for(const p of detail.products) for(const a of p.assets) assets.push(line([p.sku,a.type,a.category,a.title,a.format,a.url,a.source??'']))
  await writeFile(join(folder,'assets.csv'),assets.join('\r\n'),'utf8')

  const changes=[line(['Change Type','SKU','Field','Previous','Current'])]
  for(const c of detail.comparison?.changes??[]) changes.push(line([c.changeType,c.sku,c.field,c.previousValue,c.currentValue]))
  await writeFile(join(folder,'changes.csv'),changes.join('\r\n'),'utf8')
  return folder
}
