import { pgTable, text, serial, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const panelBaselineDocumentsTable = pgTable("panel_baseline_documents", {
  id: serial("id").primaryKey(),
  documentKind: text("document_kind", { enum: ["rates", "terms_conditions"] }).notNull(),
  versionLabel: text("version_label").notNull(),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path"),
  rawText: text("raw_text"),
  extractedJson: text("extracted_json"),
  verificationStatus: text("verification_status", { enum: ["draft", "verified", "active", "archived"] }).notNull().default("draft"),
  uploadedById: serial("uploaded_by_id").references(() => usersTable.id),
  verifiedById: serial("verified_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
});

export const panelRatesTable = pgTable("panel_rates", {
  id: serial("id").primaryKey(),
  baselineDocumentId: serial("baseline_document_id").references(() => panelBaselineDocumentsTable.id),
  lawFirmName: text("law_firm_name").notNull(),
  bestFriendName: text("best_friend_name"),
  jurisdiction: text("jurisdiction").notNull(),
  roleCode: text("role_code").notNull(),
  roleLabel: text("role_label").notNull(),
  currency: text("currency").notNull(),
  maxRate: numeric("max_rate", { precision: 12, scale: 2 }).notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPanelRateSchema = createInsertSchema(panelRatesTable).omit({ id: true, createdAt: true });
export type InsertPanelRate = z.infer<typeof insertPanelRateSchema>;
export type PanelRate = typeof panelRatesTable.$inferSelect;
export type PanelBaselineDocument = typeof panelBaselineDocumentsTable.$inferSelect;
