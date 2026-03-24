import { KNOWN_ROLE_CODES } from "./roleNormaliser";
import { issuesTable } from "@workspace/db";

/**
 * Flexible role matching: strips spaces from both sides, and treats any
 * "AssociateNthYear" rate code as matching the canonical "Associate" label.
 */
function rolesMatch(rateCode: string, normalizedLabel: string | null): boolean {
  if (!normalizedLabel) return false;
  const strip = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const nc = strip(rateCode);
  const nl = strip(normalizedLabel);
  if (nc === nl) return true;
  // "Associate" label matches any "AssociateNthYear" rate code
  if (nl === "associate" && nc.startsWith("associate")) return true;
  return false;
}

type IssueInsert = typeof issuesTable.$inferInsert;

export interface EvalItem {
  id: number;
  lineNo: number;
  workDate: string | null;
  timekeeperLabel: string | null;
  hours: string | null;
  rateCharged: string | null;
  amount: string | null;
  isExpenseLine: boolean;
  expenseType: string | null;
  description: string | null;
  roleRaw: string | null;
  roleNormalized: string | null;
  isUnauthorized: boolean;
}

export interface EvalPanelRate {
  roleCode: string;
  lawFirmName: string;
  jurisdiction: string;
  currency: string;
  maxRate: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface EvalFirm {
  name: string;
  firmType: string;
  jurisdictionsJson: string[] | null;
}

export interface EvalContext {
  invoiceId: number;
  runId: number;
  invoice: {
    currency: string;
    billingType: string | null;
    totalAmount: string | null;
    subtotalAmount: string | null;
    taxAmount: string | null;
    invoiceDate: string | null;
    jurisdiction: string | null;
    matterName: string | null;
    lawFirmId: number | null;
  };
  items: EvalItem[];
  firm: EvalFirm | null;
  firmTerms: Array<{ termKey: string; termValueJson: unknown }>;
  panelRates: Array<{ r: EvalPanelRate }>;
  docKinds: string[];
  elData: Record<string, unknown> | null;
  cumulativeYtdFees: number;
  meetingMinAttendees: number;
  meetingMaxAttendees: number;
  isRuleActive: (code: string) => boolean;
}

function n(v: string | number | null | undefined): number {
  return parseFloat(String(v ?? "0")) || 0;
}

function getTerm(terms: Array<{ termKey: string; termValueJson: unknown }>, key: string): unknown {
  return terms.find(t => t.termKey === key)?.termValueJson ?? null;
}

export function evaluateDeterministicRules(ctx: EvalContext): IssueInsert[] {
  const issues: IssueInsert[] = [];
  const {
    invoiceId, runId, invoice, items, firm, firmTerms, panelRates,
    docKinds, elData, cumulativeYtdFees, meetingMinAttendees, meetingMaxAttendees,
    isRuleActive,
  } = ctx;

  // Build a fallback rate map from firm_terms.per_role_rates_json.
  // This is used when no panel_rates entries exist for the firm, e.g. when the
  // rate schedule is defined in the firm's T&C rather than the global rate sheet.
  // Keys are canonical role labels ("Partner", "Senior Associate", "Associate", "Paralegal", etc.)
  const firmTermsRateCap: Map<string, number> = new Map();
  const perRoleRaw = firmTerms.find(t => t.termKey === "per_role_rates_json")?.termValueJson;
  if (perRoleRaw && typeof perRoleRaw === "object" && !Array.isArray(perRoleRaw)) {
    for (const [role, cap] of Object.entries(perRoleRaw as Record<string, unknown>)) {
      if (typeof cap === "number") firmTermsRateCap.set(role.trim().toLowerCase(), cap);
    }
  }

  // Given a normalized role label, find its cap rate from firm_terms (case-insensitive).
  function getFirmTermsCap(normalizedLabel: string | null): number | null {
    if (!normalizedLabel) return null;
    return firmTermsRateCap.get(normalizedLabel.trim().toLowerCase()) ?? null;
  }

  // Whether a role has a rate defined in either panel_rates or firm_terms
  function hasAnyRateCoverage(normalizedLabel: string | null): boolean {
    if (!normalizedLabel) return false;
    const hasPanelRate = panelRates.some(pr =>
      pr.r.lawFirmName === firm?.name
      && rolesMatch(pr.r.roleCode, normalizedLabel)
      && pr.r.jurisdiction === invoice.jurisdiction
      && pr.r.currency === invoice.currency
    );
    if (hasPanelRate) return true;
    return firmTermsRateCap.has(normalizedLabel.trim().toLowerCase());
  }

  const hasLineDetail = items.some(i => i.workDate !== null || i.hours !== null || i.rateCharged !== null);
  const hasAllDates = items.every(i => i.workDate !== null);
  const hasAllHours = items.every(i => i.hours !== null);
  const hasAllRates = items.every(i => i.isExpenseLine || i.rateCharged !== null);

  if (!hasLineDetail && items.length > 0 && isRuleActive("MISSING_LINE_DETAIL")) {
    issues.push({
      invoiceId,
      analysisRunId: runId,
      ruleCode: "MISSING_LINE_DETAIL",
      ruleType: "warning",
      severity: "warning",
      evaluatorType: "deterministic",
      issueStatus: "open",
      routeToRole: "legal_ops",
      explanationText: `This invoice does not contain a per-line breakdown with individual dates, hours, and rates per timekeeper. Only summary-level information is available. The following rules cannot be evaluated at line level and will be skipped or applied at summary level only: RATE_EXCESS, DUPLICATE_LINE, ARITHMETIC_ERROR, DAILY_HOURS_EXCEEDED, PARALLEL_BILLING, HOURS_DISPROPORTIONATE.`,
      evidenceJson: {
        line_item_count: items.length,
        has_dates: hasAllDates,
        has_hours: hasAllHours,
        has_rates: hasAllRates,
        summary_only: true,
      },
      suggestedAction: "Request detailed timesheet from law firm",
    });
  }

  const firmJurisdictions = (firm?.jurisdictionsJson ?? []);
  const firmHasMultipleJurisdictions = firmJurisdictions.length > 1;
  if (!invoice.jurisdiction && firmHasMultipleJurisdictions && isRuleActive("JURISDICTION_UNCLEAR")) {
    issues.push({
      invoiceId,
      analysisRunId: runId,
      ruleCode: "JURISDICTION_UNCLEAR",
      ruleType: "warning",
      severity: "warning",
      evaluatorType: "deterministic",
      issueStatus: "open",
      routeToRole: "legal_ops",
      explanationText: `The jurisdiction for this invoice could not be determined from the invoice or supporting documents. This information is required to correctly apply the rate schedule (${firm?.name ?? "this firm"} has rates varying by jurisdiction). Rules that may be affected: RATE_EXCESS, RATE_CARD_EXPIRED_OR_MISSING.`,
      evidenceJson: {
        jurisdiction_extracted: invoice.jurisdiction,
        affected_rules: ["RATE_EXCESS", "RATE_CARD_EXPIRED_OR_MISSING"],
      },
      suggestedAction: "Complete jurisdiction field manually and re-run",
    });
  }

  const agreedCurrency = (getTerm(firmTerms, "agreed_currency") as string | null)
    ?? (elData?.currency as string | null);
  if (agreedCurrency && invoice.currency && agreedCurrency.toUpperCase() !== invoice.currency.toUpperCase() && isRuleActive("WRONG_CURRENCY")) {
    const sourceDoc = elData ? "Engagement Letter" : "Panel T&C";
    issues.push({
      invoiceId,
      analysisRunId: runId,
      ruleCode: "WRONG_CURRENCY",
      ruleType: "objective",
      severity: "error",
      evaluatorType: "deterministic",
      issueStatus: "open",
      routeToRole: "legal_ops",
      explanationText: `The invoice is denominated in ${invoice.currency}, but the agreed billing currency for ${firm?.name ?? "this firm"} under ${sourceDoc} is ${agreedCurrency}. This discrepancy must be resolved before payment can be approved.`,
      evidenceJson: {
        invoice_currency: invoice.currency,
        agreed_currency: agreedCurrency,
        source_document: sourceDoc,
        law_firm: firm?.name,
      },
      suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
    });
  }

  if (invoice.billingType === "fixed_scope" || invoice.billingType === "closed_scope") {
    const hasEL = docKinds.includes("engagement_letter");
    if (!hasEL && isRuleActive("MISSING_DOCUMENTS_FIXED_SCOPE")) {
      issues.push({
        invoiceId,
        analysisRunId: runId,
        ruleCode: "MISSING_DOCUMENTS_FIXED_SCOPE",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `This invoice is billed as Fixed / Closed Scope but no Engagement Letter has been uploaded. An Engagement Letter specifying the agreed fixed fee is mandatory before this invoice can be analysed or approved.`,
        evidenceJson: {
          billing_type: invoice.billingType,
          invoice_documents_present: docKinds,
        },
        suggestedAction: "Reject",
      });
    }

    const agreedFee = n(elData?.totalAmount as string | null);
    const invoiceTotal = n(invoice.totalAmount);
    if (agreedFee > 0 && invoiceTotal > agreedFee && isRuleActive("FIXED_SCOPE_AMOUNT_MISMATCH")) {
      const excess = invoiceTotal - agreedFee;
      issues.push({
        invoiceId,
        analysisRunId: runId,
        ruleCode: "FIXED_SCOPE_AMOUNT_MISMATCH",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `This invoice is for a Fixed / Closed Scope engagement. The agreed fixed fee for ${elData?.matterName ?? invoice.matterName ?? "this matter"} under the Engagement Letter is ${invoice.currency} ${agreedFee.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. The invoice total is ${invoice.currency} ${invoiceTotal.toLocaleString("en-GB", { minimumFractionDigits: 2 })}, which exceeds the agreed fee by ${invoice.currency} ${excess.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. No variation to the fixed fee was pre-approved by Arcturus.`,
        evidenceJson: {
          billing_type: invoice.billingType,
          agreed_fee: agreedFee,
          scope_description: elData?.matterName ?? invoice.matterName,
          invoice_total: invoiceTotal,
          excess_amount: excess,
        },
        suggestedAction: "Accept | Reject",
        recoverableAmount: excess.toFixed(2),
        recoveryGroupKey: `fixed_scope_excess_${invoiceId}`,
      });
    }

    if (items.length > 0 && isRuleActive("LINE_ITEMS_IN_FIXED_SCOPE")) {
      const lineItemsWithHours = items.filter(i => !i.isExpenseLine && i.hours !== null);
      if (lineItemsWithHours.length > 0) {
        issues.push({
          invoiceId,
          analysisRunId: runId,
          ruleCode: "LINE_ITEMS_IN_FIXED_SCOPE",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `This invoice is billed as Fixed / Closed Scope, but contains ${lineItemsWithHours.length} line items with individual hours and rates. Fixed scope invoices should not include a time-based breakdown unless expressly requested by Arcturus.`,
          evidenceJson: {
            billing_type: invoice.billingType,
            line_item_count: lineItemsWithHours.length,
            sample_line_nos: lineItemsWithHours.slice(0, 5).map(i => i.lineNo),
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        });
      }
    }
  }

  const taxAmount = n(invoice.taxAmount);
  const subtotal = n(invoice.subtotalAmount);
  const total = n(invoice.totalAmount);
  if (subtotal > 0 && taxAmount >= 0 && isRuleActive("TAX_OR_VAT_MISMATCH")) {
    const expectedTotal = subtotal + taxAmount;
    const diff = Math.abs(total - expectedTotal);
    if (diff > 0.01) {
      issues.push({
        invoiceId,
        analysisRunId: runId,
        ruleCode: "TAX_OR_VAT_MISMATCH",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `A tax or VAT discrepancy was detected on this invoice. The stated subtotal is ${invoice.currency} ${subtotal.toFixed(2)} and tax is ${invoice.currency} ${taxAmount.toFixed(2)}, which should total ${invoice.currency} ${expectedTotal.toFixed(2)}. The invoice total is ${invoice.currency} ${total.toFixed(2)}. Difference: ${invoice.currency} ${diff.toFixed(2)}.`,
        evidenceJson: {
          tax_label: "VAT/Tax",
          stated_tax_amount: taxAmount,
          subtotal_amount: subtotal,
          basis_of_calculation: "subtotal + tax",
          difference: diff,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        recoverableAmount: total > expectedTotal ? (total - expectedTotal).toFixed(2) : null,
        recoveryGroupKey: `tax_mismatch_${invoiceId}`,
      });
    }
  }

  const discountThresholds = getTerm(firmTerms, "discount_thresholds_json") as { threshold: number; pct: number; method?: string }[] | null;
  if (discountThresholds && discountThresholds.length > 0 && invoice.invoiceDate && isRuleActive("VOLUME_DISCOUNT_NOT_APPLIED")) {
    const year = new Date(invoice.invoiceDate).getFullYear();
    const invoiceFees = n(invoice.totalAmount);
    const cumulativeWithInvoice = cumulativeYtdFees + invoiceFees;
    const sortedBands = [...discountThresholds].sort((a, b) => a.threshold - b.threshold);
    const discountMethod = sortedBands[0]?.method ?? "step";
    const lowestThreshold = sortedBands[0]?.threshold ?? Infinity;

    if (cumulativeWithInvoice >= lowestThreshold) {
      let expectedDiscount = 0;
      let applicableBands: { threshold: number; pct: number; amountInBand: number; bandDiscount: number }[] = [];

      if (discountMethod === "step") {
        let highestRate = 0, highestThreshold = 0;
        for (const band of sortedBands) {
          if (cumulativeWithInvoice >= band.threshold) {
            highestRate = band.pct / 100;
            highestThreshold = band.threshold;
          }
        }
        expectedDiscount = highestRate * invoiceFees;
        applicableBands = [{ threshold: highestThreshold, pct: highestRate * 100, amountInBand: invoiceFees, bandDiscount: expectedDiscount }];
      } else {
        for (let i = 0; i < sortedBands.length; i++) {
          const band = sortedBands[i];
          const nextThreshold = sortedBands[i + 1]?.threshold ?? Infinity;
          const overlapStart = Math.max(cumulativeYtdFees, band.threshold);
          const overlapEnd = Math.min(cumulativeWithInvoice, nextThreshold);
          const amountInBand = Math.max(0, overlapEnd - overlapStart);
          if (amountInBand > 0) {
            const bandDiscount = band.pct / 100 * amountInBand;
            expectedDiscount += bandDiscount;
            applicableBands.push({ threshold: band.threshold, pct: band.pct, amountInBand, bandDiscount });
          }
        }
      }

      if (expectedDiscount > 0) {
        const bandSummary = applicableBands.map(b =>
          `${invoice.currency} ${b.amountInBand.toFixed(2)} @ ${b.pct}% = ${invoice.currency} ${b.bandDiscount.toFixed(2)} (threshold: ${invoice.currency} ${b.threshold})`
        ).join("; ");
        issues.push({
          invoiceId,
          analysisRunId: runId,
          ruleCode: "VOLUME_DISCOUNT_NOT_APPLIED",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `Cumulative fees billed by ${firm?.name ?? "this firm"} in ${year} total ${invoice.currency} ${cumulativeWithInvoice.toFixed(2)} (including this invoice). Under the ${discountMethod} discount method, a total discount of ${invoice.currency} ${expectedDiscount.toFixed(2)} is owed. Bands: ${bandSummary}.`,
          evidenceJson: {
            law_firm: firm?.name,
            calendar_year: year,
            cumulative_fees_ytd: cumulativeYtdFees,
            invoice_fees: invoiceFees,
            cumulative_with_invoice: cumulativeWithInvoice,
            discount_method: discountMethod,
            applicable_bands: applicableBands,
            expected_discount: expectedDiscount,
          },
          suggestedAction: "Accept | Reject",
          recoverableAmount: expectedDiscount.toFixed(2),
          recoveryGroupKey: `volume_discount_${invoice.lawFirmId}_${year}`,
        });
      }
    }
  }

  // Expense policy can be stored as:
  //   { allowed: string[], not_allowed: string[], caps: Record<string,number> }  (new format)
  //   { [expType]: { cap?: number, allowed?: boolean } }                          (old flat format)
  const rawExpensePolicy = getTerm(firmTerms, "expense_policy_json") as Record<string, unknown> | null;
  const expAllowedList: string[] = Array.isArray(rawExpensePolicy?.allowed) ? (rawExpensePolicy!.allowed as string[]) : [];
  const expNotAllowedList: string[] = Array.isArray(rawExpensePolicy?.not_allowed) ? (rawExpensePolicy!.not_allowed as string[]) : [];

  const expenseTypeInList = (expType: string, list: string[]) =>
    list.some(entry => entry.toLowerCase().includes(expType) || expType.includes(entry.toLowerCase().split(/[\s(,]/)[0]));

  for (const item of items) {
    if (!item.isExpenseLine) continue;
    const expType = (item.expenseType ?? "").toLowerCase().trim();
    const amount = n(item.amount);

    if (!expType) continue;

    const isExplicitlyAllowed   = expAllowedList.length > 0 && expenseTypeInList(expType, expAllowedList);
    const isExplicitlyForbidden = expNotAllowedList.length > 0 && expenseTypeInList(expType, expNotAllowedList);

    if (!isExplicitlyForbidden && expAllowedList.length === 0 && expNotAllowedList.length === 0) {
      // No policy defined — skip expense type check entirely
    } else if (isExplicitlyForbidden && isRuleActive("UNAUTHORIZED_EXPENSE_TYPE")) {
      issues.push({
        invoiceId,
        analysisRunId: runId,
        invoiceItemId: item.id,
        ruleCode: "UNAUTHORIZED_EXPENSE_TYPE",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `Line ${item.lineNo} records an expense of type "${item.expenseType}" for ${invoice.currency} ${amount.toFixed(2)}. This expense type is explicitly listed as non-reimbursable under Panel T&C.`,
        evidenceJson: {
          line_no: item.lineNo,
          expense_type: item.expenseType,
          amount,
          description: item.description,
          source_document: "Panel T&C",
          not_allowed_list: expNotAllowedList,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        recoverableAmount: amount.toFixed(2),
        recoveryGroupKey: `unauth_expense_${item.lineNo}`,
      });
    } else if (!isExplicitlyAllowed && !isExplicitlyForbidden && expAllowedList.length > 0 && isRuleActive("UNAUTHORIZED_EXPENSE_TYPE")) {
      issues.push({
        invoiceId,
        analysisRunId: runId,
        invoiceItemId: item.id,
        ruleCode: "UNAUTHORIZED_EXPENSE_TYPE",
        ruleType: "objective",
        severity: "warning",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `Line ${item.lineNo} records an expense of type "${item.expenseType}" for ${invoice.currency} ${amount.toFixed(2)}. This expense type was not found in the list of authorised expense categories under Panel T&C. Please confirm whether this disbursement is recoverable.`,
        evidenceJson: {
          line_no: item.lineNo,
          expense_type: item.expenseType,
          amount,
          description: item.description,
          source_document: "Panel T&C",
          allowed_list: expAllowedList,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        recoverableAmount: amount.toFixed(2),
        recoveryGroupKey: `unauth_expense_${item.lineNo}`,
      });
    }

    // Legacy flat-format cap check
    const expensePolicy = rawExpensePolicy as Record<string, { cap?: number; allowed?: boolean }> | null;
    const found = expensePolicy ? Object.keys(expensePolicy).find(t => expType.includes(t.toLowerCase())) : undefined;
    if (found && expensePolicy![found]?.cap !== undefined && isRuleActive("EXPENSE_CAP_EXCEEDED")) {
      const cap = expensePolicy![found].cap!;
      if (amount > cap) {
        const excess = amount - cap;
        issues.push({
          invoiceId,
          analysisRunId: runId,
          invoiceItemId: item.id,
          ruleCode: "EXPENSE_CAP_EXCEEDED",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `Line ${item.lineNo} records an expense of type "${item.expenseType}" for ${invoice.currency} ${amount.toFixed(2)}. The applicable cap for this expense type under Panel T&C is ${invoice.currency} ${cap.toFixed(2)}. The excess is ${invoice.currency} ${excess.toFixed(2)}.`,
          evidenceJson: {
            line_no: item.lineNo,
            expense_type: item.expenseType,
            amount_charged: amount,
            cap_amount: cap,
            source_document: "Panel T&C",
            excess_amount: excess,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
          recoverableAmount: excess.toFixed(2),
          recoveryGroupKey: `expense_cap_${item.lineNo}`,
        });
      }
    }
  }

  const seenPairs = new Set<string>();
  if (isRuleActive("DUPLICATE_LINE")) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const descSimilar = (d1: string | null, d2: string | null): boolean => {
          if (!d1 || !d2) return true;
          const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
          const n1 = normalize(d1), n2 = normalize(d2);
          if (n1 === n2) return true;
          const shorter = n1.length < n2.length ? n1 : n2;
          const longer = n1.length < n2.length ? n2 : n1;
          return longer.includes(shorter) || (shorter.length > 10 && longer.startsWith(shorter.slice(0, Math.floor(shorter.length * 0.8))));
        };
        if (!a.isExpenseLine && !b.isExpenseLine
          && a.workDate && b.workDate && a.workDate === b.workDate
          && a.timekeeperLabel && b.timekeeperLabel && a.timekeeperLabel === b.timekeeperLabel
          && a.hours !== null && b.hours !== null && a.hours === b.hours
          && a.rateCharged !== null && b.rateCharged !== null && a.rateCharged === b.rateCharged
          && descSimilar(a.description, b.description)) {
          const pairKey = `${a.lineNo}_${b.lineNo}`;
          if (!seenPairs.has(pairKey)) {
            seenPairs.add(pairKey);
            const amount = n(b.amount);
            issues.push({
              invoiceId,
              analysisRunId: runId,
              invoiceItemId: b.id,
              ruleCode: "DUPLICATE_LINE",
              ruleType: "objective",
              severity: "error",
              evaluatorType: "deterministic",
              issueStatus: "open",
              routeToRole: "legal_ops",
              explanationText: `Line ${b.lineNo} appears to be a duplicate of line ${a.lineNo}. Both share the same date (${a.workDate}), timekeeper (${a.timekeeperLabel}), hours (${a.hours}), rate (${a.rateCharged}) and a near-identical description. The duplicate line represents ${invoice.currency} ${amount.toFixed(2)}.`,
              evidenceJson: {
                line_no_a: a.lineNo,
                line_no_b: b.lineNo,
                date: a.workDate,
                timekeeper_label: a.timekeeperLabel,
                hours: a.hours,
                rate: a.rateCharged,
                description_a: a.description,
                description_b: b.description,
                amount,
              },
              suggestedAction: "Accept | Reject",
              recoverableAmount: amount.toFixed(2),
              recoveryGroupKey: `duplicate_${a.lineNo}_${b.lineNo}`,
            });
          }
        }
      }
    }
  }

  if (isRuleActive("ARITHMETIC_ERROR")) {
    for (const item of items) {
      if (item.isExpenseLine || !item.hours || !item.rateCharged || !item.amount) continue;
      const expected = n(item.hours) * n(item.rateCharged);
      const actual = n(item.amount);
      const diff = Math.abs(actual - expected);
      if (diff > 0.01) {
        const direction = actual > expected ? "overbilling" : "underbilling";
        const recoverable = actual > expected ? (actual - expected).toFixed(2) : null;
        issues.push({
          invoiceId,
          analysisRunId: runId,
          invoiceItemId: item.id,
          ruleCode: "ARITHMETIC_ERROR",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `Line ${item.lineNo} records ${item.hours}h at ${item.rateCharged} ${invoice.currency}/h, which should total ${invoice.currency} ${expected.toFixed(2)}. The invoiced amount is ${invoice.currency} ${actual.toFixed(2)}. The discrepancy is ${invoice.currency} ${diff.toFixed(2)} (${direction}).`,
          evidenceJson: {
            line_no: item.lineNo,
            hours: item.hours,
            rate_charged: item.rateCharged,
            expected_amount: expected,
            actual_amount: actual,
            difference: diff,
          },
          suggestedAction: "Accept | Reject",
          recoverableAmount: recoverable,
          recoveryGroupKey: recoverable ? `arithmetic_${item.lineNo}` : null,
        });
      }
    }
  }

  const maxDailyHours = (getTerm(firmTerms, "max_daily_hours_per_timekeeper") as number | null) ?? 8;
  const dailyMap = new Map<string, { total: number; lineNos: number[]; role: string | null }>();
  if (isRuleActive("DAILY_HOURS_EXCEEDED")) {
    for (const item of items) {
      if (item.isExpenseLine || !item.workDate || !item.timekeeperLabel || !item.hours) continue;
      const key = `${item.timekeeperLabel}|${item.workDate}`;
      const existing = dailyMap.get(key) ?? { total: 0, lineNos: [], role: item.roleRaw };
      existing.total += n(item.hours);
      existing.lineNos.push(item.lineNo);
      dailyMap.set(key, existing);
    }
    for (const [key, data] of dailyMap.entries()) {
      if (data.total > maxDailyHours) {
        const [timekeeperLabel, workDate] = key.split("|");
        const tcSource = getTerm(firmTerms, "max_daily_hours_source_doc") as string | null ?? "Panel T&C";
        issues.push({
          invoiceId,
          analysisRunId: runId,
          ruleCode: "DAILY_HOURS_EXCEEDED",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `${timekeeperLabel} (${data.role ?? "unknown"}) billed a total of ${data.total.toFixed(1)}h on ${workDate}, exceeding the maximum of ${maxDailyHours}h per timekeeper per day under ${tcSource}. Excess: ${(data.total - maxDailyHours).toFixed(1)}h. Affected lines: ${data.lineNos.join(", ")}.`,
          evidenceJson: {
            timekeeper_label: timekeeperLabel,
            work_date: workDate,
            total_hours: data.total,
            cap_hours: maxDailyHours,
            excess_hours: data.total - maxDailyHours,
            affected_line_nos: data.lineNos,
            source_document: tcSource,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        });
      }
    }
  }

  const elStart = elData?.billingPeriodStart as string | null;
  const elEnd = elData?.billingPeriodEnd as string | null;
  if (elStart && elEnd && isRuleActive("BILLING_PERIOD_OUTSIDE_EL")) {
    const outOfPeriod = items.filter(item =>
      !item.isExpenseLine && item.workDate &&
      (item.workDate < elStart || item.workDate > elEnd)
    );
    if (outOfPeriod.length > 0) {
      issues.push({
        invoiceId,
        analysisRunId: runId,
        ruleCode: "BILLING_PERIOD_OUTSIDE_EL",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `${outOfPeriod.length} line(s) are dated outside the Engagement Letter period (${elStart} to ${elEnd}). Work billed outside the agreed engagement period requires specific authorisation. Affected lines: ${outOfPeriod.map(i => i.lineNo).join(", ")}.`,
        evidenceJson: {
          el_start: elStart,
          el_end: elEnd,
          affected_line_nos: outOfPeriod.map(i => i.lineNo),
          sample_work_dates: outOfPeriod.slice(0, 3).map(i => ({ line_no: i.lineNo, work_date: i.workDate })),
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
      });
    }
  }

  const timekeeperRates = new Map<string, { rates: Set<string>; roleNorm: string | null; lineNos: number[]; minRate: number; maxRate: number }>();
  for (const item of items) {
    if (item.isExpenseLine || !item.timekeeperLabel || !item.rateCharged) continue;
    const existing = timekeeperRates.get(item.timekeeperLabel) ?? {
      rates: new Set(), roleNorm: item.roleNormalized, lineNos: [], minRate: Infinity, maxRate: -Infinity
    };
    existing.rates.add(item.rateCharged);
    existing.lineNos.push(item.lineNo);
    const r = n(item.rateCharged);
    if (r < existing.minRate) existing.minRate = r;
    if (r > existing.maxRate) existing.maxRate = r;
    timekeeperRates.set(item.timekeeperLabel, existing);
  }

  if (isRuleActive("INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER")) {
    for (const [timekeeper, data] of timekeeperRates.entries()) {
      if (data.rates.size >= 2) {
        const panelRate = panelRates.find(pr =>
          pr.r.lawFirmName === firm?.name
          && rolesMatch(pr.r.roleCode, data.roleNorm)
          && pr.r.jurisdiction === invoice.jurisdiction
          && pr.r.currency === invoice.currency
        );
        const maxApprovedFromPanel = panelRate ? n(panelRate.r.maxRate) : null;
        // Use firm_terms as fallback if no panel rate entry exists
        const effectiveCap = maxApprovedFromPanel ?? getFirmTermsCap(data.roleNorm);
        const highestCharged = data.maxRate;

        // KEY BUSINESS RULE: Only raise this issue if the highest rate charged exceeds the
        // agreed cap. If both rates are at or below the cap, the lower rate is simply
        // advantageous to the client — flagging it could reveal to the firm that they
        // could charge more. This is not "money at risk" from the client's perspective.
        // Exception: if no cap is known we still flag it as we cannot assess the risk.
        if (effectiveCap !== null && highestCharged <= effectiveCap) continue;

        // Upside-exposure: if the firm corrects lower-rate lines up to the highest rate charged,
        // how much additional cost could they claim?
        const lowerRateLines = items.filter(i => i.timekeeperLabel === timekeeper && !i.isExpenseLine && n(i.rateCharged) < highestCharged);
        const upsideExposure = lowerRateLines.reduce((sum, i) => sum + (highestCharged - n(i.rateCharged)) * n(i.hours), 0);

        // If highest rate exceeds cap, it's an error; if no cap is known, warning.
        const anyRateAboveCap = effectiveCap !== null && highestCharged > effectiveCap;
        const severity = anyRateAboveCap ? "error" : "warning";

        const ratesDisplay = Array.from(data.rates)
          .map(r => `${invoice.currency} ${n(r).toFixed(2)}`)
          .join(" and ");

        // At this point we know highestCharged > effectiveCap (or effectiveCap is unknown).
        // The explanationText reflects that the higher of the two rates breaches the cap.
        const capNote = effectiveCap !== null
          ? ` The maximum approved rate for this role is ${invoice.currency} ${effectiveCap.toFixed(2)}/h — the higher rate charged (${invoice.currency} ${highestCharged.toFixed(2)}/h) exceeds this cap.`
          : " No approved rate cap was found for this role and jurisdiction.";
        const exposureNote = upsideExposure > 0
          ? ` If the firm applies the higher rate (${invoice.currency} ${highestCharged.toFixed(2)}/h) to all lines currently billed at the lower rate, the additional exposure would be ${invoice.currency} ${upsideExposure.toFixed(2)}.`
          : "";

        issues.push({
          invoiceId,
          analysisRunId: runId,
          ruleCode: "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER",
          ruleType: "objective",
          severity,
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `${timekeeper} (${data.roleNorm ?? "unknown role"}) is billed at inconsistent rates across ${data.lineNos.length} lines: ${ratesDisplay}/h.${capNote}${exposureNote} Please confirm which rate applies and request a corrected invoice if needed.`,
          evidenceJson: {
            timekeeper_label: timekeeper,
            role_normalized: data.roleNorm,
            rates_observed: Array.from(data.rates).map(r => n(r)),
            highest_rate_charged: highestCharged,
            lowest_rate_charged: data.minRate,
            max_approved_rate: effectiveCap,
            affected_line_nos: data.lineNos,
            lower_rate_line_nos: lowerRateLines.map(i => i.lineNo),
            upside_exposure: upsideExposure,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
          recoverableAmount: upsideExposure > 0 ? upsideExposure.toFixed(2) : null,
          recoveryGroupKey: `inconsistent_rate_${timekeeper}`,
        });
      }
    }
  }

  const seenMissingCombinations = new Set<string>();
  for (const item of items) {
    if (item.isExpenseLine || item.roleNormalized === null) continue;
    const combKey = `${firm?.name}|${invoice.jurisdiction}|${item.roleNormalized}|${invoice.currency}`;
    if (seenMissingCombinations.has(combKey)) continue;

    if (firm?.firmType === "panel" && invoice.jurisdiction) {
      const invoiceDateMs = invoice.invoiceDate ? new Date(invoice.invoiceDate).getTime() : null;
      const allMatchingRates = panelRates.filter(pr =>
        pr.r.lawFirmName === firm.name
        && pr.r.jurisdiction === invoice.jurisdiction
        && rolesMatch(pr.r.roleCode, item.roleNormalized)
        && pr.r.currency === invoice.currency
      );
      const validMatchingRates = invoiceDateMs
        ? allMatchingRates.filter(pr => {
            const from = pr.r.validFrom ? new Date(pr.r.validFrom).getTime() : 0;
            const to = pr.r.validTo ? new Date(pr.r.validTo).getTime() : Infinity;
            return from <= invoiceDateMs && invoiceDateMs <= to;
          })
        : allMatchingRates;

      // Only flag as missing if not covered by either panel_rates OR firm_terms.per_role_rates_json
      const coveredByFirmTerms = getFirmTermsCap(item.roleNormalized) !== null;
      if ((allMatchingRates.length === 0 || validMatchingRates.length === 0) && !coveredByFirmTerms && isRuleActive("RATE_CARD_EXPIRED_OR_MISSING")) {
        seenMissingCombinations.add(combKey);
        const affectedLines = items.filter(i => i.roleNormalized === item.roleNormalized).map(i => i.lineNo);
        const latestValidTo = allMatchingRates.length > 0
          ? allMatchingRates.map(pr => pr.r.validTo).filter((d): d is string => d !== null).sort().reverse()[0] ?? null
          : null;
        const reason = allMatchingRates.length === 0 ? "missing" : "expired";
        issues.push({
          invoiceId,
          analysisRunId: runId,
          ruleCode: "RATE_CARD_EXPIRED_OR_MISSING",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `Rate card ${reason} for ${firm.name} in jurisdiction ${invoice.jurisdiction} for role ${item.roleNormalized} as at ${invoice.invoiceDate ?? "invoice date"}. ${reason === "expired" ? `The rate card expired on ${latestValidTo}.` : "No rate entry covers this firm/jurisdiction/role/currency combination."} Analysis cannot proceed reliably for ${affectedLines.length} line(s) affected by this gap.`,
          evidenceJson: {
            law_firm: firm.name,
            jurisdiction: invoice.jurisdiction,
            role_normalized: item.roleNormalized,
            invoice_date: invoice.invoiceDate,
            reason,
            latest_valid_to_in_system: latestValidTo,
            affected_line_nos: affectedLines,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        });
      }
    }
  }

  const missingRoleItems = items.filter(item =>
    !item.isExpenseLine && item.roleRaw !== null && item.roleNormalized === null
  );
  if (isRuleActive("LAWYER_ROLE_MISMATCH")) {
    // Group by (timekeeperLabel, roleRaw) so one issue is raised per person/role combination
    type MismatchGroup = {
      timekeeperLabel: string | null;
      roleRaw: string;
      isUnauth: boolean;
      lines: { lineNo: number; itemId: number; amount: number }[];
      firstItemId: number;
    };
    const mismatchGroups = new Map<string, MismatchGroup>();

    for (const item of missingRoleItems) {
      const groupKey = `${item.timekeeperLabel ?? ""}|${item.roleRaw ?? ""}`;
      if (!mismatchGroups.has(groupKey)) {
        mismatchGroups.set(groupKey, {
          timekeeperLabel: item.timekeeperLabel,
          roleRaw: item.roleRaw ?? "",
          isUnauth: item.isUnauthorized,
          lines: [],
          firstItemId: item.id,
        });
      }
      mismatchGroups.get(groupKey)!.lines.push({ lineNo: item.lineNo, itemId: item.id, amount: n(item.amount) });
    }

    for (const group of mismatchGroups.values()) {
      const affectedLines = group.lines.map(l => l.lineNo).join(", ");
      const lineWord = group.lines.length === 1 ? "line" : "lines";
      const totalAmt = group.lines.reduce((s, l) => s + l.amount, 0);
      issues.push({
        invoiceId,
        analysisRunId: runId,
        invoiceItemId: group.firstItemId,
        ruleCode: "LAWYER_ROLE_MISMATCH",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: group.isUnauth
          ? `${group.timekeeperLabel ?? "An entry"} is billed as a non-human or unauthorised timekeeper with role "${group.roleRaw}" on ${lineWord} ${affectedLines} (total ${invoice.currency} ${totalAmt.toFixed(2)}). Machine translation tools, AI software, and similar non-human resources are not authorised as billable timekeepers under the Panel T&C.`
          : `The role label "${group.roleRaw}" for ${group.timekeeperLabel ?? "an unknown timekeeper"} on ${lineWord} ${affectedLines} could not be mapped to any approved role in the rate schedule. Please clarify the correct role or confirm whether this timekeeper is authorised.`,
        evidenceJson: {
          timekeeper_label: group.timekeeperLabel,
          role_raw: group.roleRaw,
          is_unauthorised_role: group.isUnauth,
          normalisation_attempted: true,
          affected_lines: group.lines.map(l => ({ line_no: l.lineNo, amount: l.amount })),
          total_amount: totalAmt,
          available_roles_in_source: KNOWN_ROLE_CODES,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        recoverableAmount: group.isUnauth ? totalAmt.toFixed(2) : undefined,
        recoveryGroupKey: group.isUnauth ? `unauth_timekeeper_${group.timekeeperLabel?.replace(/\s+/g, "_")}` : undefined,
      });
    }
  }

  const rolesMismatched = new Set(missingRoleItems.map(i => i.lineNo));

  if (isRuleActive("RATE_EXCESS")) {
    // Group excess lines by timekeeper so one issue is raised per person (not per line)
    type RateExcessGroup = {
      timekeeperLabel: string;
      roleNormalized: string;
      maxRate: number;
      rateCharged: number;
      lines: { lineNo: number; hours: number; excessAmount: number; itemId: number }[];
      firstItemId: number;
      rateSource: "panel_rates" | "firm_terms";
    };
    const rateExcessGroups = new Map<string, RateExcessGroup>();

    for (const item of items) {
      if (item.isExpenseLine || rolesMismatched.has(item.lineNo) || !item.roleNormalized || !item.rateCharged) continue;
      const applicableRates = panelRates.filter(pr =>
        pr.r.lawFirmName === firm?.name
        && rolesMatch(pr.r.roleCode, item.roleNormalized)
        && pr.r.jurisdiction === invoice.jurisdiction
        && pr.r.currency === invoice.currency
        && (!invoice.invoiceDate || !pr.r.validFrom || pr.r.validFrom <= invoice.invoiceDate)
        && (!pr.r.validTo || !invoice.invoiceDate || pr.r.validTo >= invoice.invoiceDate)
      );

      // Fallback: if no panel_rates entry, try firm_terms.per_role_rates_json
      const firmTermsCap = applicableRates.length === 0 ? getFirmTermsCap(item.roleNormalized) : null;
      if (applicableRates.length === 0 && firmTermsCap === null) continue;

      const maxRate = applicableRates.length > 0
        ? Math.max(...applicableRates.map(pr => n(pr.r.maxRate)))
        : firmTermsCap!;
      const rateCharged = n(item.rateCharged);
      if (rateCharged <= maxRate) continue;

      const groupKey = `${item.timekeeperLabel}|${item.roleNormalized}|${maxRate}`;
      if (!rateExcessGroups.has(groupKey)) {
        rateExcessGroups.set(groupKey, {
          timekeeperLabel: item.timekeeperLabel ?? "unknown",
          roleNormalized: item.roleNormalized,
          maxRate,
          rateCharged,
          lines: [],
          firstItemId: item.id,
          rateSource: applicableRates.length > 0 ? "panel_rates" : "firm_terms",
        });
      }
      const group = rateExcessGroups.get(groupKey)!;
      const hours = n(item.hours);
      group.lines.push({ lineNo: item.lineNo, hours, excessAmount: (rateCharged - maxRate) * hours, itemId: item.id });
    }

    for (const group of rateExcessGroups.values()) {
      const totalExcess = group.lines.reduce((s, l) => s + l.excessAmount, 0);
      const affectedLines = group.lines.map(l => l.lineNo).join(", ");
      const lineWord = group.lines.length === 1 ? "line" : "lines";
      issues.push({
        invoiceId,
        analysisRunId: runId,
        invoiceItemId: group.firstItemId,
        ruleCode: "RATE_EXCESS",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `${group.timekeeperLabel} (${group.roleNormalized}) is billed at ${invoice.currency} ${group.rateCharged.toFixed(2)}/h on ${lineWord} ${affectedLines}, exceeding the maximum approved rate of ${invoice.currency} ${group.maxRate.toFixed(2)}/h for this role and jurisdiction (${invoice.jurisdiction}). Total recoverable excess: ${invoice.currency} ${totalExcess.toFixed(2)}.`,
        evidenceJson: {
          timekeeper_label: group.timekeeperLabel,
          role_normalized: group.roleNormalized,
          rate_charged: group.rateCharged,
          max_rate: group.maxRate,
          jurisdiction: invoice.jurisdiction,
          affected_lines: group.lines.map(l => ({ line_no: l.lineNo, hours: l.hours, excess_amount: l.excessAmount })),
          excess_total: totalExcess,
          source_document: group.rateSource === "firm_terms" ? "T&C / Engagement Letter" : "Active Panel Rates",
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        recoverableAmount: totalExcess.toFixed(2),
        recoveryGroupKey: `rate_excess_${group.timekeeperLabel.replace(/\s+/g, "_")}`,
      });
    }
  }

  const meetingKeywords = ["meeting", "call", "conference", "hearing", "session", "videoconference", "teleconference", "webinar"];
  const dateGroups = new Map<string, Map<string, EvalItem[]>>();
  if (isRuleActive("MEETING_OVERSTAFFING")) {
    for (const item of items) {
      if (!item.workDate || !item.description) continue;
      const descLower = item.description.toLowerCase();
      if (!meetingKeywords.some(kw => descLower.includes(kw))) continue;
      const dayKey = item.workDate;
      const descKey = item.description.split(/[,;.]/)[0].trim().toLowerCase();
      if (!dateGroups.has(dayKey)) dateGroups.set(dayKey, new Map());
      const dayMap = dateGroups.get(dayKey)!;
      if (!dayMap.has(descKey)) dayMap.set(descKey, []);
      dayMap.get(descKey)!.push(item);
    }
    for (const [date, descMap] of dateGroups.entries()) {
      for (const [desc, groupItems] of descMap.entries()) {
        const uniqueTimekeepers = new Set(groupItems.map(i => i.timekeeperLabel).filter(Boolean));
        if (uniqueTimekeepers.size > meetingMaxAttendees) {
          const totalAmt = groupItems.reduce((sum, i) => sum + n(i.amount), 0);
          issues.push({
            invoiceId,
            analysisRunId: runId,
            ruleCode: "MEETING_OVERSTAFFING",
            ruleType: "configurable",
            severity: "warning",
            evaluatorType: "deterministic",
            issueStatus: "open",
            routeToRole: "legal_ops",
            explanationText: `On ${date}, ${uniqueTimekeepers.size} timekeepers billed for attendance at what appears to be the same meeting or call: ${Array.from(uniqueTimekeepers).join(", ")}. This exceeds the configured maximum of ${meetingMaxAttendees} attendees (expected normal range: ${meetingMinAttendees}–${meetingMaxAttendees}). Total amount: ${invoice.currency} ${totalAmt.toFixed(2)}.`,
            evidenceJson: {
              date,
              meeting_description: desc,
              timekeeper_list: Array.from(uniqueTimekeepers),
              attendee_count: uniqueTimekeepers.size,
              hours_each: groupItems.map(i => ({ timekeeper: i.timekeeperLabel, hours: i.hours })),
              amounts_each: groupItems.map(i => ({ timekeeper: i.timekeeperLabel, amount: i.amount })),
              total_amount: totalAmt,
              min_attendees_threshold: meetingMinAttendees,
              max_attendees_threshold: meetingMaxAttendees,
            },
            suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
            configSnapshotJson: { min_attendees: meetingMinAttendees, max_attendees: meetingMaxAttendees },
          });
        }
      }
    }
  }

  return issues;
}
