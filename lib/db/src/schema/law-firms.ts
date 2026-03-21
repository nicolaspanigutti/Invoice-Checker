import { pgTable, text, serial, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const lawFirmsTable = pgTable("law_firms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  firmType: text("firm_type", { enum: ["panel", "non_panel"] }).notNull(),
  jurisdictionsJson: jsonb("jurisdictions_json").$type<string[]>().default([]),
  practiceAreasJson: jsonb("practice_areas_json").$type<string[]>().default([]),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  relationshipPartner: text("relationship_partner"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const firmTermsTable = pgTable("firm_terms", {
  id: serial("id").primaryKey(),
  lawFirmId: serial("law_firm_id").notNull().references(() => lawFirmsTable.id),
  termKey: text("term_key").notNull(),
  termValueJson: jsonb("term_value_json"),
  sourceType: text("source_type", { enum: ["manual", "ai_extracted"] }).notNull().default("manual"),
  verificationStatus: text("verification_status", { enum: ["draft", "verified"] }).notNull().default("draft"),
  sourceDocumentId: serial("source_document_id"),
  verifiedById: serial("verified_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLawFirmSchema = createInsertSchema(lawFirmsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLawFirm = z.infer<typeof insertLawFirmSchema>;
export type LawFirm = typeof lawFirmsTable.$inferSelect;
export type FirmTerm = typeof firmTermsTable.$inferSelect;
