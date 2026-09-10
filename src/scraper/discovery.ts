import type { Frame, Locator, Page, Response } from 'playwright-core'
import type { AnalysisResult, ProductSeed } from '../shared/types'
import { BrowserSession, gotoStable } from './browser'
import { JobController } from './control'

const normalizeText = (value: string): string => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

export interface ProductRange {
  start: number
  end: number
  total: number
}

/** Parses labels such as "1 - 10 of 560 results for products". */
export function parseProductRangeText(text: string): ProductRange | null {
  const clean = normalizeText(text)
  const match = clean.match(/\b([\d,]+)\s*[-–—]\s*([\d,]+)\s+of\s+([\d,]+)\s+results?\s+for\s+products\b/i)
  if (!match) return null
  const start = Number(match[1].replace(/,/g, ''))
  const end = Number(match[2].replace(/,/g, ''))
  const total = Number(match[3].replace(/,/g, ''))
  if (![start, end, total].every(Number.isFinite) || start < 1 || end < start || total < end) return null
  return { start, end, total }
}

export function pageCountForRange(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || total <= 0 || pageSize <= 0) return 0
  return Math.ceil(total / pageSize)
}

export function pageNumberForRange(range: ProductRange | null): number | null {
  if (!range) return null
  const pageSize = Math.max(1, range.end - range.start + 1)
  return Math.floor((range.start - 1) / pageSize) + 1
}

function parseTotal(text: string): number | null {
  const range = parseProductRangeText(text)
  if (range) return range.total

  const patterns = [
    /\bof\s+([\d,]+)\s+results?\s+for\s+products\b/i,
    /\b([\d,]+)\s+results?\s+for\s+products\b/i
  ]
  for (const pattern of patterns) {
    const match = normalizeText(text).match(pattern)
    if (match) return Number(match[1].replace(/,/g, ''))
  }
  return null
}

export async function analyzeSeries(url: string, headless: boolean): Promise<AnalysisResult> {
  const browser = new BrowserSession(headless)
  const warnings: string[] = []
  try {
    const page = await browser.newPage()
    await gotoStable(page, url)
    const h1 = normalizeText(await page.locator('h1').first().textContent().catch(() => '') || '')
    const bodyText = normalizeText(await page.locator('body').innerText())
    const totalProducts = parseTotal(bodyText)
    if (totalProducts == null) warnings.push('Product count could not be detected during analysis; discovery will continue until pagination ends.')
    if (!h1) warnings.push('Series title could not be read from the H1 heading.')
    await page.close()

    return {
      url,
      seriesName: h1 || new URL(url).pathname.split('/').filter(Boolean).pop() || 'AVENTICS Series',
      totalProducts,
      supported: new URL(url).hostname.toLowerCase() === 'discreteautomation.emerson.com',
      warnings
    }
  } finally {
    await browser.close()
  }
}

interface PageProduct extends ProductSeed {
  specifications: Record<string, string>
}

async function extractCurrentPageProducts(page: Page): Promise<PageProduct[]> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined) => (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    const absolute = (href: string) => new URL(href, location.href).toString()
    const skuRegex = /\b(?:R\d{8,}|\d{10})\b/i
    const results = new Map<string, PageProduct>()

    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || ''
      if (!href.includes('/product/')) continue

      const slugSku = href.match(/aventics-sku-([^/?#]+)/i)?.[1]
      const textSku = clean(anchor.textContent).match(skuRegex)?.[0]
      const sku = decodeURIComponent(slugSku || textSku || '').toUpperCase()
      if (!sku || !skuRegex.test(sku)) continue

      let container: Element | null = anchor
      for (let i = 0; i < 8 && container?.parentElement; i += 1) {
        const parent = container.parentElement
        const parentText = clean(parent.textContent)
        const distinctSkus = new Set((parentText.match(/\b(?:R\d{8,}|\d{10})\b/gi) || []).map((value) => value.toUpperCase()))
        if (parentText.includes(sku) && parentText.length > 25 && distinctSkus.size <= 1) container = parent
        else break
      }

      const headings = container
        ? Array.from(container.querySelectorAll<HTMLElement>('h2,h3,h4,h5,a')).map((el) => clean(el.textContent))
        : []
      const name = headings.find((value) => value && value !== sku && value.toUpperCase() !== sku) || ''
      const specifications: Record<string, string> = {}

      if (container) {
        for (const row of Array.from(container.querySelectorAll('tr'))) {
          const cells = Array.from(row.querySelectorAll('th,td')).map((cell) => clean(cell.textContent))
          if (cells.length >= 2 && cells[0] && cells[1]) specifications[cells[0]] = cells.slice(1).join(' ')
        }
        for (const dl of Array.from(container.querySelectorAll('dl'))) {
          for (const dt of Array.from(dl.querySelectorAll('dt'))) {
            const dd = dt.nextElementSibling
            if (dd?.tagName.toLowerCase() === 'dd') {
              const key = clean(dt.textContent)
              const value = clean(dd.textContent)
              if (key && value) specifications[key] = value
            }
          }
        }
      }

      results.set(sku, { sku, name, url: absolute(href), specifications })
    }
    return Array.from(results.values())
  })
}

