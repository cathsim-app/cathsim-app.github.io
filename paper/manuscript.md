---
title: "Feasibility of an Entirely AI-generated (\"Vibe-coded\") Web-based PACS: A Reader Evaluation"
---

**Article type:** Research Letter (*Radiology*)

**Authors:** Jonathan Kottlors, Nedim Beste, David Maintz, Iza Iuga

**Affiliation:** [Institute and hospital — to be confirmed by the authors; degrees, ORCID, corresponding author]

**Summary statement (verify whether required; ≤ 30 words):** A large language model coding agent
generated a complete web-based PACS without human-written code; radiologists rated its usability
for standard PACS tasks as [RESULT].

> **Placeholders.** Everything in [square brackets] is not yet known and must be filled in after
> the reader study. Nothing in brackets is a result. See `author-notes.md` for the open points,
> including journal limits and references that still have to be checked at the source.

## Introduction

Picture archiving and communication systems (PACS) are complex, costly products developed by
specialized vendors. Large language model (LLM) coding agents now create software from
natural-language instructions alone ("vibe coding"), and radiologists have begun to build small
workflow tools this way (1). Whether the approach scales to a complete imaging application is
unknown. We assessed the feasibility of generating a web-based PACS with an LLM coding agent and
its usability for standard PACS tasks.

## Materials and Methods

This prospective feasibility study used only public, de-identified images; [institutional review
board statement]. Readers provided [informed consent].

**System generation.** In November 2026, one radiologist instructed an LLM coding agent ([agent,
model, version, manufacturer]) in plain language to build a complete PACS. The first request was
one paragraph plus three multiple-choice answers; a second paragraph requested adaptation to a
department (name, color scheme, window presets) and central storage of ratings. No code was
written or edited by humans, and existing viewer frameworks (2) were not used. Effort was taken
from repository time stamps. The serverless application (approximately 3600
lines of JavaScript, no third-party dependencies) comprises a DICOM parser and decoders, archive
index, worklist, multi-viewport viewer (windowing, measurements, multiplanar reformation, prior
comparison), structured reporting, and encrypted accounts (Figure), hosted on free services. Six studies (631 DICOM objects; CT, MRI, radiography) from the Imaging Data
Commons (3) served as test data. Decoded pixels were compared with an independent toolkit.

**Reader evaluation.** [N] radiologists ([n] residents, [n] board certified; median experience,
[x] years) performed 13 predefined tasks (Table) in a web browser.
For each task, completion and a five-point comparison with the reader's clinical PACS (1 = much
worse, 3 = equivalent, 5 = much better) were recorded in the application. Readers then completed
the System Usability Scale (SUS; range, 0–100) (4,5) and six five-point agreement items. Load
times were logged. Data are reported descriptively.

## Results

The first tested version was available [45] minutes after the initial request; departmental
adaptation and central rating storage took a further [14] minutes. Human effort comprised [2]
free-text messages and three multiple-choice answers; usage cost was [x]. Decoded pixels were
bit-identical to the reference toolkit in 58 of 61 test objects (95%).

All [N] readers completed the evaluation. Of [13 × N] task attempts, [n] ([x]%) were completed
without problems, [n] ([x]%) with difficulty, and [n] ([x]%) not at all. The median rating
relative to the clinical PACS was [x] (IQR, [x–x]), lowest for [task] and highest for [task]
(Table). The mean SUS score was [x] ± [x]. [n] of [N] readers considered image quality adequate
for diagnostic viewing, and [n] could imagine clinical use given regulatory clearance. Median
series load time was [x] seconds. Readers most often missed [functions].

## Discussion

