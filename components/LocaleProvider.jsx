'use client'

// Holds the interface language on the client. The server renders the
// first paint from the cookie (see app/layout.js), so this only has to
// keep the choice in state and apply a change in place.
//
// Switching is deliberately non-destructive: no reload, no remount, no
// router refresh. Someone halfway through the submission form keeps
// every value, checkbox and selected file when they change language.

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { LOCALE_COOKIE, dirFor, messagesFor, normalizeLocale } from '../lib/i18n'

const LocaleContext = createContext(null)

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export default function LocaleProvider({ initialLocale, children }) {
  const [locale, setLocaleState] = useState(() => normalizeLocale(initialLocale))

  const setLocale = useCallback((next) => {
    const value = normalizeLocale(next)
    setLocaleState(value)

    const secure = window.location.protocol === 'https:' ? '; secure' : ''
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`

    // <html> is rendered by the server layout, so it is updated here
    // directly rather than by re-rendering the document.
    document.documentElement.lang = value
    document.documentElement.dir = dirFor(value)
    document.title = messagesFor(value).meta.title
  }, [])

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('useLocale must be used inside LocaleProvider')
  return context
}
