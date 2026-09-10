import { describe, expect, it } from 'vitest'
import { pageCountForRange, pageNumberForRange, parseProductRangeText } from '../src/scraper/discovery'

describe('product pagination helpers', () => {
  it('parses the Emerson product result range', () => {
    expect(parseProductRangeText('1 - 10 of 560 results for products')).toEqual({ start: 1, end: 10, total: 560 })
    expect(parseProductRangeText('11 – 20 of 560 results for products')).toEqual({ start: 11, end: 20, total: 560 })
  })

  it('accepts comma-formatted totals and surrounding text', () => {
    expect(parseProductRangeText('Showing 991 - 1,000 of 1,234 results for products Sort')).toEqual({ start: 991, end: 1000, total: 1234 })
  })

  it('rejects malformed ranges', () => {
    expect(parseProductRangeText('10 - 1 of 560 results for products')).toBeNull()
    expect(parseProductRangeText('560 products')).toBeNull()
  })

  it('computes expected page count', () => {
    expect(pageCountForRange(560, 10)).toBe(56)
    expect(pageCountForRange(561, 10)).toBe(57)
    expect(pageCountForRange(0, 10)).toBe(0)
  })

  it('derives the active page from the visible result range', () => {
    expect(pageNumberForRange({ start: 1, end: 10, total: 560 })).toBe(1)
    expect(pageNumberForRange({ start: 11, end: 20, total: 560 })).toBe(2)
    expect(pageNumberForRange({ start: 551, end: 560, total: 560 })).toBe(56)
    expect(pageNumberForRange(null)).toBeNull()
  })
})
