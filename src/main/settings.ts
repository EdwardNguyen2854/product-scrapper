import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '../shared/types'
import { appSettingsSchema } from '../shared/schemas'

const settingsPath = () => join(app.getPath('userData'), 'settings.json')

export function defaultSettings(): AppSettings {
  return {
    outputDirectory: join(app.getPath('documents'), 'AVENTICS Product Scraper'),
    concurrency: 6,
    retryAttempts: 3,
    timeoutMs: 30000,
    headless: true,
    browserChannel: 'msedge',
    autoCompare: true,
    runQualityValidation: true,
    extractImages: true,
    extractDocuments: true,
    extractCad: true,
    developerDiagnostics: false
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const defaults = defaultSettings()
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    const parsed = appSettingsSchema.safeParse({ ...defaults, ...raw })
    return parsed.success ? parsed.data : defaults
  } catch {
    return defaults
  }
}

export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const parsed = appSettingsSchema.parse(next)
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(parsed, null, 2), 'utf8')
  return parsed
}
