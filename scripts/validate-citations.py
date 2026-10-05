#!/usr/bin/env python3
"""Phase 3 M6: parse the RIS and BibTeX exports with independent parsers.

Not part of CI (it needs two Python packages). Run locally:

    python3 -m venv /tmp/citev && /tmp/citev/bin/pip install "bibtexparser==1.4.3" rispy
    /tmp/citev/bin/python scripts/validate-citations.py

It asks lib/public/citation.js (through Node) for the exports of synthetic
records and checks what a reference manager would read back: authors whole
and in order, Arabic intact, no invented fields, escaping undone correctly.
"""
import json
import subprocess
import sys

import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.customization import convert_to_unicode
import rispy
from pylatexenc.latex2text import LatexNodes2Text

LATEX = LatexNodes2Text()


def text(v):
    """What a LaTeX-aware reference manager displays for a field value."""
    return LATEX.latex_to_text(v)

URL = "https://research.example.org/research/abcdefghjkmn"
RECORDS = {
    "en": {"public_id": "abcdefghjkmn", "title": "Groundwater Salinity: 50% & Rising_{Gezira}", "abstract": "Line one.\nLine two with $5 # and ~tilde^.",
           "year": 2021, "degree_type": "MSc", "document_type": "thesis",
           "institution": {"name_en": "University of Khartoum"}, "unit": {"name_en": "Faculty of Science"},
           "authors": [{"name": "Amna Hassan Ali"}, {"name": "Omer El Tayeb"}, {"name": "de la Cruz, Maria"}]},
    "ar": {"public_id": "abcdefghjkmp", "title": None, "title_ar": "ملوحة المياه الجوفية في مشروع الجزيرة", "abstract_ar": "دراسة عن الملوحة.",
           "year": None, "degree_type": "دكتوراه", "document_type": "thesis",
           "institution": {"name_en": "University of Khartoum", "name_ar": "جامعة الخرطوم"}, "authors": [{"name": "آمنة حسن علي"}, {"name": "محمد أحمد"}]},
    "mixed": {"public_id": "abcdefghjkmq", "title": "Water {Quality} in Kassala", "title_ar": "جودة المياه في كسلا", "year": 2019,
              "document_type": "article", "authors": [{"name": "A. B. Smith"}, {"name": "محمد أحمد"}]},
    "bare": {"public_id": "abcdefghjkmr", "title": "Only a Title", "authors": [], "document_type": None, "year": None},
}

JS = """
const C = require('./lib/public/citation')
const recs = JSON.parse(process.argv[1]); const url = process.argv[2]
const out = {}
for (const [k, r] of Object.entries(recs)) out[k] = { ris: C.ris(r, k === 'bare' ? null : url), bib: C.bibtex(r, k === 'bare' ? null : url) }
console.log(JSON.stringify(out))
"""
out = json.loads(subprocess.check_output(["node", "-e", JS, json.dumps(RECORDS), URL]))
failed = 0


def check(name, fn):
    global failed
    try:
        fn()
        print(f"ok     {name}")
    except Exception as e:  # noqa: BLE001
        failed += 1
        print(f"FAIL   {name} — {type(e).__name__}: {e}")


def bib(k, raw=True):
    p = BibTexParser(common_strings=False)
    if not raw:
        p.customization = convert_to_unicode
    db = bibtexparser.loads(out[k]["bib"], parser=p)
    assert len(db.entries) == 1, db.entries
    return db.entries[0]


def ris(k):
    entries = rispy.loads(out[k]["ris"])
    assert len(entries) == 1, entries
    return entries[0]


def en_bib():
    e = bib("en")
    assert e["ENTRYTYPE"] == "mastersthesis", e
    assert e["author"] == "{Amna Hassan Ali} and {Omer El Tayeb} and {de la Cruz, Maria}", e["author"]
    # BibTeX's own name splitting: each braced name is ONE literal name, so
    # no family/given split is guessed (a reference manager shows it whole).
    from bibtexparser.customization import splitname, getnames
    parts = [splitname(n) for n in e["author"].split(" and ")]
    assert [p["last"] for p in parts] == [["{Amna Hassan Ali}"], ["{Omer El Tayeb}"], ["{de la Cruz, Maria}"]], parts
    assert all(not p.get("first") for p in parts), parts
    assert e["title"] == r"{Groundwater Salinity: 50\% \& Rising\_\{Gezira\}}", e["title"]
    assert text(e["title"]) == "Groundwater Salinity: 50% & Rising_{Gezira}", text(e["title"])
    assert text(e["abstract"]) in ("Line one. Line two with $5 # and ~tildeˆ.", "Line one. Line two with $5 # and ~tilde^."), text(e["abstract"])
    assert e["year"] == "2021" and e["school"] == "University of Khartoum" and e["url"] == URL
    assert "doi" not in e and "journal" not in e and "publisher" not in e


def en_ris():
    e = ris("en")
    assert e["type_of_reference"] == "THES"
    assert e["authors"] == ["Amna Hassan Ali", "Omer El Tayeb", "de la Cruz, Maria"]
    assert e["title"] == "Groundwater Salinity: 50% & Rising_{Gezira}"
    assert e["year"] == "2021" and e["publisher"] == "University of Khartoum" and e["urls"] == [URL]
    assert e["abstract"] == "Line one. Line two with $5 # and ~tilde^."
    assert "doi" not in e


def ar_both():
    b, r = bib("ar"), ris("ar")
    assert b["ENTRYTYPE"] == "misc", "an Arabic degree name is not guessed into a thesis type"
    assert b["title"].strip("{}") == "ملوحة المياه الجوفية في مشروع الجزيرة"
    assert [n.strip("{}") for n in b["author"].split(" and ")] == ["آمنة حسن علي", "محمد أحمد"]
    assert "year" not in b and "url" in b
    assert r["title"] == "ملوحة المياه الجوفية في مشروع الجزيرة" and r["authors"] == ["آمنة حسن علي", "محمد أحمد"]
    assert "year" not in r


def mixed_both():
    b, r = bib("mixed"), ris("mixed")
    assert b["ENTRYTYPE"] == "misc" and "journal" not in b, b
    assert b["title"] == r"{Water \{Quality\} in Kassala}", b["title"]
    assert text(b["title"]) == "Water {Quality} in Kassala", text(b["title"])
    assert "جودة المياه في كسلا" in b["note"]
    assert r["type_of_reference"] == "GEN" and r["translated_title"] == "جودة المياه في كسلا"
    assert "publisher" not in r and "journal_name" not in r


def bare_both():
    b, r = bib("bare"), ris("bare")
    assert set(b) == {"ENTRYTYPE", "ID", "title"}, b
    assert set(r) == {"type_of_reference", "title"}, r


check("BibTeX (bibtexparser): English thesis, special characters, names whole and in order", en_bib)
check("RIS (rispy): English thesis, special characters, multiline abstract", en_ris)
check("both: Arabic-only record, no year invented", ar_both)
check("both: mixed English/Arabic article, no journal or publisher invented", mixed_both)
check("both: a record with only a title exports only a title", bare_both)
print(f"\n{failed} check(s) failed." if failed else "\nAll citation parser checks passed.")
sys.exit(1 if failed else 0)
