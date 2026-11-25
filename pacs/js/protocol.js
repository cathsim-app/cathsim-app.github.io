// Evaluation protocol: reader profile, task list, System Usability Scale, overall items.
import { T } from './util.js';

export const TASKS = () => [
  { id: 'worklist', cases: ['HCC_015'], title: T('Arbeitsliste', 'Worklist'), text: T('Suchen Sie Patient „HCC_015“ in der Arbeitsliste (Suche/Filter) und öffnen Sie die aktuelle CT-Untersuchung.', 'Find patient "HCC_015" in the worklist (search/filter) and open the most recent CT study.') },
  { id: 'scroll', cases: ['HCC_015'], title: T('Blättern und Cine', 'Scrolling and cine'), text: T('Blättern Sie mit Mausrad, Ziehen und Tastatur durch die Serie und starten Sie den Cine-Modus.', 'Scroll through the series with mouse wheel, dragging and keyboard, then start cine mode.') },
  { id: 'window', cases: ['HCC_015'], title: T('Fensterung', 'Windowing'), text: T('Wenden Sie Fenster-Voreinstellungen (z. B. Leber, Lunge, Knochen) an und fenstern Sie manuell.', 'Apply window presets (e.g. liver, lung, bone) and adjust the window manually.') },
  { id: 'zoompan', cases: ['HCC_015'], title: T('Zoom, Verschieben, Drehen', 'Zoom, pan, rotate'), text: T('Vergrößern Sie eine Läsion, verschieben Sie den Ausschnitt, drehen/spiegeln Sie das Bild und setzen Sie die Ansicht zurück.', 'Magnify a lesion, pan, rotate/flip the image and reset the view.') },
  { id: 'length', cases: ['HCC_015'], title: T('Längen- und Winkelmessung', 'Length and angle measurement'), text: T('Messen Sie den Durchmesser der Leberläsion und einen beliebigen Winkel; korrigieren Sie die Messung nachträglich.', 'Measure the diameter of the liver lesion and any angle; adjust the measurement afterwards.') },
  { id: 'roi', cases: ['HCC_015'], title: T('Dichtemessung (ROI)', 'Density measurement (ROI)'), text: T('Bestimmen Sie die mittlere Dichte (HU) in Leber und Aorta mit einer ROI sowie einen Punktwert.', 'Determine mean attenuation (HU) of liver and aorta with an ROI, and a point value.') },
  { id: 'mpr', cases: ['LIDC-IDRI-0365'], title: T('Multiplanare Rekonstruktion', 'Multiplanar reformation'), text: T('Öffnen Sie das Thorax-CT (LIDC-IDRI-0365), aktivieren Sie die MPR, navigieren Sie mit dem Fadenkreuz und erzeugen Sie eine MIP-Schicht.', 'Open the chest CT (LIDC-IDRI-0365), activate MPR, navigate with the crosshair and create a MIP slab.') },
  { id: 'compare', cases: ['HCC_015'], title: T('Vergleich mit Voruntersuchung', 'Comparison with prior study'), text: T('Vergleichen Sie bei HCC_015 die aktuelle Untersuchung mit der Voruntersuchung („Vergleich“): Die Voraufnahme wird automatisch registriert. Blättern Sie synchron und korrigieren Sie bei Bedarf manuell.', 'For HCC_015, compare the current study with the prior study ("Compare"): the prior is registered automatically. Scroll synchronously and correct manually if needed.') },
  { id: 'multiseries', cases: ['ReMIND-017'], title: T('Mehrere Serien / MRT', 'Multiple series / MRI'), text: T('Öffnen Sie die Hirn-MRT (ReMIND-017), stellen Sie T2, FLAIR und T1 nach KM nebeneinander dar und nutzen Sie Referenzlinien.', 'Open the brain MRI (ReMIND-017), display T2, FLAIR and post-contrast T1 side by side and use reference lines.') },
  { id: 'radiograph', cases: ['LIDC-IDRI-0219'], title: T('Projektionsradiografie', 'Radiography'), text: T('Öffnen Sie die Röntgen-Thoraxaufnahme (LIDC-IDRI-0219), invertieren und vergrößern Sie das Bild.', 'Open the chest radiograph (LIDC-IDRI-0219), invert and magnify the image.') },
  { id: 'keyimage', cases: ['112329'], title: T('Schlüsselbild und Annotation', 'Key image and annotation'), text: T('Öffnen Sie das Thorax-CT von Patient 112329, markieren Sie ein Schlüsselbild, setzen Sie einen beschrifteten Pfeil und exportieren Sie das Bild.', 'Open the chest CT of patient 112329, flag a key image, place a labelled arrow and export the image.') },
  { id: 'report', cases: ['HCC_015'], title: T('Befundung', 'Reporting'), text: T('Schreiben Sie einen kurzen Befund (Vorlage nutzen, Messwerte übernehmen), speichern Sie ihn und geben Sie ihn frei.', 'Write a short report (use a template, insert measurements), save and finalize it.') },
  { id: 'dicom', cases: ['TCGA-B8-5165'], title: T('DICOM-Informationen', 'DICOM information'), text: T('Öffnen Sie das Nieren-CT (TCGA-B8-5165), zeigen Sie die DICOM-Attribute des aktuellen Bildes an und suchen Sie die Schichtdicke.', 'Open the renal CT (TCGA-B8-5165), display the DICOM attributes of the current image and look up the slice thickness.') },
];

