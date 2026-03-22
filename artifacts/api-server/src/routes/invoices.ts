import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, invoiceDocumentsTable, invoiceItemsTable, lawFirmsTable, usersTable } from "@workspace/db";
import { eq, and, ilike, or, sql, desc, count } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { checkCompleteness } from "../lib/completenessGate";
import { extractInvoiceFromText } from "../lib/extractInvoice";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractTextFromBuffer } from "../lib/extractText";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

let invoiceCounter = 0;

async function generateInvoiceNumber(): Promise<string> {
  const [result] = await db.select({ c: count() }).from(invoicesTable);
  const n = (result?.c ?? 0) + (++invoiceCounter);
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

  const allowed = ["documentType", "billingType", "matterName", "projectReference", "jurisdiction", "applicableLaw", "currency", "invoiceDate", "dueDate", "totalAmount", "subtotalAmount", "taxAmount", "internalRequestorId", "assignedLegalOpsId", "assignedInternalLawyerId", "invoiceStatus"];
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

  const docs = await db
    .select()
    .from(invoiceDocumentsTable)
    .where(and(eq(invoiceDocumentsTable.invoiceId, id), eq(invoiceDocumentsTable.documentKind, "invoice_file")))
    .limit(1);

  const invoiceDoc = docs[0];
  if (!invoiceDoc) {
    res.status(422).json({ error: "No invoice file document found. Upload an invoice file before extracting." });
    return;
  }

  let rawText = invoiceDoc.rawText ?? "";

  if (!rawText && invoiceDoc.storagePath) {
    try {
      const file = await objectStorage.getObjectEntityFile(invoiceDoc.storagePath);
      const fileResponse = await objectStorage.downloadObject(file);
      const arrayBuffer = await fileResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      rawText = await extractTextFromBuffer(buffer, invoiceDoc.mimeType ?? "application/octet-stream");

      await db.update(invoiceDocumentsTable).set({
        rawText,
        extractionStatus: "done",
      }).where(eq(invoiceDocumentsTable.id, invoiceDoc.id));
    } catch {
      await db.update(invoiceDocumentsTable).set({ extractionStatus: "failed" }).where(eq(invoiceDocumentsTable.id, invoiceDoc.id));
      res.status(422).json({ error: "Failed to download or read the invoice file." });
      return;
    }
  }

  if (!rawText || rawText.trim().length < 10) {
    res.status(422).json({ error: "Invoice file could not be read as text. Ensure the file is a readable PDF or DOCX." });
    return;
  }

  const { extracted, confidence, textHash } = await extractInvoiceFromText(rawText);

  const updates: Partial<typeof invoicesTable.$inferInsert> = {};
  if (extracted.invoiceDate) updates.invoiceDate = extracted.invoiceDate;
  if (extracted.dueDate) updates.dueDate = extracted.dueDate;
  if (extracted.totalAmount) updates.totalAmount = extracted.totalAmount;
  if (extracted.subtotalAmount) updates.subtotalAmount = extracted.subtotalAmount;
  if (extracted.taxAmount) updates.taxAmount = extracted.taxAmount;
  if (extracted.currency) updates.currency = extracted.currency;
  if (extracted.matterName) updates.matterName = extracted.matterName;
  if (extracted.projectReference) updates.projectReference = extracted.projectReference;
  if (extracted.jurisdiction) updates.jurisdiction = extracted.jurisdiction;
  if (extracted.applicableLaw) updates.applicableLaw = extracted.applicableLaw;
  if (extracted.billingPeriodStart || extracted.billingPeriodEnd) {
    // Store billing period info in line items
  }

  if (Object.keys(updates).length > 0) {
    updates.invoiceStatus = "in_review";
    await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id));
  }

  await db.update(invoiceDocumentsTable).set({ textHash, extractionStatus: "done" }).where(eq(invoiceDocumentsTable.id, invoiceDoc.id));

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

  res.json({ invoiceId: id, extracted, confidence });
});

export default router;
