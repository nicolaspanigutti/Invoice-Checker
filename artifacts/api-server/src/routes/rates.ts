import { Router, type IRouter, type Request, type Response } from "express";
import { db, panelBaselineDocumentsTable, panelRatesTable } from "@workspace/db";
import { eq, and, ilike, sql, lte, or, isNull } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractTextFromBuffer } from "../lib/extractText";
import { extractRatesFromText, extractTextFromExcel, extractTextFromCsv } from "../lib/extractRates";

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

function parseId(param: string | string[]): number {
  return parseInt(Array.isArray(param) ? param[0] : param, 10);
}

function docToResponse(doc: typeof panelBaselineDocumentsTable.$inferSelect) {
  return {
    id: doc.id,
    documentKind: doc.documentKind,
    versionLabel: doc.versionLabel,
    fileName: doc.fileName ?? null,
    verificationStatus: doc.verificationStatus,
    uploadedById: doc.uploadedById,
    activatedAt: doc.activatedAt ?? null,
    createdAt: doc.createdAt,
  };
}

function rateToResponse(rate: typeof panelRatesTable.$inferSelect) {
  return {
    id: rate.id,
    baselineDocumentId: rate.baselineDocumentId,
    lawFirmName: rate.lawFirmName,
    jurisdiction: rate.jurisdiction,
    roleCode: rate.roleCode,
    roleLabel: rate.roleLabel,
    currency: rate.currency,
    maxRate: rate.maxRate,
    validFrom: rate.validFrom ?? null,
    validTo: rate.validTo ?? null,
  };
}

router.get("/panel-baseline-documents", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const { documentKind } = req.query;

  let query = db.select().from(panelBaselineDocumentsTable).$dynamic();

  if (documentKind) {
    query = query.where(eq(panelBaselineDocumentsTable.documentKind, documentKind as "rates" | "terms_conditions"));
  }

  const docs = await query.orderBy(sql`${panelBaselineDocumentsTable.createdAt} desc`);
  res.json(docs.map(docToResponse));
});

router.post("/panel-baseline-documents", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const { documentKind, versionLabel, fileName, rates } = req.body;

  if (!documentKind || !versionLabel) {
    res.status(400).json({ error: "documentKind and versionLabel are required" });
    return;
  }

  const [doc] = await db.insert(panelBaselineDocumentsTable).values({
    documentKind,
    versionLabel,
    fileName: fileName ?? null,
    verificationStatus: "draft",
    uploadedById: req.session.userId!,
    activatedAt: null,
  }).returning();

  if (documentKind === "rates" && Array.isArray(rates) && rates.length > 0) {
    await db.insert(panelRatesTable).values(
      rates.map((r: { lawFirmName: string; jurisdiction: string; roleCode: string; roleLabel: string; currency: string; maxRate: number | string; validFrom?: string; validTo?: string }) => ({
        baselineDocumentId: doc.id,
        lawFirmName: r.lawFirmName,
        jurisdiction: r.jurisdiction,
        roleCode: r.roleCode,
        roleLabel: r.roleLabel,
        currency: r.currency,
        maxRate: String(r.maxRate),
        validFrom: r.validFrom ?? new Date().toISOString().split("T")[0],
        validTo: r.validTo ?? undefined,
      }))
    );
  }

  res.status(201).json(docToResponse(doc));
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["verified", "archived"],
  verified: ["active", "archived"],
  active: ["archived"],
  archived: [],
};

router.patch("/panel-baseline-documents/:id/status", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const { status } = req.body;
  if (!status || !["draft", "verified", "active", "archived"].includes(status)) {
    res.status(400).json({ error: "status must be one of: draft, verified, active, archived" });
    return;
  }

  const [doc] = await db.select().from(panelBaselineDocumentsTable).where(eq(panelBaselineDocumentsTable.id, id)).limit(1);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[doc.verificationStatus] ?? [];
  if (!allowed.includes(status)) {
    res.status(422).json({
      error: `Cannot transition from '${doc.verificationStatus}' to '${status}'. Allowed transitions: ${allowed.length ? allowed.join(", ") : "none"}`
    });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const updateValues: Partial<typeof panelBaselineDocumentsTable.$inferInsert> = { verificationStatus: status };

    if (status === "active") {
      await tx
        .update(panelBaselineDocumentsTable)
        .set({ verificationStatus: "archived" })
        .where(
          and(
            eq(panelBaselineDocumentsTable.documentKind, doc.documentKind),
            eq(panelBaselineDocumentsTable.verificationStatus, "active"),
            sql`${panelBaselineDocumentsTable.id} != ${id}`
          )
        );
      updateValues.activatedAt = new Date();
    }

    const [updated] = await tx
      .update(panelBaselineDocumentsTable)
      .set(updateValues)
      .where(eq(panelBaselineDocumentsTable.id, id))
      .returning();

    return updated;
  });

  res.json(docToResponse(updated));
});

