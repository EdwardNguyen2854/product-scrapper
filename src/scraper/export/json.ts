import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobDetail } from '../../shared/types'

const safe = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').slice(0,100)

export async function exportJobToJson(detail: JobDetail, outputDirectory: string, appVersion: string): Promise<string> {
  await mkdir(outputDirectory,{recursive:true})
  const path=join(outputDirectory,`${safe(detail.job.seriesName)}_${detail.job.createdAt.slice(0,10)}.json`)
  const payload={schemaVersion:2,appVersion,exportedAt:new Date().toISOString(),series:{name:detail.job.seriesName,url:detail.job.sourceUrl,job:detail.job},comparison:detail.comparison,products:detail.products.map((p)=>({sku:p.sku,name:p.name,description:p.description,url:p.url,status:p.status,sourceMethod:p.sourceMethod,scrapedAt:p.scrapedAt,quality:p.quality,changeStatus:p.changeStatus,specifications:p.specifications,assets:p.assets.map(({id,productId,...a})=>a)}))}
  await writeFile(path,JSON.stringify(payload,null,2),'utf8')
  return path
}
