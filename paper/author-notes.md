# Notes for the authors (not part of the submission)

## Must be checked at the source before submission

- **Journal limits.** The web research for this draft could not open pubs.rsna.org. Search
  summaries gave 600 words, 6 references, up to 2 tables/figures, no more than 7 authors, sections
  Introduction / Materials and Methods / Results / Discussion for a *Radiology* Research Letter;
  one conflicting summary said 350 words / 5 references / no table (probably the Letters to the
  Editor block). The draft follows the 600 / 6 / 2 version. Body text is currently about 700
  words including placeholders and must be shortened once the results are in. Check https://pubs.rsna.org/page/radiology/author-instructions.
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
  branding, colour scheme, central rating storage, manuscript changes) took about [x] min — see
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

The interface uses neutral greys with a crimson accent (#c8102e) chosen to resemble the journal's
red. The exact brand colour could not be checked (publisher site not reachable from the build
environment); it is one value in `pacs/config/site.json`.

## Authors

Jonathan Kottlors (first), Nedim Beste, David Maintz, Iza Iuga (last). Affiliations, degrees and
the exact spelling of names were not provided and are placeholders.
