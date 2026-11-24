# Notes for the authors (not part of the submission)

## Must be checked at the source before submission

- **Journal limits.** A web search restricted to pubs.rsna.org returned for *Radiology*
  Research Letters: no more than 600 words of text, 6 references, up to 2 tables or figures, and
  no more than 7 authors. The page itself could not be opened (the site blocks automated access),
  so read it once before submission: https://pubs.rsna.org/page/radiology/author-instructions.
  The body text is at the limit (595 words including placeholders); filled-in results must
  not make it longer.
- **Summary statement / key results.** Not confirmed for *Radiology* Research Letters.
- **References.** None was verified on the publisher page; each is marked [verify]. Reference 1
  is the closest prior work and should be read in full.
- **AI disclosure.** RSNA policy (as summarised by search results) requires naming the model or
  tool, version and manufacturer for AI-generated content, and AI tools cannot be authors. Fill
  in the bracket in Materials and Methods and add the disclosure the submission form asks for.
- **Cost comparison.** No peer-reviewed PACS cost figure was found. Available numbers are
  vendor or market-report statements (see supplement, section 4). Either find a citable source or
  keep the sentence qualitative.
- **Data attribution.** CC BY requires attribution of four collections; with a 6-reference limit
  the citations are in the supplement and in the app. Confirm that the journal accepts this.

## To be filled in from the study

- Model/agent name and version; usage cost (session log / billing).
- Effort figures. From the repository time stamps: session start about 13:07 UTC, first tested
  version committed 13:52 UTC on 24 Nov 2026 (about 45 min); the second request (department
  branding, colour scheme, central rating storage, manuscript changes) took about 14 min (13:55–14:08 UTC) — see
  the commit times. Human input: two free-text messages and three multiple-choice answers. These
  are bracketed in the text until confirmed against the session log. Reading and testing time of
  the author is not included and should be reported separately.
- Ethics statement and consent wording (reader study without patient data; ask the local IRB
  whether a waiver/exemption applies).
- Reader numbers and all bracketed results: Admin page → load results → CSV.
- Whether readers used their own workstations and which clinical PACS products they compare with.

## Honest scope of the claim

The system is a browser application on a static file host: archive index, viewer, worklist,
reporting and accounts work, but there is no DICOM network interface (C-STORE/DICOMweb), no RIS/HL7
integration and no server-side storage. "Complete PACS" in the title is therefore arguable;
"web-based PACS" with the limitation stated (as drafted) or "PACS workstation" are safer wordings.
The decision to avoid a server was made because hosting was to stay within GitHub.

## Colour scheme

The interface uses neutral greys with a green accent, as requested to match *Radiology*. The
journal's exact green could not be read from pubs.rsna.org (automated access is blocked) and is
not in RSNA's public style guide, so the value in `pacs/config/site.json` (`accent`, `accentText`)
is provisional. Replace it with the exact hex value and regenerate the figures.

## Authors

Jonathan Kottlors (first), Nedim Beste, David Maintz, Iza Iuga (last). Affiliations, degrees and
the exact spelling of names were not provided and are placeholders.
