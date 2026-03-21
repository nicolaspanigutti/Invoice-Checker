import { db, usersTable, lawFirmsTable, firmTermsTable, panelBaselineDocumentsTable, panelRatesTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding database with synthetic data...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid varchar NOT NULL PRIMARY KEY,
      sess json NOT NULL,
      expire timestamp(6) NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON user_sessions (expire)`);

  const password = await bcrypt.hash("password123", 12);

  await db.execute(sql`TRUNCATE TABLE 
    audit_events, comments, issue_decisions, issues, analysis_runs,
    invoice_items, invoice_documents, invoices,
    firm_terms, law_firms,
    panel_rates, panel_baseline_documents,
    user_sessions, users
    RESTART IDENTITY CASCADE`);

  const [adminUser, legalOpsUser, lawyerUser] = await db.insert(usersTable).values([
    {
      displayName: "Alexandra Morgan",
      email: "admin@arcturusgroup.com",
      passwordHash: password,
      role: "super_admin",
      isActive: true,
    },
    {
      displayName: "Daniel Whitfield",
      email: "daniel.whitfield@arcturusgroup.com",
      passwordHash: password,
      role: "legal_ops",
      isActive: true,
    },
    {
      displayName: "Sophie Cartwright",
      email: "sophie.cartwright@arcturusgroup.com",
      passwordHash: password,
      role: "internal_lawyer",
      isActive: true,
    },
  ]).returning();

  console.log("Created users:", adminUser.email, legalOpsUser.email, lawyerUser.email);

  const [panelFirmA, panelFirmB, nonPanelFirm] = await db.insert(lawFirmsTable).values([
    {
      name: "Harrington & Belmont LLP",
      firmType: "panel",
      jurisdictionsJson: ["England & Wales", "Spain"],
      practiceAreasJson: ["M&A", "Finance", "Regulatory"],
      contactName: "Oliver Harrington",
      contactEmail: "o.harrington@harrington-belmont.com",
      contactPhone: "+44 20 7000 0001",
      relationshipPartner: "Alexandra Morgan",
      notes: "Preferred panel firm for M&A and finance matters. Volume discount applies at EUR 500k threshold.",
      isActive: true,
    },
    {
      name: "Voss & Edelmann Rechtsanwälte",
      firmType: "panel",
      jurisdictionsJson: ["Germany", "Austria"],
      practiceAreasJson: ["Corporate", "Labour", "IP"],
      contactName: "Heinrich Voss",
      contactEmail: "h.voss@voss-edelmann.de",
      contactPhone: "+49 30 0000 0001",
      relationshipPartner: "Daniel Whitfield",
      notes: "Panel firm for German-law matters. Best Friend firm: Aldermans & Partners (Brussels office).",
      isActive: true,
    },
    {
      name: "Calloway Dispute Resolution",
      firmType: "non_panel",
      jurisdictionsJson: ["England & Wales"],
      practiceAreasJson: ["Dispute Resolution", "Arbitration"],
      contactName: "James Calloway",
      contactEmail: "j.calloway@calloway-dr.com",
      contactPhone: "+44 20 7000 0099",
      notes: "Engaged on a specific arbitration matter. Non-panel firm — EL mandatory for analysis.",
      isActive: true,
    },
  ]).returning();

  console.log("Created law firms:", panelFirmA.name, panelFirmB.name, nonPanelFirm.name);

  await db.insert(firmTermsTable).values([
    { lawFirmId: panelFirmA.id, termKey: "billing_type_default", termValueJson: "time_and_materials", sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "discount_type", termValueJson: "step", sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "discount_payment_type", termValueJson: "credit", sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "discount_thresholds_json", termValueJson: [{ from: 0, to: 500000, pct: 0 }, { from: 500000, to: 1000000, pct: 5 }, { from: 1000000, to: null, pct: 10 }], sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "max_daily_hours_per_timekeeper", termValueJson: 8, sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "getting_up_to_speed_billable", termValueJson: false, sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "payment_terms_days", termValueJson: 30, sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "travel_policy", termValueJson: "Business class permitted on flights exceeding 5 hours", sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "expense_policy_json", termValueJson: { allowed: ["accommodation", "travel", "court_fees", "translation"], not_allowed: ["meals", "telephone", "photocopying", "secretarial"], caps: { accommodation: 300 } }, sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "third_party_services_require_approval", termValueJson: true, sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "contract_start_date", termValueJson: "2024-01-01", sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmA.id, termKey: "contract_end_date", termValueJson: "2026-12-31", sourceType: "manual", verificationStatus: "verified" },

    { lawFirmId: panelFirmB.id, termKey: "billing_type_default", termValueJson: "time_and_materials", sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmB.id, termKey: "discount_type", termValueJson: "tiered", sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmB.id, termKey: "max_daily_hours_per_timekeeper", termValueJson: 8, sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmB.id, termKey: "payment_terms_days", termValueJson: 45, sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmB.id, termKey: "contract_start_date", termValueJson: "2023-06-01", sourceType: "manual", verificationStatus: "verified" },
    { lawFirmId: panelFirmB.id, termKey: "best_friend_firms_json", termValueJson: ["Aldermans & Partners"], sourceType: "manual", verificationStatus: "verified" },
  ]);

  const [ratesDoc] = await db.insert(panelBaselineDocumentsTable).values({
    documentKind: "rates",
    versionLabel: "Panel Rates 2024 v2.1",
    fileName: "Panel_Rates_2024_v2.1_SYNTHETIC.pdf",
    verificationStatus: "active",
    uploadedById: adminUser.id,
    activatedAt: new Date("2024-01-15"),
  }).returning();

  await db.insert(panelRatesTable).values([
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Harrington & Belmont LLP", jurisdiction: "England & Wales", roleCode: "Partner", roleLabel: "Partner", currency: "EUR", maxRate: "850.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Harrington & Belmont LLP", jurisdiction: "England & Wales", roleCode: "Senior Associate", roleLabel: "Senior Associate", currency: "EUR", maxRate: "650.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Harrington & Belmont LLP", jurisdiction: "England & Wales", roleCode: "Associate 3rd year", roleLabel: "Associate 3rd year", currency: "EUR", maxRate: "480.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Harrington & Belmont LLP", jurisdiction: "England & Wales", roleCode: "Legal Trainee", roleLabel: "Legal Trainee", currency: "EUR", maxRate: "180.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Harrington & Belmont LLP", jurisdiction: "Spain", roleCode: "Partner", roleLabel: "Partner", currency: "EUR", maxRate: "780.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Harrington & Belmont LLP", jurisdiction: "Spain", roleCode: "Senior Associate", roleLabel: "Senior Associate", currency: "EUR", maxRate: "580.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Voss & Edelmann Rechtsanwälte", jurisdiction: "Germany", roleCode: "Partner", roleLabel: "Partner", currency: "EUR", maxRate: "820.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Voss & Edelmann Rechtsanwälte", jurisdiction: "Germany", roleCode: "Senior Associate", roleLabel: "Senior Associate", currency: "EUR", maxRate: "620.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Voss & Edelmann Rechtsanwälte", jurisdiction: "Germany", roleCode: "Associate 3rd year", roleLabel: "Associate 3rd year", currency: "EUR", maxRate: "440.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
    { baselineDocumentId: ratesDoc.id, lawFirmName: "Aldermans & Partners", jurisdiction: "Belgium", roleCode: "Partner", roleLabel: "Partner", currency: "EUR", maxRate: "790.00", validFrom: "2024-01-01", validTo: "2025-12-31" },
  ]);

  console.log("Seed completed successfully.");
  console.log("\nTest credentials:");
  console.log("  Super Admin: admin@arcturusgroup.com / password123");
  console.log("  Legal Ops:   daniel.whitfield@arcturusgroup.com / password123");
  console.log("  Int. Lawyer: sophie.cartwright@arcturusgroup.com / password123");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
