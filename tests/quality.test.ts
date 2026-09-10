import { describe, expect, it } from 'vitest'
import type { ProductRecord } from '../src/shared/types'
import { evaluateProductQuality } from '../src/scraper/quality/validator'

function product(specifications: Record<string,string>): ProductRecord {
  return {
    id:1,jobId:'job',sku:'R480698486',name:'Test product',description:'desc',url:'https://example.test/product',status:'success',attempts:1,sourceMethod:'http',errorMessage:null,scrapedAt:new Date().toISOString(),specifications,
    assets:[{id:1,productId:1,type:'image',category:'product_image',title:'image',url:'https://example.test/a.jpg',format:'JPG',source:'http',detectedAt:new Date().toISOString()}],
    quality:{status:'not_evaluated',score:0,issues:[],evaluatedAt:null},changeStatus:'not_compared'
  }
}

describe('evaluateProductQuality',()=>{
  it('marks a well-populated product complete',()=>{
    const q=evaluateProductQuality(product({A:'1',B:'2',C:'3',D:'4',E:'5',F:'6'}))
    expect(q.status).toBe('complete')
    expect(q.score).toBe(100)
  })
  it('allows listing-only products without detail specifications',()=>{
    const p=product({})
    p.sourceMethod='listing'
    p.attempts=0
    const q=evaluateProductQuality(p,'listing')
    expect(q.status).toBe('complete')
    expect(q.issues.some((i)=>i.code==='NO_SPECIFICATIONS')).toBe(false)
  })
  it('marks suspiciously sparse specifications incomplete',()=>{
    const q=evaluateProductQuality(product({A:'1'}))
    expect(q.status).toBe('incomplete')
    expect(q.issues.some((i)=>i.code==='LOW_SPEC_COUNT')).toBe(true)
  })
})
