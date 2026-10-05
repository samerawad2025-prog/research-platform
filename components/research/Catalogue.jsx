'use client'

// The public catalogue. Rendered on the server with the results already in
// it; the search and filters are an ordinary GET form, so the URL holds the
// whole state and everything works by keyboard and without scripts. Only
// the wording follows the reader's language choice.

import Link from 'next/link'
import { useLocale } from '../LocaleProvider'
import { messagesFor } from '../../lib/i18n'
import { titles, named } from './format'
import s from './research.module.css'

function hrefWith(filters, change) {
  const next = { ...filters, ...change }
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== null && v !== '' && !(k === 'page' && v === 1)) p.set(k, String(v))
  const q = p.toString()
  return q ? `/research?${q}` : '/research'
}

export default function Catalogue({ data, filters, error }) {
  const { locale } = useLocale()
  const t = messagesFor(locale).research
  const c = t.catalogue
  const facets = data?.facets || { unit: [], year: [], degree: [], type: [] }
  const total = data?.total || 0
  const page = data?.page || 1
  const pages = Math.max(1, Math.ceil(total / (data?.limit || 20)))
  const anyFilter = Object.keys(filters).some((k) => k !== 'page')
  const withCount = (label, n) => `${label} (${n})`

  // A filter is offered only when public records give it a real choice.
  const select = (name, label, options, current) => (options.length > 1 || current !== undefined) && (
    <label className={s.field}>
      <span>{label}</span>
      <select name={name} defaultValue={current ?? ''}>
        <option value="">{c.any}</option>
        {options}
      </select>
    </label>
  )

  return (
    <div className={s.wrap}>
      <h1 className={s.h1}>{c.title}</h1>
      <p className={s.lead}>{c.intro}</p>

      <form action="/research" method="get" role="search" aria-label={c.searchLabel}>
        <div className={s.search}>
          <label htmlFor="research-q" className={s.srOnly}>{c.searchLabel}</label>
          <input id="research-q" type="search" name="q" defaultValue={filters.q || ''} placeholder={c.searchPlaceholder} maxLength={200} dir="auto" />
          <button className={s.button} type="submit">{c.submit}</button>
        </div>
        <div className={s.layout}>
          {(() => {
            const selects = [
              select('unit', c.unit, facets.unit.map((u) => <option key={u.id} value={u.id}>{withCount(named(u, locale), u.count)}</option>), filters.unit),
              select('year', c.year, facets.year.map((y) => <option key={y.value} value={y.value}>{withCount(y.value, y.count)}</option>), filters.year),
              select('degree', c.degree, facets.degree.map((d) => <option key={d.value} value={d.value}>{withCount(d.value, d.count)}</option>), filters.degree),
              select('type', c.type, facets.type.map((d) => <option key={d.value} value={d.value}>{withCount(c.types[d.value] || d.value, d.count)}</option>), filters.type),
            ].filter(Boolean)
            // No panel when the public records offer no real choice.
            if (selects.length === 0) return anyFilter ? <p><Link className={s.link} href="/research">{c.clear}</Link></p> : <div />
            return (
              <fieldset className={s.filters}>
                <legend>{c.filters}</legend>
                {selects.map((el, i) => <div key={i}>{el}</div>)}
                <div className={s.filterActions}>
                  <button className={s.buttonSecondary} type="submit">{c.apply}</button>
                  {anyFilter && <Link className={s.link} href="/research">{c.clear}</Link>}
                </div>
              </fieldset>
            )
          })()}

          <section aria-live="polite" aria-busy="false">
            {error && <p role="alert" className={s.error}>{c.error} <Link className={s.link} href={hrefWith(filters, {})}>{c.retry}</Link></p>}
            {!error && <p className={s.count}>{filters.q ? c.countFor(total, filters.q) : c.count(total)}</p>}
            {!error && total === 0 && (
              <div className={s.empty}>
                <h2 className={s.h2}>{c.emptyTitle}</h2>
                <p>{anyFilter ? c.emptyFiltered : c.emptyCatalogue}</p>
              </div>
            )}
            <ul className={s.results}>
              {(data?.items || []).map((r) => {
                const { main, other } = titles(r, locale)
                return (
                  <li key={r.public_id} className={s.result}>
                    <h2 className={s.resultTitle}><Link href={`/research/${r.public_id}`} lang={main?.lang} dir="auto">{main?.text}</Link></h2>
                    {other && <p className={s.altTitle} lang={other.lang} dir="auto">{other.text}</p>}
                    {r.authors.length > 0 && <p className={s.byline} dir="auto">{r.authors.map((a) => a.name).join(locale === 'ar' ? '، ' : ', ')}</p>}
                    {r.snippet && <p className={s.snippet} lang={r.snippet_lang || undefined} dir="auto">{r.snippet}</p>}
                    <ul className={s.meta}>
                      {r.year && <li>{r.year}</li>}
                      {named(r.unit, locale) && <li><bdi>{named(r.unit, locale)}</bdi></li>}
                      {r.degree_type && <li><bdi>{r.degree_type}</bdi></li>}
                      {r.document_type && <li>{c.types[r.document_type]}</li>}
                      <li><span className={s.badge}>{r.fulltext ? c.fullText : c.recordOnly}</span></li>
                    </ul>
                  </li>
                )
              })}
            </ul>
            {!error && pages > 1 && (
              <nav className={s.pager} aria-label={c.pagination}>
                {page > 1 ? <Link className={s.buttonSecondary} href={hrefWith(filters, { page: page - 1 })} rel="prev">{c.previous}</Link> : <span />}
                <span className={s.muted}>{c.pageOf(page, pages)}</span>
                {page < pages ? <Link className={s.buttonSecondary} href={hrefWith(filters, { page: page + 1 })} rel="next">{c.next}</Link> : <span />}
              </nav>
            )}
          </section>
        </div>
      </form>
    </div>
  )
}
