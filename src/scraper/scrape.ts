import PQueue from 'p-queue'
import type { ProductRecord, SourceMethod } from '../shared/types'
import { BrowserSession, gotoStable } from './browser'
import { CancelledError, JobController, sleep } from './control'
import { isUsefulProduct, type ParsedProductPage } from './parser'
import { EmersonAdapter } from './adapters/emerson'

interface ScrapeContext {
  browser: BrowserSession
  browserQueue: PQueue
  controller: JobController
  timeoutMs: number
  cookie: string
  userAgent: string
}

function combinedSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return AbortSignal.any([signal, timeout])
}

async function fetchHtml(url: string, context: ScrapeContext): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': context.userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      ...(context.cookie ? { cookie: context.cookie } : {})
    },
    signal: combinedSignal(context.controller.signal, context.timeoutMs)
  })

  if (response.status === 429) throw new Error('HTTP 429 Too Many Requests')
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  const html = await response.text()
  if (html.length < 1000) throw new Error('Product response was unexpectedly small.')
  return html
}

async function scrapeWithHttp(product: ProductRecord, context: ScrapeContext): Promise<ParsedProductPage> {
  const html = await fetchHtml(product.url, context)
  const parsed = EmersonAdapter.parseProduct(html, product.url, product.sku)
  if (!isUsefulProduct(parsed, product.sku)) throw new Error('HTTP page did not contain a valid specification set.')
  return parsed
}

async function scrapeWithBrowser(product: ProductRecord, context: ScrapeContext): Promise<ParsedProductPage> {
  return context.browserQueue.add(async () => {
    context.controller.throwIfCancelled()
    await context.controller.waitIfPaused()
    const page = await context.browser.newPage()
    try {
      await gotoStable(page, product.url, context.timeoutMs)
      const specControls = [
        page.getByRole('tab', { name: /^Specifications$/i }),
        page.getByRole('button', { name: /^Specifications$/i }),
        page.getByRole('link', { name: /^Specifications$/i })
      ]
      for (const control of specControls) {
        try {
          if (await control.first().isVisible({ timeout: 400 })) {
            await control.first().click({ timeout: 1500 }).catch(() => undefined)
            await page.waitForTimeout(250)
            break
          }
        } catch {
          // Specifications are commonly visible by default; clicking is only a fallback.
        }
      }
      const html = await page.content()
      const parsed = EmersonAdapter.parseProduct(html, product.url, product.sku)
      if (!isUsefulProduct(parsed, product.sku)) throw new Error('Browser-rendered page did not contain a valid specification set.')
      return parsed
    } finally {
      await page.close().catch(() => undefined)
    }
  }) as Promise<ParsedProductPage>
}

export async function scrapeOneProduct(
  product: ProductRecord,
  context: ScrapeContext
): Promise<{ data: ParsedProductPage; sourceMethod: Exclude<SourceMethod, null> }> {
  context.controller.throwIfCancelled()
  await context.controller.waitIfPaused()

  try {
    const data = await scrapeWithHttp(product, context)
    return { data, sourceMethod: 'http' }
  } catch (httpError) {
    context.controller.throwIfCancelled()
    const data = await scrapeWithBrowser(product, context).catch((browserError) => {
      const first = httpError instanceof Error ? httpError.message : String(httpError)
      const second = browserError instanceof Error ? browserError.message : String(browserError)
      throw new Error(`HTTP: ${first}; Browser fallback: ${second}`)
    })
    return { data, sourceMethod: 'browser' }
  }
}

export async function scrapeWithRetries(
  product: ProductRecord,
  attempts: number,
  context: ScrapeContext,
  beforeAttempt: () => void
): Promise<{ data: ParsedProductPage; sourceMethod: Exclude<SourceMethod, null> }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    context.controller.throwIfCancelled()
    await context.controller.waitIfPaused()
    beforeAttempt()
    try {
      return await scrapeOneProduct(product, context)
    } catch (error) {
      if (error instanceof CancelledError) throw error
      lastError = error
      if (attempt >= attempts) break
      const base = attempt === 1 ? 1000 : 3000 * Math.pow(2, Math.max(0, attempt - 2))
      const isRateLimited = error instanceof Error && /429|too many requests/i.test(error.message)
      await sleep(isRateLimited ? Math.max(base, 10000) : base, context.controller.signal)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Unknown scraping failure.'))
}

export async function buildScrapeContext(
  browser: BrowserSession,
  controller: JobController,
  timeoutMs: number,
  cookieUrl: string
): Promise<ScrapeContext> {
  return {
    browser,
    browserQueue: new PQueue({ concurrency: 1 }),
    controller,
    timeoutMs,
    cookie: await browser.cookieHeader(cookieUrl),
    userAgent: await browser.userAgent()
  }
}
