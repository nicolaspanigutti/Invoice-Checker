import { Router, type IRouter, type Request, type Response } from "express";
import { db, rulesConfigTable, auditEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { RULES_REGISTRY } from "../lib/rulesRegistry";

const router: IRouter = Router();

router.get("/rules", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (_req: Request, res: Response) => {
  const configs = await db.select().from(rulesConfigTable);
  const configMap = new Map(configs.map(c => [c.ruleCode, c]));

  const result = RULES_REGISTRY.map(rule => {
    const config = configMap.get(rule.code);
    return {
      code: rule.code,
      displayName: rule.displayName,
      ruleType: rule.ruleType,
      severity: rule.severity,
      scope: rule.scope,
      routeToRole: rule.routeToRole,
      description: rule.description,
      hasConfig: rule.hasConfig,
      isActive: config ? config.isActive === "true" : true,
      configJson: config?.configJson ?? null,
      updatedAt: config?.updatedAt ?? null,
    };
  });

  res.json(result);
});

router.patch("/rules/:code", requireRole("super_admin"), async (req: Request, res: Response) => {
  const code = String(req.params.code);
  const rule = RULES_REGISTRY.find(r => r.code === code);
  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const { isActive, configJson, reason } = req.body as { isActive?: boolean; configJson?: Record<string, unknown> | null; reason?: string };

  if (configJson !== undefined && configJson !== null && rule.hasConfig) {
    if (code === "MEETING_OVERSTAFFING") {
      const minAttendees = typeof configJson.min_attendees === "number" ? configJson.min_attendees : null;
      const maxAttendees = typeof configJson.max_attendees === "number" ? configJson.max_attendees : null;
      if (minAttendees !== null && (!Number.isInteger(minAttendees) || minAttendees < 1)) {
        res.status(400).json({ error: "min_attendees must be a positive integer (≥ 1)" });
        return;
      }
      if (maxAttendees !== null && (!Number.isInteger(maxAttendees) || maxAttendees < 1)) {
        res.status(400).json({ error: "max_attendees must be a positive integer (≥ 1)" });
        return;
      }
      if (minAttendees !== null && maxAttendees !== null && maxAttendees < minAttendees) {
        res.status(400).json({ error: "max_attendees must be greater than or equal to min_attendees" });
        return;
      }
    }
  }

  const [existing] = await db.select().from(rulesConfigTable).where(eq(rulesConfigTable.ruleCode, code)).limit(1);

  const beforeJson = existing
    ? { isActive: existing.isActive === "true", configJson: existing.configJson }
    : { isActive: true, configJson: null };

  const newIsActive = isActive !== undefined ? (isActive ? "true" : "false") : (existing?.isActive ?? "true");
  const newConfigJson = configJson !== undefined ? configJson : (existing?.configJson ?? null);

  let updated;
  if (existing) {
    [updated] = await db.update(rulesConfigTable).set({
      isActive: newIsActive,
      configJson: newConfigJson,
      updatedById: req.session.userId,
    }).where(eq(rulesConfigTable.ruleCode, code)).returning();
  } else {
    [updated] = await db.insert(rulesConfigTable).values({
      ruleCode: code,
      isActive: newIsActive,
      configJson: newConfigJson,
      updatedById: req.session.userId,
    }).returning();
  }

  await db.insert(auditEventsTable).values({
    entityType: "rule",
    entityId: updated.id,
    eventType: "rule_config_updated",
    actorId: req.session.userId,
    beforeJson,
    afterJson: { isActive: newIsActive === "true", configJson: newConfigJson },
    reason: reason ?? null,
  });

  res.json({
    code: rule.code,
    displayName: rule.displayName,
    ruleType: rule.ruleType,
    severity: rule.severity,
    scope: rule.scope,
    routeToRole: rule.routeToRole,
    description: rule.description,
    hasConfig: rule.hasConfig,
    isActive: updated.isActive === "true",
    configJson: updated.configJson ?? null,
    updatedAt: updated.updatedAt,
  });
});

export default router;
