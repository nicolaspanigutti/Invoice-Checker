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
import PDFDocument from "pdfkit";

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
    invoiceStatus: "pending",
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
  } else if (invoice.invoiceStatus === "pending") {
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

  if (invoice.currentAnalysisRunId !== null) {
    res.status(409).json({
      error: "Analysis has already been run for this invoice. Use the rerun endpoint to initiate a new analysis with a mandatory reason.",
      currentAnalysisRunId: invoice.currentAnalysisRunId,
    });
    return;
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

router.post("/invoices/:id/rerun", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    res.status(400).json({ error: "A re-run reason is required." });
    return;
  }

  const actorId = req.session.userId!;

  const [existingInvoice] = await db.select({ id: invoicesTable.id, invoiceStatus: invoicesTable.invoiceStatus, currentAnalysisRunId: invoicesTable.currentAnalysisRunId })
    .from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!existingInvoice) {
    res.status(404).json({ error: "Invoice not found." });
    return;
  }

  if (!existingInvoice.currentAnalysisRunId) {
    res.status(409).json({ error: "Invoice has not been analysed yet. Use the analyse endpoint to run the first analysis." });
    return;
  }

  const oldStatus = existingInvoice.invoiceStatus;
  await db.update(invoicesTable).set({ invoiceStatus: "extracting_data" }).where(eq(invoicesTable.id, id));
  await db.insert(auditEventsTable).values({
    entityType: "invoice",
    entityId: id,
    eventType: "state_change",
    actorId,
    beforeJson: { status: oldStatus },
    afterJson: { status: "extracting_data" },
    reason: `Re-run initiated: ${reason}`,
  });

  await db.insert(auditEventsTable).values({
    entityType: "invoice",
    entityId: id,
    eventType: "analysis_started",
    actorId,
    afterJson: null,
    reason,
  });

  try {
    const result = await runAnalysis(id, actorId, reason);
    if (result.status === "gate_failed") {
      await db.update(invoicesTable)
        .set({ invoiceStatus: oldStatus })
        .where(eq(invoicesTable.id, id));
      await db.insert(auditEventsTable).values({
        entityType: "invoice",
        entityId: id,
        eventType: "state_change",
        actorId,
        beforeJson: { status: "extracting_data" },
        afterJson: { status: oldStatus },
        reason: "Completeness gate failed — invoice status restored",
      });
      await db.insert(auditEventsTable).values({
        entityType: "invoice",
        entityId: id,
        eventType: "analysis_failed",
        actorId,
        afterJson: { reason: "gate_failed", analysisRunId: result.analysisRunId },
        reason: "Completeness gate failed",
      });
      res.status(422).json({
        error: "Cannot re-run analysis: completeness gate failed.",
        analysisRunId: result.analysisRunId,
      });
      return;
    }
    await db.insert(auditEventsTable).values({
      entityType: "invoice",
      entityId: id,
      eventType: "analysis_completed",
      actorId,
      afterJson: { issueCount: result.issueCount, outcome: result.outcome, amountAtRisk: result.amountAtRisk, rerun: true },
      reason,
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
    console.error("Re-run analysis failed:", err);
    try {
      await db.update(invoicesTable)
        .set({ invoiceStatus: oldStatus })
        .where(eq(invoicesTable.id, id));
      await db.insert(auditEventsTable).values({
        entityType: "invoice",
        entityId: id,
        eventType: "state_change",
        actorId,
        beforeJson: { status: "extracting_data" },
        afterJson: { status: oldStatus },
        reason: "Re-run failed unexpectedly — invoice status restored",
      });
    } catch (rollbackErr) {
      console.error("Failed to restore invoice status after re-run error:", rollbackErr);
    }
    res.status(500).json({ error: "Re-run analysis failed unexpectedly." });
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

  const [inv] = await db.select({ currentAnalysisRunId: invoicesTable.currentAnalysisRunId }).from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }

  const explicitRunId = req.query.analysisRunId ? parseInt(String(req.query.analysisRunId), 10) : undefined;
  const effectiveRunId = (explicitRunId && !isNaN(explicitRunId)) ? explicitRunId : (inv.currentAnalysisRunId ?? undefined);

  const conditions = [eq(issuesTable.invoiceId, id)];
  if (effectiveRunId) conditions.push(eq(issuesTable.analysisRunId, effectiveRunId));

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

  const VALID_COMMENT_SCOPES = new Set(["general", "issue", "line_item", "issue_inline"]);
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

  const aiPayload = {
    invoice: invoice.invoiceNumber,
    lawFirm: lawFirmName ?? "unknown",
    matter: invoice.matterName ?? "unspecified",
    totalInvoiced: invoice.totalAmount ? `${invoice.currency} ${parseFloat(invoice.totalAmount).toLocaleString()}` : "unknown",
    reviewOutcome: invoice.reviewOutcome ?? "in_progress",
    issueSummary: { total: allIssues.length, rejected: rejectedIssues.length, accepted: acceptedIssues.length, escalated: escalatedIssues.length, open: openIssues.length },
    rejectedItems: rejectedForAI,
  };

  let executiveSummary = "";
  try {
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 300,
      messages: [
        { role: "system", content: "You are a senior legal operations analyst. Write a concise 3-5 sentence executive summary for a law firm invoice review report. Use professional, plain English — no jargon, no internal metric names, no system codes. Output only the summary paragraph." },
        { role: "user", content: JSON.stringify(aiPayload) },
      ],
    });
    executiveSummary = aiResponse.choices[0]?.message?.content?.trim() ?? "Executive summary unavailable.";
  } catch {
    executiveSummary = `Review of invoice ${invoice.invoiceNumber} from ${lawFirmName ?? "the law firm"} identified ${allIssues.length} compliance issues requiring attention. ${rejectedIssues.length} issue(s) were rejected for further action.`;
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

  if (invoice.invoiceStatus !== "disputed") {
    res.status(400).json({ error: "Email draft is only available when the invoice is in 'Disputed' state" });
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

  const emailPayload = {
    lawFirm: lawFirmName ?? "the firm",
    invoiceRef: invoice.invoiceNumber,
    matter: invoice.matterName ?? "the matter",
    totalInvoiced: invoice.totalAmount ? `${invoice.currency} ${parseFloat(invoice.totalAmount).toLocaleString()}` : "unknown",
    disputedItems: rejectedIssues.map(i => ({
      description: i.explanationText,
      amount: i.recoverableAmount ? `${invoice.currency} ${parseFloat(i.recoverableAmount).toLocaleString()}` : null,
    })),
  };

  let body = "";
  try {
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 600,
      messages: [
        {
          role: "system",
          content: "You are a senior in-house legal counsel. Write a formal, professional email body to a law firm disputing invoice items. Rules: (1) acknowledge the invoice courteously, (2) explain each disputed item in plain English without rule codes or internal metric names, (3) request a credit note or revised invoice, (4) close professionally, (5) no aggressive language, (6) no subject line or To/From headers, (7) output only the email body text.",
        },
        { role: "user", content: JSON.stringify(emailPayload) },
      ],
    });
    body = aiResponse.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    body = `Dear ${contactName ?? "Billing Team"},\n\nThank you for submitting invoice ${invoice.invoiceNumber}. Following our review, we have identified ${rejectedIssues.length} item(s) that require clarification or adjustment.\n\nPlease review the highlighted items and issue a credit note or revised invoice at your earliest convenience.\n\nKind regards`;
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

router.get("/invoices/:id/report/pdf", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
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

  const issueConditions = [eq(issuesTable.invoiceId, id), eq(issuesTable.analysisRunId, invoice.currentAnalysisRunId)];
  const allIssues = await db.select().from(issuesTable).where(and(...issueConditions)).orderBy(issuesTable.id);

  const latestDecisions = await db.select().from(issueDecisionsTable)
    .where(sql`issue_id IN (SELECT id FROM issues WHERE invoice_id = ${id})`)
    .orderBy(desc(issueDecisionsTable.createdAt));
  const decisionByIssue = new Map<number, typeof issueDecisionsTable.$inferSelect>();
  for (const d of latestDecisions) { if (!decisionByIssue.has(d.issueId)) decisionByIssue.set(d.issueId, d); }

  const rejectedStatuses = ["rejected_by_legal_ops", "rejected_by_internal_lawyer"];
  const acceptedStatuses = ["accepted_by_legal_ops", "accepted_by_internal_lawyer"];

  const rejectedIssues = allIssues.filter(i => rejectedStatuses.includes(i.issueStatus));
  const acceptedIssues = allIssues.filter(i => acceptedStatuses.includes(i.issueStatus));
  const escalatedIssues = allIssues.filter(i => i.issueStatus === "escalated_to_internal_lawyer");
  const openIssues = allIssues.filter(i => i.issueStatus === "open");

  const STATUS_LABELS_MAP: Record<string, string> = {
    pending: "Pending", in_review: "In Review", escalated: "Escalated",
    disputed: "Disputed", accepted: "Accepted",
  };
  const OUTCOME_MAP: Record<string, string> = {
    clean: "Clean — No Issues", accepted_with_comments: "Accepted with Comments",
    partially_rejected: "Partially Rejected", fully_rejected: "Fully Rejected",
  };

  // Generate AI executive summary for the PDF
  const rejectedForAI = rejectedIssues.map(i => ({
    rule: i.ruleCode,
    severity: i.severity,
    explanation: i.explanationText,
    recovery: i.recoverableAmount ? `${invoice.currency} ${parseFloat(i.recoverableAmount).toLocaleString()}` : null,
  }));
  const pdfAiPayload = {
    invoice: invoice.invoiceNumber,
    lawFirm: lawFirmName ?? "unknown",
    matter: invoice.matterName ?? "unspecified",
    totalInvoiced: invoice.totalAmount ? `${invoice.currency} ${parseFloat(invoice.totalAmount).toLocaleString()}` : "unknown",
    reviewOutcome: invoice.reviewOutcome ?? "in_progress",
    issueSummary: { total: allIssues.length, rejected: rejectedIssues.length, accepted: acceptedIssues.length, escalated: escalatedIssues.length, open: openIssues.length },
    rejectedItems: rejectedForAI,
  };
  let executiveSummary = "";
  try {
    const aiResp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 300,
      messages: [
        { role: "system", content: "You are a senior legal operations analyst. Write a concise 3-5 sentence executive summary for a law firm invoice review report. Use professional, plain English — no jargon, no internal metric names, no system codes. Output only the summary paragraph." },
        { role: "user", content: JSON.stringify(pdfAiPayload) },
      ],
    });
    executiveSummary = aiResp.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    executiveSummary = `Review of invoice ${invoice.invoiceNumber} from ${lawFirmName ?? "the law firm"} identified ${allIssues.length} compliance issue(s). ${rejectedIssues.length} issue(s) were rejected for further action.`;
  }

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-report-${invoice.invoiceNumber}.pdf"`);
  doc.pipe(res);

  const RED = "#EC0000";
  const DARK = "#1a1a2e";
  const GREY = "#64748B";

  doc.rect(0, 0, doc.page.width, 100).fill(RED);
  doc.fillColor("white").fontSize(9).font("Helvetica").text("INVOICE REVIEW REPORT", 50, 25, { characterSpacing: 2 });
  doc.fontSize(18).font("Helvetica-Bold").text(invoice.invoiceNumber, 50, 40);
  if (lawFirmName) doc.fontSize(11).font("Helvetica").text(lawFirmName, 50, 65);
  doc.fontSize(8).text(`Generated: ${new Date().toLocaleString("en-GB")}`, 50, 80);
  doc.moveDown(1);
  doc.y = 115;

  const drawHRule = () => { doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).lineWidth(0.5).strokeColor("#E5E7EB").stroke(); doc.moveDown(0.5); };
  const section = (title: string) => {
    doc.moveDown(0.5);
    doc.fontSize(9).font("Helvetica-Bold").fillColor(RED).text(title.toUpperCase(), { characterSpacing: 1.5 });
    doc.moveDown(0.3);
    drawHRule();
    doc.fillColor(DARK).font("Helvetica").fontSize(10);
  };

  if (executiveSummary) {
    section("Executive Findings Summary");
    doc.fontSize(10).font("Helvetica").fillColor(DARK).text(executiveSummary, { lineGap: 3 });
    doc.moveDown(0.5);
  }

  section("Invoice Summary");
  const col = (label: string, value: string) => {
    doc.fontSize(8).font("Helvetica-Bold").fillColor(GREY).text(label, { continued: false });
    doc.fontSize(10).font("Helvetica").fillColor(DARK).text(value);
    doc.moveDown(0.2);
  };
  col("Matter", invoice.matterName ?? "—");
  col("Jurisdiction", invoice.jurisdiction ?? "—");
  col("Total Invoiced", invoice.totalAmount ? `${invoice.currency} ${parseFloat(invoice.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—");
  col("Status", STATUS_LABELS_MAP[invoice.invoiceStatus] ?? invoice.invoiceStatus);
  col("Outcome", invoice.reviewOutcome ? (OUTCOME_MAP[invoice.reviewOutcome] ?? invoice.reviewOutcome) : "In Progress");
  col("Amount at Risk", invoice.amountAtRisk ? `${invoice.currency} ${parseFloat(invoice.amountAtRisk).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—");
  col("Confirmed Recovery", invoice.confirmedRecovery ? `${invoice.currency} ${parseFloat(invoice.confirmedRecovery).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—");

  section("Issue Breakdown");
  const countRow = (label: string, count: number) => {
    doc.fontSize(10).font("Helvetica").fillColor(DARK).text(`${label}: ${count}`);
    doc.moveDown(0.2);
  };
  countRow("Total", allIssues.length);
  countRow("Rejected", rejectedIssues.length);
  countRow("Accepted", acceptedIssues.length);
  countRow("Escalated to Internal Lawyer", escalatedIssues.length);
  countRow("Open", openIssues.length);

  const issueSection = (title: string, issues: typeof allIssues) => {
    if (issues.length === 0) return;
    section(title);
    for (const issue of issues) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK).text(`• ${issue.explanationText ?? issue.ruleCode}`);
      if (issue.recoverableAmount) {
        doc.fontSize(8).font("Helvetica").fillColor(GREY).text(`  Recovery: ${invoice.currency} ${parseFloat(issue.recoverableAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
      }
      const dec = decisionByIssue.get(issue.id);
      if (dec?.note) {
        doc.fontSize(8).font("Helvetica-Oblique").fillColor(GREY).text(`  Note: "${dec.note}"`);
      }
      doc.moveDown(0.4);
    }
  };

  issueSection("Rejected Issues", rejectedIssues);
  issueSection("Accepted Issues", acceptedIssues);
  issueSection("Escalated Issues", escalatedIssues);
  issueSection("Open Issues", openIssues);

  const events = await db.select({ e: auditEventsTable, actorName: usersTable.displayName })
    .from(auditEventsTable)
    .leftJoin(usersTable, eq(auditEventsTable.actorId, usersTable.id))
    .where(or(
      and(eq(auditEventsTable.entityType, "invoice"), eq(auditEventsTable.entityId, id)),
      and(eq(auditEventsTable.entityType, "issue"), sql`${auditEventsTable.entityId} IN (SELECT id FROM issues WHERE invoice_id = ${id})`)
    ))
    .orderBy(asc(auditEventsTable.createdAt));

  if (events.length > 0) {
    section("Audit Trail");
    const EVENT_LABELS: Record<string, string> = {
      invoice_created: "Invoice created", analysis_started: "Analysis started", analysis_completed: "Analysis completed",
      status_transition: "Status changed", issue_accept: "Issue accepted", issue_reject: "Issue rejected",
      issue_delegate: "Issue delegated to Internal Lawyer", comment_posted: "Comment posted",
    };
    for (const row of events) {
      const ts = new Date(row.e.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const label = EVENT_LABELS[row.e.eventType] ?? row.e.eventType.replace(/_/g, " ");
      const actor = row.actorName ? ` by ${row.actorName}` : "";
      doc.fontSize(9).font("Helvetica").fillColor(DARK).text(`${ts}  ${label}${actor}`);
      doc.moveDown(0.2);
    }
  }

  doc.end();
});

export default router;
