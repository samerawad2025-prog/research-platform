// lib/fields/researcherSeed.js
//
// Builds the researcher list the confirmation screen starts from, given
// what extraction found and who is already on the paper.
//
// The bug this exists for (BUG_HISTORY.md #33). When extraction found a
// researcher list, the screen seeded from it and threw away every
// `researcher_id`. `confirm_researcher_metadata` only takes its
// "update the existing row" branch when an id is supplied, so with none
// it INSERTED a fresh researcher for every name — and then deleted
// every link not in the list it had just been given, including the
// submitter's own.
//
// The effect, confirmed across all three confirmed papers in
// production: the submitter is detached from their own paper, the paper
// ends up linked only to email-less duplicates, and `researchers`
// accumulates a copy of every author on every confirmation. 18
// researcher rows for 10 papers, of which exactly 8 have no email —
// 1 + 1 + 6, precisely the three confirmations.
//
// `CLAUDE_CODE_HANDOVER.md` claimed this RPC "preserves the submitter's
// own email by matching on researcher_id, not by delete-and-recreate."
// The RPC does do that. The client just never gave it an id to match
// on, so the guarantee never actually held.

// Names are compared with a deliberately conservative normalization:
// case-folded, whitespace collapsed, and Arabic presentation forms left
// alone. It only has to recognise "the same name written the same way",
// because a wrong match would attach one person's contact details to
// another person's name — far worse than failing to match and creating
// a new row, which is merely the current behaviour.
function normalizeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
}

// extractedNames: [{ name, author_order }] from extraction
// existing:       [{ researcher_id, full_name, author_order, linkedin_url, facebook_url }]
//
// Returns the seed list, carrying `researcher_id` across wherever an
// extracted name matches somebody already on the paper.
function seedResearchers({ extracted, existing, alreadyConfirmed }) {
  const onPaper = Array.isArray(existing) ? existing : []

  const fromExisting = () =>
    onPaper.map((r) => ({
      researcher_id: r.researcher_id,
      full_name: r.full_name,
      author_order: r.author_order,
      linkedin_url: r.linkedin_url || '',
      facebook_url: r.facebook_url || '',
    }))

  // Once a human has confirmed, the stored list is authoritative and a
  // later extraction must never reshape it.
  if (alreadyConfirmed) return withFallback(fromExisting())

  const names = extracted?.status === 'found' && Array.isArray(extracted.value) ? extracted.value : null
  if (!names || names.length === 0) return withFallback(fromExisting())

  // Each existing researcher may be claimed by at most one extracted
  // name, so two authors who genuinely share a name cannot both collapse
  // onto the same row.
  const unclaimed = new Map()
  for (const r of onPaper) {
    if (!r.researcher_id) continue
    const key = normalizeName(r.full_name)
    if (!unclaimed.has(key)) unclaimed.set(key, [])
    unclaimed.get(key).push(r)
  }

  const seeded = names.map((r, i) => {
    const key = normalizeName(r.name)
    const bucket = unclaimed.get(key)
    const match = bucket && bucket.length > 0 ? bucket.shift() : null

    return {
      // Present only when matched. An absent id is what tells the RPC
      // to insert a genuinely new person, which is correct for an
      // author the paper did not already know about.
      ...(match ? { researcher_id: match.researcher_id } : {}),
      full_name: r.name,
      author_order: r.author_order ?? i + 1,
      linkedin_url: match?.linkedin_url || '',
      facebook_url: match?.facebook_url || '',
    }
  })

  return withFallback(seeded)
}

// The screen always needs at least one editable row.
function withFallback(list) {
  return list.length > 0 ? list : [{ full_name: '', author_order: 1, linkedin_url: '', facebook_url: '' }]
}

module.exports = { seedResearchers, normalizeName }
