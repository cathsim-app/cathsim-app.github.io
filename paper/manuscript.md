---
title: "The 35-Minute PACS: Radiologist Evaluation of a Picture Archiving and Communication System Built Entirely by an AI Coding Agent"
---

**Article type:** Research Letter (*Radiology*)

**Authors:** Jonathan Kottlors, MD [confirm degree]; Nedim Beste, [degree]; David Maintz, MD;
Andra-Iza Iuga, MD [confirm degree]

**Affiliation (all authors):** Institute for Diagnostic and Interventional Radiology, Faculty of
Medicine and University Hospital Cologne, University of Cologne, Kerpener Str 62, 50937 Cologne,
Germany

**Corresponding author:** Jonathan Kottlors ([e-mail]). **ORCID:** A.-I.I. 0000-0002-3694-0235;
others [to be added].

**Summary statement:** An AI coding agent built a working web-based PACS in 35 minutes;
radiologists rated it [equivalent to their clinical PACS for everyday viewing].

**Demonstration and code:** https://cathsim-app.github.io/pacs/ (user `demo`, password
`vibepacs-demo`); source code in the same repository.


> **FICTITIOUS RATINGS.** All reader results in this draft (values in [square brackets] in the
> Methods and Results, and Figure 2) are invented to show the layout. They are not data. This
> notice and the brackets disappear when the manuscript is rebuilt from the collected ratings.

## Introduction

A picture archiving and communication system (PACS) is the most expensive software a radiology
department buys and the one it can least change: enterprise contracts run from about $20
million to more than $200 million per health system (1). Large language model (LLM) coding
agents now write software from plain-language instructions ("vibe coding"), and radiologists
have begun building small tools this way (2). We asked a blunter question: can a radiologist,
without writing a line of code, have an agent build the whole PACS, and would colleagues want to
read on it?

## Materials and Methods

This feasibility study used only public, de-identified images; [institutional review board
statement]. Readers provided [informed consent].

**System generation.** In November 2026, one radiologist instructed an LLM coding agent
([agent, model, version, and manufacturer: see submission copy]) to build a complete PACS. The first request was one paragraph plus three
multiple-choice answers; later requests added departmental adaptation, central storage of
ratings, and automatic registration of prior studies. No code was written or edited by humans,
and existing viewer frameworks (3) were not used. The serverless application (3800 lines of
JavaScript, no third-party dependencies) comprises a DICOM parser and decoders, archive index,
worklist, multi-viewport viewer, structured reporting, and encrypted accounts (Figure 1), hosted
on free services. Twelve studies (979 DICOM objects; CT, MRI, radiography), four with prior
examinations, from the Imaging Data Commons (4) served as test data.

**Reader evaluation.** [5] radiologists ([2] residents, [3] board
certified; median experience, [7] years) performed 13 tasks. After each case, the
application recorded completion and a five-point comparison with the reader's clinical PACS
(1 = much worse, 3 = equivalent, 5 = much better), and whether automatically registered priors
showed the same anatomic level. Readers completed the System Usability Scale (SUS; range,
0–100) (5) and six five-point agreement items. Data are reported descriptively.

## Results

The first tested version existed 35 minutes after the initial request. Usage cost for the
session, including manuscript drafting, was about $28. Decoded pixels were bit-identical
to an independent toolkit in 58 of 61 test objects (95%).

Of [65] task attempts, [51] ([78]%) succeeded without problems, [9]
([14]%) with difficulty, and [5] ([8]%) failed. The median rating relative to
the clinical PACS was [3] (IQR, [2–4]); ratings were lowest for
[multiplanar reformation, zoom, pan, rotate, and reporting] (Figure 2). Automatic registration showed the same anatomic level in [13]
of [20] reader assessments and deviated by at most one section in [6]. The
mean SUS score was [77] ± [6]. [5] of [5] readers considered image
quality adequate for diagnostic viewing, and [3] could imagine clinical use given
regulatory clearance. Readers most often missed [functions from free-text answers].

## Discussion

Thirty-five minutes and the price of a lunch bought a PACS that radiologists [rated as
equivalent to their clinical system for everyday viewing]. That should unsettle an industry
whose product has been protected by the sheer effort of writing it. When a department can
describe the workstation it wants and have it the same afternoon, rebranded and reconfigured
with one paragraph of text, the viewer stops being the product. What vendors will still be paid
for is what our system lacks: integration, validated storage, service, cybersecurity, and
regulatory clearance. Diagnostic viewing software is a regulated medical device, and
AI-generated code may carry vulnerabilities its users cannot see (6). Limitations include a
small curated data set, no DICOM networking or information-system integration, no diagnostic
accuracy assessment, and unblinded readers. Writing imaging software is no longer the hard part.
Proving that it is safe is, and that is where vendors, regulators, and radiologists should now
compete.

## References

1. Radiology IT vendor Sectra inks $227M contract with large US health system. Radiology
   Business. https://radiologybusiness.com/topics/health-it/enterprise-imaging/radiology-it-vendor-sectra-inks-227m-contract-large-us-health-system.
   Accessed November 24, 2026. [verify; trade press, cited for the order of magnitude]
2. Bera K, Kayat Bittencourt L, Ramaiya N, Tirumani SH. Vibe coding in radiology: Claude Code and
   ChatGPT Codex leading to the rise of the radiologist-developer. J Am Coll Radiol
   2026;23(7):1283–1288. doi:10.1016/j.jacr.2026.04.008 [verify]
3. Ziegler E, Urban T, Brown D, et al. Open Health Imaging Foundation Viewer: an extensible
   open-source framework for building web-based imaging applications to support cancer research.
   JCO Clin Cancer Inform 2020;4:336–345. doi:10.1200/CCI.19.00131 [verify]
4. Fedorov A, Longabaugh WJR, Pot D, et al. National Cancer Institute Imaging Data Commons: toward
   transparency, reproducibility, and scalability in imaging artificial intelligence.
   RadioGraphics 2023;43(12):e230180. doi:10.1148/rg.230180 [verify]
5. Brooke J. SUS: a "quick and dirty" usability scale. In: Jordan PW, Thomas B, Weerdmeester BA,
   McClelland AL, eds. Usability Evaluation in Industry. London, England: Taylor & Francis,
   1996; 189–194.
6. Perry N, Srivastava M, Kumar D, Boneh D. Do users write more insecure code with AI assistants?
   In: Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security.
   2023; 2785–2799. doi:10.1145/3576915.3623157 [verify]

## Figures

![](figures/figure1.jpg)

**Figure 1:** Screenshots of the AI-generated PACS. **(A)** Liver CT side by side with the
automatically registered prior examination; length and region-of-interest measurements are
transferred to the structured report. **(B)** Multiplanar reformation of a chest CT with linked
crosshair. Images: HCC-TACE-Seg and LIDC-IDRI collections, Imaging Data Commons.

![](figures/figure2-ratings.png)

**Figure 2:** Reader ratings of 13 standard PACS tasks relative to each reader's clinical PACS
(diverging stacked bars centered on "equivalent"; numbers are readers). **Fictitious data for
layout only.**