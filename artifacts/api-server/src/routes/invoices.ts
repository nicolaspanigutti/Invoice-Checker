import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, invoiceDocumentsTable, invoiceItemsTable, lawFirmsTable, usersTable, analysisRunsTable, issuesTable, issueDecisionsTable, commentsTable, auditEventsTable } from "@workspace/db";
import { eq, and, ilike, or, sql, desc, count, asc } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { checkCompleteness } from "../lib/completenessGate";
import { extractInvoiceFromText, extractInvoiceFromImage } from "../lib/extractInvoice";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractTextFromBuffer, imageBufferToBase64 } from "../lib/extractText";
import { runAnalysis } from "../lib/runAnalysis";
import { evaluateInvoiceState } from "../lib/stateTransition";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

async function generateInvoiceNumber(): Promise<string> {
  const result = await db.execute(sql`SELECT nextval('invoice_number_seq') AS n`);
  const row = result.rows[0] as { n: string };
  const n = Number(row.n);
  return `INV-${String(n).padStart(6, "0")}`;
}

function parseId(s: string | string[]): number {
  return parseInt(Array.isArray(s) ? s[0] : s, 10);
}

async function buildInvoiceSummary(invoice: typeof invoicesTable.$inferSelect, includeCompleteness: boolean = false) {
  let lawFirmName: string | null = null;
  if (invoice.lawFirmId) {
    const [firm] = await db.select({ name: lawFirmsTable.name }).from(lawFirmsTable).where(eq(lawFirmsTable.id, invoice.lawFirmId)).limit(1);
    lawFirmName = firm?.name ?? null;
  }

  let internalRequestorName: string | null = null;
  if (invoice.internalRequestorId) {
    const [user] = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, invoice.internalRequestorId)).limit(1);
    internalRequestorName = user?.displayName ?? null;
  }

  const [issueCountResult] = await db
    .select({ c: count() })
    .from(sql`issues`)
    .where(sql`invoice_id = ${invoice.id}`);
  const issueCount = Number(issueCountResult?.c ?? 0);

  const summary = {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    lawFirmId: invoice.lawFirmId,
    lawFirmName,
    documentType: invoice.documentType,
    invoiceDate: invoice.invoiceDate,
    currency: invoice.currency,
    totalAmount: invoice.totalAmount,
    matterName: invoice.matterName,
    projectReference: invoice.projectReference,
    internalRequestorId: invoice.internalRequestorId,
    internalRequestorName,
    jurisdiction: invoice.jurisdiction,
    invoiceStatus: invoice.invoiceStatus,
    issueCount,
    createdAt: invoice.createdAt,
  };

  if (!includeCompleteness) return summary;

  const completeness = await checkCompleteness(invoice.id);

  return {
    ...summary,
    billingType: invoice.billingType,
    jurisdiction: invoice.jurisdiction,
    applicableLaw: invoice.applicableLaw,
    subtotalAmount: invoice.subtotalAmount,
    taxAmount: invoice.taxAmount,
    amountAtRisk: invoice.amountAtRisk,
    confirmedRecovery: invoice.confirmedRecovery,
    reviewOutcome: invoice.reviewOutcome,
    dueDate: invoice.dueDate,
    assignedLegalOpsId: invoice.assignedLegalOpsId,
    assignedInternalLawyerId: invoice.assignedInternalLawyerId,
    createdById: invoice.createdById,
    currentAnalysisRunId: invoice.currentAnalysisRunId,
    updatedAt: invoice.updatedAt,
    completeness,
  };
}

router.get("/invoices", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "10"), 10) || 10));
  const offset = (page - 1) * pageSize;
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;
  const lawFirmId = req.query.lawFirmId ? parseInt(String(req.query.lawFirmId), 10) : undefined;

  const conditions = [];

  if (status) conditions.push(eq(invoicesTable.invoiceStatus, status as typeof invoicesTable.$inferSelect["invoiceStatus"]));
  if (!isNaN(lawFirmId!)) conditions.push(eq(invoicesTable.lawFirmId, lawFirmId!));

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(invoicesTable.invoiceNumber, pattern),
        ilike(invoicesTable.matterName, pattern),
        ilike(invoicesTable.projectReference, pattern),
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db
    .select({ c: count() })
    .from(invoicesTable)
    .where(whereClause);

  const total = Number(totalResult?.c ?? 0);

  const invoices = await db
    .select()
    .from(invoicesTable)
    .where(whereClause)
    .orderBy(desc(invoicesTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  const data = await Promise.all(invoices.map(inv => buildInvoiceSummary(inv, false)));

  res.json({ data, total, page, pageSize });
});

router.post("/invoices", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const { lawFirmId, documentType, billingType, matterName, projectReference, jurisdiction, currency, invoiceDate, dueDate, internalRequestorId, assignedLegalOpsId, assignedInternalLawyerId, documents } = req.body;

  if (!lawFirmId || !documentType || !currency) {
    res.status(400).json({ error: "lawFirmId, documentType, and currency are required" });
    return;
  }

  const invoiceNumber = await generateInvoiceNumber();

  const [invoice] = await db.insert(invoicesTable).values({
    lawFirmId,
    documentType,
    billingType: billingType ?? null,
    invoiceNumber,
    matterName: matterName ?? null,
    projectReference: projectReference ?? null,
    jurisdiction: jurisdiction ?? null,
    currency,
    invoiceDate: invoiceDate ?? null,
    dueDate: dueDate ?? null,
    internalRequestorId: internalRequestorId ?? null,
    assignedLegalOpsId: assignedLegalOpsId ?? null,
    assignedInternalLawyerId: assignedInternalLawyerId ?? null,
    invoiceStatus: "extracting_data",
    createdById: req.session.userId,
  }).returning();

  if (Array.isArray(documents) && documents.length > 0) {
    for (const d of documents as { documentKind: "invoice_file" | "engagement_letter" | "budget_estimate"; fileName: string; mimeType?: string | null; storagePath?: string | null }[]) {
      await db.insert(invoiceDocumentsTable).values({
        invoiceId: invoice.id,
        documentKind: d.documentKind,
        fileName: d.fileName,
        mimeType: d.mimeType ?? null,
        storagePath: d.storagePath ?? null,
        extractionStatus: "pending",
      });
    }
  }

  const detail = await buildInvoiceSummary(invoice, true);
  res.status(201).json(detail);
});

