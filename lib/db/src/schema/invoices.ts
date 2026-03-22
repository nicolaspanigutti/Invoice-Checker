import { pgTable, pgSequence, text, serial, timestamp, numeric, date, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { lawFirmsTable } from "./law-firms";
import { usersTable } from "./users";

export const invoiceNumberSeq = pgSequence("invoice_number_seq", { startWith: 2, increment: 1 });

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  lawFirmId: serial("law_firm_id").references(() => lawFirmsTable.id),
  documentType: text("document_type", { enum: ["invoice", "proforma"] }).notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date"),
  dueDate: date("due_date"),
  currency: text("currency").notNull().default("EUR"),
  subtotalAmount: numeric("subtotal_amount", { precision: 14, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }),
  billingType: text("billing_type", { enum: ["time_and_materials", "fixed_scope", "closed_scope"] }),
  matterName: text("matter_name"),
  projectReference: text("project_reference"),
  jurisdiction: text("jurisdiction"),
  applicableLaw: text("applicable_law"),
  internalRequestorId: integer("internal_requestor_id").references(() => usersTable.id),
  assignedLegalOpsId: integer("assigned_legal_ops_id").references(() => usersTable.id),
  assignedInternalLawyerId: integer("assigned_internal_lawyer_id").references(() => usersTable.id),
  invoiceStatus: text("invoice_status", {
    enum: ["pending", "in_review", "escalated", "disputed", "accepted"]
  }).notNull().default("pending"),
  reviewOutcome: text("review_outcome", {
    enum: ["clean", "accepted_with_comments", "partially_rejected", "fully_rejected"]
  }),
  amountAtRisk: numeric("amount_at_risk", { precision: 14, scale: 2 }),
  confirmedRecovery: numeric("confirmed_recovery", { precision: 14, scale: 2 }),
  currentAnalysisRunId: integer("current_analysis_run_id"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const invoiceDocumentsTable = pgTable("invoice_documents", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  documentKind: text("document_kind", { enum: ["invoice_file", "engagement_letter", "budget_estimate"] }).notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  storagePath: text("storage_path"),
  rawText: text("raw_text"),
  textHash: text("text_hash"),
  promptVersion: text("prompt_version"),
  extractedJson: text("extracted_json"),
  extractionStatus: text("extraction_status", { enum: ["pending", "done", "failed"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  sourceRunId: integer("source_run_id"),
  lineNo: integer("line_no").notNull(),
  timekeeperLabel: text("timekeeper_label"),
  roleRaw: text("role_raw"),
  roleNormalized: text("role_normalized"),
  workDate: date("work_date"),
  hours: numeric("hours", { precision: 8, scale: 2 }),
  rateCharged: numeric("rate_charged", { precision: 12, scale: 2 }),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  description: text("description"),
  isExpenseLine: boolean("is_expense_line").notNull().default(false),
  expenseType: text("expense_type"),
  billingPeriodStart: date("billing_period_start"),
  billingPeriodEnd: date("billing_period_end"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
export type InvoiceDocument = typeof invoiceDocumentsTable.$inferSelect;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;
