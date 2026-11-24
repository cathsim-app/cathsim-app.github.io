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
(~3,600 lines). Everything runs in the browser; the only "server" is a static file host.

## Running

Any static web server works:

```
python3 -m http.server 8000      # then open http://localhost:8000/pacs/
```

On GitHub Pages the app is served from `/pacs/` of the default branch.

## Accounts and central results

`config/access.json` contains one encrypted envelope per account
(PBKDF2-SHA-256, 310,000 iterations → AES-256-GCM). A login succeeds only if the password
decrypts the envelope. The envelope also carries the user's upload credential for the result
server in `worker/` (Cloudflare Worker + KV, see `worker/README.md`): evaluations and finalized
reports are stored there; only admin accounts can read them (Admin → "Load from server", CSV export).

```
node tools/make-access.mjs --endpoint https://vibepacs-log.<account>.workers.dev --secret <STUDY_SECRET> \
     admin:Name:admin reader01:"Reader 01" reader02:"Reader 02"
```

Passwords are printed once and never stored. Without a deployed worker the app falls back to
local mode: the evaluation is kept in the browser, queued for upload and offered as a JSON file.

## Adapting it to a department

`config/site.json` sets product and institution name, accent colour, CT window presets and the
report footer. The shipped example uses a fictitious hospital. Report templates and the
evaluation protocol are in `js/protocol.js`.

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