router.get("/invoices/:id", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const detail = await buildInvoiceSummary(invoice, true);
  res.json(detail);
});

router.patch("/invoices/:id", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [existing] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (Object.keys(req.body).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const allowed = ["documentType", "billingType", "matterName", "projectReference", "jurisdiction", "applicableLaw", "currency", "invoiceDate", "dueDate", "totalAmount", "subtotalAmount", "taxAmount", "billingPeriodStart", "billingPeriodEnd", "internalRequestorId", "assignedLegalOpsId", "assignedInternalLawyerId", "invoiceStatus"];
  const updates: Partial<typeof invoicesTable.$inferInsert> = {};
  for (const key of allowed) {
    if (key in req.body) {
      (updates as Record<string, unknown>)[key] = req.body[key] ?? null;
    }
  }

  const [updated] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
  const detail = await buildInvoiceSummary(updated, true);
  res.json(detail);
});

router.get("/invoices/:id/documents", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const docs = await db.select().from(invoiceDocumentsTable).where(eq(invoiceDocumentsTable.invoiceId, id));
  res.json(docs.map(d => ({
    id: d.id,
    invoiceId: d.invoiceId,
    documentKind: d.documentKind,
    fileName: d.fileName,
    mimeType: d.mimeType,
    storagePath: d.storagePath,
    extractionStatus: d.extractionStatus,
    createdAt: d.createdAt,
  })));
});

router.post("/invoices/:id/documents", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const { documentKind, fileName, mimeType, storagePath } = req.body;
  if (!documentKind || !fileName) {
    res.status(400).json({ error: "documentKind and fileName are required" });
    return;
  }

  const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const [doc] = await db.insert(invoiceDocumentsTable).values({
    invoiceId: id,
    documentKind,
    fileName,
    mimeType: mimeType ?? null,
    storagePath: storagePath ?? null,
    extractionStatus: "pending",
  }).returning();

  await db.insert(auditEventsTable).values({
    entityType: "invoice",
    entityId: id,
    eventType: "document_uploaded",
    actorId: req.session.userId ?? null,
    afterJson: { documentId: doc.id, documentKind, fileName },
    reason: null,
  });

  res.status(201).json({
    id: doc.id,
    invoiceId: doc.invoiceId,
    documentKind: doc.documentKind,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    storagePath: doc.storagePath,
    extractionStatus: doc.extractionStatus,
    createdAt: doc.createdAt,
  });
});

router.get("/invoices/:id/items", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id));
  res.json(items.map(item => ({
    id: item.id,
    invoiceId: item.invoiceId,
    lineNo: item.lineNo,
    timekeeperLabel: item.timekeeperLabel,
    roleRaw: item.roleRaw,
    roleNormalized: item.roleNormalized,
    workDate: item.workDate,
    hours: item.hours,
    rateCharged: item.rateCharged,
    amount: item.amount,
    description: item.description,
    isExpenseLine: item.isExpenseLine,
    expenseType: item.expenseType,
    billingPeriodStart: item.billingPeriodStart,
    billingPeriodEnd: item.billingPeriodEnd,
  })));
});

router.get("/invoices/:id/completeness", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const result = await checkCompleteness(id);
  res.json(result);
});

