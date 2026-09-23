'use client'

// A country picker built as a real combobox: a button that shows the
// current selection, and a popup listbox that can be typed into.
//
// Why not the native <select> this replaces: a native option list
// cannot be styled, so every country rendered as one long unbroken
// line of "flag name +code" with the dial code pushed far to the
// right, and there was no way to search 245 entries except by holding
// a letter key. That is the complexity this replaces.
//
// Behaviour follows the WAI-ARIA combobox pattern rather than being
// invented: ArrowUp/ArrowDown move the active option, Enter selects,
// Escape closes, Home/End jump, typing filters, and the active option
// is tracked with aria-activedescendant so a screen reader announces
// it. Focus stays in the text input the whole time, which is what
// makes it feel immediate.

import { useEffect, useMemo, useRef, useState, useId } from 'react'
import { listCountries } from '../lib/validation/phone'
import { useLocale } from './LocaleProvider'
import { messagesFor } from '../lib/i18n'
import styles from './CountrySelect.module.css'

function flagEmoji(code) {
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// Matches on country name, ISO code, or dial code, with or without
// the leading "+", so "249", "+249", "sd" and "sud" all find Sudan.
// Both names are always searched, whatever the interface language:
// someone in the Arabic interface may still type "Sudan", and vice versa.
function matches(country, query) {
  if (!query) return true
  const q = query.trim().toLowerCase().replace(/^\+/, '')
  return (
    country.name_en.toLowerCase().includes(q) ||
    country.name_ar.includes(query.trim()) ||
    country.code.toLowerCase().startsWith(q) ||
    country.callingCode.startsWith(q)
  )
}

export default function CountrySelect({ value, onChange, disabled }) {
  const { locale } = useLocale()
  const t = messagesFor(locale).country
  // listCountries() is cached and sorted by English name. Arabic sorts a
  // copy by Arabic name so the shared cache is never mutated.
  const countries = useMemo(() => {
    const all = listCountries()
    return locale === 'ar' ? [...all].sort((a, b) => a.name_ar.localeCompare(b.name_ar, 'ar')) : all
  }, [locale])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const id = useId()

  const selected = countries.find((c) => c.code === value) || countries[0]
  const filtered = useMemo(() => countries.filter((c) => matches(c, query)), [countries, query])

  // Keep the highlighted row inside the scroll viewport. `block:
  // 'nearest'` scrolls the list only when the row is actually out of
  // view, so arrowing through the middle of the list doesn't jump.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector(`[data-index="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  // Close on an outside click. Pointerdown rather than click so the
  // popup is gone before a click on something behind it lands.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function openList() {
    if (disabled) return
    setQuery('')
    const current = countries.findIndex((c) => c.code === value)
    setActiveIndex(current > -1 ? current : 0)
    setOpen(true)
    // The input only exists once the popup is open.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  function pick(country) {
    if (!country) return
    onChange(country.code)
    close()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((i) => (i + step + filtered.length) % filtered.length)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(Math.max(0, filtered.length - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault() // never submits the surrounding form
      pick(filtered[activeIndex])
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'Tab') close()
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => (open ? close() : openList())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.trigger(t.name(selected))}
      >
        <span className={styles.flag} aria-hidden="true">{flagEmoji(selected.code)}</span>
        {/* Dial codes are always read left to right; without dir="ltr" an
            RTL line renders "+249" as "249+". */}
        <span className={styles.dial} dir="ltr">+{selected.callingCode}</span>
        <svg className={styles.chevron} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={styles.popup}>
          <input
            ref={inputRef}
            className={styles.search}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={filtered[activeIndex] ? `${id}-opt-${activeIndex}` : undefined}
            aria-label={t.search}
            placeholder={t.search}
            // Arabic or Latin queries each get their own caret direction.
            dir="auto"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={onKeyDown}
          />

          <ul className={styles.list} id={`${id}-list`} role="listbox" ref={listRef}>
            {filtered.map((c, i) => (
              <li
                key={c.code}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={c.code === value}
                className={`${styles.option} ${i === activeIndex ? styles.optionActive : ''} ${c.code === value ? styles.optionSelected : ''}`}
                // Mousedown, not click: click fires after blur, which
                // would close the popup before the choice registers.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(c)
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className={styles.flag} aria-hidden="true">{flagEmoji(c.code)}</span>
                <span className={styles.name}>{t.name(c)}</span>
                <span className={styles.code} dir="ltr">+{c.callingCode}</span>
              </li>
            ))}

            {filtered.length === 0 && <li className={styles.empty}>{t.empty}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
