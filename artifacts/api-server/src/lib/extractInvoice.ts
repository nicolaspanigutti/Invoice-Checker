import OpenAI from "openai";
import { createHash } from "crypto";
import { db, invoiceDocumentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const EXTRACTION_PROMPT_VERSION = "v1.1";

export interface ExtractedLineItem {
  timekeeperLabel: string | null;
  roleRaw: string | null;
  workDate: string | null;
  hours: string | null;
  rateCharged: string | null;
  amount: string | null;
  description: string | null;
  isExpenseLine: boolean;
  expenseType: string | null;
}

export interface ExtractedInvoiceData {
  lawFirmName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  totalAmount: string | null;
  subtotalAmount: string | null;
  taxAmount: string | null;
  currency: string | null;
  matterName: string | null;
  projectReference: string | null;
  jurisdiction: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  lineItems: ExtractedLineItem[];
}

export interface ExtractionOutput {
  extracted: ExtractedInvoiceData;
  confidence: Record<string, number>;
  textHash: string;
  promptVersion: string;
  fromCache: boolean;
}

const SYSTEM_PROMPT = `You are an expert legal invoice data extraction system for a corporate legal operations team. 
Extract structured data from law firm invoices with high precision.
Return ONLY valid JSON with no markdown or explanation.`;

const EXTRACTION_PROMPT = `Extract all the following fields from this law firm invoice. Return a JSON object with exactly these fields:

{
  "lawFirmName": "name of the law firm issuing the invoice (string or null)",
  "invoiceDate": "invoice date in YYYY-MM-DD format (string or null)",
  "dueDate": "payment due date in YYYY-MM-DD format (string or null)",
  "totalAmount": "total invoice amount as a decimal string without currency symbol e.g. '12345.67' (string or null)",
  "subtotalAmount": "subtotal before tax as decimal string (string or null)",
  "taxAmount": "VAT/tax amount as decimal string (string or null)",
  "currency": "3-letter ISO currency code e.g. GBP, EUR, USD (string or null)",
  "matterName": "legal matter name or description (string or null)",
  "projectReference": "project or matter reference number (string or null)",
  "jurisdiction": "legal jurisdiction e.g. England & Wales (string or null)",
  "billingPeriodStart": "start of billing period in YYYY-MM-DD (string or null)",
  "billingPeriodEnd": "end of billing period in YYYY-MM-DD (string or null)",
  "lineItems": [
    {
      "timekeeperLabel": "name or identifier of the timekeeper/person (string or null)",
      "roleRaw": "role as stated in invoice e.g. Partner, Associate, Trainee (string or null)",
      "workDate": "date work was performed in YYYY-MM-DD (string or null)",
      "hours": "hours billed as decimal string e.g. '2.50' (string or null)",
      "rateCharged": "hourly rate charged as decimal string (string or null)",
      "amount": "line amount as decimal string (string or null)",
      "description": "description of work performed (string or null)",
      "isExpenseLine": true or false,
      "expenseType": "type of expense if isExpenseLine is true e.g. court filing, travel (string or null)"
    }
  ],
  "confidence": {
    "lawFirmName": 0.0-1.0,
    "invoiceDate": 0.0-1.0,
    "totalAmount": 0.0-1.0,
    "currency": 0.0-1.0,
    "matterName": 0.0-1.0,
    "lineItems": 0.0-1.0
  }
}

Important rules:
- Monetary amounts: extract as plain decimal strings (e.g. "12345.67"), no currency symbols, no thousands separators
- For line item "amount": extract EXACTLY the number printed in the invoice's amount/total column for that row — do NOT compute or verify hours × rate. Arithmetic errors are deliberate and must be preserved as stated.
- Dates: always YYYY-MM-DD format. If only month/year are present, use the first day
- If a field is not present or cannot be determined, use null
- lineItems should contain one entry per billing line. If no line items are found, use an empty array
- confidence values should reflect how certain you are about each field: 1.0 = fully explicit, 0.5 = inferred, 0.0 = guessed

Invoice text:
`;

export function computeTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 64);
}

function makeClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