router.post("/invoices/:id/extract", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const allDocs = await db
    .select()
    .from(invoiceDocumentsTable)
    .where(eq(invoiceDocumentsTable.invoiceId, id));

  const invoiceDoc = allDocs.find(d => d.documentKind === "invoice_file");
  if (!invoiceDoc) {
    res.status(422).json({ error: "No invoice file document found. Upload an invoice file before extracting." });
    return;
  }

  if (!invoiceDoc.storagePath) {
    res.status(422).json({ error: "Invoice file has no storage path. Re-upload the document." });
    return;
  }

  const downloadDoc = async (doc: typeof invoiceDoc): Promise<Buffer | null> => {
    if (!doc.storagePath) return null;
    try {
      const file = await objectStorage.getObjectEntityFile(doc.storagePath);
      const fileResponse = await objectStorage.downloadObject(file);
      const ab = await fileResponse.arrayBuffer();
      return Buffer.from(ab);
    } catch {
      return null;
    }
  };

  const extractDoc = async (doc: typeof invoiceDoc, buf: Buffer): Promise<Awaited<ReturnType<typeof extractInvoiceFromText>> | null> => {
    const mime = doc.mimeType ?? "application/octet-stream";
    const isImg = mime.startsWith("image/");
    try {
      if (isImg) {
        const b64 = imageBufferToBase64(buf, mime);
        return await extractInvoiceFromImage(b64, mime, doc.id);
      } else {
        const rawText = await extractTextFromBuffer(buf, mime);
        if (rawText.trim().length < 10) return null;
        await db.update(invoiceDocumentsTable).set({ rawText }).where(eq(invoiceDocumentsTable.id, doc.id));
        return await extractInvoiceFromText(rawText, doc.id);
      }
    } catch {
      await db.update(invoiceDocumentsTable).set({ extractionStatus: "failed" }).where(eq(invoiceDocumentsTable.id, doc.id));
      return null;
    }
  };

  const invoiceBuf = await downloadDoc(invoiceDoc);
  if (!invoiceBuf) {
    await db.update(invoiceDocumentsTable).set({ extractionStatus: "failed" }).where(eq(invoiceDocumentsTable.id, invoiceDoc.id));
    res.status(422).json({ error: "Failed to download the invoice file from storage." });
    return;
  }

  const result = await extractDoc(invoiceDoc, invoiceBuf);
  if (!result) {
    res.status(422).json({ error: "Invoice file could not be read as text. Please upload a readable PDF, DOCX, or image file." });
    return;
  }

  const { extracted, confidence, textHash, fromCache } = result;

  const elDoc = allDocs.find(d => d.documentKind === "engagement_letter" && d.storagePath);
  const budgetDoc = allDocs.find(d => d.documentKind === "budget_estimate" && d.storagePath);

  const [elBuf, budgetBuf] = await Promise.all([
    elDoc ? downloadDoc(elDoc) : Promise.resolve(null),
    budgetDoc ? downloadDoc(budgetDoc) : Promise.resolve(null),
  ]);

  await Promise.allSettled([
    elDoc && elBuf ? extractDoc(elDoc, elBuf) : Promise.resolve(null),
    budgetDoc && budgetBuf ? extractDoc(budgetDoc, budgetBuf) : Promise.resolve(null),
  ]);

  const updates: Partial<typeof invoicesTable.$inferInsert> = {};
  if (extracted.invoiceDate) updates.invoiceDate = extracted.invoiceDate;
  if (extracted.dueDate) updates.dueDate = extracted.dueDate;
  if (extracted.totalAmount) updates.totalAmount = extracted.totalAmount;
  if (extracted.subtotalAmount) updates.subtotalAmount = extracted.subtotalAmount;
  if (extracted.taxAmount) updates.taxAmount = extracted.taxAmount;
  if (extracted.currency) updates.currency = extracted.currency;
  if (extracted.matterName && !invoice.matterName) updates.matterName = extracted.matterName;
  if (extracted.projectReference && !invoice.projectReference) updates.projectReference = extracted.projectReference;
  if (extracted.jurisdiction && !invoice.jurisdiction) updates.jurisdiction = extracted.jurisdiction;
  if (extracted.applicableLaw && !invoice.applicableLaw) updates.applicableLaw = extracted.applicableLaw;

  const prevStatus = invoice.invoiceStatus;
  let statusDidChange = false;
  if (Object.keys(updates).length > 0) {
    updates.invoiceStatus = "in_review";
    await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id));
    statusDidChange = prevStatus !== "in_review";
  } else if (invoice.invoiceStatus === "extracting_data") {
    await db.update(invoicesTable).set({ invoiceStatus: "in_review" }).where(eq(invoicesTable.id, id));
    statusDidChange = true;
  }
  if (statusDidChange) {
    await db.insert(auditEventsTable).values({
      entityType: "invoice",
      entityId: id,
      eventType: "state_change",
      actorId: req.session.userId ?? null,
      beforeJson: { status: prevStatus },
      afterJson: { status: "in_review" },
      reason: "extraction_completed",
    });
  }

  if (!fromCache) {
    await db.update(invoiceDocumentsTable)
      .set({ textHash, extractionStatus: "done" })
      .where(eq(invoiceDocumentsTable.id, invoiceDoc.id));
  }

  if (extracted.lineItems.length > 0) {
    await db.delete(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id));
    await db.insert(invoiceItemsTable).values(
      extracted.lineItems.map((item, idx) => ({
        invoiceId: id,
        lineNo: idx + 1,
        timekeeperLabel: item.timekeeperLabel,
        roleRaw: item.roleRaw,
        workDate: item.workDate,
        hours: item.hours,
        rateCharged: item.rateCharged,
        amount: item.amount,
        description: item.description,
        isExpenseLine: item.isExpenseLine,
        expenseType: item.expenseType,
        billingPeriodStart: extracted.billingPeriodStart ?? null,
        billingPeriodEnd: extracted.billingPeriodEnd ?? null,
      }))
    );
  }

  res.json({ invoiceId: id, extracted, confidence, fromCache });
});

router.post("/invoices/:id/analyse", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  const actorId = req.session.userId!;
  const isRerun = invoice.currentAnalysisRunId !== null;

  if (isRerun) {
    await db.insert(auditEventsTable).values({
      entityType: "invoice",
      entityId: id,
      eventType: "re_run_requested",
      actorId,
      afterJson: { previousRunId: invoice.currentAnalysisRunId },
      reason: null,
    });
  }

  await db.insert(auditEventsTable).values({
    entityType: "invoice",
    entityId: id,
    eventType: "analysis_started",
    actorId,
    afterJson: null,
    reason: null,
  });

  try {
    const result = await runAnalysis(id, actorId);
    if (result.status === "gate_failed") {
      await db.insert(auditEventsTable).values({
        entityType: "invoice",
        entityId: id,
        eventType: "analysis_failed",
        actorId,
        afterJson: { reason: "gate_failed" },
        reason: "Completeness gate failed",
      });
      res.status(422).json({
        error: "Cannot run analysis: completeness gate failed. Check the invoice for missing required fields or documents.",
        analysisRunId: result.analysisRunId,
      });
      return;
    }
    await db.insert(auditEventsTable).values({
      entityType: "invoice",
      entityId: id,
      eventType: "analysis_completed",
      actorId,
      afterJson: { issueCount: result.issueCount, outcome: result.outcome, amountAtRisk: result.amountAtRisk },
      reason: null,
    });
    await recalculateRecovery(id);
    res.json({
      analysisRunId: result.analysisRunId,
      invoiceId: id,
      status: result.status,
      issueCount: result.issueCount,
      outcome: result.outcome,
      amountAtRisk: result.amountAtRisk,
    });
  } catch (err) {
    console.error("Analysis failed:", err);
    res.status(500).json({ error: "Analysis failed unexpectedly." });
  }
});

