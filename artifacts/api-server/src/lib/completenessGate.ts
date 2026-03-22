import { db, invoicesTable, invoiceDocumentsTable, lawFirmsTable, panelBaselineDocumentsTable, firmTermsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface CompletenessIssue {
  code: string;
  message: string;
  field?: string | null;
}

export interface CompletenessResult {
  canRunAnalysis: boolean;
  blockingIssues: CompletenessIssue[];
}

export async function checkCompleteness(invoiceId: number): Promise<CompletenessResult> {
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId))
    .limit(1);

  if (!invoice) {
    return { canRunAnalysis: false, blockingIssues: [{ code: "INVOICE_NOT_FOUND", message: "Invoice not found." }] };
  }

  const issues: CompletenessIssue[] = [];

  const docs = await db
    .select()
    .from(invoiceDocumentsTable)
    .where(eq(invoiceDocumentsTable.invoiceId, invoiceId));

  const hasInvoiceFile = docs.some(d => d.documentKind === "invoice_file");
  if (!hasInvoiceFile) {
    issues.push({
      code: "REQUIRED_SOURCE_MISSING",
      message: "An invoice file (PDF, DOCX, or image) must be uploaded before analysis can run.",
      field: "invoiceFile",
    });
  }

  if (!invoice.billingType) {
    issues.push({
      code: "BILLING_TYPE_MISSING",
      message: "Billing type must be set (Time & Materials or Fixed Scope).",
      field: "billingType",
    });
  }

  if (!invoice.matterName || invoice.matterName.trim() === "") {
    issues.push({
      code: "MATTER_NAME_MISSING",
      message: "Matter name is required.",
      field: "matterName",
    });
  }

  if (invoice.lawFirmId) {
    const [firm] = await db
      .select()
      .from(lawFirmsTable)
      .where(eq(lawFirmsTable.id, invoice.lawFirmId))
      .limit(1);

    if (firm) {
      if (firm.firmType === "non_panel") {
        const hasEL = docs.some(d => d.documentKind === "engagement_letter");
        if (!hasEL) {
          issues.push({
            code: "REQUIRED_SOURCE_MISSING",
            message: "An Engagement Letter is required for non-panel firms.",
            field: "engagementLetter",
          });
        }
      }

      if (firm.firmType === "panel") {
        const [activeRatesDoc] = await db
          .select({ id: panelBaselineDocumentsTable.id })
          .from(panelBaselineDocumentsTable)
          .where(
            and(
              eq(panelBaselineDocumentsTable.documentKind, "rates"),
              eq(panelBaselineDocumentsTable.verificationStatus, "active")
            )
          )
          .limit(1);

        if (!activeRatesDoc) {
          issues.push({
            code: "REQUIRED_SOURCE_MISSING",
            message: "No active panel rate schedule exists. Activate a rate schedule before running analysis on panel firm invoices.",
            field: "panelRates",
          });
        }

        const [activeTCDoc] = await db
          .select({ id: panelBaselineDocumentsTable.id })
          .from(panelBaselineDocumentsTable)
          .where(
            and(
              eq(panelBaselineDocumentsTable.documentKind, "terms_conditions"),
              eq(panelBaselineDocumentsTable.verificationStatus, "active")
            )
          )
          .limit(1);

        if (!activeTCDoc) {
          // Also accept law-firm-level terms extracted from a T&C uploaded during firm creation
          const [firmTerm] = await db
            .select({ id: firmTermsTable.id })
            .from(firmTermsTable)
            .where(eq(firmTermsTable.lawFirmId, firm.id))
            .limit(1);

          if (!firmTerm) {
            issues.push({
              code: "REQUIRED_SOURCE_MISSING",
              message: "No Panel T&C document exists for this firm. Upload a T&C document on the Law Firm page or activate a global Panel T&C baseline.",
              field: "panelTC",
            });
          }
        }
      }
    }
  }

  return {
    canRunAnalysis: issues.length === 0,
    blockingIssues: issues,
  };
}
