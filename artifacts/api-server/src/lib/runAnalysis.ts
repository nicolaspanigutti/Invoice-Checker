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
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import { normaliseRole, isUnauthorizedRole } from "./roleNormaliser";
import { checkCompleteness } from "./completenessGate";
import { evaluateDeterministicRules, type EvalContext } from "./evaluateDeterministicRules";

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

export async function runAnalysis(invoiceId: number, startedById: number, triggerReason?: string): Promise<{
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
    : [];

  const allRulesConfig = await db.select().from(rulesConfigTable);
  const rulesConfigMap = new Map(allRulesConfig.map(c => [c.ruleCode, c]));
  const isRuleActive = (code: string): boolean => {
    const cfg = rulesConfigMap.get(code);
    return cfg ? cfg.isActive === "true" : true;
  };

  const meetingConfigRow = rulesConfigMap.get("MEETING_OVERSTAFFING");
  const meetingConfigJson = (meetingConfigRow?.configJson as Record<string, unknown> | null) ?? {};
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
  const prevRunIds = prevRuns.map(r => r.id);
  const versionNo = prevRuns.length + 1;

  const [run] = await db.insert(analysisRunsTable).values({
    invoiceId,
    versionNo,
    triggerReason: triggerReason ?? "manual",
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
      summaryJson: { reason: "gate_failed", blockingIssues: completeness.blockingIssues },
    }).where(eq(analysisRunsTable.id, run.id));
    return {
      analysisRunId: run.id,
      issueCount: 0,
      outcome: null,
      amountAtRisk: null,
      status: "gate_failed",
    };
  }

  if (prevRunIds.length > 0) {
    await db.update(analysisRunsTable)
      .set({ status: "obsolete" })
      .where(inArray(analysisRunsTable.id, prevRunIds));
  }

  try {
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

  // Pre-fetch cumulative YTD fees for VOLUME_DISCOUNT rule (must be done before pure evaluation)
  const discountThresholds = firmTerms.find(t => t.termKey === "discount_thresholds_json")?.termValueJson as { threshold: number; pct: number; method?: string }[] | null;
  let cumulativeYtdFees = 0;
  if (discountThresholds && discountThresholds.length > 0 && invoice.invoiceDate && isRuleActive("VOLUME_DISCOUNT_NOT_APPLIED") && invoice.lawFirmId) {
    const year = new Date(invoice.invoiceDate).getFullYear();
    const priorResult = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(total_amount AS DECIMAL)), 0) as total
      FROM invoices
      WHERE law_firm_id = ${invoice.lawFirmId}
        AND EXTRACT(YEAR FROM COALESCE(invoice_date::date, created_at::date)) = ${year}
        AND invoice_status = 'accepted'
        AND id != ${invoiceId}
    `);
    cumulativeYtdFees = parseFloat(((priorResult.rows[0] ?? {}) as { total?: string }).total ?? "0");
  }

  const evalCtx: EvalContext = {
    invoiceId,
    runId: run.id,
    invoice: {
      currency: invoice.currency,
      billingType: invoice.billingType,
      totalAmount: invoice.totalAmount,
      subtotalAmount: invoice.subtotalAmount,
      taxAmount: invoice.taxAmount,
      invoiceDate: invoice.invoiceDate,
      jurisdiction: invoice.jurisdiction,
      matterName: invoice.matterName,
      lawFirmId: invoice.lawFirmId,
    },
    items: items.map(item => ({
      id: item.id,
      lineNo: item.lineNo,
      workDate: item.workDate,
      timekeeperLabel: item.timekeeperLabel,
      hours: item.hours,
      rateCharged: item.rateCharged,
      amount: item.amount,
      isExpenseLine: item.isExpenseLine,
      expenseType: item.expenseType,
      description: item.description,
      roleRaw: item.roleRaw,
      roleNormalized: item.roleNormalizedComputed,
      isUnauthorized: item.isUnauthorized,
    })),
    firm: firm ? {
      name: firm.name,
      firmType: firm.firmType,
      jurisdictionsJson: (firm.jurisdictionsJson as string[] | null),
    } : null,
    firmTerms,
    panelRates: panelRates.map(pr => ({ r: {
      roleCode: pr.r.roleCode,
      lawFirmName: pr.r.lawFirmName,
      jurisdiction: pr.r.jurisdiction,
      currency: pr.r.currency,
      maxRate: pr.r.maxRate,
      validFrom: pr.r.validFrom,
      validTo: pr.r.validTo,
    }})),
    docKinds: docs.map(d => d.documentKind),
    elData,
    cumulativeYtdFees,
    meetingMinAttendees,
    meetingMaxAttendees,
    isRuleActive,
  };

  const issues: IssueInsert[] = evaluateDeterministicRules(evalCtx);

  let greyIssues: IssueInsert[] = [];
  let greyRulesFailed = false;
  if (items.length > 0) {
    try {
      greyIssues = await runGreyRules(invoiceId, run.id, invoice, firm, items, elData, budgetData, panelRates, isRuleActive);
    } catch (greyErr) {
      console.error("Grey rule AI evaluation failed; continuing with objective results:", greyErr);
      greyRulesFailed = true;
    }
  }

  issues.push(...greyIssues);

  if (prevRunIds.length > 0) {
    const immediatelyPreviousRunId = Math.max(...prevRunIds);
    const newIssueSignatures = new Set(
      issues.map(iss => `${iss.ruleCode}::${iss.invoiceItemId ?? "invoice"}`)
    );
    const oldIssues = await db
      .select({ id: issuesTable.id, ruleCode: issuesTable.ruleCode, invoiceItemId: issuesTable.invoiceItemId, issueStatus: issuesTable.issueStatus })
      .from(issuesTable)
      .where(eq(issuesTable.analysisRunId, immediatelyPreviousRunId));
    const staleIssueIds = oldIssues
      .filter(iss => {
        const sig = `${iss.ruleCode}::${iss.invoiceItemId ?? "invoice"}`;
        const stillFires = newIssueSignatures.has(sig);
        const decidedStatuses: string[] = ["accepted_by_legal_ops", "rejected_by_legal_ops", "escalated_to_internal_lawyer", "accepted_by_internal_lawyer", "rejected_by_internal_lawyer", "no_longer_applicable"];
        const isDecided = decidedStatuses.includes(iss.issueStatus ?? "open");
        return !stillFires && !isDecided;
      })
      .map(iss => iss.id);
    if (staleIssueIds.length > 0) {
      await db.update(issuesTable)
        .set({ issueStatus: "no_longer_applicable" })
        .where(inArray(issuesTable.id, staleIssueIds));
      const staleIssues = oldIssues.filter(iss => staleIssueIds.includes(iss.id));
      for (const staleIssue of staleIssues) {
        await db.insert(auditEventsTable).values({
          entityType: "issue",
          entityId: staleIssue.id,
          eventType: "issue_auto_resolved",
          actorId: startedById,
          beforeJson: { issueStatus: staleIssue.issueStatus, analysisRunId: immediatelyPreviousRunId },
          afterJson: { issueStatus: "no_longer_applicable", resolvedByRunId: run.id, reason: "Rule no longer fires in latest analysis" },
          reason: "Automatic resolution: issue did not fire in the re-run analysis",
        });
      }
    }
  }

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
    newStatus = "accepted";
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

export interface GreyRuleParseContext {
  invoiceId: number;
  runId: number;
  currency: string;
  matterName: string | null | undefined;
  items: Array<{ id: number; lineNo: number }>;
  isRuleActive: (code: string) => boolean;
}

export function parseGreyRulesResponse(
  parsed: Record<string, unknown>,
  ctx: GreyRuleParseContext,
): IssueInsert[] {
  const { invoiceId, runId, currency, matterName, items, isRuleActive } = ctx;
  const greyIssues: IssueInsert[] = [];

  const elConflict = parsed["EL_CONFLICT_WITH_PANEL_BASELINE"] as { fires?: boolean; conflict_description?: string; baseline_source?: string; baseline_value?: string; el_value?: string } | null;
  if (elConflict?.fires && elConflict.conflict_description && isRuleActive("EL_CONFLICT_WITH_PANEL_BASELINE")) {
    greyIssues.push({
      invoiceId,
      analysisRunId: runId,
      ruleCode: "EL_CONFLICT_WITH_PANEL_BASELINE",
      ruleType: "objective",
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
  if (Array.isArray(hoursDisp) && isRuleActive("HOURS_DISPROPORTIONATE")) {
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
  if (Array.isArray(parallelBilling) && isRuleActive("PARALLEL_BILLING")) {
    for (const pb of parallelBilling) {
      if (!pb.fires || !pb.date) continue;
      // Skip if all timekeepers are the same person — that is a duplicate entry, not parallel billing
      const uniqueTimekeepers = new Set((pb.timekeeper_list ?? []).map(t => t.trim().toLowerCase()));
      if (uniqueTimekeepers.size < 2) continue;
      greyIssues.push({
        invoiceId,
        analysisRunId: runId,
        ruleCode: "PARALLEL_BILLING",
        ruleType: "gray",
        severity: "warning",
        evaluatorType: "heuristic",
        issueStatus: "open",
        routeToRole: "internal_lawyer",
        explanationText: `On ${pb.date}, ${pb.timekeeper_list?.length ?? 0} timekeepers billed for tasks with similar or overlapping descriptions: ${pb.timekeeper_list?.join(", ")}. Total hours billed across these lines: ${pb.total_hours}h for combined amount of ${currency} ${pb.total_amount?.toFixed(2) ?? "0.00"}. ${pb.heuristic_reasoning ?? ""}`,
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
  if (Array.isArray(scopeCreep) && isRuleActive("SCOPE_CREEP")) {
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
        explanationText: `Line ${sc.line_no} describes work ("${sc.description}") that does not appear to fall within the agreed scope of the Engagement Letter dated ${sc.el_date ?? "N/A"} for ${sc.matter_name ?? matterName ?? "this matter"}. The agreed scope covers: ${sc.el_scope_summary ?? "see Engagement Letter"}. ${sc.heuristic_reasoning ?? ""}`,
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
  if (Array.isArray(seniorityOverkill) && isRuleActive("SENIORITY_OVERKILL")) {
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
        explanationText: `Line ${so.line_no}: ${so.timekeeper_label} (${so.role_normalized}, ${currency} ${so.rate_charged}/h) billed ${so.hours}h for "${so.description}". This task appears to be routine or administrative in nature and could typically be handled by a more junior timekeeper at a lower rate. ${so.heuristic_reasoning ?? ""}`,
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
  if (estimateExcess?.fires && estimateExcess.estimate_amount && isRuleActive("ESTIMATE_EXCESS")) {
    greyIssues.push({
      invoiceId,
      analysisRunId: runId,
      ruleCode: "ESTIMATE_EXCESS",
      ruleType: "gray",
      severity: "warning",
      evaluatorType: "heuristic",
      issueStatus: "open",
      routeToRole: "internal_lawyer",
      explanationText: `The fee estimate for this matter was ${currency} ${estimateExcess.estimate_amount?.toFixed(2)} (source: ${estimateExcess.source_document ?? "Budget Estimate"}, dated ${estimateExcess.source_date ?? "N/A"}). Cumulative fees billed on this matter to date (including this invoice) total ${currency} ${estimateExcess.cumulative_fees?.toFixed(2)}, exceeding the estimate by ${currency} ${estimateExcess.excess_amount?.toFixed(2)} (${estimateExcess.excess_pct?.toFixed(1)}%). The Law Firm has ${estimateExcess.revised_estimate_provided ? "" : "not "}provided a revised estimate or explanation for this deviation.`,
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
  if (Array.isArray(internalCoord) && isRuleActive("INTERNAL_COORDINATION")) {
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

  const timekeeperNotApproved = parsed["TIMEKEEPER_NOT_APPROVED"] as Array<{ fires?: boolean; line_no?: number; timekeeper_label?: string; role_normalized?: string; hours?: number; amount?: number; heuristic_reasoning?: string }> | null;
  if (Array.isArray(timekeeperNotApproved) && isRuleActive("TIMEKEEPER_NOT_APPROVED")) {
    for (const tna of timekeeperNotApproved) {
      if (!tna.fires || !tna.line_no) continue;
      const lineItem = items.find(i => i.lineNo === tna.line_no);
      greyIssues.push({
        invoiceId,
        analysisRunId: runId,
        invoiceItemId: lineItem?.id,
        ruleCode: "TIMEKEEPER_NOT_APPROVED",
        ruleType: "gray",
        severity: "warning",
        evaluatorType: "heuristic",
        issueStatus: "open",
        routeToRole: "internal_lawyer",
        explanationText: `Line ${tna.line_no}: ${tna.timekeeper_label} (${tna.role_normalized ?? "unknown"}) does not appear in the approved staffing list in the Engagement Letter. Billing by unapproved timekeepers requires prior authorisation from Arcturus. ${tna.heuristic_reasoning ?? ""}`,
        evidenceJson: {
          line_no: tna.line_no,
          timekeeper_label: tna.timekeeper_label,
          role_normalized: tna.role_normalized,
          hours: tna.hours,
          amount: tna.amount,
          heuristic_reasoning: tna.heuristic_reasoning,
          source_document: "Engagement Letter (staffing annex)",
        },
        suggestedAction: "Accept | Reject | Delegate to Internal Lawyer",
      });
    }
  }

  return greyIssues;
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
  isRuleActive: (code: string) => boolean,
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
  ],
  "TIMEKEEPER_NOT_APPROVED": [
    {
      "fires": true/false,
      "line_no": number,
      "timekeeper_label": "...",
      "role_normalized": "...",
      "hours": number,
      "amount": number,
      "heuristic_reasoning": "..."
    }
  ]
}

Rules:
- EL_CONFLICT_WITH_PANEL_BASELINE: Only fires if EL is available AND firm is a panel firm AND EL contains terms that clearly contradict panel rates/T&C.
- HOURS_DISPROPORTIONATE: Only fires when hours for a task are genuinely unusual for the role (e.g. junior billing >80h/month on one task).
- PARALLEL_BILLING: Only fires when two or more DIFFERENT timekeepers (distinct individuals) bill similar/overlapping work on the same date. Never fire this for the same timekeeper appearing twice on the same date — that is a data-entry duplicate, not parallel billing.
- SCOPE_CREEP: Only fires if EL is available and a line clearly describes work outside the engagement scope. Be conservative.
- SENIORITY_OVERKILL: Only fires when a senior timekeeper (Partner, Senior Partner) bills for clearly administrative or routine tasks.
- ESTIMATE_EXCESS: Only fires if a budget estimate amount is available and cumulative billing clearly exceeds it.
- INTERNAL_COORDINATION: Only fires when a line description clearly indicates internal firm coordination billed to the client.
- TIMEKEEPER_NOT_APPROVED: Only fires if EL is available and contains a staffing annex or approved timekeeper list, and a timekeeper on the invoice is not listed. Be conservative — do not fire if no staffing list is available.

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

    return parseGreyRulesResponse(parsed, {
      invoiceId,
      runId,
      currency: invoice.currency,
      matterName: invoice.matterName,
      items,
      isRuleActive,
    });
  } catch (err) {
    console.error("Grey rules AI call failed:", err);
    throw new Error(`Grey rule AI evaluation failed: ${String(err)}`);
  }
}

