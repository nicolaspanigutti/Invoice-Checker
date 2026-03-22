const ROLE_MAPPING: Record<string, string> = {
  "partner": "Partner",
  "equity partner": "Partner",
  "senior partner": "Senior Partner",
  "managing partner": "Senior Partner",
  "of counsel": "Counsel",
  "counsel": "Counsel",
  "junior partner": "Counsel",
  "senior associate": "Senior Associate",
  "sr associate": "Senior Associate",
  "legal specialist": "Senior Associate",
  "specialist": "Senior Associate",
  "associate": "Associate",
  "associate solicitor": "Associate",
  "junior associate": "Associate",
  "paralegal": "Paralegal",
  "legal assistant": "Paralegal",
  "legal trainee": "Legal Trainee",
  "trainee": "Legal Trainee",
  "trainee solicitor": "Legal Trainee",
  "becario": "Legal Trainee",
  "legal trainee solicitor": "Legal Trainee",
  "intern": "Legal Trainee",
  "machine translation": "__UNAUTHORIZED__",
  "software tool": "__UNAUTHORIZED__",
  "ai tool": "__UNAUTHORIZED__",
};

// "Associate 2nd Year", "Associate 3rd Year", "2nd Year Associate", "Abogado 2º Año", etc.
const ASSOCIATE_YEAR_PATTERN = /^(?:associate\s+\d+(?:th|st|nd|rd)?\s+year|\d+(?:th|st|nd|rd)?\s+year\s+associate)$/i;
const ABOGADO_PATTERN = /^abogado\s+\d+[oº°]\s+a[nñ]o$/i;

export function normaliseRole(roleRaw: string | null): string | null {
  if (!roleRaw) return null;
  const key = roleRaw.trim().toLowerCase();

  if (ROLE_MAPPING[key] !== undefined) return ROLE_MAPPING[key] === "__UNAUTHORIZED__" ? null : ROLE_MAPPING[key];
  if (ASSOCIATE_YEAR_PATTERN.test(key) || ABOGADO_PATTERN.test(key)) return "Associate";

  for (const [pattern, code] of Object.entries(ROLE_MAPPING)) {
    if (key.includes(pattern) && code !== "__UNAUTHORIZED__") return code;
  }

  return null;
}

export function isUnauthorizedRole(roleRaw: string | null): boolean {
  if (!roleRaw) return false;
  const key = roleRaw.trim().toLowerCase();
  return ROLE_MAPPING[key] === "__UNAUTHORIZED__" || key.includes("machine translation") || key.includes("software tool");
}

export const KNOWN_ROLE_CODES = [
  "Partner", "Senior Partner", "Counsel", "Senior Associate",
  "Associate", "Legal Trainee", "Paralegal",
];