async function readProductRange(page: Page): Promise<ProductRange | null> {
  const text = await page.locator('body').innerText().catch(() => '')
  return parseProductRangeText(text)
}

async function currentPageNumber(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const visible = (el: HTMLElement) => {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0
    }
    const numeric = (value: string | null | undefined) => {
      const n = Number((value || '').trim())
      return Number.isFinite(n) && n > 0 ? n : null
    }

    const current = document.querySelector<HTMLElement>('[aria-current="page"]')
    if (current && visible(current)) {
      const direct = numeric(current.textContent)
      if (direct != null) return direct
    }

    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button,a,[role="button"],[role="link"],li,span'))
    for (const el of candidates) {
      if (!visible(el)) continue
      const cls = `${el.className || ''}`
      const selected = el.getAttribute('aria-selected') === 'true' || el.getAttribute('data-selected') === 'true' || /(?:^|[-_\s])(active|current|selected)(?:$|[-_\s])/i.test(cls)
      const value = numeric(el.textContent)
      if (selected && value != null) return value
    }
    return null
  })
}

interface PaginationSnapshot {
  signature: string
  range: ProductRange | null
  pageNumber: number | null
}

async function paginationSnapshot(page: Page): Promise<PaginationSnapshot> {
  const [products, range, selectedPage] = await Promise.all([
    extractCurrentPageProducts(page),
    readProductRange(page),
    currentPageNumber(page)
  ])
  return {
    signature: products.map((item) => item.sku).slice(0, 5).join('|'),
    range,
    pageNumber: pageNumberForRange(range) ?? selectedPage
  }
}

function rangeChanged(before: ProductRange | null, after: ProductRange | null): boolean {
  if (!before || !after) return false
  return before.start !== after.start || before.end !== after.end || before.total !== after.total
}

async function waitForPageAdvance(page: Page, before: PaginationSnapshot, desiredPage: number, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  await page.waitForLoadState('domcontentloaded', { timeout: 2500 }).catch(() => undefined)

  while (Date.now() < deadline) {
    await page.waitForTimeout(250)
    const after = await paginationSnapshot(page)
    if (rangeChanged(before.range, after.range)) return true
    if (after.pageNumber === desiredPage && after.pageNumber !== before.pageNumber) return true
    if (after.signature && before.signature && after.signature !== before.signature) return true
  }
  return false
}

interface RequestTrace {
  method: string
  url: string
  resourceType: string
  postData: string | null
  headers: Record<string, string>
  responseText?: string
  status?: number
  contentType?: string
}

class NetworkProbe {
  private readonly records: RequestTrace[] = []
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly page: Page) {
    page.on('response', (response) => this.capture(response))
  }

  private capture(response: Response): void {
    const request = response.request()
    const resourceType = request.resourceType()
    if (!['xhr', 'fetch'].includes(resourceType)) return

    const task = (async () => {
      const headers = await request.allHeaders().catch(() => ({} as Record<string, string>))
      const responseHeaders = await response.allHeaders().catch(() => ({} as Record<string, string>))
      const contentType = responseHeaders['content-type'] || ''
      const record: RequestTrace = {
        method: request.method(),
        url: request.url(),
        resourceType,
        postData: request.postData(),
        headers,
        status: response.status(),
        contentType
      }
      if (/json|text|javascript|html/i.test(contentType)) {
        record.responseText = await response.text().catch(() => undefined)
        if (record.responseText && record.responseText.length > 3_000_000) record.responseText = record.responseText.slice(0, 3_000_000)
      }
      this.records.push(record)
      if (this.records.length > 200) this.records.splice(0, this.records.length - 200)
    })()

    this.pending.add(task)
    void task.finally(() => this.pending.delete(task))
  }

  mark(): number { return this.records.length }

  async settle(): Promise<void> {
    if (this.pending.size) await Promise.allSettled(Array.from(this.pending))
  }

  since(mark: number): RequestTrace[] { return this.records.slice(mark) }
  all(): RequestTrace[] { return [...this.records] }

  summarySince(mark: number): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of this.since(mark)) {
      const short = `${item.method} ${item.url}`
      if (seen.has(short)) continue
      seen.add(short)
      out.push(short.length > 180 ? `${short.slice(0, 177)}...` : short)
      if (out.length >= 6) break
    }
    return out
  }
}

