# VibePACS

A browser-based PACS (archive index, worklist, diagnostic viewer, reporting, access control,
reader-evaluation module) whose source code was generated entirely by an AI coding agent.
It is the software artefact of a feasibility study ("Can a complete PACS be vibe-coded?").

**Research prototype. Not a medical device. Not for clinical use. Do not load patient data
that you are not permitted to process on your own computer.**

## What it does

| Area | Functions |
|---|---|
| Archive | Static study store of unmodified DICOM Part 10 objects (gzip transport), JSON index built by `tools/ingest.mjs`; local import of DICOM files/folders into the browser (IndexedDB, never uploaded) |
| DICOM | Own parser (Implicit/Explicit VR LE, Explicit BE, Deflated, sequences, encapsulated data); decoders for native 8/16/32-bit, RLE, JPEG Lossless (Process 14), baseline JPEG (browser), palette colour, YBR/RGB |
| Worklist | Search, modality/status filters, sorting, prior-study indicator, report status, keyboard navigation |
| Viewer | 1×1 – 2×3 layouts, stack scroll, cine, window/level with CT presets, zoom, pan, rotate, flip, invert, radiological default orientation, orientation markers, scale bar, pixel/HU readout |
| Measurements | Length, angle, elliptical/rectangular ROI (mean, SD, min, max, area), point value, labelled arrows; editable, persistent per user |
| 3D | Orthogonal MPR with linked 3D crosshair, MIP/MinIP/average slabs, reference lines, cross-series cursor |
| Comparison | Side-by-side prior study, synchronised scrolling (frame of reference or manual anchor) |
| Reporting | Structured report with templates, measurement insertion, draft/final workflow, prior reports, text export and print |
| Other | Key images, DICOM attribute browser, PNG export, German/English UI, audit trail |
| Study | Task checklist with per-task ratings, System Usability Scale, overall items, usage and load-time telemetry, admin summary with CSV export |

No framework, no build step, no third-party runtime dependency: plain ES modules
(~3,400 lines). Everything runs in the browser; the only "server" is a static file host.

## Running

Any static web server works:

```
python3 -m http.server 8000      # then open http://localhost:8000/pacs/
```

On GitHub Pages the app is served from `/pacs/` of the default branch.

## Accounts and results (GitHub only, no backend)

`config/access.json` contains one encrypted envelope per account
(PBKDF2-SHA-256, 310,000 iterations → AES-256-GCM). A login succeeds only if the password
decrypts the envelope, so no password or hash that could be tested offline cheaply is published.
The envelope may additionally carry a GitHub token; if present, finalized reports and
evaluations are written as JSON files to a results repository through the GitHub API.

Create accounts either in the app (Admin → "Accounts and results repository") or with

```
node tools/make-access.mjs --repo OWNER/RESULTS-REPO --token github_pat_… \
     admin:Name:admin reader01:"Reader 01" reader02:"Reader 02"
```

Passwords are printed once and never stored. Recommended set-up for the reader study:

1. Create a **private** repository for results (e.g. `vibepacs-results`) with one initial commit.
2. Create a **fine-grained personal access token** restricted to that repository with
   *Contents: Read and write* only, with an expiry date after the study.
3. Generate `access.json` with that token and commit it to `pacs/config/`.

Security note: every reader who logs in can technically extract the token from their own
browser session. It therefore must not grant anything beyond write access to the results
repository. Without a token the app runs in local mode: evaluations are saved in the
browser and downloaded as a JSON file that readers send to the study team; the admin page
can merge such files.

## Demo data

`tools/demo-manifest.json` lists the series, `tools/fetch-idc.mjs` downloads them from the
public NCI Imaging Data Commons bucket and `tools/ingest.mjs` builds `data/`.

```
node tools/fetch-idc.mjs /tmp/raw && node tools/ingest.mjs /tmp/raw
```

| Collection | Content used | Licence | DOI |
|---|---|---|---|
| LIDC-IDRI | chest CT (1 series), chest radiograph | CC BY 3.0 | 10.7937/K9/TCIA.2015.LO9QL9SX |
| HCC-TACE-Seg | liver CT, two time points | CC BY 4.0 | 10.7937/TCIA.5FNA-0924 |
| ReMIND | brain MRI (T2, FLAIR, post-contrast T1) | CC BY 4.0 | 10.7937/3RAG-D070 |
| PROSTATEx | prostate MRI (T2 ×3, ADC, calculated b-value) | CC BY 3.0 | 10.7937/K9TCIA.2017.MURS5CL |

Data were obtained from the NCI Imaging Data Commons / The Cancer Imaging Archive. Objects are
stored byte-identical to the source (only gzip-compressed for transport).

## Verification

`tests/compare.mjs` compares header values and decoded pixel data against checksums produced
with an independent toolkit (pydicom). On 61 objects (demo series plus pydicom test files
covering six transfer syntaxes) 58 were bit-identical; the three differences are a palette-colour
object (decoded to RGB here by design), uncompressed YBR 4:2:2 (not supported) and an
odd-sized big-endian RGB object.

## Known limitations

No DICOM network services (C-STORE, DICOMweb), no server-side storage or user management,
no JPEG 2000 / JPEG-LS, no oblique or curved reformation, no volume rendering, no structured
reports/segmentations/presentation states, no hanging-protocol editor, no display calibration
(GSDF), no regulatory clearance. Annotations and reports are stored per browser profile unless
a results repository is configured.
