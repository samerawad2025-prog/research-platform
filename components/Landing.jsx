'use client'

import Link from 'next/link'
import { useLocale } from './LocaleProvider'
import { dirFor, messagesFor } from '../lib/i18n'
import styles from './Landing.module.css'

export default function Landing() {
  const { locale } = useLocale()
  const t = messagesFor(locale).landing

  // Sets its own lang/dir to opt out of the temporary English/LTR
  // boundary in SiteShell — this page is fully translated.
  return (
    <div className={styles.page} lang={locale} dir={dirFor(locale)}>
      <section className={styles.hero}>
        <h1 className={styles.title}>{t.title}</h1>
        <p className={styles.lead}>{t.lead}</p>
        <Link href="/submit" className={styles.cta}>
          {t.cta}
        </Link>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>{t.howHeading}</h2>
        <ol className={styles.steps}>
          {t.steps.map((step) => (
            <li key={step.heading} className={styles.step}>
              <h3 className={styles.stepHeading}>{step.heading}</h3>
              <p className={styles.stepText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>{t.whatHeading}</h2>
        <p className={styles.sectionText}>{t.whatText}</p>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{t.formatsLabel}</dt>
            <dd>{t.formatsValue}</dd>
          </div>
          <div className={styles.fact}>
            <dt>{t.sizeLabel}</dt>
            <dd>{t.sizeValue}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
