import type { ProductRecord, QualityIssue, QualityResult, ScrapeMode } from '../../shared/types'

export function evaluateProductQuality(product: ProductRecord, mode: ScrapeMode = 'full'): QualityResult {
  if (product.status === 'failed') {
    return {
      status: 'failed',
      score: 0,
      issues: [{ code: 'SCRAPE_FAILED', severity: 'error', message: product.errorMessage || 'Product scrape failed.' }],
      evaluatedAt: new Date().toISOString()
    }
  }

  const issues: QualityIssue[] = []
  let score = 100
  const warn = (code: string, message: string, penalty: number) => { issues.push({ code, severity: 'warning', message }); score -= penalty }
  const info = (code: string, message: string) => issues.push({ code, severity: 'info', message })
  const error = (code: string, message: string, penalty: number) => { issues.push({ code, severity: 'error', message }); score -= penalty }

  if (!product.sku.trim()) error('MISSING_SKU', 'SKU is missing.', 50)
  if (!product.url.trim()) error('MISSING_URL', 'Product URL is missing.', 40)
  if (!product.name.trim()) warn('MISSING_NAME', 'Product name is missing.', 25)

  const specCount = Object.keys(product.specifications).length
  if (mode === 'full') {
    if (specCount === 0) error('NO_SPECIFICATIONS', 'No specifications were extracted.', 50)
    else if (specCount < 3) warn('LOW_SPEC_COUNT', `Only ${specCount} specification(s) were extracted.`, 20)
    else if (specCount < 6) warn('LOW_SPEC_COUNT', `Only ${specCount} specifications were extracted; review this product.`, 10)
  }

  // Listing mode intentionally validates only fields that discovery is expected
  // to provide. Detail-only fields remain informational and do not make a
  // listing-only run incomplete.
  if (mode === 'full' && !product.description.trim()) info('NO_DESCRIPTION', 'No separate product description was found.')
  if (mode === 'full' && !product.assets.some((a) => a.type === 'image')) info('NO_IMAGE', 'No product image link was detected.')
  if (mode === 'full' && !product.assets.some((a) => a.type === 'document')) info('NO_DOCUMENT', 'No document link was detected.')
  if (mode === 'full' && !product.assets.some((a) => a.type === 'cad')) info('NO_CAD', 'No CAD link was detected.')

  score = Math.max(0, Math.min(100, score))
  const status: QualityResult['status'] = issues.some((i) => i.severity === 'error' || i.severity === 'warning') ? 'incomplete' : 'complete'
  return { status, score, issues, evaluatedAt: new Date().toISOString() }
}