function parseExtractionResponse(content: string): { extracted: ExtractedInvoiceData; confidence: Record<string, number> } {
  let parsed: { confidence?: Record<string, number>; lineItems?: ExtractedLineItem[] } & Omit<ExtractedInvoiceData, "lineItems">;
  try {
    const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { lawFirmName: null, invoiceDate: null, dueDate: null, totalAmount: null, subtotalAmount: null, taxAmount: null, currency: null, matterName: null, projectReference: null, jurisdiction: null, billingPeriodStart: null, billingPeriodEnd: null, lineItems: [] };
  }

  const confidence: Record<string, number> = (parsed.confidence as Record<string, number>) ?? {};
  delete (parsed as Record<string, unknown>).confidence;

  const extracted: ExtractedInvoiceData = {
    lawFirmName: parsed.lawFirmName ?? null,
    invoiceDate: parsed.invoiceDate ?? null,
    dueDate: parsed.dueDate ?? null,
    totalAmount: parsed.totalAmount ?? null,
    subtotalAmount: parsed.subtotalAmount ?? null,
    taxAmount: parsed.taxAmount ?? null,
    currency: parsed.currency ?? null,
    matterName: parsed.matterName ?? null,
    projectReference: parsed.projectReference ?? null,
    jurisdiction: parsed.jurisdiction ?? null,
    billingPeriodStart: parsed.billingPeriodStart ?? null,
    billingPeriodEnd: parsed.billingPeriodEnd ?? null,
    lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems.map((item: ExtractedLineItem) => ({
      timekeeperLabel: item.timekeeperLabel ?? null,
      roleRaw: item.roleRaw ?? null,
      workDate: item.workDate ?? null,
      hours: item.hours != null ? String(item.hours) : null,
      rateCharged: item.rateCharged != null ? String(item.rateCharged) : null,
      amount: item.amount != null ? String(item.amount) : null,
      description: item.description ?? null,
      isExpenseLine: Boolean(item.isExpenseLine),
      expenseType: item.expenseType ?? null,
    })) : [],
  };

  return { extracted, confidence };
}

export async function extractInvoiceFromText(rawText: string, documentId?: number, apiKey?: string): Promise<ExtractionOutput> {
  const textHash = computeTextHash(rawText);

  if (documentId !== undefined) {
    const [existing] = await db
      .select()
      .from(invoiceDocumentsTable)
      .where(
        and(
          eq(invoiceDocumentsTable.id, documentId),
          eq(invoiceDocumentsTable.textHash, textHash),
          eq(invoiceDocumentsTable.extractionStatus, "done"),
          eq(invoiceDocumentsTable.promptVersion, EXTRACTION_PROMPT_VERSION),
        )
      )
      .limit(1);

    if (existing?.extractedJson) {
      try {
        const cached = JSON.parse(existing.extractedJson as string) as { extracted: ExtractedInvoiceData; confidence: Record<string, number> };
        return {
          extracted: cached.extracted,
          confidence: cached.confidence,
          textHash,
          promptVersion: EXTRACTION_PROMPT_VERSION,
          fromCache: true,
        };
      } catch {
      }
    }
  }

  if (!apiKey) throw new Error("OpenAI API key not configured. Please add your key in Settings.");

  const truncatedText = rawText.slice(0, 12000);

  const response = await makeClient(apiKey).chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: EXTRACTION_PROMPT + truncatedText },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const { extracted, confidence } = parseExtractionResponse(content);

  if (documentId !== undefined) {
    await db.update(invoiceDocumentsTable)
      .set({
        textHash,
        extractionStatus: "done",
        promptVersion: EXTRACTION_PROMPT_VERSION,
        extractedJson: JSON.stringify({ extracted, confidence }),
      })
      .where(eq(invoiceDocumentsTable.id, documentId));
  }

  return { extracted, confidence, textHash, promptVersion: EXTRACTION_PROMPT_VERSION, fromCache: false };
}

export async function extractInvoiceFromImage(base64DataUrl: string, mimeType: string, documentId?: number, apiKey?: string): Promise<ExtractionOutput> {
  const imageHash = computeTextHash(base64DataUrl);

  if (documentId !== undefined) {
    const [existing] = await db
      .select()
      .from(invoiceDocumentsTable)
      .where(
        and(
          eq(invoiceDocumentsTable.id, documentId),
          eq(invoiceDocumentsTable.textHash, imageHash),
          eq(invoiceDocumentsTable.extractionStatus, "done"),
          eq(invoiceDocumentsTable.promptVersion, EXTRACTION_PROMPT_VERSION),
        )
      )
      .limit(1);

    if (existing?.extractedJson) {
      try {
        const cached = JSON.parse(existing.extractedJson as string) as { extracted: ExtractedInvoiceData; confidence: Record<string, number> };
        return {
          extracted: cached.extracted,
          confidence: cached.confidence,
          textHash: imageHash,
          promptVersion: EXTRACTION_PROMPT_VERSION,
          fromCache: true,
        };
      } catch {
      }
    }
  }

  if (!apiKey) throw new Error("OpenAI API key not configured. Please add your key in Settings.");

  const response = await makeClient(apiKey).chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${EXTRACTION_PROMPT}[See attached invoice image]`,
          },
          {
            type: "image_url",
            image_url: {
              url: base64DataUrl,
              detail: "high",
            },
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const { extracted, confidence } = parseExtractionResponse(content);

  if (documentId !== undefined) {
    await db.update(invoiceDocumentsTable)
      .set({
        textHash: imageHash,
        extractionStatus: "done",
        promptVersion: EXTRACTION_PROMPT_VERSION,
        extractedJson: JSON.stringify({ extracted, confidence }),
      })
      .where(eq(invoiceDocumentsTable.id, documentId));
  }

  return { extracted, confidence, textHash: imageHash, promptVersion: EXTRACTION_PROMPT_VERSION, fromCache: false };
}