router.get("/invoices/:id/analysis-runs", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const runs = await db
    .select()
    .from(analysisRunsTable)
    .where(eq(analysisRunsTable.invoiceId, id))
    .orderBy(desc(analysisRunsTable.startedAt));

  res.json(runs.map(r => ({
    id: r.id,
    invoiceId: r.invoiceId,
    versionNo: r.versionNo,
    status: r.status,
    triggerReason: r.triggerReason,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    summaryJson: r.summaryJson,
  })));
});

router.get("/invoices/:id/issues", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const analysisRunId = req.query.analysisRunId ? parseInt(String(req.query.analysisRunId), 10) : undefined;
  const conditions = [eq(issuesTable.invoiceId, id)];
  if (analysisRunId && !isNaN(analysisRunId)) conditions.push(eq(issuesTable.analysisRunId, analysisRunId));

  const issues = await db
    .select()
    .from(issuesTable)
    .where(and(...conditions))
    .orderBy(issuesTable.id);

  const issueIds = issues.map(i => i.id);
  const decisionsByIssue = new Map<number, typeof issueDecisionsTable.$inferSelect & { actorName: string | null }>();

  if (issueIds.length > 0) {
    const decisions = await db
      .select({
        d: issueDecisionsTable,
        actorName: usersTable.displayName,
      })
      .from(issueDecisionsTable)
      .leftJoin(usersTable, eq(issueDecisionsTable.actorId, usersTable.id))
      .where(sql`${issueDecisionsTable.issueId} = ANY(${sql.raw(`ARRAY[${issueIds.join(",")}]::int[]`)})`)
      .orderBy(desc(issueDecisionsTable.createdAt));

    for (const row of decisions) {
      if (!decisionsByIssue.has(row.d.issueId)) {
        decisionsByIssue.set(row.d.issueId, { ...row.d, actorName: row.actorName ?? null });
      }
    }
  }

  res.json(issues.map(iss => {
    const latestDecision = decisionsByIssue.get(iss.id) ?? null;
    return {
      id: iss.id,
      invoiceId: iss.invoiceId,
      analysisRunId: iss.analysisRunId,
      invoiceItemId: iss.invoiceItemId,
      ruleCode: iss.ruleCode,
      ruleType: iss.ruleType,
      severity: iss.severity,
      issueStatus: iss.issueStatus,
      routeToRole: iss.routeToRole,
      explanationText: iss.explanationText,
      evidenceJson: iss.evidenceJson,
      suggestedAction: iss.suggestedAction,
      recoverableAmount: iss.recoverableAmount,
      recoveryGroupKey: iss.recoveryGroupKey,
      configSnapshotJson: iss.configSnapshotJson,
      latestDecision: latestDecision ? {
        id: latestDecision.id,
        issueId: latestDecision.issueId,
        actorId: latestDecision.actorId,
        actorRole: latestDecision.actorRole,
        actorName: latestDecision.actorName,
        action: latestDecision.action,
        note: latestDecision.note,
        createdAt: latestDecision.createdAt,
      } : null,
      createdAt: iss.createdAt,
    };
  }));
});

const ROLE_PERMITTED_ACTIONS: Record<string, string[]> = {
  legal_ops: ["accept", "reject", "delegate"],
  internal_lawyer: ["accept", "reject", "return"],
  super_admin: ["accept", "reject", "delegate", "return"],
};

const ACTION_TO_STATUS: Record<string, typeof issuesTable.$inferSelect["issueStatus"]> = {
  accept: "accepted_by_legal_ops",
  reject: "rejected_by_legal_ops",
  delegate: "escalated_to_internal_lawyer",
  return: "open",
};

const ACTION_TO_STATUS_LAWYER: Record<string, typeof issuesTable.$inferSelect["issueStatus"]> = {
  accept: "accepted_by_internal_lawyer",
  reject: "rejected_by_internal_lawyer",
  return: "open",
};

