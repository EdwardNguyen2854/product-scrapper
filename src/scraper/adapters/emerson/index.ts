import type { AnalysisResult, ProductSeed } from '../../../shared/types'
import type { BrowserSession } from '../../browser'
import type { JobController } from '../../control'
import { analyzeSeries, discoverProducts } from '../../discovery'
import { parseProductHtml, type ParsedProductPage } from '../../parser'

export interface SiteAdapter {
  supportsUrl(url: string): boolean
  analyzeSeries(url: string, headless: boolean): Promise<AnalysisResult>
  discoverProducts(
    sourceUrl: string,
    expectedTotal: number | null,
    browser: BrowserSession,
    controller: JobController,
    onPage: (products: ProductSeed[], pageNo: number) => Promise<void>,
    onDiagnostic?: (message: string) => void
  ): Promise<ProductSeed[]>
  parseProduct(html: string, url: string, skuHint?: string): ParsedProductPage
}

export const EmersonAdapter: SiteAdapter = {
  supportsUrl(url: string) {
    try { return new URL(url).hostname.toLowerCase() === 'discreteautomation.emerson.com' } catch { return false }
  },
  analyzeSeries,
  discoverProducts,
  parseProduct: parseProductHtml
}
