import { openai } from "@workspace/integrations-openai-ai-server";

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
  "jurisdictions": ["England & Wales", "Germany"] — array of jurisdictions the firm operates in. Use [] if none found,
  "practiceAreas": ["M&A", "Finance", "Regulatory"] — array of practice areas. Use [] if none found,
  "notes": "any other relevant notes about the firm in 1-2 sentences, or null"
}

Rules:
- name must be the official firm name (include LLP, GmbH, etc. if present)
- firmType: if the document says it is a panel firm, use 'panel'. If it describes niche/specialist work, use 'specialist'. Otherwise infer from context or use null.
- jurisdictions: list all countries/jurisdictions mentioned as the firm's operating locations
- practiceAreas: extract practice areas listed by the firm (M&A, Employment, Finance, IP, Litigation, Tax, etc.)
- Do NOT invent contact details — only extract what is explicitly stated in the document

Document text:
${text.slice(0, 40000)}`;

export async function extractLawFirmInfoFromText(text: string): Promise<ExtractedLawFirmInfo> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: EXTRACTION_PROMPT(text) },
    ],
    max_completion_tokens: 1200,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<ExtractedLawFirmInfo> = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  return {
    name: typeof parsed.name === "string" ? parsed.name : null,
    firmType: ["panel", "preferred", "specialist", "ad_hoc"].includes(parsed.firmType as string)
      ? (parsed.firmType as ExtractedLawFirmInfo["firmType"])
      : null,
    contactName: typeof parsed.contactName === "string" ? parsed.contactName : null,
    contactEmail: typeof parsed.contactEmail === "string" ? parsed.contactEmail : null,
    contactPhone: typeof parsed.contactPhone === "string" ? parsed.contactPhone : null,
    relationshipPartner: typeof parsed.relationshipPartner === "string" ? parsed.relationshipPartner : null,
    jurisdictions: Array.isArray(parsed.jurisdictions) ? (parsed.jurisdictions as string[]).filter(j => typeof j === "string") : [],
    practiceAreas: Array.isArray(parsed.practiceAreas) ? (parsed.practiceAreas as string[]).filter(p => typeof p === "string") : [],
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
  };
}