router.post("/invoices/:id/issues/:issueId/decide", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const invoiceId = parseId(req.params.id);
  const issueId = parseId(req.params.issueId);
  if (isNaN(invoiceId) || isNaN(issueId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const actorId = req.session.userId!;
  const actorRole = req.session.userRole as string;
  const { action, note } = req.body as { action: string; note?: string };

  if (!action) { res.status(400).json({ error: "action is required" }); return; }

  const permitted = ROLE_PERMITTED_ACTIONS[actorRole] ?? [];
  if (!permitted.includes(action)) {
    res.status(403).json({ error: `Role '${actorRole}' cannot perform action '${action}'` });
    return;
  }

  if (action === "return" && !note?.trim()) {
    res.status(400).json({ error: "A note is required when returning an issue to Legal Ops" });
    return;
  }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  const [issue] = await db.select().from(issuesTable).where(and(eq(issuesTable.id, issueId), eq(issuesTable.invoiceId, invoiceId))).limit(1);
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }

  const isLawyer = actorRole === "internal_lawyer";

  const ACTIONABLE_STATUSES_FOR_ROLE: Record<string, string[]> = {
    legal_ops: ["open"],
    internal_lawyer: ["escalated_to_internal_lawyer"],
    super_admin: ["open", "escalated_to_internal_lawyer"],
  };
  const actionableStatuses = ACTIONABLE_STATUSES_FOR_ROLE[actorRole] ?? [];
  if (!actionableStatuses.includes(issue.issueStatus)) {
    res.status(409).json({ error: `Cannot perform '${action}' on issue with current status '${issue.issueStatus}'` });
    return;
  }

  const statusMap = isLawyer ? ACTION_TO_STATUS_LAWYER : ACTION_TO_STATUS;
  const newIssueStatus = statusMap[action] ?? issue.issueStatus;

  await db.update(issuesTable).set({ issueStatus: newIssueStatus, updatedAt: new Date() }).where(eq(issuesTable.id, issueId));

  await db.insert(issueDecisionsTable).values({
    issueId,
    actorId,
    actorRole,
    action,
    note: note ?? null,
  });

  await db.insert(auditEventsTable).values({
    entityType: "issue",
    entityId: issueId,
    eventType: `issue_${action}`,
    actorId,
    beforeJson: { issueStatus: issue.issueStatus },
    afterJson: { issueStatus: newIssueStatus },
    reason: note ?? null,
  });

  await evaluateInvoiceState(invoiceId, actorId, `issue ${action} by ${actorRole}`);
  await recalculateRecovery(invoiceId);

  const [updatedIssue] = await db.select().from(issuesTable).where(eq(issuesTable.id, issueId)).limit(1);
  const [actorUser] = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, actorId)).limit(1);

  const [latestDecision] = await db
    .select()
    .from(issueDecisionsTable)
    .where(eq(issueDecisionsTable.issueId, issueId))
    .orderBy(desc(issueDecisionsTable.createdAt))
    .limit(1);

  res.json({
    id: updatedIssue.id,
    invoiceId: updatedIssue.invoiceId,
    analysisRunId: updatedIssue.analysisRunId,
    invoiceItemId: updatedIssue.invoiceItemId,
    ruleCode: updatedIssue.ruleCode,
    ruleType: updatedIssue.ruleType,
    severity: updatedIssue.severity,
    issueStatus: updatedIssue.issueStatus,
    routeToRole: updatedIssue.routeToRole,
    explanationText: updatedIssue.explanationText,
    evidenceJson: updatedIssue.evidenceJson,
    suggestedAction: updatedIssue.suggestedAction,
    recoverableAmount: updatedIssue.recoverableAmount,
    recoveryGroupKey: updatedIssue.recoveryGroupKey,
    configSnapshotJson: updatedIssue.configSnapshotJson,
    latestDecision: latestDecision ? {
      id: latestDecision.id,
      issueId: latestDecision.issueId,
      actorId: latestDecision.actorId,
      actorRole: latestDecision.actorRole,
      actorName: actorUser?.displayName ?? null,
      action: latestDecision.action,
      note: latestDecision.note,
      createdAt: latestDecision.createdAt,
    } : null,
    createdAt: updatedIssue.createdAt,
  });
});

router.get("/invoices/:id/comments", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const issueId = req.query.issueId ? parseInt(String(req.query.issueId), 10) : undefined;
  const scope = req.query.scope as string | undefined;

  const conditions = [eq(commentsTable.invoiceId, id)];
  if (issueId && !isNaN(issueId)) conditions.push(eq(commentsTable.issueId, issueId));
  if (scope) conditions.push(eq(commentsTable.commentScope, scope as typeof commentsTable.$inferSelect["commentScope"]));

  const comments = await db
    .select({
      c: commentsTable,
      authorName: usersTable.displayName,
    })
    .from(commentsTable)
    .leftJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
    .where(and(...conditions))
    .orderBy(asc(commentsTable.createdAt));

  res.json(comments.map(row => ({
    id: row.c.id,
    invoiceId: row.c.invoiceId,
    issueId: row.c.issueId,
    invoiceItemId: row.c.invoiceItemId,
    commentScope: row.c.commentScope,
    authorId: row.c.authorId,
    authorName: row.authorName ?? null,
    content: row.c.content,
    createdAt: row.c.createdAt,
  })));
});

router.post("/invoices/:id/comments", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const actorId = req.session.userId!;
  const { content, commentScope, issueId, invoiceItemId } = req.body as {
    content: string;
    commentScope: string;
    issueId?: number;
    invoiceItemId?: number;
  };

  const VALID_COMMENT_SCOPES = new Set(["general", "issue", "line_item"]);
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }
  if (!commentScope || !VALID_COMMENT_SCOPES.has(commentScope)) {
    res.status(400).json({ error: `commentScope must be one of: ${[...VALID_COMMENT_SCOPES].join(", ")}` });
    return;
  }

  const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  const [comment] = await db.insert(commentsTable).values({
    invoiceId: id,
    issueId: issueId ?? null,
    invoiceItemId: invoiceItemId ?? null,
    commentScope: commentScope as typeof commentsTable.$inferSelect["commentScope"],
    authorId: actorId,
    content: content.trim(),
  }).returning();

  await db.insert(auditEventsTable).values({
    entityType: "invoice",
    entityId: id,
    eventType: "comment_posted",
    actorId,
    afterJson: { commentId: comment.id, scope: commentScope, issueId: issueId ?? null },
  });

  const [actorUser] = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, actorId)).limit(1);

  res.status(201).json({
    id: comment.id,
    invoiceId: comment.invoiceId,
    issueId: comment.issueId,
    invoiceItemId: comment.invoiceItemId,
    commentScope: comment.commentScope,
    authorId: comment.authorId,
    authorName: actorUser?.displayName ?? null,
    content: comment.content,
    createdAt: comment.createdAt,
  });
});

