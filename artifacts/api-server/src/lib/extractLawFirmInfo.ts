import { type AICompletionClient } from "./aiClient";

export interface ExtractedLawFirmInfo {
  name: string | null;
  firmType: "panel" | "preferred" | "specialist" | "ad_hoc" | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  relationshipPartner: string | null;
  jurisdictions: string[];
  practiceAreas: string[];
  notes: string | null;
}

const VALID_JURISDICTIONS = [
  "England & Wales",
  "United States (NY)",
  "Spain",
  "Germany",
  "France",
  "Netherlands",
  "Singapore",
  "Hong Kong",
  "UAE (DIFC)",
  "Australia",
];

const VALID_PRACTICE_AREAS = [
  "Mergers & Acquisitions",
  "Corporate Finance",
  "Regulatory & Compliance",
  "Litigation & Dispute Resolution",
  "Real Estate",
  "Employment & Labor",
  "Tax",
  "Intellectual Property",
  "Banking & Finance",
  "Restructuring & Insolvency",
];

const SYSTEM_PROMPT = `You are a specialist in corporate legal operations. Extract structured law firm information from documents such as engagement letters, pitch documents, capability statements, or firm brochures.
Return ONLY valid JSON. Use null for fields not found. Do not guess. Do not make up contact details.`;

const EXTRACTION_PROMPT = (text: string) => `Extract law firm information from the following document. Return a JSON object with exactly these fields:

{
  "name": "full legal name of the law firm, e.g. 'Smith & Associates LLP', or null if not found",
  "firmType": "one of: 'panel' (firms on an approved panel), 'preferred' (preferred suppliers not on panel), 'specialist' (niche/specialist firms), 'ad_hoc' (one-off/occasional use) — infer from context or use null",
  "contactName": "primary contact person's full name, or null",
  "contactEmail": "primary contact email address, or null",
  "contactPhone": "primary contact phone number with country code, or null",
  "relationshipPartner": "the relationship partner or account manager name at the firm, or null",
  "jurisdictions": [] — array of jurisdictions from this EXACT list only: ${JSON.stringify(VALID_JURISDICTIONS)}. Match each jurisdiction mentioned in the document to the closest option from this list. Return [] if none match,
  "practiceAreas": [] — array of practice areas from this EXACT list only: ${JSON.stringify(VALID_PRACTICE_AREAS)}. Match each practice area mentioned in the document to the closest option from this list. Return [] if none match,
  "notes": "any other relevant notes about the firm in 1-2 sentences, or null"
}

Rules:
- name must be the official firm name (include LLP, GmbH, etc. if present)
- firmType: if the document says it is a panel firm, use 'panel'. If it describes niche/specialist work, use 'specialist'. Otherwise infer from context or use null.
- jurisdictions: MUST only contain values from the allowed list above — map the document's jurisdictions to the nearest matching option. If a jurisdiction is not in the list, omit it.
- practiceAreas: MUST only contain values from the allowed list above — map the document's practice areas to the nearest matching option. For example: "IP", "Intellectual Property law", "Patents & Trademarks" → "Intellectual Property"; "M&A", "Mergers", "Corporate Transactions" → "Mergers & Acquisitions"; "Litigation", "Dispute Resolution", "Arbitration" → "Litigation & Dispute Resolution"; "Employment", "Labour", "HR" → "Employment & Labor"; "Finance", "Banking" → "Banking & Finance".
- Do NOT invent contact details — only extract what is explicitly stated in the document

Document text:
${text.slice(0, 40000)}`;

export async function extractLawFirmInfoFromText(text: string, aiClient?: AICompletionClient): Promise<ExtractedLawFirmInfo> {
  if (!aiClient) throw new Error("No AI provider configured. Please add an API key in Settings.");
  const raw = await aiClient.complete({
    tier: "smart",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: EXTRACTION_PROMPT(text) },
    ],
  });
  let parsed: Partial<ExtractedLawFirmInfo> = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  // Filter jurisdictions and practice areas to only allow values from the valid lists
  const validJurisdictions = Array.isArray(parsed.jurisdictions)
    ? (parsed.jurisdictions as string[]).filter(j => typeof j === "string" && VALID_JURISDICTIONS.includes(j))
    : [];

  const validPracticeAreas = Array.isArray(parsed.practiceAreas)
    ? (parsed.practiceAreas as string[]).filter(p => typeof p === "string" && VALID_PRACTICE_AREAS.includes(p))
    : [];

  return {
    name: typeof parsed.name === "string" ? parsed.name : null,
    firmType: ["panel", "preferred", "specialist", "ad_hoc"].includes(parsed.firmType as string)
      ? (parsed.firmType as ExtractedLawFirmInfo["firmType"])
      : null,
    contactName: typeof parsed.contactName === "string" ? parsed.contactName : null,
    contactEmail: typeof parsed.contactEmail === "string" ? parsed.contactEmail : null,
    contactPhone: typeof parsed.contactPhone === "string" ? parsed.contactPhone : null,
    relationshipPartner: typeof parsed.relationshipPartner === "string" ? parsed.relationshipPartner : null,
    jurisdictions: validJurisdictions,
    practiceAreas: validPracticeAreas,
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
  };
}
