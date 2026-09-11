import * as cheerio from 'cheerio'
import type { AssetCategory, AssetRecord, AssetType, SourceMethod } from '../shared/types'
import { normalizeAventicsSku, skuFromLabeledText, skuFromProductUrl } from './sku'

export type ParsedAsset = Omit<AssetRecord, 'id' | 'productId' | 'detectedAt'>

export interface ParsedProductPage {
  sku: string
  name: string
  description: string
  specifications: Record<string, string>
  assets: ParsedAsset[]
}

const clean = (value: string): string => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

function inferSku(url: string, text = ''): string {
  return skuFromProductUrl(url) || skuFromLabeledText(text)
}

function addPair(target: Record<string, string>, keyRaw: string, valueRaw: string): void {
  const key = clean(keyRaw).replace(/[:\-–—]+$/, '').trim()
  const value = clean(valueRaw)
  if (!key || !value) return
  if (key.length > 120 || value.length > 3000) return
  if (/^(specifications?|features?|downloads?|parts\s*&\s*accessories)$/i.test(key)) return
  if (/^(add to cart|add to list|where to buy)$/i.test(value)) return
  if (!target[key]) target[key] = value
}

function absoluteUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base)
    if (!['http:', 'https:'].includes(u.protocol)) return null
    return u.toString()
  } catch {
    return null
  }
}

function fileFormat(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const ext = pathname.match(/\.([a-z0-9]{2,5})$/)?.[1]
    return ext ? ext.toUpperCase() : ''
  } catch {
    return ''
  }
}

function classifyAsset(url: string, labelRaw: string): { type: AssetType; category: AssetCategory } | null {
  const label = clean(labelRaw).toLowerCase()
  const haystack = `${url.toLowerCase()} ${label}`
  const format = fileFormat(url).toLowerCase()

  if (/\b(step|stp)\b/.test(haystack) || ['step', 'stp'].includes(format)) return { type: 'cad', category: 'step' }
  if (/\bsat\b/.test(haystack) || format === 'sat') return { type: 'cad', category: 'sat' }
  if (/\b(iges|igs)\b/.test(haystack) || ['iges', 'igs'].includes(format)) return { type: 'cad', category: 'iges' }
  if (/\b(cad|cadenas|3d model|3d-model|download drawing|download model)\b/i.test(haystack)) return { type: 'cad', category: 'cad_portal' }

  if (format === 'pdf' || /\b(pdf|datasheet|data sheet|manual|certificate|technical document|instructions?|documentation)\b/i.test(haystack)) {
    if (/data\s*sheet|datasheet/i.test(haystack)) return { type: 'document', category: 'datasheet' }
    if (/manual|instructions?/i.test(haystack)) return { type: 'document', category: 'manual' }
    if (/certificate|declaration|compliance/i.test(haystack)) return { type: 'document', category: 'certificate' }
    return { type: 'document', category: 'technical_document' }
  }

  if (/\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(url) || /\b(product image|image|photo)\b/i.test(label)) {
    return { type: 'image', category: 'product_image' }
  }
  return null
}

function assetKey(asset: ParsedAsset): string {
  return `${asset.type}|${asset.url}`.toLowerCase()
}