/** Patients with a prior study: the automatic registration is rated for each of them. */
export const REGISTRATION_CASES = () => [
  { id: 'HCC_015', label: T('Leber-CT (HCC_015)', 'Liver CT (HCC_015)') },
  { id: '112329', label: T('Thorax-CT (112329)', 'Chest CT (112329)') },
  { id: 'TCGA-B8-5165', label: T('Nieren-CT (TCGA-B8-5165)', 'Renal CT (TCGA-B8-5165)') },
  { id: 'VS-MC-RC-016', label: T('Schädel-MRT (VS-MC-RC-016)', 'Head MRI (VS-MC-RC-016)') },
];
export const REGISTRATION_SCALE = () => [
  ['exact', T('Gleiche anatomische Höhe', 'Same anatomical level')],
  ['minor', T('Geringe Abweichung (bis 1 Schicht)', 'Minor deviation (up to 1 slice)')],
  ['major', T('Deutliche Abweichung', 'Clear deviation')],
  ['failed', T('Nicht registriert / nicht beurteilbar', 'Not registered / not assessable')],
];

export const COMPLETION = () => [
  ['yes', T('Ohne Probleme gelöst', 'Completed without problems')],
  ['partly', T('Mit Schwierigkeiten gelöst', 'Completed with difficulty')],
  ['no', T('Nicht lösbar', 'Could not be completed')],
];

export const COMPARISON_SCALE = () => [
  T('deutlich schlechter', 'much worse'), T('schlechter', 'worse'), T('gleichwertig', 'equivalent'),
  T('besser', 'better'), T('deutlich besser', 'much better'),
];

export const SUS = () => [
  T('Ich kann mir sehr gut vorstellen, das System regelmäßig zu nutzen.', 'I think that I would like to use this system frequently.'),
  T('Ich empfinde das System als unnötig komplex.', 'I found the system unnecessarily complex.'),
  T('Ich empfinde das System als einfach zu nutzen.', 'I thought the system was easy to use.'),
  T('Ich denke, dass ich technischen Support brauchen würde, um das System zu nutzen.', 'I think that I would need the support of a technical person to be able to use this system.'),
  T('Ich finde, dass die verschiedenen Funktionen des Systems gut integriert sind.', 'I found the various functions in this system were well integrated.'),
  T('Ich finde, dass es im System zu viele Inkonsistenzen gibt.', 'I thought there was too much inconsistency in this system.'),
  T('Ich kann mir vorstellen, dass die meisten Leute das System schnell zu beherrschen lernen.', 'I would imagine that most people would learn to use this system very quickly.'),
  T('Ich empfinde die Bedienung als sehr umständlich.', 'I found the system very cumbersome to use.'),
  T('Ich habe mich bei der Nutzung des Systems sehr sicher gefühlt.', 'I felt very confident using the system.'),
  T('Ich musste eine Menge Dinge lernen, bevor ich mit dem System arbeiten konnte.', 'I needed to learn a lot of things before I could get going with this system.'),
];

export const AGREE_SCALE = () => [
  T('stimme gar nicht zu', 'strongly disagree'), T('stimme nicht zu', 'disagree'), T('neutral', 'neutral'),
  T('stimme zu', 'agree'), T('stimme voll zu', 'strongly agree'),
];

