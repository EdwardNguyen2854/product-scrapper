import { describe, expect, it } from 'vitest'
import { normalizeAventicsSku, skuFromLabeledText, skuFromProductUrl } from '../src/scraper/sku'

describe('AVENTICS SKU helpers', () => {
  const supported = [
    'R480698477',
    '0821000002',
    'G617A40010A0006',
    'SH03101LB16DS4',
    'G651A5S610A00FH'
  ]

  it('accepts legacy and mixed alphanumeric SKU families', () => {
    for (const sku of supported) expect(normalizeAventicsSku(sku.toLowerCase())).toBe(sku)
  })

  it('uses the canonical Emerson product slug as the primary identity', () => {
    for (const sku of supported) {
      expect(skuFromProductUrl(`https://discreteautomation.emerson.com/product/aventics-sku-${sku.toLowerCase()}`)).toBe(sku)
    }
  })

  it('accepts explicitly labeled mixed alphanumeric identifiers', () => {
    expect(skuFromLabeledText('Part Number: G617A40010A0006')).toBe('G617A40010A0006')
    expect(skuFromLabeledText('SKU SH03101LB16DS4')).toBe('SH03101LB16DS4')
  })

  it('rejects obvious prose and short numeric values', () => {
    expect(normalizeAventicsSku('PRODUCT')).toBe('')
    expect(normalizeAventicsSku('617')).toBe('')
  })
})