function collectAssets($: cheerio.CheerioAPI, baseUrl: string, sku: string): ParsedAsset[] {
  const assets = new Map<string, ParsedAsset>()
  const add = (rawUrl: string, title: string, source: SourceMethod = 'http', forced?: { type: AssetType; category: AssetCategory }) => {
    const url = absoluteUrl(rawUrl, baseUrl)
    if (!url) return
    const classification = forced ?? classifyAsset(url, title)
    if (!classification) return
    if (/logo|favicon|sprite|icon|tracking|analytics|placeholder/i.test(url) && classification.type === 'image') return
    const asset: ParsedAsset = {
      type: classification.type,
      category: classification.category,
      title: clean(title) || classification.category.replaceAll('_', ' '),
      url,
      format: fileFormat(url),
      source
    }
    assets.set(assetKey(asset), asset)
  }

  const og = $('meta[property="og:image"], meta[name="twitter:image"]').first().attr('content')
  if (og) add(og, `${sku || 'Product'} image`, 'http', { type: 'image', category: 'product_image' })

  $('img[src], img[data-src], source[srcset]').each((_i, node) => {
    const el = $(node)
    const raw = el.attr('src') || el.attr('data-src') || (el.attr('srcset') || '').split(',')[0]?.trim().split(/\s+/)[0] || ''
    if (!raw) return
    const alt = el.attr('alt') || el.attr('title') || ''
    const combined = `${alt} ${raw}`
    if (sku && !combined.toLowerCase().includes(sku.toLowerCase()) && !/product|aventics|cylinder|valve|image/i.test(combined)) return
    add(raw, alt || `${sku || 'Product'} image`, 'http', { type: 'image', category: 'product_image' })
  })

  $('a[href]').each((_i, node) => {
    const el = $(node)
    const href = el.attr('href') || ''
    const label = `${clean(el.text())} ${el.attr('title') || ''} ${el.attr('aria-label') || ''}`
    add(href, label || href)
  })

  $('script[type="application/ld+json"]').each((_index, node) => {
    try {
      const parsed = JSON.parse($(node).text())
      const walk = (value: unknown, parentKey = ''): void => {
        if (typeof value === 'string') {
          if (/^https?:\/\//i.test(value)) {
            if (/image/i.test(parentKey)) add(value, `${sku || 'Product'} image`, 'http', { type: 'image', category: 'product_image' })
            else add(value, parentKey || value)
          }
          return
        }
        if (Array.isArray(value)) return value.forEach((item) => walk(item, parentKey))
        if (value && typeof value === 'object') {
          for (const [key, item] of Object.entries(value as Record<string, unknown>)) walk(item, key)
        }
      }
      walk(parsed)
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  })

  // Prefer one primary product image. Keep all documents and CAD assets.
  const values = Array.from(assets.values())
  const images = values.filter((a) => a.type === 'image')
  const primaryImage = images.find((a) => sku && a.url.toLowerCase().includes(sku.toLowerCase())) ?? images[0]
  return [...(primaryImage ? [primaryImage] : []), ...values.filter((a) => a.type !== 'image')]
}

export function parseProductHtml(html: string, url: string, skuHint = ''): ParsedProductPage {
  const $ = cheerio.load(html)
  const pageText = clean($.root().text())
  let sku = normalizeAventicsSku(skuHint) || inferSku(url, pageText)
  let name = clean($('h1').first().text())
  let description = ''
  const specifications: Record<string, string> = {}

  $('script[type="application/ld+json"]').each((_index, node) => {
    try {
      const parsed = JSON.parse($(node).text())
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        const candidates = item?.['@graph'] ? item['@graph'] : [item]
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object') continue
          const type = String(candidate['@type'] ?? '')
          if (!/Product/i.test(type)) continue
          if (!name && candidate.name) name = clean(String(candidate.name))
          if (!description && candidate.description) description = clean(String(candidate.description))
          if (!sku && candidate.sku) sku = normalizeAventicsSku(clean(String(candidate.sku)))
        }
      }
    } catch {
      // Ignore malformed third-party JSON-LD blocks.
    }
  })

  if (!description) {
    const meta = $('meta[name="description"]').attr('content')
    if (meta) description = clean(meta)
  }

  if (!description) {
    const body = clean($('body').text())
    const match = body.match(/Product Description\s*-?\s*(.+?)(?=Specifications|Features|Downloads|Parts\s*&\s*Accessories|$)/i)
    if (match) description = clean(match[1])
  }

  const partNumber = pageText.match(/Part Number\s*:?\s*((?:AVENTICS-)?[A-Z0-9][A-Z0-9._-]{4,39})/i)?.[1]
  if (partNumber && normalizeAventicsSku(partNumber)) addPair(specifications, 'Part Number', partNumber)
  const price = pageText.match(/(?:US\$|USD\s*|\$)\s*[\d,]+(?:\.\d{2})?/)?.[0]
  if (price) addPair(specifications, 'Price', price)

  $('table tr').each((_index, row) => {
    const cells = $(row).find('th, td').toArray().map((cell) => clean($(cell).text()))
    if (cells.length >= 2) addPair(specifications, cells[0], cells.slice(1).join(' '))
  })

  $('dl').each((_index, dl) => {
    $(dl).find('dt').each((_i, dt) => addPair(specifications, $(dt).text(), $(dt).next('dd').text()))
  })

  const specHeading = $('h1,h2,h3,h4,h5,div,span').filter((_index, node) => /^Specifications$/i.test(clean($(node).text()))).first()
  if (specHeading.length) {
    const regionCandidates = [specHeading.parent(), specHeading.parent().next(), specHeading.next(), specHeading.closest('section'), specHeading.closest('[class*="tab"]')]
    for (const region of regionCandidates) {
      if (!region?.length) continue
      region.find('div, li').each((_index, row) => {
        const direct = $(row).children().toArray()
        if (direct.length !== 2) return
        addPair(specifications, $(direct[0]).text(), $(direct[1]).text())
      })
    }
  }

  $('[class*="spec"], [class*="attribute"], [class*="property"]').each((_index, node) => {
    const direct = $(node).children().toArray()
    if (direct.length === 2) addPair(specifications, $(direct[0]).text(), $(direct[1]).text())
  })

  for (const key of Object.keys(specifications)) {
    if (/^(select columns|best match|availability|qty|quantity)$/i.test(key)) delete specifications[key]
  }

  if (!name) {
    const title = clean($('title').text())
    name = title.replace(/\s*\|.*$/, '')
  }

  name = clean(name)
  description = clean(description)
  sku = normalizeAventicsSku(sku || inferSku(url, `${name} ${pageText}`))
  const assets = collectAssets($, url, sku)
  return { sku, name, description, specifications, assets }
}

export function isUsefulProduct(data: ParsedProductPage, expectedSku?: string): boolean {
  if (!data.sku || !data.name) return false
  const actual = normalizeAventicsSku(data.sku)
  const expected = normalizeAventicsSku(expectedSku)
  if (expected && actual !== expected) return false
  return Object.keys(data.specifications).length > 0
}
