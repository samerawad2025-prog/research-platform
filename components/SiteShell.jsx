'use client'

// Skip link, header, the single <main> landmark and the contact footer.
// A client component so the shell's language changes in place when the
// toggle is used, without reloading the page underneath it.

import Link from 'next/link'
import { useLocale } from './LocaleProvider'
import { CONTACT_EMAIL, CONTACT_PHONE, messagesFor } from '../lib/i18n'
import styles from './SiteShell.module.css'

export default function SiteShell({ children }) {
  const { locale, setLocale } = useLocale()
  const t = messagesFor(locale).shell

  return (
    <>
      <a href="#main-content" className={styles.skipLink}>
        {t.skipLink}
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.wordmark}>
            {t.wordmark}
          </Link>
          <div className={styles.headerActions}>
            <nav>
              <Link href="/submit" className={styles.navLink}>
                {t.navSubmit}
              </Link>
            </nav>
            {/* Offers the other language, written in that language, so the
                whole control — visible word and accessible name — carries
                the target language's lang attribute. */}
            <button
              type="button"
              className={styles.langToggle}
              lang={t.switchTo}
              aria-label={t.switchAriaLabel}
              onClick={() => setLocale(t.switchTo)}
            >
              {t.switchLabel}
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className={styles.main}>
        {children}
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          {/* The official name as a quiet sign-off, in the current
              language only. Plain text, not a second link home. */}
          <p className={styles.footerName}>{t.wordmark}</p>
          <p className={styles.footerLead}>{t.footerLead}</p>
          {/* Label and value share one <span> so they flow as a single line
              of text inside the inline-flex link; as two flex items the
              space between them collapsed and the address broke mid-way. */}
          <ul className={styles.contactList}>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`} className={styles.contactLink}>
                <span>
                  {t.emailLabel} <bdi dir="ltr">{CONTACT_EMAIL}</bdi>
                </span>
              </a>
            </li>
            <li>
              <a href={`https://wa.me/${CONTACT_PHONE.slice(1)}`} className={styles.contactLink}>
                <span>
                  {t.whatsappLabel} <bdi dir="ltr">{CONTACT_PHONE}</bdi>
                </span>
              </a>
            </li>
          </ul>
        </div>
      </footer>
    </>
  )
}
