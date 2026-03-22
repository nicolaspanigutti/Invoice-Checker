import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable, invoiceItemsTable } from "./invoices";
import { usersTable } from "./users";

export const analysisRunsTable = pgTable("analysis_runs", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  versionNo: integer("version_no").notNull().default(1),
  triggerReason: text("trigger_reason"),
  status: text("status", { enum: ["running", "completed", "failed", "obsolete"] }).notNull().default("running"),
  inputHash: text("input_hash"),
  extractionPromptVersion: text("extraction_prompt_version"),
  heuristicPromptVersion: text("heuristic_prompt_version"),
  startedById: integer("started_by_id").references(() => usersTable.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  summaryJson: jsonb("summary_json"),
});

export const issuesTable = pgTable("issues", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  analysisRunId: integer("analysis_run_id").references(() => analysisRunsTable.id),
  invoiceItemId: integer("invoice_item_id").references(() => invoiceItemsTable.id),
  ruleCode: text("rule_code").notNull(),
  ruleType: text("rule_type", { enum: ["objective", "gray", "configurable", "metadata", "warning"] }).notNull(),
  severity: text("severity", { enum: ["error", "warning"] }).notNull(),
  evaluatorType: text("evaluator_type", { enum: ["deterministic", "heuristic"] }).notNull(),
  issueStatus: text("issue_status", {
    enum: [
      "open",
      "accepted_by_legal_ops",
      "rejected_by_legal_ops",
      "escalated_to_internal_lawyer",
      "accepted_by_internal_lawyer",
      "rejected_by_internal_lawyer",
      "no_longer_applicable"
    ]
  }).notNull().default("open"),
  routeToRole: text("route_to_role", { enum: ["legal_ops", "internal_lawyer"] }).notNull(),
  explanationText: text("explanation_text").notNull(),
  evidenceJson: jsonb("evidence_json"),
  suggestedAction: text("suggested_action"),
  recoverableAmount: numeric("recoverable_amount", { precision: 14, scale: 2 }),
  recoveryGroupKey: text("recovery_group_key"),
  configSnapshotJson: jsonb("config_snapshot_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const issueDecisionsTable = pgTable("issue_decisions", {
  id: serial("id").primaryKey(),
  issueId: integer("issue_id").notNull().references(() => issuesTable.id),
  actorId: integer("actor_id").references(() => usersTable.id),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  issueId: integer("issue_id").references(() => issuesTable.id),
  invoiceItemId: integer("invoice_item_id").references(() => invoiceItemsTable.id),
  commentScope: text("comment_scope", {
    enum: ["general", "issue_inline", "line_inline", "escalation", "decision"]
  }).notNull(),
  authorId: integer("author_id").references(() => usersTable.id),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  actorId: integer("actor_id").references(() => usersTable.id),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rulesConfigTable = pgTable("rules_config", {
  id: serial("id").primaryKey(),
  ruleCode: text("rule_code").notNull().unique(),
  isActive: text("is_active").notNull().default("true"),
  configJson: jsonb("config_json"),
  updatedById: integer("updated_by_id").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AnalysisRun = typeof analysisRunsTable.$inferSelect;
export type Issue = typeof issuesTable.$inferSelect;
export type IssueDecision = typeof issueDecisionsTable.$inferSelect;
export type Comment = typeof commentsTable.$inferSelect;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
