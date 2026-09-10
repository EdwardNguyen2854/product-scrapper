import { z } from 'zod'

export const aventicsSeriesUrlSchema = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value)
      if (!['https:', 'http:'].includes(url.protocol)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL must use HTTP or HTTPS.' })
      }
      if (url.hostname.toLowerCase() !== 'discreteautomation.emerson.com') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only discreteautomation.emerson.com is supported in v0.2.2.' })
      }
      if (!url.pathname.toLowerCase().startsWith('/product/')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an Emerson product-series URL.' })
      }
      if (/aventics-sku-/i.test(url.pathname)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a series URL, not an individual SKU URL.' })
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid URL.' })
    }
  })

export const jobOptionsSchema = z.object({
  mode: z.enum(['listing', 'full']),
  concurrency: z.number().int().min(1).max(10),
  retryAttempts: z.number().int().min(1).max(6),
  timeoutMs: z.number().int().min(5000).max(120000),
  extractImages: z.boolean(),
  extractDocuments: z.boolean(),
  extractCad: z.boolean(),
  runQualityValidation: z.boolean(),
  autoCompare: z.boolean(),
  developerDiagnostics: z.boolean()
})

export const appSettingsSchema = z.object({
  outputDirectory: z.string().min(1),
  concurrency: z.number().int().min(1).max(10),
  retryAttempts: z.number().int().min(1).max(6),
  timeoutMs: z.number().int().min(5000).max(120000),
  headless: z.boolean(),
  browserChannel: z.literal('msedge'),
  autoCompare: z.boolean(),
  runQualityValidation: z.boolean(),
  extractImages: z.boolean(),
  extractDocuments: z.boolean(),
  extractCad: z.boolean(),
  developerDiagnostics: z.boolean()
})

export const productQuerySchema = z.object({
  search: z.string().max(200).optional(),
  series: z.string().max(200).optional(),
  quality: z.enum(['complete', 'incomplete', 'failed', 'not_evaluated', 'all']).optional(),
  change: z.enum(['added', 'removed', 'changed', 'unchanged', 'not_compared', 'all']).optional(),
  sourceMethod: z.enum(['listing', 'api', 'http', 'browser', 'all']).nullable().optional(),
  hasImage: z.boolean().nullable().optional(),
  hasDocument: z.boolean().nullable().optional(),
  hasCad: z.boolean().nullable().optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  offset: z.number().int().min(0).optional()
})

export const exportFieldSelectionSchema = z.object({
  core: z.array(z.string()),
  specifications: z.array(z.string()),
  assets: z.array(z.string()),
  comparison: z.array(z.string())
})

export const exportRequestSchema = z.object({
  jobId: z.string().min(1),
  outputDirectory: z.string().min(1),
  format: z.enum(['xlsx', 'csv', 'json']),
  presetId: z.string().optional(),
  selection: exportFieldSelectionSchema.optional()
})
