import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JobDetail, ProductRecord } from '../src/shared/types'
import { exportJobToExcel } from '../src/scraper/excel'

function listingProduct(): ProductRecord {
  return {
    id: 1, jobId: 'job', sku: 'R480698486', name: 'Test product', description: '',
    url: 'https://example.test/product/aventics-sku-r480698486', status: 'success', attempts: 0,
    sourceMethod: 'listing', errorMessage: null, scrapedAt: new Date().toISOString(), specifications: {}, assets: [],
    quality: { status: 'complete', score: 100, issues: [], evaluatedAt: new Date().toISOString() },
    changeStatus: 'not_compared'
  }
}

function detail(): JobDetail {
  const products=[listingProduct()]
  return {
    job: {
      id:'job',batchId:null,sourceUrl:'https://example.test/product/series',normalizedSourceUrl:'https://example.test/product/series',
      seriesName:'Test Series',expectedTotal:1,status:'completed',mode:'listing',concurrency:1,retryAttempts:1,timeoutMs:30000,
      extractImages:true,extractDocuments:true,extractCad:true,runQualityValidation:true,autoCompare:false,developerDiagnostics:false,
      createdAt:new Date().toISOString(),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),
      completedCount:1,failedCount:0,incompleteCount:0,productCount:1,outputPath:null,errorMessage:null,comparedToJobId:null
    },
    products,comparison:null
  }
}

describe('exportJobToExcel',()=>{
  it('exports a listing-only job without crashing in AutoFilter setup',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'aventics-xlsx-'))
    try {
      const path=await exportJobToExcel(detail(),dir,'0.2.6')
      const bytes=await readFile(path)
      expect(bytes.length).toBeGreaterThan(1000)
    } finally {
      await rm(dir,{recursive:true,force:true})
    }
  })
})