async function recalculateRecovery(invoiceId: number): Promise<void> {
  const [invoice] = await db
    .select({ currentAnalysisRunId: invoicesTable.currentAnalysisRunId })
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId))
    .limit(1);

  const rejectedStatuses = [
    "rejected_by_legal_ops",
    "rejected_by_internal_lawyer",
  ];

  const conditions = [eq(issuesTable.invoiceId, invoiceId)];
  if (invoice?.currentAnalysisRunId) {
    conditions.push(eq(issuesTable.analysisRunId, invoice.currentAnalysisRunId));
  }

  const rejectedIssues = await db
    .select({
      recoverableAmount: issuesTable.recoverableAmount,
      recoveryGroupKey: issuesTable.recoveryGroupKey,
      issueStatus: issuesTable.issueStatus,
    })
    .from(issuesTable)
    .where(and(...conditions));

  const rejected = rejectedIssues.filter(i => rejectedStatuses.includes(i.issueStatus));

  const groupMaxMap = new Map<string, number>();
  let ungroupedTotal = 0;

  for (const issue of rejected) {
    const amt = issue.recoverableAmount ? parseFloat(issue.recoverableAmount) : 0;
    if (!amt) continue;

    if (issue.recoveryGroupKey) {
      const prev = groupMaxMap.get(issue.recoveryGroupKey) ?? 0;
      groupMaxMap.set(issue.recoveryGroupKey, Math.max(prev, amt));
    } else {
      ungroupedTotal += amt;
    }
  }

  let confirmedRecovery = ungroupedTotal;
  for (const v of groupMaxMap.values()) {
    confirmedRecovery += v;
  }

  const openStatuses = ["open", "escalated_to_internal_lawyer"];
  const openIssues = rejectedIssues.filter(i => openStatuses.includes(i.issueStatus));
  const amountAtRisk = openIssues.reduce((sum, i) => {
    return sum + (i.recoverableAmount ? parseFloat(i.recoverableAmount) : 0);
  }, 0);

  await db.update(invoicesTable).set({
    confirmedRecovery: confirmedRecovery.toFixed(2),
    amountAtRisk: amountAtRisk.toFixed(2),
    updatedAt: new Date(),
  }).where(eq(invoicesTable.id, invoiceId));
}

router.get("/invoices/:id/audit-events", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  const events = await db
    .select({
      e: auditEventsTable,
      actorName: usersTable.displayName,
    })
    .from(auditEventsTable)
    .leftJoin(usersTable, eq(auditEventsTable.actorId, usersTable.id))
    .where(and(
      eq(auditEventsTable.entityType, "invoice"),
      eq(auditEventsTable.entityId, id),
    ))
    .orderBy(asc(auditEventsTable.createdAt));

  const issueEvents = await db
    .select({
      e: auditEventsTable,
      actorName: usersTable.displayName,
    })
    .from(auditEventsTable)
    .leftJoin(usersTable, eq(auditEventsTable.actorId, usersTable.id))
    .where(and(
      eq(auditEventsTable.entityType, "issue"),
      sql`${auditEventsTable.entityId} IN (SELECT id FROM issues WHERE invoice_id = ${id})`,
    ))
    .orderBy(asc(auditEventsTable.createdAt));

  const allEvents = [...events, ...issueEvents].sort((a, b) =>
    new Date(a.e.createdAt).getTime() - new Date(b.e.createdAt).getTime()
  );

  res.json(allEvents.map(row => ({
    id: row.e.id,
    entityType: row.e.entityType,
    entityId: row.e.entityId,
    eventType: row.e.eventType,
    actorId: row.e.actorId,
    actorName: row.actorName ?? null,
    beforeJson: row.e.beforeJson,
    afterJson: row.e.afterJson,
    reason: row.e.reason,
    createdAt: row.e.createdAt,
  })));
});

const RULE_LABELS: Record<string, string> = {
  WRONG_CURRENCY: "Wrong Currency",
  MISSING_DOCUMENTS_FIXED_SCOPE: "Missing Engagement Letter (Fixed Scope)",
  FIXED_SCOPE_AMOUNT_MISMATCH: "Fixed Scope Amount Mismatch",
  LINE_ITEMS_IN_FIXED_SCOPE: "Line Items in Fixed Scope",
  TAX_OR_VAT_MISMATCH: "Tax / VAT Mismatch",
  VOLUME_DISCOUNT_NOT_APPLIED: "Volume Discount Not Applied",
  UNAUTHORIZED_EXPENSE_TYPE: "Unauthorised Expense Type",
  EXPENSE_CAP_EXCEEDED: "Expense Cap Exceeded",
  DUPLICATE_LINE: "Duplicate Line Item",
  ARITHMETIC_ERROR: "Arithmetic Error",
  DAILY_HOURS_EXCEEDED: "Daily Hours Exceeded",
  BILLING_PERIOD_OUTSIDE_EL: "Billing Outside Engagement Letter Period",
  INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER: "Inconsistent Rate for Timekeeper",
  RATE_CARD_EXPIRED_OR_MISSING: "Rate Card Missing or Expired",
  LAWYER_ROLE_MISMATCH: "Role Not Recognised",
  RATE_EXCESS: "Rate Exceeds Panel Maximum",
  MEETING_OVERSTAFFING: "Meeting Overstaffing",
  EL_CONFLICT_WITH_PANEL_BASELINE: "Engagement Letter / Panel Conflict",
  HOURS_DISPROPORTIONATE: "Hours Disproportionate",
  PARALLEL_BILLING: "Parallel Billing",
  SCOPE_CREEP: "Scope Creep",
  SENIORITY_OVERKILL: "Seniority Overkill",
  ESTIMATE_EXCESS: "Estimate Exceeded",
  INTERNAL_COORDINATION: "Internal Coordination Billed",
  MISSING_LINE_DETAIL: "Missing Line Detail",
  JURISDICTION_UNCLEAR: "Jurisdiction Unclear",
};

