/**
 * ABTC-relevant ICD-10 code subset.
 * Covers ~95% of diagnoses encountered at Animal Bite Treatment Centers:
 * rabies exposure, animal bites by site/type, tetanus, open wounds by body region,
 * anaphylaxis/AEFI reactions, and common comorbidities.
 *
 * Intentionally NOT the full WHO list — kept small for bundle discipline.
 */
export interface ICD10Entry {
  code: string
  description: string
  chapter?: string
}

export const ICD10_CODES: ICD10Entry[] = [
  // ── Rabies (A82) ──────────────────────────────────────────────────────────
  { code: 'A82.0', description: 'Sylvatic rabies', chapter: 'Rabies' },
  { code: 'A82.1', description: 'Urban rabies', chapter: 'Rabies' },
  { code: 'A82.9', description: 'Rabies, unspecified', chapter: 'Rabies' },

  // ── Tetanus (A33–A35) ─────────────────────────────────────────────────────
  { code: 'A33', description: 'Tetanus neonatorum', chapter: 'Tetanus' },
  { code: 'A34', description: 'Obstetrical tetanus', chapter: 'Tetanus' },
  { code: 'A35', description: 'Other tetanus', chapter: 'Tetanus' },

  // ── Animal bites / exposure ───────────────────────────────────────────────
  { code: 'W54.0', description: 'Bitten by dog', chapter: 'Animal Bites' },
  { code: 'W54.1', description: 'Struck by dog', chapter: 'Animal Bites' },
  { code: 'W53.0', description: 'Bitten by house mouse', chapter: 'Animal Bites' },
  { code: 'W53.1', description: 'Bitten by rat', chapter: 'Animal Bites' },
  { code: 'W53.8', description: 'Bitten by other rodent', chapter: 'Animal Bites' },
  { code: 'W55.0', description: 'Bitten by cat', chapter: 'Animal Bites' },
  { code: 'W55.1', description: 'Scratched by cat', chapter: 'Animal Bites' },
  { code: 'W55.2', description: 'Bitten by cow', chapter: 'Animal Bites' },
  { code: 'W55.3', description: 'Bitten by horse', chapter: 'Animal Bites' },
  { code: 'W55.4', description: 'Bitten by pig', chapter: 'Animal Bites' },
  { code: 'W55.5', description: 'Bitten by raccoon', chapter: 'Animal Bites' },
  { code: 'W55.8', description: 'Bitten or struck by other mammals', chapter: 'Animal Bites' },
  { code: 'W59.0', description: 'Bitten by nonvenomous lizard', chapter: 'Animal Bites' },
  { code: 'W59.1', description: 'Struck by nonvenomous lizard', chapter: 'Animal Bites' },
  {
    code: 'W64',
    description: 'Exposure to unspecified animate mechanical forces',
    chapter: 'Animal Bites',
  },

  // ── Open wounds — head & neck (S01) ───────────────────────────────────────
  { code: 'S01.0', description: 'Open wound of scalp', chapter: 'Open Wounds — Head' },
  {
    code: 'S01.1',
    description: 'Open wound of eyelid and periocular area',
    chapter: 'Open Wounds — Head',
  },
  { code: 'S01.2', description: 'Open wound of nose', chapter: 'Open Wounds — Head' },
  { code: 'S01.3', description: 'Open wound of ear', chapter: 'Open Wounds — Head' },
  {
    code: 'S01.4',
    description: 'Open wound of cheek and temporomandibular area',
    chapter: 'Open Wounds — Head',
  },
  {
    code: 'S01.5',
    description: 'Open wound of lip and oral cavity',
    chapter: 'Open Wounds — Head',
  },
  {
    code: 'S01.8',
    description: 'Open wound of other parts of head',
    chapter: 'Open Wounds — Head',
  },
  { code: 'S01.9', description: 'Open wound of head, unspecified', chapter: 'Open Wounds — Head' },
  { code: 'S09.9', description: 'Unspecified injury of head', chapter: 'Open Wounds — Head' },

  // ── Open wounds — neck (S11) ──────────────────────────────────────────────
  { code: 'S11.0', description: 'Open wound of larynx and trachea', chapter: 'Open Wounds — Neck' },
  { code: 'S11.1', description: 'Open wound of thyroid gland', chapter: 'Open Wounds — Neck' },
  {
    code: 'S11.2',
    description: 'Open wound of pharynx and cervical oesophagus',
    chapter: 'Open Wounds — Neck',
  },
  {
    code: 'S11.8',
    description: 'Open wound of other parts of neck',
    chapter: 'Open Wounds — Neck',
  },
  { code: 'S11.9', description: 'Open wound of neck, unspecified', chapter: 'Open Wounds — Neck' },

  // ── Open wounds — thorax (S21) ────────────────────────────────────────────
  { code: 'S21.0', description: 'Open wound of breast', chapter: 'Open Wounds — Thorax' },
  {
    code: 'S21.1',
    description: 'Open wound of front wall of thorax without penetration',
    chapter: 'Open Wounds — Thorax',
  },
  {
    code: 'S21.2',
    description: 'Open wound of back wall of thorax without penetration',
    chapter: 'Open Wounds — Thorax',
  },
  {
    code: 'S21.9',
    description: 'Open wound of thorax, unspecified',
    chapter: 'Open Wounds — Thorax',
  },

  // ── Open wounds — shoulder & upper arm (S41) ──────────────────────────────
  {
    code: 'S41.0',
    description: 'Open wound of shoulder',
    chapter: 'Open Wounds — Shoulder/Upper Arm',
  },
  {
    code: 'S41.1',
    description: 'Open wound of upper arm',
    chapter: 'Open Wounds — Shoulder/Upper Arm',
  },
  {
    code: 'S49.9',
    description: 'Unspecified injury of shoulder and upper arm',
    chapter: 'Open Wounds — Shoulder/Upper Arm',
  },

  // ── Open wounds — elbow & forearm (S51) ───────────────────────────────────
  { code: 'S51.0', description: 'Open wound of elbow', chapter: 'Open Wounds — Elbow/Forearm' },
  {
    code: 'S51.7',
    description: 'Multiple open wounds of forearm',
    chapter: 'Open Wounds — Elbow/Forearm',
  },
  {
    code: 'S51.8',
    description: 'Open wound of other parts of forearm',
    chapter: 'Open Wounds — Elbow/Forearm',
  },
  {
    code: 'S51.9',
    description: 'Open wound of forearm, unspecified',
    chapter: 'Open Wounds — Elbow/Forearm',
  },
  {
    code: 'S59.9',
    description: 'Unspecified injury of forearm',
    chapter: 'Open Wounds — Elbow/Forearm',
  },

  // ── Open wounds — hand & wrist (S61) ──────────────────────────────────────
  {
    code: 'S61.0',
    description: 'Open wound of finger without damage to nail',
    chapter: 'Open Wounds — Hand/Wrist',
  },
  {
    code: 'S61.1',
    description: 'Open wound of finger with damage to nail',
    chapter: 'Open Wounds — Hand/Wrist',
  },
  {
    code: 'S61.2',
    description: 'Open wound of thumb without damage to nail',
    chapter: 'Open Wounds — Hand/Wrist',
  },
  {
    code: 'S61.3',
    description: 'Open wound of thumb with damage to nail',
    chapter: 'Open Wounds — Hand/Wrist',
  },
  { code: 'S61.4', description: 'Open wound of hand', chapter: 'Open Wounds — Hand/Wrist' },
  { code: 'S61.5', description: 'Open wound of wrist', chapter: 'Open Wounds — Hand/Wrist' },
  {
    code: 'S61.9',
    description: 'Open wound of wrist and hand, unspecified',
    chapter: 'Open Wounds — Hand/Wrist',
  },

  // ── Open wounds — abdomen (S31) ───────────────────────────────────────────
  {
    code: 'S31.0',
    description: 'Open wound of lower back and pelvis',
    chapter: 'Open Wounds — Abdomen',
  },
  {
    code: 'S31.1',
    description: 'Open wound of abdominal wall without penetration',
    chapter: 'Open Wounds — Abdomen',
  },
  {
    code: 'S31.9',
    description: 'Open wound of abdomen, unspecified',
    chapter: 'Open Wounds — Abdomen',
  },

  // ── Open wounds — hip & thigh (S71) ───────────────────────────────────────
  { code: 'S71.0', description: 'Open wound of hip', chapter: 'Open Wounds — Hip/Thigh' },
  { code: 'S71.1', description: 'Open wound of thigh', chapter: 'Open Wounds — Hip/Thigh' },
  {
    code: 'S79.9',
    description: 'Unspecified injury of hip and thigh',
    chapter: 'Open Wounds — Hip/Thigh',
  },

  // ── Open wounds — knee & lower leg (S81) ──────────────────────────────────
  { code: 'S81.0', description: 'Open wound of knee', chapter: 'Open Wounds — Knee/Lower Leg' },
  {
    code: 'S81.7',
    description: 'Multiple open wounds of lower leg',
    chapter: 'Open Wounds — Knee/Lower Leg',
  },
  {
    code: 'S81.8',
    description: 'Open wound of other parts of lower leg',
    chapter: 'Open Wounds — Knee/Lower Leg',
  },
  {
    code: 'S81.9',
    description: 'Open wound of lower leg, unspecified',
    chapter: 'Open Wounds — Knee/Lower Leg',
  },
  {
    code: 'S89.9',
    description: 'Unspecified injury of lower leg',
    chapter: 'Open Wounds — Knee/Lower Leg',
  },

  // ── Open wounds — ankle & foot (S91) ──────────────────────────────────────
  { code: 'S91.0', description: 'Open wound of ankle', chapter: 'Open Wounds — Ankle/Foot' },
  {
    code: 'S91.1',
    description: 'Open wound of toe without damage to nail',
    chapter: 'Open Wounds — Ankle/Foot',
  },
  {
    code: 'S91.2',
    description: 'Open wound of toe with damage to nail',
    chapter: 'Open Wounds — Ankle/Foot',
  },
  { code: 'S91.3', description: 'Open wound of foot', chapter: 'Open Wounds — Ankle/Foot' },
  {
    code: 'S99.9',
    description: 'Unspecified injury of ankle and foot',
    chapter: 'Open Wounds — Ankle/Foot',
  },

  // ── Anaphylaxis & allergy (T78, T80) ──────────────────────────────────────
  {
    code: 'T78.0',
    description: 'Anaphylactic shock due to adverse food reaction',
    chapter: 'Anaphylaxis / Allergy',
  },
  { code: 'T78.1', description: 'Other adverse food reactions', chapter: 'Anaphylaxis / Allergy' },
  {
    code: 'T78.2',
    description: 'Anaphylactic shock, unspecified',
    chapter: 'Anaphylaxis / Allergy',
  },
  { code: 'T78.3', description: 'Angioneurotic oedema', chapter: 'Anaphylaxis / Allergy' },
  { code: 'T78.4', description: 'Allergy, unspecified', chapter: 'Anaphylaxis / Allergy' },
  {
    code: 'T80.5',
    description: 'Anaphylactic shock due to serum',
    chapter: 'Anaphylaxis / Allergy',
  },
  { code: 'T80.6', description: 'Other serum reactions', chapter: 'Anaphylaxis / Allergy' },

  // ── AEFI — immunization complications (T88) ───────────────────────────────
  { code: 'T88.0', description: 'Infection following immunization', chapter: 'AEFI' },
  { code: 'T88.1', description: 'Other complications following immunization', chapter: 'AEFI' },
  {
    code: 'T88.6',
    description: 'Anaphylactic shock due to adverse effect of correct drug',
    chapter: 'AEFI',
  },
  {
    code: 'T88.7',
    description: 'Unspecified adverse effect of drug or medicament',
    chapter: 'AEFI',
  },

  // ── Wound infections ──────────────────────────────────────────────────────
  { code: 'L08.0', description: 'Pyoderma', chapter: 'Wound Infection' },
  {
    code: 'L08.8',
    description: 'Other specified local infections of skin',
    chapter: 'Wound Infection',
  },
  { code: 'L03.0', description: 'Cellulitis of finger and toe', chapter: 'Wound Infection' },
  { code: 'L03.1', description: 'Cellulitis of other parts of limb', chapter: 'Wound Infection' },
  { code: 'L03.9', description: 'Cellulitis, unspecified', chapter: 'Wound Infection' },

  // ── Common comorbidities ──────────────────────────────────────────────────
  { code: 'E10', description: 'Type 1 diabetes mellitus', chapter: 'Comorbidities' },
  {
    code: 'E10.9',
    description: 'Type 1 diabetes mellitus without complications',
    chapter: 'Comorbidities',
  },
  { code: 'E11', description: 'Type 2 diabetes mellitus', chapter: 'Comorbidities' },
  {
    code: 'E11.9',
    description: 'Type 2 diabetes mellitus without complications',
    chapter: 'Comorbidities',
  },
  { code: 'I10', description: 'Essential (primary) hypertension', chapter: 'Comorbidities' },
  { code: 'J45', description: 'Asthma', chapter: 'Comorbidities' },
  { code: 'J45.9', description: 'Asthma, unspecified', chapter: 'Comorbidities' },
  { code: 'N18', description: 'Chronic kidney disease', chapter: 'Comorbidities' },
  { code: 'N18.9', description: 'Chronic kidney disease, unspecified', chapter: 'Comorbidities' },
  {
    code: 'B20',
    description: 'Human immunodeficiency virus (HIV) disease',
    chapter: 'Comorbidities',
  },
  {
    code: 'Z21',
    description: 'Asymptomatic human immunodeficiency virus infection status',
    chapter: 'Comorbidities',
  },
  { code: 'K92.1', description: 'Melaena', chapter: 'Comorbidities' },
  {
    code: 'Z87.3',
    description: 'Personal history of endocrine, nutritional and metabolic diseases',
    chapter: 'Comorbidities',
  },
]
