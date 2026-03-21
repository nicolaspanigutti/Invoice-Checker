import { Router, type IRouter, type Request, type Response } from "express";
import { db, panelBaselineDocumentsTable, panelRatesTable, usersTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

const router: IRouter = Router();

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

router.get("/panel-baseline-documents", requireAuth, async (req: Request, res: Response) => {
  const docs = await db
    .select()
    .from(panelBaselineDocumentsTable)
    .orderBy(sql`${panelBaselineDocumentsTable.createdAt} desc`);
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
    verificationStatus: "active",
    uploadedById: req.session.userId!,
    activatedAt: new Date(),
  }).returning();

  if (Array.isArray(rates) && rates.length > 0) {
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

router.get("/panel-rates", requireAuth, async (req: Request, res: Response) => {
  const { documentId, firmName, jurisdiction } = req.query;

  let query = db.select().from(panelRatesTable).$dynamic();

  const conditions = [];
  if (documentId) conditions.push(eq(panelRatesTable.baselineDocumentId, parseInt(documentId as string)));
  if (firmName) conditions.push(ilike(panelRatesTable.lawFirmName, `%${firmName}%`));
  if (jurisdiction) conditions.push(ilike(panelRatesTable.jurisdiction, `%${jurisdiction}%`));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rates = await query.orderBy(panelRatesTable.lawFirmName, panelRatesTable.jurisdiction, panelRatesTable.roleCode);
  res.json(rates.map(rateToResponse));
});

export default router;
