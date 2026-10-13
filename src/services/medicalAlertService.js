// Turns a patient's structured medical history into clinical alerts.
//
//   standingAlerts(ctx)        -> always-relevant flags shown on the patient record
//   drugAlerts(ctx, drugName)  -> warnings for a drug about to be prescribed
//   procedureAlerts(ctx, key)  -> warnings for a planned procedure
//
// Every alert is { level: 'high' | 'caution' | 'info', code, message }.
//
// This is a SCREENING AID, not a clinical decision-maker. An empty result does
// NOT mean a drug or procedure is safe, and the rules only know what is listed
// below. The dentist remains responsible. Review and extend the rules with your
// clinicians (add drug names to the lists, or new rules in the functions).

const { PROCEDURES } = require('../config/medicalHistoryCatalogue');

/* ------------------------------------------------------------
   Drug name lists (lower case, substring match, brands included)
   ------------------------------------------------------------ */
const DRUGS = {
  nsaid: ['ibuprofen', 'brufen', 'diclofenac', 'voltaren', 'naproxen', 'ketoprofen', 'ketorolac',
    'aspirin', 'mefenamic', 'ponstan', 'celecoxib', 'etoricoxib', 'piroxicam', 'meloxicam',
    'indomethacin', 'nsaid'],
  aspirin: ['aspirin'],
  metronidazole: ['metronidazole', 'flagyl', 'tinidazole'],
  azole: ['fluconazole', 'miconazole', 'ketoconazole', 'itraconazole', 'daktarin'],
  macrolide: ['erythromycin', 'clarithromycin', 'azithromycin'],
  cotrimoxazole: ['co-trimoxazole', 'cotrimoxazole', 'septrin', 'bactrim', 'sulfamethoxazole', 'sulfadiazine'],
  quinolone: ['ciprofloxacin', 'ciproxin', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin'],
  tetracycline: ['tetracycline', 'doxycycline', 'minocycline', 'oxytetracycline'],
  tramadol: ['tramadol'],
  codeine: ['codeine', 'co-codamol', 'cocodamol'],
  steroid: ['prednisolone', 'prednisone', 'dexamethasone', 'hydrocortisone', 'methylprednisolone'],
  paracetamol: ['paracetamol', 'acetaminophen', 'panadol'],
  g6pdAvoid: ['nitrofurantoin', 'dapsone', 'primaquine'],
};

// Classify the drugs a patient already takes (from the medications list).
const MED_CLASSES = {
  warfarin: ['warfarin', 'coumadin', 'marevan'],
  anticoagulant: ['warfarin', 'coumadin', 'marevan', 'rivaroxaban', 'xarelto', 'apixaban', 'eliquis',
    'dabigatran', 'pradaxa', 'edoxaban', 'heparin', 'enoxaparin', 'clexane'],
  antiplatelet: ['clopidogrel', 'plavix', 'ticagrelor', 'prasugrel', 'cilostazol', 'dipyridamole', 'aspirin', 'cardiprin'],
  bisphosphonate: ['alendron', 'fosamax', 'risedron', 'ibandron', 'zoledron', 'pamidron', 'denosumab', 'prolia', 'xgeva'],
  steroid: ['prednisolone', 'prednisone', 'dexamethasone', 'hydrocortisone', 'methylprednisolone'],
  immunosuppressant: ['methotrexate', 'azathioprine', 'ciclosporin', 'cyclosporin', 'tacrolimus', 'mycophenolate'],
};

const has = (text, list) => list.some((term) => text.includes(term));

/* ------------------------------------------------------------
   Context: everything the rules need, derived once
   ------------------------------------------------------------ */
function buildContext(history, patient) {
  const h = history || {};
  const conds = new Set(Array.isArray(h.conditions) ? h.conditions : []);
  const meds = Array.isArray(h.medications) ? h.medications : [];
  const medNames = meds.map((m) => String((m && m.name) || '').toLowerCase()).filter(Boolean);
  const anyMed = (list) => medNames.some((n) => has(n, list));

  const onWarfarin = anyMed(MED_CLASSES.warfarin);
  const onAnticoag = conds.has('blood_thinners') || anyMed(MED_CLASSES.anticoagulant) || anyMed(MED_CLASSES.antiplatelet);
  const allergiesText = String((patient && patient.allergies) || '').toLowerCase();

  return {
    hasHistory: !!history,
    conds,
    meds,
    medNames,
    weeks: h.pregnancy_weeks != null ? Number(h.pregnancy_weeks) : null,
    pregnant: !!h.is_pregnant,
    breastfeeding: !!h.is_breastfeeding,
    anaestheticReaction: !!h.anaesthetic_reaction,
    anaestheticReactionNotes: h.anaesthetic_reaction_notes || '',
    onWarfarin,
    onAnticoag,
    bleedingRisk: conds.has('bleeding_disorder') || onAnticoag,
    onBisphosphonate: conds.has('bisphosphonates') || anyMed(MED_CLASSES.bisphosphonate),
    onSteroids: conds.has('long_term_steroids') || anyMed(MED_CLASSES.steroid),
    immunosuppressed: conds.has('immunosuppressed') || anyMed(MED_CLASSES.immunosuppressant),
    latex: conds.has('latex_allergy') || allergiesText.includes('latex'),
  };
}

const A = (level, code, message) => ({ level, code, message });
const ORDER = { high: 0, caution: 1, info: 2 };
const sortAlerts = (list) => list.sort((a, b) => ORDER[a.level] - ORDER[b.level]);

/* ------------------------------------------------------------
   Standing alerts — shown on the patient record at all times
   ------------------------------------------------------------ */
function standingAlerts(ctx) {
  const c = ctx.conds;
  const out = [];

  if (ctx.latex) out.push(A('high', 'latex', 'Latex allergy — use latex-free gloves, rubber dam and equipment.'));
  if (c.has('prosthetic_heart_valve')) {
    out.push(A('high', 'endocarditis', 'High risk of infective endocarditis (artificial valve / previous endocarditis / congenital heart defect). Antibiotic prophylaxis may be needed before procedures that make the gums bleed — confirm against current guidelines or with the cardiologist.'));
  }
  if (ctx.bleedingRisk) {
    out.push(A('high', 'bleeding', `Bleeding risk${ctx.onWarfarin ? ' (on warfarin)' : ctx.onAnticoag ? ' (on blood thinners)' : ''}. Check recent clotting status (INR if on warfarin) before extractions or surgery and plan local haemostatic measures. Do not stop blood thinners without the prescribing doctor's advice.`));
  }
  if (ctx.anaestheticReaction) {
    out.push(A('high', 'anaesthetic_reaction', `Previous reaction to an anaesthetic${ctx.anaestheticReactionNotes ? ': ' + ctx.anaestheticReactionNotes : '.'}`));
  }
  if (c.has('head_neck_radiotherapy')) {
    out.push(A('high', 'radiotherapy', 'Previous head/neck radiotherapy — risk of osteoradionecrosis after extractions or jaw surgery. Seek specialist advice before extracting in the irradiated area.'));
  }
  if (ctx.onBisphosphonate) {
    out.push(A('caution', 'bisphosphonate', 'On bisphosphonate / denosumab — risk of osteonecrosis of the jaw after extractions or jaw surgery. Discuss with the prescribing doctor before invasive treatment.'));
  }
  if (ctx.onSteroids) {
    out.push(A('caution', 'steroids', 'Long-term steroid use — possible adrenal suppression; discuss steroid cover with the physician before major or stressful procedures. Healing and infection risk may be affected.'));
  }
  if (ctx.immunosuppressed) {
    out.push(A('caution', 'immunosuppressed', 'Weakened immunity — higher infection risk. Consider consulting the physician before invasive treatment.'));
  }
  if (c.has('diabetes')) {
    out.push(A('caution', 'diabetes', 'Diabetes — confirm the patient has eaten and taken their medication, know the hypoglycaemia plan, and expect slower healing and higher infection risk.'));
  }
  if (c.has('hypertension')) {
    out.push(A('caution', 'hypertension', 'High blood pressure — check BP before treatment and use adrenaline-containing anaesthetic sparingly.'));
  }
  if (c.has('heart_disease')) {
    out.push(A('caution', 'heart_disease', 'Heart disease — keep appointments short and low-stress, limit adrenaline, and make sure any prescribed GTN is available.'));
  }
  if (c.has('pacemaker')) {
    out.push(A('caution', 'pacemaker', 'Pacemaker / defibrillator — ultrasonic scalers and electrosurgery may interfere with some devices; check with the cardiologist if unsure.'));
  }
  if (c.has('epilepsy')) {
    out.push(A('caution', 'epilepsy', 'Epilepsy — confirm medication was taken today and be prepared to manage a seizure.'));
  }
  if (c.has('asthma')) {
    out.push(A('caution', 'asthma', 'Asthma — patient should bring their reliever inhaler. NSAIDs/aspirin can trigger attacks in some asthmatics.'));
  }
  if (c.has('sickle_cell')) {
    out.push(A('caution', 'sickle_cell', 'Sickle cell — avoid dehydration, stress and prolonged procedures; take care with sedation and nitrous oxide.'));
  }
  if (c.has('tuberculosis')) {
    out.push(A('caution', 'tb', 'Tuberculosis — confirm treatment status; defer elective treatment while the patient may be infectious.'));
  }
  if (c.has('g6pd')) {
    out.push(A('caution', 'g6pd', 'G6PD deficiency — avoid sulfonamides (e.g. co-trimoxazole), nitrofurantoin and high-dose aspirin.'));
  }
  if (c.has('kidney_disease')) {
    out.push(A('caution', 'kidney', 'Kidney disease — avoid NSAIDs and adjust doses of renally cleared drugs.'));
  }
  if (c.has('liver_disease')) {
    out.push(A('caution', 'liver', 'Liver disease — reduce paracetamol dose and take care with metronidazole, macrolides and local anaesthetic quantity.'));
  }
  if (ctx.pregnant) {
    out.push(A('caution', 'pregnancy', `Pregnant${ctx.weeks ? ` (${ctx.weeks} weeks)` : ''} — treat urgent problems only in the first trimester; the second trimester is the safest time for needed treatment; avoid lying flat late in pregnancy; minimise X-rays and drugs.`));
  }
  if (ctx.breastfeeding) {
    out.push(A('info', 'breastfeeding', 'Breastfeeding — check drug safety (avoid codeine/tramadol; take care with metronidazole and tetracyclines).'));
  }
  if (c.has('joint_replacement')) {
    out.push(A('info', 'joint', 'Artificial joint — antibiotic prophylaxis is not routinely required; consult the orthopaedic surgeon if there is any doubt.'));
  }
  return sortAlerts(out);
}

/* ------------------------------------------------------------
   Drug alerts
   ------------------------------------------------------------ */
function drugAlerts(ctx, drugName) {
  const drug = String(drugName || '').toLowerCase().trim();
  if (!drug) return [];
  const c = ctx.conds;
  const out = [];
  const is = (key) => has(drug, DRUGS[key]);

  // Already taking this drug?
  const dup = ctx.meds.find((m) => {
    const n = String((m && m.name) || '').toLowerCase();
    return n && (n.includes(drug) || drug.includes(n));
  });
  if (dup) out.push(A('info', 'already_taking', `Patient already lists ${dup.name}${dup.dose ? ' (' + dup.dose + ')' : ''} in their current medicines.`));

  // NSAIDs / aspirin
  if (is('nsaid')) {
    if (ctx.bleedingRisk) out.push(A('high', 'nsaid_bleeding', 'NSAIDs/aspirin increase bleeding risk with blood thinners or a bleeding disorder. Paracetamol is usually preferred.'));
    if (c.has('kidney_disease')) out.push(A('high', 'nsaid_kidney', 'Avoid NSAIDs in kidney disease.'));
    if (c.has('peptic_ulcer')) out.push(A('high', 'nsaid_ulcer', 'Avoid NSAIDs with a history of stomach ulcer or gastritis — risk of bleeding/relapse.'));
    if (ctx.pregnant) {
      out.push(A(ctx.weeks != null && ctx.weeks < 20 ? 'caution' : 'high', 'nsaid_pregnancy',
        'NSAIDs are generally avoided in pregnancy — avoid from 20 weeks and do not use after 30 weeks.'));
    }
    if (c.has('hypertension')) out.push(A('caution', 'nsaid_htn', 'NSAIDs can raise blood pressure and blunt blood-pressure medicines — lowest dose, shortest course.'));
    if (c.has('heart_disease')) out.push(A('caution', 'nsaid_heart', 'NSAIDs raise cardiovascular risk and can worsen heart failure.'));
    if (c.has('asthma')) out.push(A('caution', 'nsaid_asthma', 'NSAIDs can trigger bronchospasm in some people with asthma.'));
    if (c.has('liver_disease')) out.push(A('caution', 'nsaid_liver', 'Use NSAIDs with caution in liver disease.'));
    if (ctx.onSteroids) out.push(A('caution', 'nsaid_steroid', 'NSAIDs together with steroids raise the risk of stomach bleeding.'));
    if (c.has('g6pd') && is('aspirin')) out.push(A('caution', 'aspirin_g6pd', 'High-dose aspirin can trigger haemolysis in G6PD deficiency.'));
  }

  // Drugs that interact with anticoagulants
  const warfarinInteractors = is('metronidazole') || is('azole') || is('macrolide') || is('cotrimoxazole')
    || is('quinolone') || is('tramadol');
  if (warfarinInteractors) {
    if (ctx.onWarfarin) {
      out.push(A('high', 'warfarin_interaction', 'Can raise INR and cause bleeding in a patient on warfarin. Avoid or arrange INR monitoring with the prescriber.'));
    } else if (ctx.onAnticoag) {
      out.push(A('caution', 'anticoag_interaction', 'May increase the effect of blood thinners — if the patient is on warfarin or another anticoagulant, check with the prescriber.'));
    }
  }

  // Pregnancy
  if (ctx.pregnant) {
    if (is('tetracycline')) out.push(A('high', 'tetra_pregnancy', 'Avoid tetracyclines in pregnancy (affects fetal teeth and bone).'));
    if (is('azole') && drug.includes('fluconazole')) out.push(A('caution', 'fluconazole_pregnancy', 'Fluconazole is best avoided in pregnancy, especially the first trimester.'));
    if (is('metronidazole') && (ctx.weeks == null || ctx.weeks < 14)) out.push(A('caution', 'metro_pregnancy', 'Metronidazole is generally avoided in the first trimester.'));
    if (is('cotrimoxazole')) out.push(A('caution', 'cotrim_pregnancy', 'Co-trimoxazole interferes with folate — avoid in the first trimester and near term.'));
    if (is('quinolone')) out.push(A('caution', 'quinolone_pregnancy', 'Quinolones are generally avoided in pregnancy.'));
    if (is('codeine') || is('tramadol')) out.push(A('caution', 'opioid_pregnancy', 'Opioids in pregnancy — use only if essential and for the shortest time.'));
    if (is('steroid')) out.push(A('caution', 'steroid_pregnancy', 'Systemic steroids in pregnancy — use only if clearly needed.'));
  }

  // Breastfeeding
  if (ctx.breastfeeding) {
    if (is('codeine') || is('tramadol')) out.push(A('caution', 'opioid_breastfeeding', 'Codeine/tramadol can cause opioid toxicity in the breastfed infant — avoid.'));
    if (is('metronidazole')) out.push(A('caution', 'metro_breastfeeding', 'Metronidazole passes into breast milk — avoid high single doses and long courses.'));
    if (is('tetracycline')) out.push(A('caution', 'tetra_breastfeeding', 'Tetracyclines pass into breast milk — avoid prolonged courses.'));
  }

  // Other conditions
  if (c.has('diabetes') && is('steroid')) out.push(A('caution', 'steroid_diabetes', 'Steroids raise blood sugar — warn the patient and monitor.'));
  if (c.has('hypertension') && is('steroid')) out.push(A('caution', 'steroid_htn', 'Steroids can raise blood pressure through fluid retention.'));
  if (c.has('liver_disease') && (is('paracetamol') || is('metronidazole') || drug.includes('erythromycin'))) {
    out.push(A('caution', 'liver_drug', 'Reduce the dose or avoid in significant liver disease.'));
  }
  if (c.has('kidney_disease') && (is('tetracycline') || is('cotrimoxazole') || is('codeine') || is('tramadol') || is('quinolone'))) {
    out.push(A('caution', 'kidney_drug', 'Dose adjustment or avoidance may be needed in kidney disease.'));
  }
  if (c.has('epilepsy') && (is('tramadol') || is('quinolone'))) {
    out.push(A('caution', 'epilepsy_drug', 'Can lower the seizure threshold — use with caution in epilepsy.'));
  }
  if (c.has('g6pd') && (is('cotrimoxazole') || is('g6pdAvoid'))) {
    out.push(A('high', 'g6pd_drug', 'Can cause haemolysis in G6PD deficiency — avoid.'));
  }
  if ((c.has('heart_disease') || c.has('prosthetic_heart_valve')) && (is('macrolide') || is('quinolone'))) {
    out.push(A('caution', 'qt_drug', 'Can prolong the QT interval and affect heart rhythm — use with caution in heart disease.'));
  }

  return sortAlerts(out);
}

/* ------------------------------------------------------------
   Procedure alerts
   ------------------------------------------------------------ */
function procedureAlerts(ctx, procedureKey) {
  const proc = PROCEDURES.find((p) => p.key === procedureKey);
  if (!proc) return [];
  const c = ctx.conds;
  const out = [];

  if (proc.bleeding && ctx.bleedingRisk) {
    out.push(A('high', 'proc_bleeding', `${proc.label}: bleeding risk. ${ctx.onWarfarin ? 'Check a recent INR. ' : ''}Plan local haemostatic measures (packing, sutures, tranexamic acid) and do not stop blood thinners without the prescriber's advice.`));
  }
  if (proc.bleeding && c.has('prosthetic_heart_valve')) {
    out.push(A('high', 'proc_endocarditis', `${proc.label}: consider antibiotic prophylaxis for endocarditis risk before starting.`));
  }
  if (proc.surgical && ctx.onBisphosphonate) {
    out.push(A('high', 'proc_bisphosphonate', `${proc.label}: osteonecrosis-of-the-jaw risk (bisphosphonate/denosumab). Discuss with the prescribing doctor first.`));
  }
  if (proc.surgical && c.has('head_neck_radiotherapy')) {
    out.push(A('high', 'proc_radiotherapy', `${proc.label}: osteoradionecrosis risk after head/neck radiotherapy — seek specialist advice.`));
  }
  if (proc.la && ctx.anaestheticReaction) {
    out.push(A('high', 'proc_anaesthetic_reaction', 'Previous anaesthetic reaction on record — review details before giving local anaesthetic.'));
  }
  if (proc.la && (c.has('hypertension') || c.has('heart_disease'))) {
    out.push(A('caution', 'proc_adrenaline', 'Check BP first; use adrenaline-containing local anaesthetic sparingly and aspirate before injecting.'));
  }
  if (proc.surgical && ctx.onSteroids) {
    out.push(A('caution', 'proc_steroids', `${proc.label}: patient on long-term steroids — consider steroid cover with the physician.`));
  }
  if (proc.surgical && ctx.immunosuppressed) {
    out.push(A('caution', 'proc_immuno', `${proc.label}: infection risk with weakened immunity — consider consulting the physician.`));
  }
  if (proc.surgical && c.has('diabetes')) {
    out.push(A('caution', 'proc_diabetes', `${proc.label}: check diabetes control (recent HbA1c/glucose) — healing and infection risk.`));
  }
  if (proc.key === 'scaling' && c.has('pacemaker')) {
    out.push(A('caution', 'proc_pacemaker', 'Pacemaker: avoid ultrasonic scaling unless cleared by the cardiologist.'));
  }
  if (proc.key === 'xray' && ctx.pregnant) {
    out.push(A('caution', 'proc_xray_pregnancy', 'Pregnant: avoid dental X-rays unless essential; use a lead apron and the lowest exposure.'));
  } else if (ctx.pregnant && proc.key !== 'xray') {
    out.push(A('caution', 'proc_pregnancy', 'Pregnant: confirm the procedure is necessary now — elective treatment is best deferred to the second trimester or after delivery.'));
  }
  if (c.has('tuberculosis')) {
    out.push(A('caution', 'proc_tb', 'Tuberculosis: confirm the patient is non-infectious before elective treatment.'));
  }

  return sortAlerts(out);
}

module.exports = { buildContext, standingAlerts, drugAlerts, procedureAlerts };
