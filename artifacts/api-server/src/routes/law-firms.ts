import { Router, type IRouter, type Request, type Response } from "express";
import { db, lawFirmsTable, firmTermsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

const router: IRouter = Router();

function parseId(param: string | string[]): number {
  return parseInt(Array.isArray(param) ? param[0] : param, 10);
}

function firmToResponse(firm: typeof lawFirmsTable.$inferSelect) {
  return {
    id: firm.id,
    name: firm.name,
    firmType: firm.firmType,
    jurisdictions: (firm.jurisdictionsJson as string[]) ?? [],
    practiceAreas: (firm.practiceAreasJson as string[]) ?? [],
    contactName: firm.contactName ?? null,
    contactEmail: firm.contactEmail ?? null,
    contactPhone: firm.contactPhone ?? null,
    relationshipPartner: firm.relationshipPartner ?? null,
    notes: firm.notes ?? null,
    isActive: firm.isActive,
    createdAt: firm.createdAt,
    updatedAt: firm.updatedAt,
  };
}

function termToResponse(term: typeof firmTermsTable.$inferSelect) {
  return {
    id: term.id,
    lawFirmId: term.lawFirmId,
    termKey: term.termKey,
    termValue: term.termValueJson,
    sourceType: term.sourceType,
    verificationStatus: term.verificationStatus,
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

router.get("/law-firms", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === "true";
  const firms = await db
    .select()
    .from(lawFirmsTable)
    .where(includeInactive ? undefined : eq(lawFirmsTable.isActive, true))
    .orderBy(lawFirmsTable.name);

  res.json(firms.map(firmToResponse));
});

router.post("/law-firms", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const { name, firmType, jurisdictions, practiceAreas, contactName, contactEmail, contactPhone, relationshipPartner, notes } = req.body;

  if (!name || !firmType) {
    res.status(400).json({ error: "name and firmType are required" });
    return;
  }

  const [firm] = await db.insert(lawFirmsTable).values({
    name,
    firmType,
    jurisdictionsJson: jurisdictions ?? [],
    practiceAreasJson: practiceAreas ?? [],
    contactName: contactName ?? null,
    contactEmail: contactEmail ?? null,
    contactPhone: contactPhone ?? null,
    relationshipPartner: relationshipPartner ?? null,
    notes: notes ?? null,
    isActive: true,
  }).returning();

  res.status(201).json(firmToResponse(firm));
});

router.get("/law-firms/:id", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [firm] = await db.select().from(lawFirmsTable).where(eq(lawFirmsTable.id, id)).limit(1);
  if (!firm) {
    res.status(404).json({ error: "Law firm not found" });
    return;
  }

  const terms = await db.select().from(firmTermsTable).where(eq(firmTermsTable.lawFirmId, id));

  res.json({
    ...firmToResponse(firm),
    terms: terms.map(termToResponse),
  });
});

router.put("/law-firms/:id", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const { name, firmType, jurisdictions, practiceAreas, contactName, contactEmail, contactPhone, relationshipPartner, notes, isActive } = req.body;

  const updateData: Partial<typeof lawFirmsTable.$inferInsert> = {};
  if (name !== undefined) updateData.name = name;
  if (firmType !== undefined) updateData.firmType = firmType;
  if (jurisdictions !== undefined) updateData.jurisdictionsJson = jurisdictions;
  if (practiceAreas !== undefined) updateData.practiceAreasJson = practiceAreas;
  if (contactName !== undefined) updateData.contactName = contactName;
  if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
  if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
  if (relationshipPartner !== undefined) updateData.relationshipPartner = relationshipPartner;
  if (notes !== undefined) updateData.notes = notes;
  if (isActive !== undefined) updateData.isActive = isActive;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db.update(lawFirmsTable).set(updateData).where(eq(lawFirmsTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Law firm not found" });
    return;
  }

  res.json(firmToResponse(updated));
});

router.get("/law-firms/:id/terms", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  const terms = await db.select().from(firmTermsTable).where(eq(firmTermsTable.lawFirmId, id));
  res.json(terms.map(termToResponse));
});

router.put("/law-firms/:id/terms", requireRole("super_admin", "legal_ops"), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const { terms } = req.body;
  if (!Array.isArray(terms)) {
    res.status(400).json({ error: "terms must be an array" });
    return;
  }

  const results = [];
  for (const term of terms) {
    const { termKey, termValue, verificationStatus } = term;

    const existing = await db
      .select()
      .from(firmTermsTable)
      .where(and(eq(firmTermsTable.lawFirmId, id), eq(firmTermsTable.termKey, termKey)))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(firmTermsTable)
        .set({
          termValueJson: termValue,
          verificationStatus: verificationStatus ?? existing[0].verificationStatus,
        })
        .where(and(eq(firmTermsTable.lawFirmId, id), eq(firmTermsTable.termKey, termKey)))
        .returning();
      results.push(updated);
    } else {
      const [created] = await db
        .insert(firmTermsTable)
        .values({
          lawFirmId: id,
          termKey,
          termValueJson: termValue,
          verificationStatus: verificationStatus ?? "draft",
          sourceType: "manual",
        })
        .returning();
      results.push(created);
    }
  }

  res.json(results.map(termToResponse));
});

export default router;