An LLM coding agent generated a functional web-based PACS from two plain-language requests in
[about 1 hour], and radiologists [completed most standard tasks and rated its usability as …].
Generation and hosting cost [x], whereas commercial PACS entail substantial license and
maintenance costs [source to be verified]. Because changes take minutes, a department could
tailor presets, report templates, and appearance to its workflow, as shown by the rebranding for
a fictitious hospital. The comparison is incomplete: commercial prices cover integration,
validated storage, service, cybersecurity, and regulatory compliance. Diagnostic viewing software
is a regulated medical device, and AI-generated code may contain unrecognized security
vulnerabilities (6). Limitations include a small curated data set, no DICOM networking or
information-system integration, no diagnostic accuracy assessment, and unblinded readers. In conclusion, vibe coding reduced the effort of creating and customizing imaging
software to [about 1 hour], shifting the bottleneck from development to validation, security, and
regulation.

## References

1. Bera K, Kayat Bittencourt L, Ramaiya N, Tirumani SH. Vibe coding in radiology: Claude Code and
   ChatGPT Codex leading to the rise of the radiologist-developer. J Am Coll Radiol
   2026;23(7):1283–1288. doi:10.1016/j.jacr.2026.04.008 [verify]
2. Ziegler E, Urban T, Brown D, et al. Open Health Imaging Foundation Viewer: an extensible
   open-source framework for building web-based imaging applications to support cancer research.
   JCO Clin Cancer Inform 2020;4:336–345. doi:10.1200/CCI.19.00131 [verify]
3. Fedorov A, Longabaugh WJR, Pot D, et al. National Cancer Institute Imaging Data Commons: toward
   transparency, reproducibility, and scalability in imaging artificial intelligence.
   RadioGraphics 2023;43(12):e230180. doi:10.1148/rg.230180 [verify]
4. Brooke J. SUS: a "quick and dirty" usability scale. In: Jordan PW, Thomas B, Weerdmeester BA,
   McClelland AL, eds. Usability Evaluation in Industry. London, England: Taylor & Francis,
   1996; 189–194.
5. Bangor A, Kortum PT, Miller JT. An empirical evaluation of the System Usability Scale. Int J
   Hum Comput Interact 2008;24(6):574–594. doi:10.1080/10447310802205776 [verify]
6. Perry N, Srivastava M, Kumar D, Boneh D. Do users write more insecure code with AI assistants?
   In: Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security.
   2023; 2785–2799. doi:10.1145/3576915.3623157 [verify]

## Table. Reader Tasks and Ratings

| Task | Completed without problems | Completed with difficulty | Not completed | Rating vs clinical PACS, median (IQR) |
|---|---|---|---|---|
| Find and open study in worklist | [n] | [n] | [n] | [x] |
| Scrolling and cine | [n] | [n] | [n] | [x] |
| Windowing (presets, manual) | [n] | [n] | [n] | [x] |
| Zoom, pan, rotate, reset | [n] | [n] | [n] | [x] |
| Length and angle measurement | [n] | [n] | [n] | [x] |
| Attenuation measurement (ROI, point) | [n] | [n] | [n] | [x] |
| Multiplanar reformation and MIP | [n] | [n] | [n] | [x] |
| Comparison with prior study, synchronized scrolling | [n] | [n] | [n] | [x] |
| Multiple MRI series, reference lines | [n] | [n] | [n] | [x] |
| Radiograph display | [n] | [n] | [n] | [x] |
| Key image, annotation, export | [n] | [n] | [n] | [x] |
| Reporting (template, measurements, finalize) | [n] | [n] | [n] | [x] |
| DICOM attribute display | [n] | [n] | [n] | [x] |

Note.—Data are numbers of readers (N = [N]). Ratings: 1 = much worse, 3 = equivalent, 5 = much
better than the reader's clinical PACS.

## Figure

**Figure:** Screenshots of the AI-generated PACS. **(A)** Side-by-side comparison of a liver CT
with the prior examination, with length and region-of-interest measurements transferred to the
structured report (`figures/figure1b-comparison.png`). **(B)** Multiplanar reformation of a chest
CT with linked crosshair (`figures/figure1c-mpr.png`). Images: HCC-TACE-Seg and LIDC-IDRI
collections, Imaging Data Commons. (Worklist view available as `figures/figure1a-worklist.png`.)
