// lib/validation/linkedin.js
//
// LinkedIn profile links, checked the same way in the browser and in
// confirm_researcher_metadata (migration 0013): an https linkedin.com
// /in/<name> address and nothing else. The browser also tidies what
// people commonly type (no scheme, http, trailing spaces) before checking,
// so a correct link is not refused for a missing "https://".

const PROFILE = /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[^/?#\s]{1,100}\/?$/i

function normalizeLinkedIn(value) {
  let v = String(value ?? '').trim()
  if (!v) return ''
  if (/^http:\/\//i.test(v)) v = 'https://' + v.slice(7)
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v
  return v
}

// { state: 'empty' | 'valid' | 'invalid', url }
function validateLinkedIn(value) {
  const url = normalizeLinkedIn(value)
  if (!url) return { state: 'empty', url: '' }
  return PROFILE.test(url) ? { state: 'valid', url } : { state: 'invalid', url }
}

// What a public page may show for one researcher (M5, not built yet): a
// link only when its owner chose to display it and it is still valid.
function publicLinkedIn(researcher) {
  if (!researcher || researcher.linkedin_public !== true) return null
  const v = validateLinkedIn(researcher.linkedin_url)
  return v.state === 'valid' ? v.url : null
}

module.exports = { validateLinkedIn, normalizeLinkedIn, publicLinkedIn, LINKEDIN_PROFILE: PROFILE }