router.post("/invoices/:id/report", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  if (!invoice.currentAnalysisRunId) {
    res.status(400).json({ error: "Report unavailable: no analysis has been run on this invoice yet." });
    return;
  }

  let lawFirmName: string | null = null;
  if (invoice.lawFirmId) {
    const [firm] = await db.select({ name: lawFirmsTable.name }).from(lawFirmsTable).where(eq(lawFirmsTable.id, invoice.lawFirmId)).limit(1);
    lawFirmName = firm?.name ?? null;
  }

  const conditions = [eq(issuesTable.invoiceId, id), eq(issuesTable.analysisRunId, invoice.currentAnalysisRunId)];

  const allIssues = await db
    .select({ i: issuesTable, actorName: usersTable.displayName })
    .from(issuesTable)
    .leftJoin(
      issueDecisionsTable,
      and(
        eq(issueDecisionsTable.issueId, issuesTable.id),
        sql`${issueDecisionsTable.id} = (SELECT MAX(id) FROM issue_decisions WHERE issue_id = ${issuesTable.id})`
      )
    )
    .leftJoin(usersTable, eq(issueDecisionsTable.actorId, usersTable.id))
    .where(and(...conditions))
    .orderBy(issuesTable.id);

  const latestDecisions = await db
    .select()
    .from(issueDecisionsTable)
    .where(sql`issue_id IN (SELECT id FROM issues WHERE invoice_id = ${id})`)
    .orderBy(desc(issueDecisionsTable.createdAt));

  const decisionByIssue = new Map<number, typeof issueDecisionsTable.$inferSelect & { actorName?: string | null }>();
  for (const d of latestDecisions) {
    if (!decisionByIssue.has(d.issueId)) {
      decisionByIssue.set(d.issueId, d);
    }
  }

  const decisionActorNames = new Map<number, string | null>();
  const uniqueActorIds = [...new Set(latestDecisions.map(d => d.actorId).filter(Boolean) as number[])];
  if (uniqueActorIds.length > 0) {
    const actors = await db.select({ id: usersTable.id, name: usersTable.displayName }).from(usersTable).where(sql`id = ANY(ARRAY[${sql.join(uniqueActorIds.map(aid => sql`${aid}`), sql`, `)}]::int[])`);
    for (const a of actors) decisionActorNames.set(a.id, a.name);
  }

  function mapIssue(row: typeof allIssues[0]) {
    const decision = decisionByIssue.get(row.i.id);
    const actorName = decision?.actorId ? decisionActorNames.get(decision.actorId) ?? null : null;
    return {
      id: row.i.id,
      ruleCode: row.i.ruleCode,
      ruleType: row.i.ruleType,
      severity: row.i.severity,
      issueStatus: row.i.issueStatus,
      explanationText: row.i.explanationText,
      suggestedAction: row.i.suggestedAction,
      recoverableAmount: row.i.recoverableAmount,
      recoveryGroupKey: row.i.recoveryGroupKey,
      decisionAction: decision?.action ?? null,
      decisionNote: decision?.note ?? null,
      decisionActorName: actorName,
      decisionActorRole: decision?.actorRole ?? null,
    };
  }

  const rejectedStatuses = ["rejected_by_legal_ops", "rejected_by_internal_lawyer"];
  const acceptedStatuses = ["accepted_by_legal_ops", "accepted_by_internal_lawyer"];
  const escalatedStatuses = ["escalated_to_internal_lawyer"];
  const openStatuses = ["open"];

  const rejectedIssues = allIssues.filter(r => rejectedStatuses.includes(r.i.issueStatus)).map(mapIssue);
  const acceptedIssues = allIssues.filter(r => acceptedStatuses.includes(r.i.issueStatus)).map(mapIssue);
  const escalatedIssues = allIssues.filter(r => escalatedStatuses.includes(r.i.issueStatus)).map(mapIssue);
  const openIssues = allIssues.filter(r => openStatuses.includes(r.i.issueStatus)).map(mapIssue);

  const events = await db
    .select({ e: auditEventsTable, actorName: usersTable.displayName, actorRole: usersTable.role })
    .from(auditEventsTable)
    .leftJoin(usersTable, eq(auditEventsTable.actorId, usersTable.id))
    .where(or(
      and(eq(auditEventsTable.entityType, "invoice"), eq(auditEventsTable.entityId, id)),
      and(
        eq(auditEventsTable.entityType, "issue"),
        sql`${auditEventsTable.entityId} IN (SELECT id FROM issues WHERE invoice_id = ${id})`
      )
    ))
    .orderBy(asc(auditEventsTable.createdAt));

  const auditTrail = events.map(row => ({
    eventType: row.e.eventType,
    actorName: row.actorName ?? null,
    actorRole: row.actorRole ?? null,
    createdAt: row.e.createdAt,
    detail: row.e.afterJson ?? null,
  }));

  const rejectedForAI = rejectedIssues.map(i => ({
    rule: RULE_LABELS[i.ruleCode] ?? i.ruleCode,
    severity: i.severity,
    explanation: i.explanationText,
    recovery: i.recoverableAmount ? `${invoice.currency} ${parseFloat(i.recoverableAmount).toLocaleString()}` : null,
  }));

  const prompt = `You are a senior legal operations analyst. Write a concise 3–5 sentence executive summary for a law firm invoice review report. Use professional, plain English — no jargon, no internal metric names.

Invoice: ${invoice.invoiceNumber}
Law firm: ${lawFirmName ?? "unknown"}
Matter: ${invoice.matterName ?? "unspecified"}
Total invoiced: ${invoice.currency} ${invoice.totalAmount ? parseFloat(invoice.totalAmount).toLocaleString() : "unknown"}
Review outcome: ${invoice.reviewOutcome ?? "in progress"}
Amount at risk: ${invoice.currency} ${invoice.amountAtRisk ? parseFloat(invoice.amountAtRisk).toLocaleString() : "0"}
Confirmed recovery: ${invoice.currency} ${invoice.confirmedRecovery ? parseFloat(invoice.confirmedRecovery).toLocaleString() : "0"}
Issues found: ${allIssues.length} total (${rejectedIssues.length} rejected, ${acceptedIssues.length} accepted, ${escalatedIssues.length} escalated, ${openIssues.length} open)

Rejected issues:
${rejectedForAI.length === 0 ? "None" : rejectedForAI.map((i, n) => `${n + 1}. ${i.rule}: ${i.explanation}${i.recovery ? ` (recovery: ${i.recovery})` : ""}`).join("\n")}

Write only the executive summary paragraph. Do not include a title or heading.`;

  let executiveSummary = "";
  try {
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    executiveSummary = aiResponse.choices[0]?.message?.content?.trim() ?? "Executive summary unavailable.";
  } catch {
    executiveSummary = `Review of invoice ${invoice.invoiceNumber} from ${lawFirmName ?? "the law firm"} identified ${allIssues.length} compliance issues requiring attention. ${rejectedIssues.length} issue(s) were rejected with a confirmed recovery of ${invoice.currency} ${invoice.confirmedRecovery ? parseFloat(invoice.confirmedRecovery).toLocaleString() : "0"}.`;
  }

  res.json({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    lawFirmName,
    matterName: invoice.matterName,
    jurisdiction: invoice.jurisdiction,
    currency: invoice.currency,
    totalAmount: invoice.totalAmount,
    invoiceDate: invoice.invoiceDate,
    reviewOutcome: invoice.reviewOutcome,
    invoiceStatus: invoice.invoiceStatus,
    amountAtRisk: invoice.amountAtRisk,
    confirmedRecovery: invoice.confirmedRecovery,
    executiveSummary,
    rejectedIssues,
    acceptedIssues,
    escalatedIssues,
    openIssues,
    auditTrail,
    generatedAt: new Date(),
  });
});

