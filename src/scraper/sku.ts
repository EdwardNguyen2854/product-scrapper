/**
 * AVENTICS catalog SKUs are not restricted to one legacy format. Current
 * Emerson pages use R-prefixed, numeric, and mixed alphanumeric identifiers
 * (for example R480698477, 0821000002, G617A40010A0006, SH03101LB16DS4).
 */
export function normalizeAventicsSku(raw: string | null | undefined): string {
  if (!raw) return ''
  let value = raw.trim()
  try { value = decodeURIComponent(value) } catch { /* keep raw text */ }
  value = value.replace(/^AVENTICS-/i, '').trim().toUpperCase()

  // Keep this intentionally format-agnostic while rejecting obvious prose/IDs.
  // Product URLs remain the strongest identity source; this validator is only a
  // safety gate for values extracted from labels/JSON.
  if (!/^[A-Z0-9][A-Z0-9._-]{4,39}$/.test(value)) return ''
  if (!/\d/.test(value)) return ''
  if (/^\d+$/.test(value) && value.length < 8) return ''
  return value
}

export function skuFromProductUrl(url: string): string {
  const slug = url.match(/aventics-sku-([^/?#]+)/i)?.[1]
  return normalizeAventicsSku(slug)
}

export function skuFromLabeledText(text: string): string {
  const labeled = text.match(/(?:part\s*number|sku|catalog\s*number|material\s*number|product\s*number)\s*:?\s*((?:AVENTICS-)?[A-Z0-9][A-Z0-9._-]{4,39})/i)?.[1]
  const fromLabel = normalizeAventicsSku(labeled)
  if (fromLabel) return fromLabel

  // Legacy fallbacks remain useful on pages that do not label the identifier.
  const legacy = text.match(/\b(?:R\d{8,}|\d{10})\b/i)?.[0]
  return normalizeAventicsSku(legacy)
}
