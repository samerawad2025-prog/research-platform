'use client'

// A country picker + national number input that together produce one
// E.164 string for storage.
//
// Deliberately not a packaged phone-input component. The packaged
// options (react-phone-number-input and friends) ship their own CSS,
// their own flag sprite or SVG set, and their own focus/keyboard
// behaviour to override - all of which this form would have to fight
// to stay consistent with the bilingual styling already here. The part
// that genuinely needs a library is the validation metadata, which
// lib/validation/phone.js takes from libphonenumber-js. See CLAUDE.md
// on not adding weight without a reason.
//
// The picker itself is ./CountrySelect, a searchable combobox. It
// replaced a native <select>, whose option list cannot be styled: 245
// countries rendered as one unbroken line each, with no way to find
// one except holding a letter key.

import { useId } from 'react'
import CountrySelect from './CountrySelect'
import { formatAsYouType } from '../lib/validation/phone'
import styles from './PhoneField.module.css'

export default function PhoneField({
  label,
  hint,
  country,
  onCountryChange,
  value,
  onValueChange,
  validation,
  showError,
  onBlur,
}) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`

  const invalid = showError && validation.state === 'invalid'

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>

      <div className={`${styles.controls} ${invalid ? styles.controlsInvalid : ''}`}>
        <CountrySelect value={country} onChange={onCountryChange} />

        <input
          id={inputId}
          className={styles.numberInput}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={value}
          // Deliberately NOT reformatted on every keystroke. An
          // as-you-type formatter inserts and removes spaces while the
          // caret is mid-string, which makes backspace jump in a
          // controlled React input unless the caret is restored by
          // hand. Tidying on blur gives the same readable result with
          // none of that hazard, and validation is still live on every
          // keystroke, which is what the person actually needs.
          onChange={(e) => onValueChange(e.target.value)}
          onBlur={() => {
            if (value.trim()) onValueChange(formatAsYouType(value, country))
            onBlur?.()
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : hint ? hintId : undefined}
        />
      </div>

      {invalid && (
        <p id={errorId} role="alert" className={styles.error}>
          {validation.error}
        </p>
      )}

      {hint && !invalid && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  )
}
