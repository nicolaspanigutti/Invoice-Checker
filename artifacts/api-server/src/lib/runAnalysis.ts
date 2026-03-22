import {
  db,
  invoicesTable,
  invoiceDocumentsTable,
  invoiceItemsTable,
  lawFirmsTable,
  firmTermsTable,
  panelRatesTable,
  panelBaselineDocumentsTable,
  analysisRunsTable,
  issuesTable,
  rulesConfigTable,
  auditEventsTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { createHash } from "crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import { normaliseRole, isUnauthorizedRole, KNOWN_ROLE_CODES } from "./roleNormaliser";
import { checkCompleteness } from "./completenessGate";

const HEURISTIC_PROMPT_VERSION = "v1.0";
const EXTRACTION_PROMPT_VERSION = "v1.0";

type IssueInsert = typeof issuesTable.$inferInsert;
type InvoiceItem = typeof invoiceItemsTable.$inferSelect;

function n(v: string | null | undefined): number {
  return parseFloat(v ?? "0") || 0;
}

function getElData(extractedJson: string | null): Record<string, unknown> | null {
  if (!extractedJson) return null;
  try {
    return JSON.parse(extractedJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getTerm(terms: { termKey: string; termValueJson: unknown }[], key: string): unknown {
  return terms.find(t => t.termKey === key)?.termValueJson ?? null;
}

export async function runAnalysis(invoiceId: number, startedById: number): Promise<{
  analysisRunId: number;
  issueCount: number;
  outcome: string | null;
  amountAtRisk: string | null;
  status: string;
}> {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
  if (!invoice) throw new Error("Invoice not found");

  const [firm] = invoice.lawFirmId
    ? await db.select().from(lawFirmsTable).where(eq(lawFirmsTable.id, invoice.lawFirmId)).limit(1)
    : [null];

  const docs = await db.select().from(invoiceDocumentsTable).where(eq(invoiceDocumentsTable.invoiceId, invoiceId));
  const rawItems = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));

  const elDoc = docs.find(d => d.documentKind === "engagement_letter");
  const budgetDoc = docs.find(d => d.documentKind === "budget_estimate");
  const elData = getElData(elDoc?.extractedJson ?? null);
  const budgetData = getElData(budgetDoc?.extractedJson ?? null);

  const firmTerms = firm
    ? await db.select().from(firmTermsTable).where(eq(firmTermsTable.lawFirmId, firm.id))
    : [];

  const panelRates = firm && firm.firmType === "panel"
    ? await db
        .select({ r: panelRatesTable, d: panelBaselineDocumentsTable })
        .from(panelRatesTable)
        .innerJoin(panelBaselineDocumentsTable, eq(panelRatesTable.baselineDocumentId, panelBaselineDocumentsTable.id))
        .where(eq(panelBaselineDocumentsTable.verificationStatus, "active"))
    : [];

  const meetingConfig = await db.select().from(rulesConfigTable).where(eq(rulesConfigTable.ruleCode, "MEETING_OVERSTAFFING")).limit(1);
  const meetingConfigJson = (meetingConfig[0]?.configJson as Record<string, unknown> | null) ?? {};
  const meetingMinAttendees = (meetingConfigJson.min_attendees as number | null) ?? (meetingConfigJson.threshold as number | null) ?? 3;
  const meetingMaxAttendees = (meetingConfigJson.max_attendees as number | null) ?? 5;

  const inputHashSource = JSON.stringify({
    invoice: { id: invoice.id, totalAmount: invoice.totalAmount, currency: invoice.currency, invoiceDate: invoice.invoiceDate },
    docCount: docs.length,
    itemCount: rawItems.length,
    elDataHash: elDoc?.extractedJson ? createHash("sha256").update(elDoc.extractedJson).digest("hex").slice(0, 16) : null,
  });
  const inputHash = createHash("sha256").update(inputHashSource).digest("hex");

  const prevRuns = await db.select({ id: analysisRunsTable.id }).from(analysisRunsTable).where(eq(analysisRunsTable.invoiceId, invoiceId));
  const versionNo = prevRuns.length + 1;

  if (prevRuns.length > 0) {
    await db.update(analysisRunsTable)
      .set({ status: "obsolete" })
      .where(eq(analysisRunsTable.invoiceId, invoiceId));
    await db.delete(issuesTable).where(eq(issuesTable.invoiceId, invoiceId));
  }

  const [run] = await db.insert(analysisRunsTable).values({
    invoiceId,
    versionNo,
    triggerReason: "manual",
    status: "running",
    startedById,
    startedAt: new Date(),
    inputHash,
    extractionPromptVersion: EXTRACTION_PROMPT_VERSION,
    heuristicPromptVersion: HEURISTIC_PROMPT_VERSION,
  }).returning();

  const completeness = await checkCompleteness(invoiceId);
  if (!completeness.canRunAnalysis) {
    await db.update(analysisRunsTable).set({
      status: "failed",
      finishedAt: new Date(),
      summaryJson: {
        error: "completeness_gate_failed",
        blockingIssues: completeness.blockingIssues,
      },
    }).where(eq(analysisRunsTable.id, run.id));
    return {
      analysisRunId: run.id,
      issueCount: 0,
      outcome: null,
      amountAtRisk: null,
      status: "gate_failed",
    };
  }

  try {
  const issues: IssueInsert[] = [];

  const items: (InvoiceItem & { roleNormalizedComputed: string | null; isUnauthorized: boolean })[] = rawItems.map(item => ({
    ...item,
    roleNormalizedComputed: normaliseRole(item.roleRaw),
    isUnauthorized: isUnauthorizedRole(item.roleRaw),
  }));

  for (const item of items) {
    if (item.roleRaw !== null && !item.isExpenseLine) {
      await db.update(invoiceItemsTable)
        .set({ roleNormalized: item.roleNormalizedComputed })
        .where(eq(invoiceItemsTable.id, item.id));
    }
  }

  const hasLineDetail = items.some(i => i.workDate !== null || i.hours !== null || i.rateCharged !== null);
  const hasAllDates = items.every(i => i.workDate !== null);
  const hasAllHours = items.every(i => i.hours !== null);
  const hasAllRates = items.every(i => i.isExpenseLine || i.rateCharged !== null);

  if (!hasLineDetail && items.length > 0) {
    issues.push({
      invoiceId,
      analysisRunId: run.id,
      ruleCode: "MISSING_LINE_DETAIL",
      ruleType: "metadata",
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

  const firmHasMultipleJurisdictions = (firm?.jurisdictionsJson as string[] | null ?? []).length > 1;
  if (!invoice.jurisdiction && firmHasMultipleJurisdictions) {
    issues.push({
      invoiceId,
      analysisRunId: run.id,
      ruleCode: "JURISDICTION_UNCLEAR",
      ruleType: "metadata",
      severity: "warning",
      evaluatorType: "deterministic",
      issueStatus: "open",
      routeToRole: "legal_ops",
      explanationText: `The jurisdiction or applicable law for this invoice could not be determined from the invoice or supporting documents. This information is required to correctly apply the rate schedule (${firm?.name ?? "this firm"} has rates varying by jurisdiction). Rules that may be affected: RATE_EXCESS, RATE_CARD_EXPIRED_OR_MISSING.`,
      evidenceJson: {
        jurisdiction_extracted: invoice.jurisdiction,
        applicable_law_extracted: invoice.applicableLaw,
        affected_rules: ["RATE_EXCESS", "RATE_CARD_EXPIRED_OR_MISSING"],
      },
      suggestedAction: "Complete jurisdiction field manually and re-run",
    });
  }

  const agreedCurrency = (getTerm(firmTerms, "agreed_currency") as string | null)
    ?? (elData?.currency as string | null);
  if (agreedCurrency && invoice.currency && agreedCurrency.toUpperCase() !== invoice.currency.toUpperCase()) {
    const sourceDoc = elData ? "Engagement Letter" : "Panel T&C";
    issues.push({
      invoiceId,
      analysisRunId: run.id,
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
    const hasEL = docs.some(d => d.documentKind === "engagement_letter");
    if (!hasEL) {
      issues.push({
        invoiceId,
        analysisRunId: run.id,
        ruleCode: "MISSING_DOCUMENTS_FIXED_SCOPE",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `This invoice is billed as Fixed / Closed Scope but no Engagement Letter has been uploaded. An Engagement Letter specifying the agreed fixed fee is mandatory before this invoice can be analysed or approved.`,
        evidenceJson: {
          billing_type: invoice.billingType,
          invoice_documents_present: docs.map(d => d.documentKind),
        },
        suggestedAction: "Reject",
      });
    }

    const agreedFee = n(elData?.totalAmount as string | null);
    const invoiceTotal = n(invoice.totalAmount);
    if (agreedFee > 0 && invoiceTotal > agreedFee) {
      const excess = invoiceTotal - agreedFee;
      issues.push({
        invoiceId,
        analysisRunId: run.id,
        ruleCode: "FIXED_SCOPE_AMOUNT_MISMATCH",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `This invoice is for a Fixed / Closed Scope engagement. The agreed fixed fee for ${elData?.matterName ?? invoice.matterName ?? "this matter"} under the Engagement Letter dated ${elData?.invoiceDate ?? "N/A"} is ${invoice.currency} ${agreedFee.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. The invoice total is ${invoice.currency} ${invoiceTotal.toLocaleString("en-GB", { minimumFractionDigits: 2 })}, which exceeds the agreed fee by ${invoice.currency} ${excess.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. No variation to the fixed fee was pre-approved by Arcturus.`,
        evidenceJson: {
          billing_type: invoice.billingType,
          agreed_fee: agreedFee,
          el_date: elData?.invoiceDate,
          scope_description: elData?.matterName ?? invoice.matterName,
          invoice_total: invoiceTotal,
          excess_amount: excess,
        },
        suggestedAction: "Accept | Reject",
        recoverableAmount: excess.toFixed(2),
        recoveryGroupKey: `fixed_scope_excess_${invoiceId}`,
      });
    }

    if (items.length > 0) {
      const lineItemsWithHours = items.filter(i => !i.isExpenseLine && i.hours !== null);
      if (lineItemsWithHours.length > 0) {
        issues.push({
          invoiceId,
          analysisRunId: run.id,
          ruleCode: "LINE_ITEMS_IN_FIXED_SCOPE",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `This invoice is billed as Fixed / Closed Scope, but contains ${lineItemsWithHours.length} line items with individual hours and rates. Fixed scope invoices should not include a time-based breakdown unless expressly requested by Arcturus. The presence of hourly lines may indicate that the firm is attempting to bill on a time and materials basis.`,
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

  if (invoice.billingType !== "fixed_scope" && invoice.billingType !== "closed_scope") {
    const hasEL = docs.some(d => d.documentKind === "engagement_letter");
    const hasBudget = docs.some(d => d.documentKind === "budget_estimate");
    const hasRateCard = firm?.firmType === "panel" && panelRates.length > 0;
    const hasAnySource = hasEL || hasBudget || hasRateCard;
    if (!hasAnySource) {
      issues.push({
        invoiceId,
        analysisRunId: run.id,
        ruleCode: "REQUIRED_SOURCE_MISSING",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `No source document (Engagement Letter, Budget Estimate, or active Panel Rate Card) has been linked to this invoice. Without at least one source document, it is not possible to verify rates, scope compliance, or billing terms. Please upload the relevant document(s) before analysis can be completed reliably.`,
        evidenceJson: {
          billing_type: invoice.billingType,
          has_engagement_letter: hasEL,
          has_budget_estimate: hasBudget,
          has_panel_rate_card: hasRateCard,
          documents_present: docs.map(d => d.documentKind),
        },
        suggestedAction: "Upload Engagement Letter, Budget Estimate, or confirm Panel Rate Card is active",
      });
    }
  }

  const taxAmount = n(invoice.taxAmount);
  const subtotal = n(invoice.subtotalAmount);
  const total = n(invoice.totalAmount);
  if (subtotal > 0 && taxAmount >= 0) {
    const expectedTotal = subtotal + taxAmount;
    const diff = Math.abs(total - expectedTotal);
    if (diff > 0.01) {
      issues.push({
        invoiceId,
        analysisRunId: run.id,
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
          expected_tax_amount: taxAmount,
          tax_rate: null,
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
  if (discountThresholds && discountThresholds.length > 0 && invoice.invoiceDate) {
    const year = new Date(invoice.invoiceDate).getFullYear();
    const priorInvoicesResult = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(total_amount AS DECIMAL)), 0) as total
      FROM invoices 
      WHERE law_firm_id = ${invoice.lawFirmId}
        AND EXTRACT(YEAR FROM COALESCE(invoice_date::date, created_at::date)) = ${year}
        AND invoice_status = 'ready_to_pay'
        AND id != ${invoiceId}
    `);
    const cumulativeYtd = parseFloat((priorInvoicesResult.rows[0] as { total: string }).total ?? "0");
    const invoiceFees = n(invoice.totalAmount);
    const cumulativeWithInvoice = cumulativeYtd + invoiceFees;

    // Sort thresholds ascending so we can process bands in order
    const sortedBands = [...discountThresholds].sort((a, b) => a.threshold - b.threshold);

    // Determine discount method from first band (contract-level, consistent across bands)
    const discountMethod = sortedBands[0]?.method ?? "step";

    // Only proceed if cumulative total (including this invoice) crosses at least one threshold
    const lowestThreshold = sortedBands[0]?.threshold ?? Infinity;
    if (cumulativeWithInvoice >= lowestThreshold) {
      let expectedDiscount = 0;
      let applicableBands: { threshold: number; pct: number; amountInBand: number; bandDiscount: number }[] = [];

      if (discountMethod === "step") {
        // Step method: find the highest threshold crossed by cumulativeWithInvoice;
        // that rate applies to the ENTIRE invoice amount.
        let highestRate = 0;
        let highestThreshold = 0;
        for (const band of sortedBands) {
          if (cumulativeWithInvoice >= band.threshold) {
            highestRate = band.pct / 100;
            highestThreshold = band.threshold;
          }
        }
        expectedDiscount = highestRate * invoiceFees;
        applicableBands = [{ threshold: highestThreshold, pct: highestRate * 100, amountInBand: invoiceFees, bandDiscount: expectedDiscount }];
      } else {
        // Tiered method: each portion of the invoice is discounted at the rate
        // of the band it falls into. Accumulate across all bands crossed.
        // Bands: [T0=0 → T1): no discount, [T1 → T2): rate1, [T2 → T3): rate2, etc.
        for (let i = 0; i < sortedBands.length; i++) {
          const band = sortedBands[i];
          const nextThreshold = sortedBands[i + 1]?.threshold ?? Infinity;

          // Amount of this invoice that falls within this band
          const bandStart = band.threshold;
          const bandEnd = nextThreshold;
          const invoiceStart = cumulativeYtd;
          const invoiceEnd = cumulativeWithInvoice;

          // Overlap of invoice range [invoiceStart, invoiceEnd) with band [bandStart, bandEnd)
          const overlapStart = Math.max(invoiceStart, bandStart);
          const overlapEnd = Math.min(invoiceEnd, bandEnd);
          const amountInBand = Math.max(0, overlapEnd - overlapStart);

          if (amountInBand > 0) {
            const bandDiscount = band.pct / 100 * amountInBand;
            expectedDiscount += bandDiscount;
            applicableBands.push({ threshold: band.threshold, pct: band.pct, amountInBand, bandDiscount });
          }
        }
      }

      if (expectedDiscount > 0.01) {
        const bandSummary = applicableBands.map(b =>
          `${invoice.currency} ${b.amountInBand.toFixed(2)} @ ${b.pct}% = ${invoice.currency} ${b.bandDiscount.toFixed(2)} (threshold: ${invoice.currency} ${b.threshold})`
        ).join("; ");

        issues.push({
          invoiceId,
          analysisRunId: run.id,
          ruleCode: "VOLUME_DISCOUNT_NOT_APPLIED",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `Cumulative fees billed by ${firm?.name ?? "this firm"} in ${year} (excluding this invoice) total ${invoice.currency} ${cumulativeYtd.toFixed(2)}. With this invoice (${invoice.currency} ${invoiceFees.toFixed(2)}), cumulative total reaches ${invoice.currency} ${cumulativeWithInvoice.toFixed(2)}. Under the ${discountMethod} discount method, a total discount of ${invoice.currency} ${expectedDiscount.toFixed(2)} is owed. Bands: ${bandSummary}. No matching discount was found on this invoice.`,
          evidenceJson: {
            law_firm: firm?.name,
            calendar_year: year,
            cumulative_fees_ytd: cumulativeYtd,
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

  const expensePolicy = getTerm(firmTerms, "expense_policy_json") as Record<string, { cap?: number; allowed?: boolean }> | null;
  const authorisedTypes = expensePolicy ? Object.keys(expensePolicy) : [];

  for (const item of items) {
    if (!item.isExpenseLine) continue;
    const expType = (item.expenseType ?? "").toLowerCase();
    const amount = n(item.amount);

    if (!expType || authorisedTypes.length === 0) continue;

    const found = authorisedTypes.find(t => expType.includes(t.toLowerCase()));
    if (!found) {
      issues.push({
        invoiceId,
        analysisRunId: run.id,
        invoiceItemId: item.id,
        ruleCode: "UNAUTHORIZED_EXPENSE_TYPE",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `Line ${item.lineNo} records an expense of type "${item.expenseType}" for ${invoice.currency} ${amount.toFixed(2)}. This expense type was not found in the list of authorised expenses under Panel T&C, or no prior authorisation from Arcturus was recorded. Common non-reimbursable items include: secretarial time, photocopying, telephone charges, meals (outside approved travel), and third-party professional services (experts, local counsel, eDiscovery platforms) without prior written approval.`,
        evidenceJson: {
          line_no: item.lineNo,
          expense_type: item.expenseType,
          amount,
          description: item.description,
          source_document: "Panel T&C",
          authorised_types_in_source: authorisedTypes,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        recoverableAmount: amount.toFixed(2),
        recoveryGroupKey: `unauth_expense_${item.lineNo}`,
      });
    } else if (expensePolicy![found]?.cap !== undefined) {
      const cap = expensePolicy![found].cap!;
      if (amount > cap) {
        const excess = amount - cap;
        issues.push({
          invoiceId,
          analysisRunId: run.id,
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
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const descSimilar = (d1: string | null, d2: string | null): boolean => {
        if (!d1 || !d2) return true;
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
        const n1 = normalize(d1);
        const n2 = normalize(d2);
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
            analysisRunId: run.id,
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
        analysisRunId: run.id,
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

  const maxDailyHours = (getTerm(firmTerms, "max_daily_hours_per_timekeeper") as number | null) ?? 8;
  const dailyMap = new Map<string, { total: number; lineNos: number[]; role: string | null }>();
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
      const [timekeeper, date] = key.split("|");
      const excess = data.total - maxDailyHours;
      const tcSource = firmTerms.some(t => t.termKey === "max_daily_hours_per_timekeeper") ? "Panel T&C" : "default cap";
      issues.push({
        invoiceId,
        analysisRunId: run.id,
        ruleCode: "DAILY_HOURS_EXCEEDED",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `${timekeeper} (${data.role ?? "unknown role"}) billed ${data.total.toFixed(1)}h on ${date} across ${data.lineNos.length} line(s), exceeding the daily cap of ${maxDailyHours}h set in ${tcSource}. Excess: ${excess.toFixed(1)}h. No prior written approval from Arcturus was recorded.`,
        evidenceJson: {
          timekeeper_label: timekeeper,
          role_raw: data.role,
          date,
          total_hours_on_date: data.total,
          daily_cap: maxDailyHours,
          excess_hours: excess,
          affected_line_nos: data.lineNos,
          source_document: tcSource,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
      });
    }
  }

  const elStart = elData?.billingPeriodStart as string | null;
  const elEnd = elData?.billingPeriodEnd as string | null;
  if (elStart && elEnd) {
    const outOfPeriod = items.filter(item =>
      !item.isExpenseLine && item.workDate &&
      (item.workDate < elStart || item.workDate > elEnd)
    );
    if (outOfPeriod.length > 0) {
      issues.push({
        invoiceId,
        analysisRunId: run.id,
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
      rates: new Set(), roleNorm: item.roleNormalizedComputed, lineNos: [], minRate: Infinity, maxRate: -Infinity
    };
    existing.rates.add(item.rateCharged);
    existing.lineNos.push(item.lineNo);
    const r = n(item.rateCharged);
    if (r < existing.minRate) existing.minRate = r;
    if (r > existing.maxRate) existing.maxRate = r;
    timekeeperRates.set(item.timekeeperLabel, existing);
  }

  for (const [timekeeper, data] of timekeeperRates.entries()) {
    if (data.rates.size >= 2) {
      const panelRate = panelRates.find(pr =>
        pr.r.roleCode === data.roleNorm && pr.r.jurisdiction === invoice.jurisdiction && pr.r.currency === invoice.currency
      );
      const maxApproved = panelRate ? n(panelRate.r.maxRate) : null;
      const ratesAboveMin = data.lineNos
        .map(ln => items.find(i => i.lineNo === ln))
        .filter((i): i is typeof items[0] => i !== undefined && n(i.rateCharged) > data.minRate);
      const excessAmount = ratesAboveMin.reduce((sum, i) => sum + (n(i.rateCharged) - data.minRate) * n(i.hours), 0);

      issues.push({
        invoiceId,
        analysisRunId: run.id,
        ruleCode: "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER",
        ruleType: "objective",
        severity: "error",
        evaluatorType: "deterministic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `${timekeeper} (${data.roleNorm ?? "unknown role"}) appears on ${data.lineNos.length} lines with inconsistent rates: ${Array.from(data.rates).join(", ")} ${invoice.currency}/h. ${maxApproved ? `The maximum approved rate for this role and jurisdiction is ${invoice.currency} ${maxApproved.toFixed(2)}.` : ""} Estimated excess (lines above minimum): ${invoice.currency} ${excessAmount.toFixed(2)}.`,
        evidenceJson: {
          timekeeper_label: timekeeper,
          role_normalized: data.roleNorm,
          rates_observed: Array.from(data.rates),
          max_approved_rate: maxApproved,
          affected_line_nos: data.lineNos,
          excess_amount: excessAmount,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        recoverableAmount: excessAmount > 0 ? excessAmount.toFixed(2) : null,
        recoveryGroupKey: `inconsistent_rate_${timekeeper}`,
      });
    }
  }

  const seenMissingCombinations = new Set<string>();
  for (const item of items) {
    if (item.isExpenseLine || item.roleNormalizedComputed === null) continue;
    const combKey = `${firm?.name}|${invoice.jurisdiction}|${item.roleNormalizedComputed}|${invoice.currency}`;
    if (seenMissingCombinations.has(combKey)) continue;

    if (firm?.firmType === "panel" && invoice.jurisdiction) {
      const invoiceDateMs = invoice.invoiceDate ? new Date(invoice.invoiceDate).getTime() : null;
      const allMatchingRates = panelRates.filter(pr =>
        pr.r.lawFirmName === firm.name
        && pr.r.jurisdiction === invoice.jurisdiction
        && pr.r.roleCode === item.roleNormalizedComputed
        && pr.r.currency === invoice.currency
      );

      const validMatchingRates = invoiceDateMs
        ? allMatchingRates.filter(pr => {
            const from = pr.r.validFrom ? new Date(pr.r.validFrom).getTime() : 0;
            const to = pr.r.validTo ? new Date(pr.r.validTo).getTime() : Infinity;
            return from <= invoiceDateMs && invoiceDateMs <= to;
          })
        : allMatchingRates;

      if (allMatchingRates.length === 0 || validMatchingRates.length === 0) {
        seenMissingCombinations.add(combKey);
        const affectedLines = items.filter(i => i.roleNormalizedComputed === item.roleNormalizedComputed).map(i => i.lineNo);
        const latestValidTo = allMatchingRates.length > 0
          ? allMatchingRates
              .map(pr => pr.r.validTo)
              .filter((d): d is string => d !== null)
              .sort()
              .reverse()[0] ?? null
          : null;
        const reason = allMatchingRates.length === 0 ? "missing" : "expired";
        issues.push({
          invoiceId,
          analysisRunId: run.id,
          ruleCode: "RATE_CARD_EXPIRED_OR_MISSING",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `Rate card ${reason} for ${firm.name} in jurisdiction ${invoice.jurisdiction} for role ${item.roleNormalizedComputed} as at ${invoice.invoiceDate ?? "invoice date"}. ${reason === "expired" ? `The rate card expired on ${latestValidTo}.` : "No rate entry covers this firm/jurisdiction/role/currency combination."} Analysis cannot proceed reliably for ${affectedLines.length} line(s) affected by this gap.`,
          evidenceJson: {
            law_firm: firm.name,
            jurisdiction: invoice.jurisdiction,
            role_normalized: item.roleNormalizedComputed,
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

  const missingRoleLines = items.filter(item =>
    !item.isExpenseLine && item.roleRaw !== null && item.roleNormalizedComputed === null
  );
  for (const item of missingRoleLines) {
    const isUnauth = item.isUnauthorized;
    const recoverableAmt = isUnauth && item.amount ? n(item.amount) : null;
    issues.push({
      invoiceId,
      analysisRunId: run.id,
      invoiceItemId: item.id,
      ruleCode: "LAWYER_ROLE_MISMATCH",
      ruleType: "objective",
      severity: "error",
      evaluatorType: "deterministic",
      issueStatus: "open",
      routeToRole: "legal_ops",
      explanationText: isUnauth
        ? `Line ${item.lineNo} records a non-human or unauthorised role ("${item.roleRaw}") billed as a timekeeper for ${invoice.currency} ${n(item.amount).toFixed(2)}. Machine translation tools, AI software, and similar non-human resources are not authorised as billable timekeepers under the Panel T&C.`
        : `The role label "${item.roleRaw}" on line ${item.lineNo} for ${item.timekeeperLabel ?? "unknown timekeeper"} could not be mapped to any approved role in the rate schedule applicable to this matter. As a result, no maximum rate check can be performed for this line. Please clarify the correct role or confirm whether this timekeeper is authorised.`,
      evidenceJson: {
        line_no: item.lineNo,
        timekeeper_label: item.timekeeperLabel,
        role_raw: item.roleRaw,
        is_unauthorised_role: isUnauth,
        normalisation_attempted: true,
        available_roles_in_source: KNOWN_ROLE_CODES,
        amount: item.amount,
      },
      suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
      recoverableAmount: recoverableAmt !== null ? recoverableAmt.toFixed(2) : undefined,
      recoveryGroupKey: isUnauth ? `unauth_timekeeper_${item.lineNo}` : undefined,
    });
  }

  const rolesMismatched = new Set(missingRoleLines.map(i => i.lineNo));

  for (const item of items) {
    if (item.isExpenseLine || rolesMismatched.has(item.lineNo) || !item.roleNormalizedComputed || !item.rateCharged) continue;

    const applicableRates = panelRates.filter(pr =>
      pr.r.lawFirmName === firm?.name
      && pr.r.roleCode === item.roleNormalizedComputed
      && pr.r.jurisdiction === invoice.jurisdiction
      && pr.r.currency === invoice.currency
      && (!invoice.invoiceDate || pr.r.validFrom <= invoice.invoiceDate)
      && (!pr.r.validTo || !invoice.invoiceDate || pr.r.validTo >= invoice.invoiceDate)
    );

    if (applicableRates.length > 0) {
      const maxRate = Math.max(...applicableRates.map(pr => n(pr.r.maxRate)));
      const rateCharged = n(item.rateCharged);
      if (rateCharged > maxRate) {
        const excessPerHour = rateCharged - maxRate;
        const hours = n(item.hours);
        const recoverableAmount = excessPerHour * hours;
        issues.push({
          invoiceId,
          analysisRunId: run.id,
          invoiceItemId: item.id,
          ruleCode: "RATE_EXCESS",
          ruleType: "objective",
          severity: "error",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `The hourly rate charged for ${item.timekeeperLabel ?? "unknown"} (${item.roleNormalizedComputed}) on line ${item.lineNo} is ${invoice.currency} ${rateCharged.toFixed(2)}, which exceeds the maximum approved rate of ${invoice.currency} ${maxRate.toFixed(2)} for this role and jurisdiction (${invoice.jurisdiction}). Excess per hour: ${invoice.currency} ${excessPerHour.toFixed(2)}. Total excess on this line: ${invoice.currency} ${recoverableAmount.toFixed(2)}.`,
          evidenceJson: {
            line_no: item.lineNo,
            timekeeper_label: item.timekeeperLabel,
            role_raw: item.roleRaw,
            role_normalized: item.roleNormalizedComputed,
            rate_charged: rateCharged,
            max_rate: maxRate,
            jurisdiction: invoice.jurisdiction,
            hours,
            excess_per_hour: excessPerHour,
            excess_total: recoverableAmount,
            source_document: "Active Panel Rates",
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
          recoverableAmount: recoverableAmount.toFixed(2),
          recoveryGroupKey: `rate_excess_line_${item.lineNo}`,
        });
      }
    }
  }

  const meetingKeywords = ["meeting", "call", "conference", "hearing", "session", "videoconference", "teleconference", "webinar"];
  const dateGroups = new Map<string, Map<string, InvoiceItem[]>>();
  for (const item of items) {
    if (!item.workDate || !item.description) continue;
    const descLower = item.description.toLowerCase();
    const isMeeting = meetingKeywords.some(kw => descLower.includes(kw));
    if (!isMeeting) continue;
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
        const total = groupItems.reduce((sum, i) => sum + n(i.amount), 0);
        issues.push({
          invoiceId,
          analysisRunId: run.id,
          ruleCode: "MEETING_OVERSTAFFING",
          ruleType: "configurable",
          severity: "warning",
          evaluatorType: "deterministic",
          issueStatus: "open",
          routeToRole: "legal_ops",
          explanationText: `On ${date}, ${uniqueTimekeepers.size} timekeepers billed for attendance at what appears to be the same meeting or call: ${Array.from(uniqueTimekeepers).join(", ")}. This exceeds the configured maximum of ${meetingMaxAttendees} attendees (expected normal range: ${meetingMinAttendees}–${meetingMaxAttendees}). Total amount for these lines: ${invoice.currency} ${total.toFixed(2)}.`,
          evidenceJson: {
            date,
            meeting_description: desc,
            timekeeper_list: Array.from(uniqueTimekeepers),
            attendee_count: uniqueTimekeepers.size,
            hours_each: groupItems.map(i => ({ timekeeper: i.timekeeperLabel, hours: i.hours })),
            amounts_each: groupItems.map(i => ({ timekeeper: i.timekeeperLabel, amount: i.amount })),
            total_amount: total,
            min_attendees_threshold: meetingMinAttendees,
            max_attendees_threshold: meetingMaxAttendees,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
          configSnapshotJson: { min_attendees: meetingMinAttendees, max_attendees: meetingMaxAttendees },
        });
      }
    }
  }

  let greyIssues: IssueInsert[] = [];
  let greyRulesFailed = false;
  if (items.length > 0) {
    try {
      greyIssues = await runGreyRules(invoiceId, run.id, invoice, firm, items, elData, budgetData, panelRates);
    } catch (greyErr) {
      console.error("Grey rule AI evaluation failed; continuing with objective results:", greyErr);
      greyRulesFailed = true;
    }
  }

  issues.push(...greyIssues);

  if (issues.length > 0) {
    for (const issue of issues) {
      await db.insert(issuesTable).values(issue);
    }
  }

  const totalRecoverable = issues.reduce((sum, iss) => sum + (iss.recoverableAmount ? parseFloat(iss.recoverableAmount as string) : 0), 0);

  let outcome: string | null = null;
  let newStatus: typeof invoicesTable.$inferSelect["invoiceStatus"] = "in_review";
  if (issues.length === 0) {
    outcome = "clean";
    newStatus = "ready_to_pay";
  }

  const oldInvoiceStatus = invoice.invoiceStatus;
  await db.update(invoicesTable).set({
    invoiceStatus: newStatus,
    reviewOutcome: outcome as typeof invoicesTable.$inferSelect["reviewOutcome"] | null,
    amountAtRisk: totalRecoverable > 0 ? totalRecoverable.toFixed(2) : null,
    currentAnalysisRunId: run.id,
  }).where(eq(invoicesTable.id, invoiceId));

  if (newStatus !== oldInvoiceStatus) {
    await db.insert(auditEventsTable).values({
      entityType: "invoice",
      entityId: invoiceId,
      eventType: "state_change",
      actorId: startedById,
      beforeJson: { status: oldInvoiceStatus },
      afterJson: { status: newStatus, outcome, issueCount: issues.length },
      reason: "analysis_completed",
    });
  }

  await db.update(analysisRunsTable).set({
    status: "completed",
    finishedAt: new Date(),
    summaryJson: {
      issueCount: issues.length,
      totalRecoverable,
      outcome,
      greyRulesEvaluated: !greyRulesFailed,
      greyRulesFailedReason: greyRulesFailed ? "AI evaluation error" : null,
    },
  }).where(eq(analysisRunsTable.id, run.id));

  return {
    analysisRunId: run.id,
    issueCount: issues.length,
    outcome,
    amountAtRisk: totalRecoverable > 0 ? totalRecoverable.toFixed(2) : null,
    status: "completed",
  };

  } catch (err) {
    await db.update(analysisRunsTable).set({
      status: "failed",
      finishedAt: new Date(),
      summaryJson: { error: String(err) },
    }).where(eq(analysisRunsTable.id, run.id));
    throw err;
  }
}

async function runGreyRules(
  invoiceId: number,
  runId: number,
  invoice: typeof invoicesTable.$inferSelect,
  firm: typeof lawFirmsTable.$inferSelect | null,
  items: (typeof invoiceItemsTable.$inferSelect & { roleNormalizedComputed: string | null })[],
  elData: Record<string, unknown> | null,
  budgetData: Record<string, unknown> | null,
  panelRates: { r: typeof panelRatesTable.$inferSelect; d: typeof panelBaselineDocumentsTable.$inferSelect }[],
): Promise<IssueInsert[]> {
  const linesSummary = items.map(i => ({
    line: i.lineNo,
    timekeeper: i.timekeeperLabel,
    role: i.roleRaw,
    roleNorm: i.roleNormalizedComputed,
    date: i.workDate,
    hours: i.hours,
    rate: i.rateCharged,
    amount: i.amount,
    desc: i.description?.slice(0, 80),
    isExpense: i.isExpenseLine,
    expenseType: i.expenseType,
  }));

  const elExcerpt = elData ? {
    matterName: elData.matterName,
    currency: elData.currency,
    totalAmount: elData.totalAmount,
    billingPeriodStart: elData.billingPeriodStart,
    billingPeriodEnd: elData.billingPeriodEnd,
    jurisdiction: elData.jurisdiction,
  } : null;

  const budgetExcerpt = budgetData ? { estimateAmount: budgetData.totalAmount, currency: budgetData.currency } : null;

  const panelMaxRates = panelRates.reduce<Record<string, string>>((acc, pr) => {
    const key = `${pr.r.roleCode}|${pr.r.jurisdiction}|${pr.r.currency}`;
    acc[key] = pr.r.maxRate;
    return acc;
  }, {});

  const prompt = `You are an expert legal invoice compliance reviewer for Arcturus Financial Group. Evaluate the following invoice line items for grey (heuristic) compliance rules. Return ONLY a valid JSON object.

Invoice metadata:
- Law Firm: ${firm?.name ?? "Unknown"}
- Firm Type: ${firm?.firmType ?? "unknown"}
- Invoice Total: ${invoice.currency} ${invoice.totalAmount}
- Matter: ${invoice.matterName}
- Jurisdiction: ${invoice.jurisdiction}
- Billing Type: ${invoice.billingType}
- Invoice Date: ${invoice.invoiceDate}

Line items (first 50):
${JSON.stringify(linesSummary, null, 2)}

Engagement Letter excerpt:
${elExcerpt ? JSON.stringify(elExcerpt, null, 2) : "Not available"}

Budget estimate:
${budgetExcerpt ? JSON.stringify(budgetExcerpt, null, 2) : "Not available"}

Panel max rates (roleCode|jurisdiction|currency → maxRate):
${JSON.stringify(panelMaxRates, null, 2)}

For each grey rule below, determine if it should fire based on the evidence. Return a JSON object with keys for each rule code:

{
  "EL_CONFLICT_WITH_PANEL_BASELINE": {
    "fires": true/false,
    "conflict_description": "...",
    "baseline_source": "...",
    "baseline_value": "...",
    "el_source": "Engagement Letter",
    "el_value": "..."
  },
  "HOURS_DISPROPORTIONATE": [
    {
      "fires": true/false,
      "timekeeper_label": "...",
      "role_normalized": "...",
      "total_hours": number,
      "billing_period": "...",
      "task_description": "...",
      "heuristic_reasoning": "..."
    }
  ],
  "PARALLEL_BILLING": [
    {
      "fires": true/false,
      "date": "...",
      "timekeeper_list": [...],
      "descriptions": [...],
      "hours_each": [...],
      "amounts_each": [...],
      "total_hours": number,
      "total_amount": number,
      "heuristic_reasoning": "..."
    }
  ],
  "SCOPE_CREEP": [
    {
      "fires": true/false,
      "line_no": number,
      "description": "...",
      "el_scope_summary": "...",
      "el_date": "...",
      "matter_name": "...",
      "heuristic_reasoning": "..."
    }
  ],
  "SENIORITY_OVERKILL": [
    {
      "fires": true/false,
      "line_no": number,
      "timekeeper_label": "...",
      "role_normalized": "...",
      "rate_charged": number,
      "hours": number,
      "amount": number,
      "description": "...",
      "heuristic_reasoning": "..."
    }
  ],
  "ESTIMATE_EXCESS": {
    "fires": true/false,
    "estimate_amount": number,
    "source_document": "...",
    "source_date": "...",
    "cumulative_fees": number,
    "excess_amount": number,
    "excess_pct": number,
    "revised_estimate_provided": false
  },
  "INTERNAL_COORDINATION": [
    {
      "fires": true/false,
      "line_no": number,
      "timekeeper_label": "...",
      "role_normalized": "...",
      "hours": number,
      "amount": number,
      "description": "...",
      "heuristic_reasoning": "..."
    }
  ]
}

Rules:
- EL_CONFLICT_WITH_PANEL_BASELINE: Only fires if EL is available AND firm is a panel firm AND EL contains terms that clearly contradict panel rates/T&C.
- HOURS_DISPROPORTIONATE: Only fires when hours for a task are genuinely unusual for the role (e.g. junior billing >80h/month on one task).
- PARALLEL_BILLING: Only fires when multiple timekeepers bill similar/overlapping work on the same date with similar descriptions.
- SCOPE_CREEP: Only fires if EL is available and a line clearly describes work outside the engagement scope. Be conservative.
- SENIORITY_OVERKILL: Only fires when a senior timekeeper (Partner, Senior Partner) bills for clearly administrative or routine tasks.
- ESTIMATE_EXCESS: Only fires if a budget estimate amount is available and cumulative billing clearly exceeds it.
- INTERNAL_COORDINATION: Only fires when a line description clearly indicates internal firm coordination billed to the client.

Return valid JSON only. No markdown, no explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: "You are a legal invoice compliance expert. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const greyIssues: IssueInsert[] = [];

    const elConflict = parsed["EL_CONFLICT_WITH_PANEL_BASELINE"] as { fires?: boolean; conflict_description?: string; baseline_source?: string; baseline_value?: string; el_value?: string } | null;
    if (elConflict?.fires && elConflict.conflict_description) {
      greyIssues.push({
        invoiceId,
        analysisRunId: runId,
        ruleCode: "EL_CONFLICT_WITH_PANEL_BASELINE",
        ruleType: "gray",
        severity: "error",
        evaluatorType: "heuristic",
        issueStatus: "open",
        routeToRole: "legal_ops",
        explanationText: `The Engagement Letter for this matter contains terms that appear to conflict with the active Panel baseline. Specific conflict detected: ${elConflict.conflict_description}. Panel baseline source: ${elConflict.baseline_source ?? "Active Panel Rates/T&C"}. EL term: ${elConflict.el_value ?? "see evidence"}. Per the Panel T&C, the EL does not override the Panel baseline unless expressly approved in writing by Arcturus.`,
        evidenceJson: {
          conflict_type: elConflict.conflict_description,
          baseline_source: elConflict.baseline_source,
          baseline_value: elConflict.baseline_value,
          el_source: "Engagement Letter",
          el_value: elConflict.el_value,
          conflict_description: elConflict.conflict_description,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
      });
    }

    const hoursDisp = parsed["HOURS_DISPROPORTIONATE"] as Array<{ fires?: boolean; timekeeper_label?: string; role_normalized?: string; total_hours?: number; billing_period?: string; task_description?: string; heuristic_reasoning?: string }> | null;
    if (Array.isArray(hoursDisp)) {
      for (const h of hoursDisp) {
        if (!h.fires || !h.timekeeper_label) continue;
        greyIssues.push({
          invoiceId,
          analysisRunId: runId,
          ruleCode: "HOURS_DISPROPORTIONATE",
          ruleType: "gray",
          severity: "warning",
          evaluatorType: "heuristic",
          issueStatus: "open",
          routeToRole: "internal_lawyer",
          explanationText: `${h.timekeeper_label} (${h.role_normalized ?? "unknown"}) billed ${h.total_hours}h on "${h.task_description}" during ${h.billing_period ?? "this billing period"}. For a ${h.role_normalized ?? "timekeeper"}, this volume of hours on a single task in one period is potentially unusual. ${h.heuristic_reasoning ?? ""}`,
          evidenceJson: {
            timekeeper_label: h.timekeeper_label,
            role_normalized: h.role_normalized,
            total_hours: h.total_hours,
            billing_period: h.billing_period,
            task_description: h.task_description,
            heuristic_reasoning: h.heuristic_reasoning,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        });
      }
    }

    const parallelBilling = parsed["PARALLEL_BILLING"] as Array<{ fires?: boolean; date?: string; timekeeper_list?: string[]; descriptions?: string[]; hours_each?: unknown[]; amounts_each?: unknown[]; total_hours?: number; total_amount?: number; heuristic_reasoning?: string }> | null;
    if (Array.isArray(parallelBilling)) {
      for (const pb of parallelBilling) {
        if (!pb.fires || !pb.date) continue;
        greyIssues.push({
          invoiceId,
          analysisRunId: runId,
          ruleCode: "PARALLEL_BILLING",
          ruleType: "gray",
          severity: "warning",
          evaluatorType: "heuristic",
          issueStatus: "open",
          routeToRole: "internal_lawyer",
          explanationText: `On ${pb.date}, ${pb.timekeeper_list?.length ?? 0} timekeepers billed for tasks with similar or overlapping descriptions: ${pb.timekeeper_list?.join(", ")}. Total hours billed across these lines: ${pb.total_hours}h for combined amount of ${invoice.currency} ${pb.total_amount?.toFixed(2) ?? "0.00"}. ${pb.heuristic_reasoning ?? ""}`,
          evidenceJson: {
            date: pb.date,
            timekeeper_list: pb.timekeeper_list,
            descriptions: pb.descriptions,
            hours_each: pb.hours_each,
            amounts_each: pb.amounts_each,
            total_hours: pb.total_hours,
            total_amount: pb.total_amount,
            heuristic_reasoning: pb.heuristic_reasoning,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        });
      }
    }

    const scopeCreep = parsed["SCOPE_CREEP"] as Array<{ fires?: boolean; line_no?: number; description?: string; el_scope_summary?: string; el_date?: string; matter_name?: string; heuristic_reasoning?: string }> | null;
    if (Array.isArray(scopeCreep)) {
      for (const sc of scopeCreep) {
        if (!sc.fires || !sc.line_no) continue;
        const lineItem = items.find(i => i.lineNo === sc.line_no);
        greyIssues.push({
          invoiceId,
          analysisRunId: runId,
          invoiceItemId: lineItem?.id,
          ruleCode: "SCOPE_CREEP",
          ruleType: "gray",
          severity: "warning",
          evaluatorType: "heuristic",
          issueStatus: "open",
          routeToRole: "internal_lawyer",
          explanationText: `Line ${sc.line_no} describes work ("${sc.description}") that does not appear to fall within the agreed scope of the Engagement Letter dated ${sc.el_date ?? "N/A"} for ${sc.matter_name ?? invoice.matterName ?? "this matter"}. The agreed scope covers: ${sc.el_scope_summary ?? "see Engagement Letter"}. ${sc.heuristic_reasoning ?? ""}`,
          evidenceJson: {
            line_no: sc.line_no,
            description: sc.description,
            el_scope_summary: sc.el_scope_summary,
            el_date: sc.el_date,
            matter_name: sc.matter_name,
            heuristic_reasoning: sc.heuristic_reasoning,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        });
      }
    }

    const seniorityOverkill = parsed["SENIORITY_OVERKILL"] as Array<{ fires?: boolean; line_no?: number; timekeeper_label?: string; role_normalized?: string; rate_charged?: number; hours?: number; amount?: number; description?: string; heuristic_reasoning?: string }> | null;
    if (Array.isArray(seniorityOverkill)) {
      for (const so of seniorityOverkill) {
        if (!so.fires || !so.line_no) continue;
        const lineItem = items.find(i => i.lineNo === so.line_no);
        greyIssues.push({
          invoiceId,
          analysisRunId: runId,
          invoiceItemId: lineItem?.id,
          ruleCode: "SENIORITY_OVERKILL",
          ruleType: "gray",
          severity: "warning",
          evaluatorType: "heuristic",
          issueStatus: "open",
          routeToRole: "internal_lawyer",
          explanationText: `Line ${so.line_no}: ${so.timekeeper_label} (${so.role_normalized}, ${invoice.currency} ${so.rate_charged}/h) billed ${so.hours}h for "${so.description}". This task appears to be routine or administrative in nature and could typically be handled by a more junior timekeeper at a lower rate. ${so.heuristic_reasoning ?? ""}`,
          evidenceJson: {
            line_no: so.line_no,
            timekeeper_label: so.timekeeper_label,
            role_normalized: so.role_normalized,
            rate_charged: so.rate_charged,
            hours: so.hours,
            amount: so.amount,
            description: so.description,
            heuristic_reasoning: so.heuristic_reasoning,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        });
      }
    }

    const estimateExcess = parsed["ESTIMATE_EXCESS"] as { fires?: boolean; estimate_amount?: number; source_document?: string; source_date?: string; cumulative_fees?: number; excess_amount?: number; excess_pct?: number; revised_estimate_provided?: boolean } | null;
    if (estimateExcess?.fires && estimateExcess.estimate_amount) {
      greyIssues.push({
        invoiceId,
        analysisRunId: runId,
        ruleCode: "ESTIMATE_EXCESS",
        ruleType: "gray",
        severity: "warning",
        evaluatorType: "heuristic",
        issueStatus: "open",
        routeToRole: "internal_lawyer",
        explanationText: `The fee estimate for this matter was ${invoice.currency} ${estimateExcess.estimate_amount?.toFixed(2)} (source: ${estimateExcess.source_document ?? "Budget Estimate"}, dated ${estimateExcess.source_date ?? "N/A"}). Cumulative fees billed on this matter to date (including this invoice) total ${invoice.currency} ${estimateExcess.cumulative_fees?.toFixed(2)}, exceeding the estimate by ${invoice.currency} ${estimateExcess.excess_amount?.toFixed(2)} (${estimateExcess.excess_pct?.toFixed(1)}%). The Law Firm has ${estimateExcess.revised_estimate_provided ? "" : "not "}provided a revised estimate or explanation for this deviation.`,
        evidenceJson: {
          estimate_amount: estimateExcess.estimate_amount,
          source_document: estimateExcess.source_document,
          source_date: estimateExcess.source_date,
          cumulative_fees: estimateExcess.cumulative_fees,
          excess_amount: estimateExcess.excess_amount,
          excess_pct: estimateExcess.excess_pct,
          revised_estimate_provided: estimateExcess.revised_estimate_provided ?? false,
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
      });
    }

    const internalCoord = parsed["INTERNAL_COORDINATION"] as Array<{ fires?: boolean; line_no?: number; timekeeper_label?: string; role_normalized?: string; hours?: number; amount?: number; description?: string; heuristic_reasoning?: string }> | null;
    if (Array.isArray(internalCoord)) {
      for (const ic of internalCoord) {
        if (!ic.fires || !ic.line_no) continue;
        const lineItem = items.find(i => i.lineNo === ic.line_no);
        greyIssues.push({
          invoiceId,
          analysisRunId: runId,
          invoiceItemId: lineItem?.id,
          ruleCode: "INTERNAL_COORDINATION",
          ruleType: "gray",
          severity: "warning",
          evaluatorType: "heuristic",
          issueStatus: "open",
          routeToRole: "internal_lawyer",
          explanationText: `Line ${ic.line_no}: ${ic.timekeeper_label} (${ic.role_normalized ?? "unknown"}) billed ${ic.hours}h for "${ic.description}". This description suggests internal coordination, team meetings, or knowledge transfer between firm lawyers, which may not be billable under the T&C. ${ic.heuristic_reasoning ?? ""}`,
          evidenceJson: {
            line_no: ic.line_no,
            timekeeper_label: ic.timekeeper_label,
            role_normalized: ic.role_normalized,
            hours: ic.hours,
            amount: ic.amount,
            description: ic.description,
            heuristic_reasoning: ic.heuristic_reasoning,
          },
          suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
        });
      }
    }

    return greyIssues;
  } catch (err) {
    console.error("Grey rules AI call failed:", err);
    throw new Error(`Grey rule AI evaluation failed: ${String(err)}`);
  }
}
