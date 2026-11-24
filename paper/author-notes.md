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
- **Cost comparison.** No peer-reviewed PACS cost figure was found. Rough figures from a web
  search (trade press and vendor guides, not verified at the source): enterprise imaging contracts
  reported for single health systems of about USD 20-46 million (5-6 years) up to USD 227 million,
  and SEK 1.6 billion over 10 years for Region Stockholm; vendor guides quote licences of USD
  0.2-1 million or more, annual maintenance of 15-20% of the licence, and USD 0.50-3 per study
  for hosted systems. The manuscript cites one trade-press report (reference 1) for the order of
  magnitude only; replace it if a better source turns up.
- **Data attribution.** CC BY requires attribution of four collections; with a 6-reference limit
  the citations are in the supplement and in the app. Confirm that the journal accepts this.

## To be filled in from the study

- Agent and model: named in the submission copy of the manuscript (Word file sent to the first
  author and stored in OneDrive). The repository copy keeps a placeholder.
- Effort and cost, from the session record: session created 13:17 UTC on 24 Nov 2026; first
  tested version committed 13:52 UTC (35 min); second request done 13:55–14:08 UTC (14 min).
  Human input: two free-text messages and three multiple-choice answers. Usage was about USD 21
  at 14:40 UTC for the whole session, which includes manuscript drafting and later revisions, so
  it overstates the cost of the software alone. The first author's reading and testing time is
  not included.
- Fictitious ratings: every bracketed reader result and Figure 2 are invented
  (`fictitious-results.json`). Regenerate Figure 2 from the real export.
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

Jonathan Kottlors (first), Nedim Beste, David Maintz, Andra-Iza Iuga (last). Found by web search:
the institute's standard affiliation line and address; David Maintz as director of the institute;
Andra-Iza Iuga's full name and ORCID 0000-0002-3694-0235 (University of Cologne publication
server). Not found: degrees, ORCID iDs of the other authors, anything on Nedim Beste, and the
corresponding author's e-mail address. Degrees marked [confirm] are assumptions.

## Public demonstration

https://cathsim-app.github.io/pacs/ with the public account `demo` / `vibepacs-demo` (shown on
the login page; this account stores nothing centrally). The site is served from the `gh-pages`
branch of cathsim-app/cathsim-app.github.io. Running `deploy_redirect.sh` from the simulator
repository force-pushes that branch and would remove the demo; move the PACS to its own
repository before the link is printed.
