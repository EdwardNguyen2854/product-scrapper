import type { ExportFieldSelection, ExportRequest, JobDetail } from '../../shared/types'
import type { ScraperDatabase } from '../db'
import { exportJobToExcel, defaultExportSelection, exportSchema } from '../excel'
import { exportJobToCsv } from './csv'
import { exportJobToJson } from './json'

export { exportSchema }

export async function exportJob(db: ScraperDatabase, detail: JobDetail, request: ExportRequest, appVersion: string): Promise<string> {
  let selection: ExportFieldSelection | undefined = request.selection
  if (!selection && request.presetId) {
    const preset = db.getPreset(request.presetId)
    if (preset) {
      const schema = exportSchema(detail)
      selection = {
        core: preset.selection.core,
        specifications: preset.selection.specifications.includes('*') ? schema.specifications : preset.selection.specifications,
        assets: preset.selection.assets,
        comparison: preset.selection.comparison
      }
    }
  }
  selection ??= defaultExportSelection(detail)
  if (request.format === 'xlsx') return exportJobToExcel(detail, request.outputDirectory, appVersion, selection)
  if (request.format === 'csv') return exportJobToCsv(detail, request.outputDirectory, selection)
  return exportJobToJson(detail, request.outputDirectory, appVersion)
}
