import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

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

export async function dismissCookieBanner(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /accept all/i }),
    page.getByRole('button', { name: /accept cookies/i }),
    page.getByRole('button', { name: /^accept$/i }),
    page.locator('#onetrust-accept-btn-handler'),
    page.locator('button').filter({ hasText: /allow all/i })
  ]

  for (const candidate of candidates) {
    try {
      if (await candidate.first().isVisible({ timeout: 500 })) {
        await candidate.first().click({ timeout: 1500 })
        return
      }
    } catch {
      // Try the next known cookie control.
    }
  }
}

export async function gotoStable(page: Page, url: string, timeoutMs = 45000): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  await dismissCookieBanner(page)
  await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => undefined)
  await page.waitForTimeout(350)
}