export const OVERALL = () => [
  ['imageQuality', T('Die Bildqualität ist für die diagnostische Betrachtung ausreichend.', 'Image quality is adequate for diagnostic viewing.')],
  ['speed', T('Lade- und Reaktionszeiten sind für die Routinebefundung akzeptabel.', 'Loading and response times are acceptable for routine reading.')],
  ['completeness', T('Der Funktionsumfang deckt die Kernfunktionen eines PACS-Arbeitsplatzes ab.', 'The feature set covers the core functions of a PACS workstation.')],
  ['reliability', T('Das System lief stabil und ohne Fehler.', 'The system ran reliably and without errors.')],
  ['teaching', T('Ich würde das System für Lehre oder Forschung einsetzen.', 'I would use the system for teaching or research.')],
  ['clinical', T('Mit entsprechender Zulassung könnte ich mir den Einsatz in der klinischen Routine vorstellen.', 'Given regulatory clearance, I could imagine using it in clinical routine.')],
];

export const PROFILE = () => [
  { id: 'role', label: T('Position', 'Position'), options: [['resident', T('Assistenzarzt/-ärztin', 'Resident')], ['board', T('Facharzt/-ärztin', 'Board-certified radiologist')], ['senior', T('Oberarzt/-ärztin oder leitend', 'Senior/attending or chief')], ['other', T('Andere', 'Other')]] },
  { id: 'years', label: T('Jahre radiologische Berufserfahrung', 'Years of experience in radiology'), type: 'number' },
  { id: 'pacs', label: T('Klinisch genutztes PACS (Produkt)', 'PACS used clinically (product)'), type: 'text' },
  { id: 'input', label: T('Eingabegerät im Test', 'Input device during test'), options: [['mouse', T('Maus', 'Mouse')], ['trackpad', 'Trackpad'], ['touch', 'Touch']] },
];

/** SUS score 0–100, or null if incomplete. Answers are 1..5 keyed by item index. */
export function susScore(answers) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const a = Number(answers?.[i]);
    if (!(a >= 1 && a <= 5)) return null;
    sum += i % 2 === 0 ? a - 1 : 5 - a;
  }
  return sum * 2.5;
}

export const REPORT_TEMPLATES = () => ({
  CT: [
    { name: T('CT Abdomen (Leber)', 'CT abdomen (liver)'), technique: T('Mehrphasige CT des Abdomens nach i.v. Kontrastmittelgabe.', 'Multiphase contrast-enhanced CT of the abdomen.'),
      findings: T('Leber: \nGallenwege/Gallenblase: \nPankreas, Milz, Nebennieren: \nNieren: \nLymphknoten: \nGefäße: \nSkelett: ', 'Liver: \nBiliary system/gallbladder: \nPancreas, spleen, adrenals: \nKidneys: \nLymph nodes: \nVessels: \nSkeleton: ') },
    { name: T('CT Thorax', 'CT chest'), technique: T('CT des Thorax.', 'CT of the chest.'),
      findings: T('Lungenparenchym: \nPleura: \nMediastinum/Hili: \nHerz/große Gefäße: \nMiterfasster Oberbauch: \nSkelett: ', 'Lung parenchyma: \nPleura: \nMediastinum/hila: \nHeart/great vessels: \nUpper abdomen: \nSkeleton: ') },
  ],
  MR: [
    { name: T('MRT Schädel', 'MRI brain'), technique: T('MRT des Schädels nativ und nach i.v. Kontrastmittelgabe.', 'MRI of the brain without and with contrast.'),
      findings: T('Hirnparenchym: \nRaumforderung/KM-Aufnahme: \nLiquorräume: \nMittellinie: \nOrbitae/NNH: ', 'Brain parenchyma: \nMass/enhancement: \nCSF spaces: \nMidline: \nOrbits/sinuses: ') },
    { name: T('MRT Prostata', 'MRI prostate'), technique: T('Multiparametrische MRT der Prostata.', 'Multiparametric MRI of the prostate.'),
      findings: T('Prostatavolumen: \nPeriphere Zone: \nTransitionszone: \nSamenblasen: \nLymphknoten/Skelett: ', 'Prostate volume: \nPeripheral zone: \nTransition zone: \nSeminal vesicles: \nLymph nodes/skeleton: ') },
  ],
  DX: [
    { name: T('Röntgen Thorax', 'Chest radiograph'), technique: T('Röntgen Thorax.', 'Chest radiograph.'),
      findings: T('Herz/Mediastinum: \nLunge: \nPleura: \nSkelett/Weichteile: \nFremdmaterial: ', 'Heart/mediastinum: \nLungs: \nPleura: \nSkeleton/soft tissues: \nDevices: ') },
  ],
});
