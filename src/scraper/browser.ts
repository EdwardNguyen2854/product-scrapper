import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright-core'

export class BrowserSession {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private userAgentValue = ''

  constructor(private readonly headless = true) {}

  async start(): Promise<void> {
    if (this.browser) return
    this.browser = await chromium.launch({ channel: 'msedge', headless: this.headless })
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US'
    })
    const page = await this.context.newPage()
    this.userAgentValue = await page.evaluate(() => navigator.userAgent)
    await page.close()
  }

  async newPage(): Promise<Page> {
    await this.start()
    return this.context!.newPage()
  }

  async cookieHeader(url: string): Promise<string> {
    await this.start()
    const cookies = await this.context!.cookies(url)
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  }

  async userAgent(): Promise<string> {
    await this.start()
    return this.userAgentValue
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined)
    await this.browser?.close().catch(() => undefined)
    this.context = null
    this.browser = null
  }
}

async function tryConsentControls(frame: Page | Frame): Promise<boolean> {
  const selectors = [
    '#onetrust-accept-btn-handler',
    '#onetrust-reject-all-handler',
    '.onetrust-close-btn-handler',
    '#onetrust-close-btn-container button',
    'button[aria-label*="cookie" i][aria-label*="close" i]',
    'button[aria-label*="privacy" i][aria-label*="close" i]'
  ]

  for (const selector of selectors) {
    const candidate = frame.locator(selector).first()
    try {
      if (!(await candidate.isVisible({ timeout: 80 }))) continue
      const clicked = await candidate.click({ timeout: 900 }).then(() => true).catch(() => false)
      if (!clicked) await candidate.click({ timeout: 900, force: true }).catch(() => undefined)
      return true
    } catch {
      // Try the next known consent control.
    }
  }

  const labels = [
    /accept all cookies/i,
    /accept all/i,
    /accept cookies/i,
    /^accept$/i,
    /allow all/i,
    /^agree$/i,
    /i agree/i,
    /^continue$/i
  ]
  for (const label of labels) {
    const candidate = frame.getByRole('button', { name: label }).first()
    try {
      if (!(await candidate.isVisible({ timeout: 80 }))) continue
      const clicked = await candidate.click({ timeout: 900 }).then(() => true).catch(() => false)
      if (!clicked) await candidate.click({ timeout: 900, force: true }).catch(() => undefined)
      return true
    } catch {
      // Try the next wording/frame.
    }
  }
  return false
}

async function waitForOneTrustHidden(page: Page): Promise<void> {
  const overlay = page.locator('#onetrust-banner-sdk, #onetrust-consent-sdk .onetrust-pc-dark-filter').first()
  await overlay.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => undefined)
}

/**
 * Dismiss common Emerson/OneTrust consent UI. The banner can be injected after
 * DOMContentLoaded, so callers may give this helper a short polling window.
 */
export async function dismissCookieBanner(page: Page, waitMs = 0): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, waitMs)
  do {
    for (const frame of page.frames()) {
      if (await tryConsentControls(frame)) {
        await waitForOneTrustHidden(page)
        await page.waitForTimeout(100).catch(() => undefined)
        return true
      }
    }
    if (Date.now() >= deadline) break
    await page.waitForTimeout(200).catch(() => undefined)
  } while (Date.now() <= deadline)
  return false
}

export async function gotoStable(page: Page, url: string, timeoutMs = 45000): Promise<boolean> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

  // Consent UI is often injected slightly after DOMContentLoaded. Try before
  // and after the short network-idle window so it cannot cover the paginator.
  let cookieDismissed = await dismissCookieBanner(page, 2200)
  await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => undefined)
  if (!cookieDismissed) cookieDismissed = await dismissCookieBanner(page, 1800)
  else await dismissCookieBanner(page, 0)
  await page.waitForTimeout(250)
  return cookieDismissed
}
