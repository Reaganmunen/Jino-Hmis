/* ============================================================
   ALLERGY CHECK (dentist side)
   ------------------------------------------------------------
   AllergyCheck.check(allergiesText, drugName)
     -> [{ level: 'high' | 'caution', allergy, message }]

   Compares a drug name against the free-text allergies stored on the
   patient record. It is a screening aid, not a clinical decision: it
   only knows the drug families listed below, so an empty result does
   NOT mean the drug is safe. Add families or aliases to FAMILIES as
   your clinic needs.

   Levels:
     high    - same drug, or a drug in the same family as a family-level
               allergy ("penicillin allergy" + amoxicillin)
     caution - a related drug in the same family, or a family known to
               cross-react ("penicillin allergy" + cefalexin)
   ============================================================ */
(function (root) {
  'use strict';

  // names : words that mean the whole family ("penicillin allergy", "NSAIDs")
  // drugs : specific drugs / brands in the family (lower case, substring match)
  // crossWith : ids of other families that can cross-react
  const FAMILIES = [
    {
      id: 'penicillins', label: 'penicillins',
      names: ['penicillin', 'beta-lactam', 'beta lactam', 'betalactam'],
      drugs: ['penicillin', 'amoxicillin', 'amoxil', 'ampicillin', 'flucloxacillin', 'cloxacillin',
        'augmentin', 'amoxiclav', 'co-amoxiclav', 'coamoxiclav', 'clavulan', 'piperacillin'],
      crossWith: ['cephalosporins'],
    },
    {
      id: 'cephalosporins', label: 'cephalosporins',
      names: ['cephalosporin'],
      drugs: ['cefalexin', 'cephalexin', 'cefuroxime', 'cefixime', 'cefadroxil', 'ceftriaxone',
        'cefpodoxime', 'cefaclor', 'cefazolin', 'ceftazidime', 'cefdinir'],
      crossWith: ['penicillins'],
    },
    {
      id: 'nsaids', label: 'NSAIDs (anti-inflammatories)',
      names: ['nsaid', 'anti-inflammatory', 'anti inflammatory', 'antiinflammatory'],
      drugs: ['ibuprofen', 'brufen', 'diclofenac', 'voltaren', 'naproxen', 'ketoprofen', 'ketorolac',
        'aspirin', 'mefenamic', 'ponstan', 'celecoxib', 'etoricoxib', 'piroxicam', 'meloxicam', 'indomethacin'],
      crossWith: [],
    },
    {
      id: 'sulfonamides', label: 'sulfonamides',
      names: ['sulfa', 'sulpha', 'sulfonamide'],
      drugs: ['sulfamethoxazole', 'co-trimoxazole', 'cotrimoxazole', 'septrin', 'bactrim', 'sulfadiazine', 'sulfasalazine'],
      crossWith: [],
    },
    {
      id: 'macrolides', label: 'macrolides',
      names: ['macrolide'],
      drugs: ['erythromycin', 'azithromycin', 'clarithromycin'],
      crossWith: [],
    },
    {
      id: 'nitroimidazoles', label: 'nitroimidazoles',
      names: ['nitroimidazole'],
      drugs: ['metronidazole', 'flagyl', 'tinidazole', 'ornidazole'],
      crossWith: [],
    },
    {
      id: 'tetracyclines', label: 'tetracyclines',
      names: ['tetracycline'],
      drugs: ['tetracycline', 'doxycycline', 'minocycline', 'oxytetracycline'],
      crossWith: [],
    },
    {
      id: 'lincosamides', label: 'lincosamides',
      names: ['lincosamide'],
      drugs: ['clindamycin', 'dalacin', 'lincomycin'],
      crossWith: [],
    },
    {
      id: 'quinolones', label: 'quinolones',
      names: ['quinolone'],
      drugs: ['ciprofloxacin', 'cipro', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin'],
      crossWith: [],
    },
    {
      id: 'opioids', label: 'opioids',
      names: ['opioid', 'opiate'],
      drugs: ['codeine', 'co-codamol', 'tramadol', 'morphine', 'oxycodone', 'pethidine'],
      crossWith: [],
    },
    {
      id: 'paracetamol', label: 'paracetamol',
      names: ['paracetamol', 'acetaminophen'],
      drugs: ['paracetamol', 'acetaminophen', 'panadol', 'tylenol', 'calpol'],
      crossWith: [],
    },
    {
      id: 'chlorhexidine', label: 'chlorhexidine',
      names: ['chlorhexidine'],
      drugs: ['chlorhexidine', 'corsodyl'],
      crossWith: [],
    },
  ];

  const BY_ID = {};
  FAMILIES.forEach((f) => { BY_ID[f.id] = f; });

  // "No known allergies" and friends must not be treated as an allergy.
  const NEGATIVE = /^(none|nil|nka|nkda|n\/a|na|not known|no\b.*|-+)$/;

  function parseAllergies(text) {
    if (!text || typeof text !== 'string') return [];
    return text
      .split(/[,;\n/+]|\band\b/i)
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((raw) => ({ raw, norm: raw.toLowerCase() }))
      .filter((a) => !NEGATIVE.test(a.norm));
  }

  const hasAny = (text, list) => list.some((w) => text.includes(w));

  // Same substance: the allergy contains a word of the drug name, or the other way round.
  function sameSubstance(term, drug) {
    const words = drug.split(/[^a-z-]+/).filter((w) => w.length >= 4);
    if (words.some((w) => term.includes(w))) return true;
    return term.length >= 4 && drug.includes(term);
  }

  function check(allergiesText, drugName) {
    const allergies = parseAllergies(allergiesText);
    const drug = (drugName || '').trim().toLowerCase();
    if (!allergies.length || drug.length < 3) return [];

    const found = [];
    const seen = new Set();
    const add = (level, allergy, message) => {
      const key = level + '|' + message;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ level, allergy, message });
    };

    allergies.forEach(({ raw, norm }) => {
      const same = sameSubstance(norm, drug);
      if (same) add('high', raw, `This is the same drug as the recorded allergy (“${raw}”).`);

      FAMILIES.forEach((fam) => {
        const termIsFamilyWide = hasAny(norm, fam.names);
        const termIsFamilyDrug = hasAny(norm, fam.drugs);
        const drugInFamily = hasAny(drug, fam.drugs);

        if (drugInFamily && !same) {
          if (termIsFamilyWide) {
            add('high', raw, `Patient is allergic to ${fam.label} (“${raw}”), and this drug is one of them.`);
          } else if (termIsFamilyDrug) {
            add('caution', raw, `Allergy to “${raw}” — this is a related drug in the same family (${fam.label}). Cross-sensitivity is possible.`);
          }
        }

        if ((termIsFamilyWide || termIsFamilyDrug) && fam.crossWith.length) {
          fam.crossWith.forEach((otherId) => {
            const other = BY_ID[otherId];
            if (other && hasAny(drug, other.drugs)) {
              add('caution', raw, `Allergy to “${raw}” — ${other.label} can cross-react with ${fam.label}.`);
            }
          });
        }
      });
    });

    // High-severity first.
    return found.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));
  }

  root.AllergyCheck = { check, parseAllergies };
})(window);
