# Notes for the authors (not part of the submission)

## Must be checked at the source before submission

- **Journal limits.** The web research for this draft could not open pubs.rsna.org. Search
  summaries gave 600 words, 6 references, up to 2 tables/figures, no more than 7 authors, sections
  Introduction / Materials and Methods / Results / Discussion for a *Radiology* Research Letter;
  one conflicting summary said 350 words / 5 references / no table (probably the Letters to the
  Editor block). The draft follows the 600 / 6 / 2 version. Body text is currently about 600
  words including placeholders. Check https://pubs.rsna.org/page/radiology/author-instructions.
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

- Model/agent name and version; agent runtime, number of user messages, usage cost (session log).
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
