// Single source of truth for the medical-history questionnaire.
// The server validates against it and the frontend renders from it
// (GET /api/medical-history/catalogue), so they can never drift apart.

const GROUPS = [
  { id: 'heart', label: 'Heart & circulation' },
  { id: 'blood', label: 'Blood' },
  { id: 'hormone', label: 'Hormones & metabolism' },
  { id: 'lungs', label: 'Lungs' },
  { id: 'nerves', label: 'Brain & nerves' },
  { id: 'infection', label: 'Infections' },
  { id: 'organs', label: 'Kidney, liver & stomach' },
  { id: 'treatments', label: 'Medicines & treatments' },
  { id: 'other', label: 'Other' },
];

const CONDITIONS = [
  // Heart & circulation
  { key: 'hypertension', label: 'High blood pressure', group: 'heart' },
  { key: 'heart_disease', label: 'Heart disease (angina, heart attack, heart failure, arrhythmia)', group: 'heart' },
  { key: 'prosthetic_heart_valve', label: 'Artificial heart valve, previous endocarditis or congenital heart defect', group: 'heart' },
  { key: 'pacemaker', label: 'Pacemaker / implanted defibrillator', group: 'heart' },
  { key: 'stroke', label: 'Stroke / TIA', group: 'heart' },
  { key: 'rheumatic_fever', label: 'Rheumatic fever / rheumatic heart disease', group: 'heart' },

  // Blood
  { key: 'bleeding_disorder', label: 'Bleeding disorder or prolonged bleeding after cuts/extractions', group: 'blood' },
  { key: 'blood_thinners', label: 'Takes blood thinners (warfarin, rivaroxaban, clopidogrel, daily aspirin…)', group: 'blood' },
  { key: 'anaemia', label: 'Anaemia', group: 'blood' },
  { key: 'sickle_cell', label: 'Sickle cell disease / trait', group: 'blood' },
  { key: 'g6pd', label: 'G6PD deficiency', group: 'blood' },

  // Hormones & metabolism
  { key: 'diabetes', label: 'Diabetes', group: 'hormone' },
  { key: 'thyroid_disease', label: 'Thyroid disease', group: 'hormone' },

  // Lungs
  { key: 'asthma', label: 'Asthma', group: 'lungs' },
  { key: 'copd', label: 'COPD / chronic bronchitis', group: 'lungs' },
  { key: 'tuberculosis', label: 'Tuberculosis (current or recent)', group: 'lungs' },

  // Brain & nerves
  { key: 'epilepsy', label: 'Epilepsy / seizures', group: 'nerves' },

  // Infections
  { key: 'hiv', label: 'HIV', group: 'infection' },
  { key: 'hepatitis_b', label: 'Hepatitis B', group: 'infection' },
  { key: 'hepatitis_c', label: 'Hepatitis C', group: 'infection' },

  // Kidney, liver & stomach
  { key: 'kidney_disease', label: 'Kidney disease', group: 'organs' },
  { key: 'liver_disease', label: 'Liver disease', group: 'organs' },
  { key: 'peptic_ulcer', label: 'Stomach / peptic ulcer or gastritis', group: 'organs' },

  // Medicines & treatments
  { key: 'bisphosphonates', label: 'Bisphosphonate or denosumab (alendronate, zoledronic acid, Prolia…)', group: 'treatments' },
  { key: 'long_term_steroids', label: 'Long-term steroids (prednisolone, dexamethasone…)', group: 'treatments' },
  { key: 'immunosuppressed', label: 'Weakened immunity (chemotherapy, transplant, immunosuppressant drugs)', group: 'treatments' },
  { key: 'head_neck_radiotherapy', label: 'Radiotherapy to the head or neck', group: 'treatments' },
  { key: 'cancer', label: 'Cancer (current or past)', group: 'treatments' },

  // Other
  { key: 'latex_allergy', label: 'Latex allergy', group: 'other' },
  { key: 'joint_replacement', label: 'Artificial joint (hip, knee…)', group: 'other' },
];

const CONDITION_KEYS = new Set(CONDITIONS.map((c) => c.key));

const PROCEDURES = [
  { key: 'extraction', label: 'Extraction / minor oral surgery', bleeding: true, la: true, surgical: true },
  { key: 'surgery', label: 'Surgery (implant, flap, biopsy…)', bleeding: true, la: true, surgical: true },
  { key: 'scaling', label: 'Scaling / deep cleaning / gum treatment', bleeding: true, la: false, surgical: false },
  { key: 'rct', label: 'Root canal treatment', bleeding: false, la: true, surgical: false },
  { key: 'restorative', label: 'Filling / crown / routine restorative', bleeding: false, la: true, surgical: false },
  { key: 'xray', label: 'Dental X-ray', bleeding: false, la: false, surgical: false },
];

const SMOKING = ['never', 'former', 'current'];
const ALCOHOL = ['none', 'occasional', 'regular'];

// Re-confirm the history if it was last reviewed longer ago than this.
const STALE_AFTER_DAYS = 180;

module.exports = {
  GROUPS, CONDITIONS, CONDITION_KEYS, PROCEDURES, SMOKING, ALCOHOL, STALE_AFTER_DAYS,
};