function sanitizeReplayHeaders(headers: Record<string, string>): Record<string, string> {
  const blocked = new Set([
    'host', 'content-length', 'connection', 'accept-encoding', 'origin', 'referer',
    'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'
  ])
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())))
}

function extractSeedsFromPayload(text: string, sourceUrl: string): ProductSeed[] {
  const urlRegex = /(?:https?:\\?\/\\?\/[^"'\s<>]*\/product\/aventics-sku-[^"'\s<>\\?#]+|\/product\/aventics-sku-[^"'\s<>\\?#]+)/gi
  const urls = (text.match(urlRegex) || []).map((raw) => raw.replace(/\\\//g, '/'))
  const bySku = new Map<string, string>()
  const skuValues = new Set<string>()

  for (const raw of urls) {
    const slug = raw.match(/aventics-sku-([^/?#"']+)/i)?.[1]
    if (!slug) continue
    const sku = decodeURIComponent(slug).toUpperCase()
    if (!/^(?:R\d{8,}|\d{10})$/i.test(sku)) continue
    skuValues.add(sku)
    bySku.set(sku, new URL(raw, sourceUrl).toString())
  }

  // R-prefixed AVENTICS identifiers are distinctive enough to accept directly.
  for (const sku of text.match(/\bR\d{8,}\b/gi) || []) skuValues.add(sku.toUpperCase())

  // Pure 10-digit identifiers are accepted only when they are attached to a
  // product/SKU-like JSON key; arbitrary timestamps/IDs are not treated as SKUs.
  const tagged = /["'](?:sku|partNumber|part_number|catalogNumber|catalog_number|productNumber|product_number|materialNumber|material_number)["']\s*:\s*["']?(\d{10})["']?/gi
  for (const match of text.matchAll(tagged)) skuValues.add(match[1].toUpperCase())

  const seeds: ProductSeed[] = []
  for (const sku of skuValues) {
    const url = bySku.get(sku) || new URL(`/product/aventics-sku-${sku.toLowerCase()}`, sourceUrl).toString()
    seeds.push({ sku, name: '', url, specifications: {} })
  }
  return seeds
}

function pageFeedScore(record: RequestTrace, anchorSkus: string[], expectedTotal: number | null): number {
  const body = record.responseText || ''
  if (!body) return 0
  let score = 0
  const upper = body.toUpperCase()
  const anchorMatches = anchorSkus.filter((sku) => upper.includes(sku.toUpperCase())).length
  score += Math.min(30, anchorMatches * 5)
  const productLinkCount = (body.match(/aventics-sku-/gi) || []).length
  score += Math.min(10, productLinkCount)
  if (expectedTotal != null && new RegExp(`\\b${expectedTotal}\\b`).test(body)) score += 3
  if (/product|catalog|search|result|sku/i.test(record.url)) score += 2
  if (/json/i.test(record.contentType || '')) score += 2
  return score
}

function mutateUrlForPage(urlText: string, desiredPage: number, pageSize: number): string[] {
  const outputs = new Set<string>()
  let url: URL
  try { url = new URL(urlText) } catch { return [] }

  const pageKeys = /^(?:page|p|pageNumber|pageNo|currentPage|pageIndex|page_index)$/i
  const offsetKeys = /^(?:offset|skip|from|start|startIndex|start_index)$/i
  for (const [key, value] of Array.from(url.searchParams.entries())) {
    if (pageKeys.test(key)) {
      const copy = new URL(url)
      const current = Number(value)
      copy.searchParams.set(key, String(Number.isFinite(current) && current === 0 ? desiredPage - 1 : desiredPage))
      outputs.add(copy.toString())
    }
    if (offsetKeys.test(key)) {
      const copy = new URL(url)
      const current = Number(value)
      const base = Number.isFinite(current) && current === 1 ? 1 : 0
      copy.searchParams.set(key, String((desiredPage - 1) * pageSize + base))
      outputs.add(copy.toString())
    }
  }
  return Array.from(outputs)
}

function mutatePostDataForPage(postData: string | null, contentType: string | undefined, desiredPage: number, pageSize: number): string[] {
  if (!postData) return []
  const pageKeys = /^(?:page|p|pageNumber|pageNo|currentPage|pageIndex|page_index)$/i
  const offsetKeys = /^(?:offset|skip|from|start|startIndex|start_index)$/i
  const outputs = new Set<string>()

  const mutateObject = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(mutateObject)
    if (!input || typeof input !== 'object') return input
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (pageKeys.test(key) && (typeof value === 'number' || typeof value === 'string')) {
        const n = Number(value)
        out[key] = Number.isFinite(n) && n === 0 ? desiredPage - 1 : desiredPage
      } else if (offsetKeys.test(key) && (typeof value === 'number' || typeof value === 'string')) {
        const n = Number(value)
        const base = Number.isFinite(n) && n === 1 ? 1 : 0
        out[key] = (desiredPage - 1) * pageSize + base
      } else out[key] = mutateObject(value)
    }
    return out
  }

  if (/json/i.test(contentType || '') || /^[\[{]/.test(postData.trim())) {
    try {
      const parsed = JSON.parse(postData)
      const mutated = JSON.stringify(mutateObject(parsed))
      if (mutated !== postData) outputs.add(mutated)
    } catch { /* fall through to form parsing */ }
  }

  try {
    const params = new URLSearchParams(postData)
    let changed = false
    for (const [key, value] of Array.from(params.entries())) {
      if (pageKeys.test(key)) {
        const current = Number(value)
        params.set(key, String(Number.isFinite(current) && current === 0 ? desiredPage - 1 : desiredPage))
        changed = true
      } else if (offsetKeys.test(key)) {
        const current = Number(value)
        const base = Number.isFinite(current) && current === 1 ? 1 : 0
        params.set(key, String((desiredPage - 1) * pageSize + base))
        changed = true
      }
    }
    if (changed) outputs.add(params.toString())
  } catch { /* not form encoded */ }

  return Array.from(outputs)
}

async function tryNetworkFeedPage(
  page: Page,
  records: RequestTrace[],
  anchorSkus: string[],
  excludeSkus: string[],
  expectedTotal: number | null,
  sourceUrl: string,
  desiredPage: number,
  pageSize: number
): Promise<{ products: ProductSeed[]; description: string } | null> {
  const ranked = records
    .map((record) => ({ record, score: pageFeedScore(record, anchorSkus, expectedTotal) }))
    .filter((item) => item.score >= Math.min(15, Math.max(7, anchorSkus.length * 2)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)

  for (const { record } of ranked) {
    if (!['GET', 'POST'].includes(record.method.toUpperCase())) continue
    if (record.method.toUpperCase() === 'POST' && /\bmutation\b/i.test(record.postData || '')) continue
    const variants: Array<{ url: string; data?: string }> = []
    for (const url of mutateUrlForPage(record.url, desiredPage, pageSize)) variants.push({ url, data: record.postData || undefined })
    for (const data of mutatePostDataForPage(record.postData, record.headers['content-type'], desiredPage, pageSize)) variants.push({ url: record.url, data })

    const dedupe = new Set<string>()
    for (const variant of variants) {
      const key = `${variant.url}\n${variant.data || ''}`
      if (dedupe.has(key)) continue
      dedupe.add(key)
      try {
        const response = await page.context().request.fetch(variant.url, {
          method: record.method,
          headers: sanitizeReplayHeaders(record.headers),
          data: variant.data,
          timeout: 12000,
          failOnStatusCode: false
        })
        if (!response.ok()) continue
        const text = await response.text()
        const products = extractSeedsFromPayload(text, sourceUrl)
        if (expectedTotal != null && products.length >= Math.max(pageSize, Math.floor(expectedTotal * 0.9))) {
          return { products: products.slice(0, expectedTotal), description: `${record.method} ${variant.url} (full-feed)` }
        }
        const before = new Set(excludeSkus.map((sku) => sku.toUpperCase()))
        const fresh = products.filter((p) => !before.has(p.sku.toUpperCase()))
        if (fresh.length >= Math.min(3, pageSize)) {
          return { products: fresh.slice(0, pageSize), description: `${record.method} ${variant.url}` }
        }
      } catch {
        // Network replay is an optimization/fallback only.
      }
    }
  }
  return null
}

interface CandidateMeta {
  index: number
  score: number
  tag: string
  label: string
}

async function rankExactTextCandidates(frame: Frame, wanted: string): Promise<Array<{ locator: Locator; meta: CandidateMeta }>> {
  const locator = frame.getByText(wanted, { exact: true })
  const count = await locator.count().catch(() => 0)
  const items: Array<{ locator: Locator; meta: CandidateMeta }> = []

  for (let i = 0; i < Math.min(count, 50); i += 1) {
    const candidate = locator.nth(i)
    if (!(await candidate.isVisible().catch(() => false))) continue
    const meta = await candidate.evaluate((element, index) => {
      const el = element as HTMLElement
      const clean = (value: string | null | undefined) => (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
      let score = 1
      let node: HTMLElement | null = el
      let depth = 0
      while (node && depth < 7) {
        const cls = `${node.className || ''}`
        const role = node.getAttribute('role') || ''
        const text = clean(node.innerText)
        if (/pagination|pager|paging|page-item|page-link/i.test(cls)) score += 12
        if (/navigation/i.test(role)) score += 5
        if (node.tagName.toLowerCase() === 'nav') score += 8
        if (/…|\.\.\./.test(text) && (text.match(/\b\d{1,4}\b/g) || []).length >= 3) score += 10
        const numericChildren = Array.from(node.querySelectorAll('*')).filter((child) => /^\d{1,4}$/.test(clean(child.textContent))).length
        if (numericChildren >= 3) score += Math.min(10, numericChildren)
        if (node.querySelector('svg')) score += 2
        if (text.length > 600) score -= 8
        node = node.parentElement
        depth += 1
      }
      const tag = el.tagName.toLowerCase()
      if (['button', 'a'].includes(tag)) score += 5
      if ((el.getAttribute('role') || '').toLowerCase() === 'button') score += 4
      if (getComputedStyle(el).cursor === 'pointer') score += 3
      return { index, score, tag, label: clean(el.textContent) }
    }, i).catch(() => ({ index: i, score: 0, tag: '', label: '' }))
    items.push({ locator: candidate, meta })
  }

  return items.sort((a, b) => b.meta.score - a.meta.score)
}

async function clickLocatorAndVerify(page: Page, candidate: Locator, before: PaginationSnapshot, desiredPage: number): Promise<{ moved: boolean; mode: string }> {
  if (!(await candidate.isVisible().catch(() => false))) return { moved: false, mode: 'hidden' }
  if (await candidate.isDisabled().catch(() => false)) return { moved: false, mode: 'disabled' }
  if (await candidate.getAttribute('aria-disabled').catch(() => null) === 'true') return { moved: false, mode: 'aria-disabled' }

  await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
  const href = await candidate.getAttribute('href').catch(() => null)
  if (href && !/^\s*(?:#|javascript:)/i.test(href)) {
    const target = new URL(href, page.url()).toString()
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => undefined)
    if (await waitForPageAdvance(page, before, desiredPage, 8000)) return { moved: true, mode: 'href' }
  } else {
    const clicked = await candidate.click({ timeout: 3500 }).then(() => true).catch(() => false)
    if (clicked && await waitForPageAdvance(page, before, desiredPage, 7000)) return { moved: true, mode: 'playwright-click' }

    // Some component libraries attach the handler to an ancestor while exposing
    // only a text/span node. A physical pointer click reproduces real user input.
    const box = await candidate.boundingBox().catch(() => null)
    if (box && box.width > 0 && box.height > 0) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => undefined)
      if (await waitForPageAdvance(page, before, desiredPage, 7000)) return { moved: true, mode: 'mouse-click' }
    }
  }
  return { moved: false, mode: 'no-advance' }
}

async function tryGlobalExactPageNumber(page: Page, desiredPage: number, before: PaginationSnapshot, attempts: string[]): Promise<boolean> {
  const wanted = String(desiredPage)
  const ranked: Array<{ locator: Locator; meta: CandidateMeta; frameUrl: string }> = []
  for (const frame of page.frames()) {
    const items = await rankExactTextCandidates(frame, wanted)
    for (const item of items) ranked.push({ ...item, frameUrl: frame.url() })
  }
  ranked.sort((a, b) => b.meta.score - a.meta.score)
  attempts.push(`global-exact-${wanted}:${ranked.length}`)

  for (let i = 0; i < Math.min(ranked.length, 12); i += 1) {
    const item = ranked[i]
    const result = await clickLocatorAndVerify(page, item.locator, before, desiredPage)
    attempts.push(`global-exact-${wanted}[${i + 1}]:score=${item.meta.score}/${item.meta.tag}/${result.mode}`)
    if (result.moved) return true
  }
  return false
}

async function tryHrefPagination(page: Page, desiredPage: number, before: PaginationSnapshot, attempts: string[]): Promise<boolean> {
  const pageKeys = /(?:[?&](?:page|p|pageNumber|pageNo|currentPage|pageIndex|page_index)=)/i
  const candidates = page.locator('a[href]')
  const count = await candidates.count().catch(() => 0)
  const wanted: Locator[] = []
  for (let i = 0; i < Math.min(count, 1000); i += 1) {
    const link = candidates.nth(i)
    const href = await link.getAttribute('href').catch(() => null)
    if (!href || !pageKeys.test(href)) continue
    try {
      const url = new URL(href, page.url())
      const values = Array.from(url.searchParams.entries())
        .filter(([key]) => /^(?:page|p|pageNumber|pageNo|currentPage|pageIndex|page_index)$/i.test(key))
        .map(([, value]) => Number(value))
      if (values.some((value) => value === desiredPage || value === desiredPage - 1)) wanted.push(link)
    } catch { /* ignore malformed href */ }
  }
  attempts.push(`href-page-${desiredPage}:${wanted.length}`)
  for (const candidate of wanted.slice(0, 8)) {
    const result = await clickLocatorAndVerify(page, candidate, before, desiredPage)
    if (result.moved) return true
  }
  return false
}

async function rankIconCandidates(page: Page): Promise<Array<{ locator: Locator; score: number }>> {
  const selector = 'button:has(svg),a:has(svg),[role="button"]:has(svg),[role="link"]:has(svg),[tabindex]:has(svg),svg'
  const locator = page.locator(selector)
  const count = await locator.count().catch(() => 0)
  const result: Array<{ locator: Locator; score: number }> = []
  for (let i = 0; i < Math.min(count, 100); i += 1) {
    const candidate = locator.nth(i)
    if (!(await candidate.isVisible().catch(() => false))) continue
    const score = await candidate.evaluate((element) => {
      const el = element as HTMLElement
      const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
      let score = 0
      const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.className || ''}`
      if (/prev|previous|back/i.test(label)) return -100
      if (/next|forward|right/i.test(label)) score += 20
      let node: HTMLElement | null = el
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const cls = `${node.className || ''}`
        const text = clean(node.innerText)
        if (/pagination|pager|paging/i.test(cls)) score += 12
        if (node.tagName.toLowerCase() === 'nav') score += 8
        if (/…|\.\.\./.test(text) && (text.match(/\b\d{1,4}\b/g) || []).length >= 3) score += 8
        if (text.length > 600) score -= 8
      }
      const text = clean(el.textContent)
      if (!text) score += 2
      return score
    }).catch(() => -100)
    if (score > 0) result.push({ locator: candidate, score })
  }
  return result.sort((a, b) => b.score - a.score)
}

async function tryIconNext(page: Page, desiredPage: number, before: PaginationSnapshot, attempts: string[]): Promise<boolean> {
  const candidates = await rankIconCandidates(page)
  attempts.push(`icon-candidates:${candidates.length}`)
  for (let i = 0; i < Math.min(candidates.length, 10); i += 1) {
    const result = await clickLocatorAndVerify(page, candidates[i].locator, before, desiredPage)
    attempts.push(`icon[${i + 1}]:score=${candidates[i].score}/${result.mode}`)
    if (result.moved) return true
  }
  return false
}

interface AdvanceResult {
  moved: boolean
  method: string
  attempts: string[]
  network: string[]
}

async function advanceToNextPage(page: Page, desiredPage: number, probe: NetworkProbe): Promise<AdvanceResult> {
  const before = await paginationSnapshot(page)
  const attempts: string[] = []
  const networkMark = probe.mark()

  // Conventional accessible next controls first.
  const selectors = [
    'a[aria-label*="next" i]', 'button[aria-label*="next" i]',
    '[role="button"][aria-label*="next" i]', '[role="link"][aria-label*="next" i]',
    'a[title*="next" i]', 'button[title*="next" i]'
  ]
  for (const selector of selectors) {
    const candidates = page.locator(selector)
    const count = await candidates.count().catch(() => 0)
    if (count) attempts.push(`${selector}:${count}`)
    for (let i = 0; i < count; i += 1) {
      const result = await clickLocatorAndVerify(page, candidates.nth(i), before, desiredPage)
      if (result.moved) {
        await probe.settle()
        return { moved: true, method: `selector:${selector}/${result.mode}`, attempts, network: probe.summarySince(networkMark) }
      }
    }
  }

  // Most important v0.2.2 change: use Playwright's global text engine (including
  // open shadow roots and iframes) instead of requiring paginator-like markup.
  if (await tryGlobalExactPageNumber(page, desiredPage, before, attempts)) {
    await probe.settle()
    return { moved: true, method: `global-exact:${desiredPage}`, attempts, network: probe.summarySince(networkMark) }
  }

  // Some paginators expose hrefs without useful accessible text.
  if (await tryHrefPagination(page, desiredPage, before, attempts)) {
    await probe.settle()
    return { moved: true, method: `href-page:${desiredPage}`, attempts, network: probe.summarySince(networkMark) }
  }

  // Finally try icon controls, but validate every candidate and reject any icon
  // that does not actually alter range/page/SKU signature.
  if (await tryIconNext(page, desiredPage, before, attempts)) {
    await probe.settle()
    return { moved: true, method: 'verified-icon-next', attempts, network: probe.summarySince(networkMark) }
  }

  await probe.settle()
  return { moved: false, method: 'none', attempts, network: probe.summarySince(networkMark) }
}

export async function discoverProducts(
  sourceUrl: string,
  expectedTotal: number | null,
  browser: BrowserSession,
  controller: JobController,
  onPage: (products: ProductSeed[], pageNo: number) => Promise<void>,
  onDiagnostic?: (message: string) => void
): Promise<ProductSeed[]> {
  const page = await browser.newPage()
  const probe = new NetworkProbe(page)
  const all = new Map<string, ProductSeed>()
  const seenPageSignatures = new Set<string>()
  let lastAdvance: AdvanceResult | null = null
  let lastRange: ProductRange | null = null
  let lastDetectedPage: number | null = null

  const mergeProducts = async (products: ProductSeed[], pageNo: number): Promise<void> => {
    const newlyAdded: ProductSeed[] = []
    for (const product of products) {
      if (!all.has(product.sku)) newlyAdded.push(product)
      const existing = all.get(product.sku)
      all.set(product.sku, {
        sku: product.sku,
        name: product.name || existing?.name || '',
        url: product.url || existing?.url || '',
        specifications: { ...(existing?.specifications || {}), ...(product.specifications || {}) }
      })
    }
    await onPage(newlyAdded, pageNo)
  }

  try {
    await gotoStable(page, sourceUrl)
    await probe.settle()

    let initialProducts = await extractCurrentPageProducts(page)
    if (initialProducts.length === 0) {
      const productControls = [
        page.getByRole('tab', { name: /^Products$/i }),
        page.getByRole('button', { name: /^Products$/i }),
        page.getByRole('link', { name: /^Products$/i })
      ]
      for (const control of productControls) {
        try {
          if (await control.first().isVisible({ timeout: 400 })) {
            await control.first().click({ timeout: 1500 }).catch(() => undefined)
            await page.waitForTimeout(500)
            initialProducts = await extractCurrentPageProducts(page)
            if (initialProducts.length > 0) break
          }
        } catch { /* continue */ }
      }
    }

    if (!initialProducts.length) return []

    const initialRange = await readProductRange(page)
    const pageSize = initialRange ? Math.max(1, initialRange.end - initialRange.start + 1) : Math.max(1, initialProducts.length)
    const expectedPages = expectedTotal != null ? pageCountForRange(expectedTotal, pageSize) : null

    await mergeProducts(initialProducts, 1)
    seenPageSignatures.add(initialProducts.map((item) => item.sku).join('|'))
    lastRange = initialRange
    lastDetectedPage = pageNumberForRange(initialRange) ?? await currentPageNumber(page)

    if (expectedTotal != null && all.size >= expectedTotal) return Array.from(all.values())

    // API/XHR-first fallback. The page-load response that contains first-page SKUs
    // is replayed with common page/offset parameters. If successful, DOM pagination
    // is unnecessary and the browser remains only the authenticated session host.
    const currentPageSkus = initialProducts.map((p) => p.sku)
    const networkPage2 = await tryNetworkFeedPage(page, probe.all(), currentPageSkus, currentPageSkus, expectedTotal, sourceUrl, 2, pageSize)
    if (networkPage2) {
      onDiagnostic?.(`[diag] pagination network feed detected: ${networkPage2.description}`)
      let feedSucceeded = true
      let previousSkus = currentPageSkus
      for (let pageNo = 2; expectedPages == null || pageNo <= expectedPages; pageNo += 1) {
        controller.throwIfCancelled()
        await controller.waitIfPaused()
        const result = pageNo === 2
          ? networkPage2
          : await tryNetworkFeedPage(page, probe.all(), currentPageSkus, previousSkus, expectedTotal, sourceUrl, pageNo, pageSize)
        if (!result || !result.products.length) { feedSucceeded = false; break }
        const signature = result.products.map((p) => p.sku).join('|')
        if (!signature || seenPageSignatures.has(signature)) { feedSucceeded = false; break }
        seenPageSignatures.add(signature)
        await mergeProducts(result.products, pageNo)
        previousSkus = result.products.map((p) => p.sku)
        if (expectedTotal != null && all.size >= expectedTotal) return Array.from(all.values())
      }
      if (feedSucceeded && (expectedTotal == null || all.size >= expectedTotal)) return Array.from(all.values())
      onDiagnostic?.(`[diag] network feed pagination became incomplete at ${all.size}${expectedTotal ? `/${expectedTotal}` : ''}; continuing with browser paginator.`)

      // If feed partially succeeded, returning to DOM page 1 and mixing methods can
      // create repeated pages. Reload and continue only from the amount already merged;
      // browser navigation below deduplicates by SKU.
      await gotoStable(page, sourceUrl)
    }

    // Browser paginator loop. Page 1 was already merged above.
    for (let logicalPage = 1; logicalPage <= 1000; logicalPage += 1) {
      controller.throwIfCancelled()
      await controller.waitIfPaused()

      const snapshot = await paginationSnapshot(page)
      lastRange = snapshot.range
      lastDetectedPage = snapshot.pageNumber
      const browserPage = snapshot.pageNumber ?? logicalPage

      // If network feed already merged some products, skip merging page 1 again.
      if (!(browserPage === 1 && logicalPage === 1)) {
        const current = await extractCurrentPageProducts(page)
        const signature = current.map((item) => item.sku).join('|')
        if (!signature) break
        if (!seenPageSignatures.has(signature)) {
          seenPageSignatures.add(signature)
          await mergeProducts(current, browserPage)
        }
      }

      if (expectedTotal != null && all.size >= expectedTotal) break
      const desiredPage = browserPage + 1
      if (expectedPages != null && desiredPage > expectedPages) break

      lastAdvance = await advanceToNextPage(page, desiredPage, probe)
      onDiagnostic?.(`[diag] pagination ${browserPage}->${desiredPage}: ${lastAdvance.moved ? `success via ${lastAdvance.method}` : 'failed'}; attempts=${lastAdvance.attempts.join(' | ')}${lastAdvance.network.length ? `; network=${lastAdvance.network.join(' || ')}` : '; network=none'}`)
      if (!lastAdvance.moved) break
    }

    if (expectedTotal != null && all.size < expectedTotal) {
      const expectedPagesText = expectedPages != null ? String(expectedPages) : '?'
      const rangeText = lastRange ? `${lastRange.start}-${lastRange.end} of ${lastRange.total}` : 'not detected'
      const derivedPage = pageNumberForRange(lastRange) ?? lastDetectedPage
      const pageText = derivedPage != null ? `${derivedPage}/${expectedPagesText}` : `unknown/${expectedPagesText}`
      const attemptText = lastAdvance?.attempts.length ? lastAdvance.attempts.join(', ') : 'no navigation attempts recorded'
      const networkText = lastAdvance?.network.length ? lastAdvance.network.join(' | ') : 'no XHR/fetch request observed during the final pagination attempts'
      throw new Error(
        `Product discovery stopped at ${all.size} of ${expectedTotal}. ` +
        `Current range: ${rangeText}; current page: ${pageText}. ` +
        `Pagination attempts: ${attemptText}. ` +
        `Network: ${networkText}. ` +
        'v0.2.2 rejected every click that failed to change the result range/page/SKU grid.'
      )
    }
    return Array.from(all.values())
  } finally {
    await page.close().catch(() => undefined)
  }
}