router.get("/panel-rates", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const { documentId, firmName, jurisdiction } = req.query;

  let query = db.select().from(panelRatesTable).$dynamic();

  const conditions = [];
  if (documentId) {
    const parsedDocId = parseInt(documentId as string, 10);
    if (isNaN(parsedDocId)) {
      res.status(400).json({ error: "Invalid documentId" });
      return;
    }
    conditions.push(eq(panelRatesTable.baselineDocumentId, parsedDocId));
  }
  if (firmName) conditions.push(ilike(panelRatesTable.lawFirmName, `%${firmName}%`));
  if (jurisdiction) conditions.push(ilike(panelRatesTable.jurisdiction, `%${jurisdiction}%`));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rates = await query.orderBy(panelRatesTable.lawFirmName, panelRatesTable.jurisdiction, panelRatesTable.roleCode);
  res.json(rates.map(rateToResponse));
});

router.get("/panel-rates/lookup", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const { lawFirmName, jurisdiction, roleCode, currency, invoiceDate } = req.query;

  if (!lawFirmName || !jurisdiction || !roleCode || !currency || !invoiceDate) {
    res.status(400).json({ error: "lawFirmName, jurisdiction, roleCode, currency, and invoiceDate are all required" });
    return;
  }

  const [rate] = await db
    .select({ rate: panelRatesTable })
    .from(panelRatesTable)
    .innerJoin(
      panelBaselineDocumentsTable,
      and(
        eq(panelRatesTable.baselineDocumentId, panelBaselineDocumentsTable.id),
        eq(panelBaselineDocumentsTable.verificationStatus, "active"),
        eq(panelBaselineDocumentsTable.documentKind, "rates")
      )
    )
    .where(
      and(
        ilike(panelRatesTable.lawFirmName, lawFirmName as string),
        ilike(panelRatesTable.jurisdiction, jurisdiction as string),
        ilike(panelRatesTable.roleCode, roleCode as string),
        eq(panelRatesTable.currency, currency as string),
        lte(panelRatesTable.validFrom, invoiceDate as string),
        or(isNull(panelRatesTable.validTo), sql`${panelRatesTable.validTo} >= ${invoiceDate}`)
      )
    )
    .orderBy(sql`${panelRatesTable.validFrom} desc`)
    .limit(1);

  const rateRow = rate?.rate ?? null;
  res.json({ found: !!rateRow, rate: rateRow ? rateToResponse(rateRow) : null });
});

router.post("/panel-baseline-documents/extract-rates", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const { storagePath, mimeType } = req.body as { storagePath?: string; mimeType?: string };
  if (!storagePath) { res.status(400).json({ error: "storagePath is required" }); return; }

  let fileBuffer: Buffer;
  try {
    const file = await objectStorage.getObjectEntityFile(storagePath);
    const fileResponse = await objectStorage.downloadObject(file);
    const ab = await fileResponse.arrayBuffer();
    fileBuffer = Buffer.from(ab);
  } catch {
    res.status(422).json({ error: "Failed to download the file from storage. Please re-upload." });
    return;
  }

  const mime = (mimeType ?? "application/octet-stream").toLowerCase();
  let rawText = "";

  if (mime === "text/csv" || mime === "text/plain" || storagePath.endsWith(".csv")) {
    rawText = await extractTextFromCsv(fileBuffer);
  } else if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    storagePath.endsWith(".xlsx") || storagePath.endsWith(".xls")
  ) {
    rawText = await extractTextFromExcel(fileBuffer);
  } else {
    rawText = await extractTextFromBuffer(fileBuffer, mime);
  }

  if (!rawText.trim()) {
    res.status(422).json({ error: "Could not extract readable text from this file. Please upload a PDF, DOCX, Excel, or CSV file." });
    return;
  }

  const rates = await extractRatesFromText(rawText);
  res.json({ extracted: rates.length, rates });
});

export default router;