router.post("/invoices/:id/email-draft", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  if (invoice.invoiceStatus !== "pending_law_firm") {
    res.status(400).json({ error: "Email draft is only available when the invoice is in 'Pending Law Firm' state" });
    return;
  }

  let lawFirmName: string | null = null;
  let contactName: string | null = null;
  let contactEmail: string | null = null;

  if (invoice.lawFirmId) {
    const [firm] = await db.select({
      name: lawFirmsTable.name,
      contactName: lawFirmsTable.contactName,
      contactEmail: lawFirmsTable.contactEmail,
    }).from(lawFirmsTable).where(eq(lawFirmsTable.id, invoice.lawFirmId)).limit(1);
    lawFirmName = firm?.name ?? null;
    contactName = firm?.contactName ?? null;
    contactEmail = firm?.contactEmail ?? null;
  }

  const conditions = [eq(issuesTable.invoiceId, id)];
  if (invoice.currentAnalysisRunId) {
    conditions.push(eq(issuesTable.analysisRunId, invoice.currentAnalysisRunId));
  }

  const rejectedStatuses = ["rejected_by_legal_ops", "rejected_by_internal_lawyer"];
  const rejectedIssues = await db
    .select()
    .from(issuesTable)
    .where(and(...conditions, sql`issue_status IN ('rejected_by_legal_ops', 'rejected_by_internal_lawyer')`))
    .orderBy(issuesTable.id);

  const rejectedForPrompt = rejectedIssues.map((i, n) => {
    const amt = i.recoverableAmount ? parseFloat(i.recoverableAmount) : null;
    return `${n + 1}. ${i.explanationText}${amt ? ` (disputed amount: ${invoice.currency} ${amt.toLocaleString()})` : ""}`;
  });

  const prompt = `You are a senior in-house legal counsel writing a formal, professional email to a law firm to dispute specific items in an invoice.

Context:
- Law firm: ${lawFirmName ?? "the firm"}
- Invoice reference: ${invoice.invoiceNumber}
- Matter: ${invoice.matterName ?? "the matter"}
- Total invoiced: ${invoice.currency} ${invoice.totalAmount ? parseFloat(invoice.totalAmount).toLocaleString() : "unknown"}
- Confirmed recovery amount: ${invoice.currency} ${invoice.confirmedRecovery ? parseFloat(invoice.confirmedRecovery).toLocaleString() : "0"}

Rejected items (${rejectedIssues.length} total):
${rejectedForPrompt.length === 0 ? "None" : rejectedForPrompt.join("\n")}

Write a professional email that:
1. Opens with a courteous acknowledgement of the invoice
2. States clearly which items are disputed and why (use plain language, not rule codes)
3. Requests correction or credit note for the disputed items
4. Closes professionally
5. Is firm but respectful — no aggressive language
6. Does NOT mention internal systems, rule codes, or compliance scores
7. Does NOT include subject line or To/From headers — only the email body

Write only the email body text.`;

  let body = "";
  try {
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    body = aiResponse.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    body = `Dear ${contactName ?? "Billing Team"},\n\nThank you for submitting invoice ${invoice.invoiceNumber}. Following our internal review, we have identified ${rejectedIssues.length} item(s) that require clarification or adjustment.\n\nPlease review the highlighted items and issue a credit note or revised invoice at your earliest convenience.\n\nKind regards`;
  }

  const subject = `Re: Invoice ${invoice.invoiceNumber}${invoice.matterName ? ` — ${invoice.matterName}` : ""} — Billing Query`;

  res.json({
    to: contactEmail,
    subject,
    body,
    lawFirmName,
    lawFirmContactName: contactName,
  });
});

export default router;
