import OpenAI from "openai";

export interface ExtractedFirmTerms {
  billing_type_default: string | null;
  discount_type: string | null;
  discount_payment_type: string | null;
  discount_thresholds_json: Array<{ from?: number; to?: number | null; pct?: number }> | null;
  max_daily_hours_per_timekeeper: number | null;
  getting_up_to_speed_billable: boolean | null;
  payment_terms_days: number | null;
  travel_policy: string | null;
  expense_policy_json: { allowed?: string[]; not_allowed?: string[]; caps?: Record<string, number> } | null;
  third_party_services_require_approval: boolean | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  best_friend_firms_json: string[] | null;
  per_role_rates_json: Record<string, number> | null;
}

const SYSTEM_PROMPT = `You are a specialist in corporate legal operations, expert at reading law firm engagement letters and terms & conditions documents. Extract structured commercial terms with precision.
Return ONLY valid JSON. Use null for any field not found. Do not guess.`;

const EXTRACTION_PROMPT = `Extract all commercial terms from the following law firm T&C / engagement letter document. Return a JSON object with exactly these fields:

{
  "billing_type_default": "primary billing arrangement: 'hourly', 'fixed_fee', 'blended_rate', 'retainer', or null",
  "discount_type": "type of discount: 'volume', 'early_payment', 'fixed_discount', or null",
  "discount_payment_type": "how discount is applied: 'invoice_reduction', 'rebate', 'credit_note', or null",
  "discount_thresholds_json": [{"from": 0, "to": 100000, "pct": 2.5}, ...] or null if no volume discounts,
  "max_daily_hours_per_timekeeper": integer max daily billable hours per person, or null if not specified,
  "getting_up_to_speed_billable": true/false/null — can the firm bill for familiarisation / getting up to speed time?,
  "payment_terms_days": integer number of days for payment, e.g. 30, 60, or null,
  "travel_policy": short summary of the travel expenses policy (string or null),
  "expense_policy_json": {"allowed": ["taxis", "meals"], "not_allowed": ["first class travel"], "caps": {"hotel": 200}} or null,
  "third_party_services_require_approval": true/false/null — do external/third-party disbursements need prior client approval?,
  "contract_start_date": "YYYY-MM-DD or null",
  "contract_end_date": "YYYY-MM-DD or null",
  "best_friend_firms_json": ["Firm A", "Firm B"] list of named best-friend or preferred network firms, or null,
  "per_role_rates_json": {"Partner": 700, "Senior Associate": 530, "Associate": 430, "Paralegal": 270} — maximum approved hourly rates per role, keyed by the canonical role name. Use the EXACT role name keys: "Senior Partner", "Partner", "Counsel", "Senior Associate", "Associate", "Legal Trainee", "Paralegal". Only include roles that have an explicit rate stated in the document. Use null if no rates are specified.
}

Document text:
`;

export async function extractLawFirmTermsFromText(text: string, apiKey?: string): Promise<ExtractedFirmTerms> {
  if (!apiKey) throw new Error("OpenAI API key not configured. Please add your key in Settings.");
  const truncated = text.slice(0, 40000);

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: EXTRACTION_PROMPT + truncated },
    ],
    max_completion_tokens: 2000,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(raw) as ExtractedFirmTerms;
  } catch {
    return {
      billing_type_default: null, discount_type: null, discount_payment_type: null,
      discount_thresholds_json: null, max_daily_hours_per_timekeeper: null,
      getting_up_to_speed_billable: null, payment_terms_days: null, travel_policy: null,
      expense_policy_json: null, third_party_services_require_approval: null,
      contract_start_date: null, contract_end_date: null, best_friend_firms_json: null,
      per_role_rates_json: null,
    };
  }
}

export function termsToUpsertPayload(extracted: ExtractedFirmTerms): Array<{ termKey: string; termValue: unknown }> {
  const entries = Object.entries(extracted) as [keyof ExtractedFirmTerms, unknown][];
  return entries
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([termKey, termValue]) => ({ termKey, termValue }));
}
