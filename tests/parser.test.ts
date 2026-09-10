import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isUsefulProduct, parseProductHtml } from '../src/scraper/parser'

const fixture = readFileSync(resolve(__dirname, 'fixtures/product.html'), 'utf8')

describe('parseProductHtml', () => {
  it('extracts identity, description, dynamic specifications, and assets', () => {
    const parsed = parseProductHtml(fixture, 'https://discreteautomation.emerson.com/product/aventics-sku-r480698486')
    expect(parsed.sku).toBe('R480698486')
    expect(parsed.name).toContain('TaskMaster')
    expect(parsed.description).toContain('1.5X12')
    expect(parsed.specifications['Part Number']).toBe('AVENTICS-R480698486')
    expect(parsed.specifications['Price']).toBe('$207.57')
    expect(parsed.specifications['Standards']).toBe('NFPA')
    expect(parsed.specifications['Piston Ø']).toBe('38.1 mm')
    expect(parsed.specifications['Max. working pressure']).toBe('10 bar')
    expect(parsed.assets.some((a) => a.type === 'image')).toBe(true)
    expect(parsed.assets.some((a) => a.type === 'document' && a.category === 'datasheet')).toBe(true)
    expect(parsed.assets.some((a) => a.type === 'cad' && a.category === 'step')).toBe(true)
    expect(isUsefulProduct(parsed, 'R480698486')).toBe(true)
  })
})
