import { type AICompletionClient } from "./aiClient";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export interface ExtractedRateRow {
  lawFirmName: string;
  jurisdiction: string;
  roleCode: string;
  roleLabel: string;
  currency: string;
  maxRate: string;
  validFrom: string | null;
  validTo: string | null;
}

const SYSTEM_PROMPT = `You are a specialist in corporate legal billing who extracts structured rate schedule data from law firm documents.
Extract every rate row you can find. Return ONLY valid JSON. No markdown, no explanation.`;

const USER_PROMPT = (text: string) => `Extract all rate rows from this law firm rate schedule document. Return a JSON object:

{
  "rates": [
    {
      "lawFirmName": "exact law firm name from the document or 'Unknown'",
      "jurisdiction": "jurisdiction e.g. 'England & Wales', 'Germany', 'France'",
      "roleCode": "short code e.g. 'Partner', 'SeniorAssociate', 'Associate', 'Paralegal'",
      "roleLabel": "full label e.g. 'Senior Partner', '2nd Year Associate'",
      "currency": "3-letter ISO code e.g. 'GBP', 'EUR', 'USD'",
      "maxRate": "hourly rate as decimal string e.g. '650.00'",
      "validFrom": "YYYY-MM-DD or null",
      "validTo": "YYYY-MM-DD or null"
    }
  ]
}

Rules:
- Extract every role/jurisdiction combination as a separate row
- If currency is not stated but amounts look like GBP (£), use 'GBP'; EUR (€) → 'EUR'; USD ($) → 'USD'
- If dates are not stated, use null
- If law firm name is not in the document, use 'Unknown'
- roleCode should be a compact identifier (no spaces), roleLabel is the human-readable version
- maxRate must be a decimal number string, no currency symbols

Document text:
${text.slice(0, 40000)}`;

export async function extractRatesFromText(text: string, aiClient?: AICompletionClient): Promise<ExtractedRateRow[]> {
  if (!aiClient) throw new Error("No AI provider configured. Please add an API key in Settings.");
  const raw = await aiClient.complete({
    tier: "smart",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT(text) },
    ],
  });
  try {
    const parsed = JSON.parse(raw) as { rates?: ExtractedRateRow[] };
    return (parsed.rates ?? []).filter(r => r.lawFirmName && r.jurisdiction && r.roleCode && r.maxRate);
  } catch {
    return [];
  }
}

export async function extractTextFromExcel(buffer: Buffer): Promise<string> {
  try {
    const XLSX = require("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const lines: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim()) {
        lines.push(`=== Sheet: ${sheetName} ===`);
        lines.push(csv);
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function extractTextFromCsv(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8");
}
