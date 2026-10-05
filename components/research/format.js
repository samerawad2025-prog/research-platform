// Small display helpers shared by the public research components.

// The title in the reader's language first, the other one second; never
// an invented translation, never the same text twice.
export function titles(r, locale) {
  const en = r.title || null
  const ar = r.title_ar || null
  const main = locale === 'ar' ? (ar ? { text: ar, lang: 'ar' } : en ? { text: en, lang: 'en' } : null)
    : en ? { text: en, lang: 'en' } : ar ? { text: ar, lang: 'ar' } : null
  const other = main && main.lang === 'en' ? (ar && ar !== en ? { text: ar, lang: 'ar' } : null)
    : main ? (en && en !== ar ? { text: en, lang: 'en' } : null) : null
  return { main, other }
}

export function named(o, locale) {
  if (!o) return null
  if (o.text) return o.text
  return (locale === 'ar' ? o.name_ar || o.name_en : o.name_en || o.name_ar) || null
}

export function fileSize(bytes, t) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return t.sizeKB(Math.max(1, Math.round(bytes / 1024)))
  return t.sizeMB((bytes / (1024 * 1024)).toFixed(1))
}
