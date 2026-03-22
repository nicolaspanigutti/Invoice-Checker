import { db, invoicesTable, issuesTable, auditEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type InvoiceStatus = typeof invoicesTable.$inferSelect["invoiceStatus"];
type ReviewOutcome = typeof invoicesTable.$inferSelect["reviewOutcome"];

const ACCEPTED_STATUSES = new Set([
  "accepted_by_legal_ops",
  "accepted_by_internal_lawyer",
  "no_longer_applicable",
]);

const REJECTED_STATUSES = new Set([
  "rejected_by_legal_ops",
  "rejected_by_internal_lawyer",
]);

export async function evaluateInvoiceState(
  invoiceId: number,
  actorId: number | null,
  reason?: string,
): Promise<{ newStatus: InvoiceStatus; outcome: ReviewOutcome | null }> {
  const invoice = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId))
    .then(r => r[0]);

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const issues = await db
    .select({ issueStatus: issuesTable.issueStatus })
    .from(issuesTable)
    .where(eq(issuesTable.invoiceId, invoiceId));

  const oldStatus = invoice.invoiceStatus;

  const hasEscalated = issues.some(i => i.issueStatus === "escalated_to_internal_lawyer");
  const hasOpen = issues.some(i => i.issueStatus === "open");
  const hasRejected = issues.some(i => REJECTED_STATUSES.has(i.issueStatus));
  const allDecided = issues.length > 0 && !hasOpen && !hasEscalated;
  const allAccepted = allDecided && !hasRejected;

  let newStatus: InvoiceStatus = oldStatus;
  let outcome: ReviewOutcome | null = invoice.reviewOutcome ?? null;

  if (issues.length === 0) {
    newStatus = "ready_to_pay";
    outcome = "clean";
  } else if (hasEscalated) {
    newStatus = "waiting_internal_lawyer";
    outcome = null;
  } else if (hasOpen) {
    newStatus = "in_review";
    outcome = null;
  } else if (allDecided) {
    if (hasRejected) {
      const allRejected = issues.every(i => REJECTED_STATUSES.has(i.issueStatus));
      outcome = allRejected ? "fully_rejected" : "partially_rejected";
      newStatus = "pending_law_firm";
    } else if (allAccepted) {
      outcome = "accepted_with_comments";
      newStatus = "ready_to_pay";
    }
  }

  if (newStatus !== oldStatus || outcome !== invoice.reviewOutcome) {
    await db
      .update(invoicesTable)
      .set({ invoiceStatus: newStatus, reviewOutcome: outcome })
      .where(eq(invoicesTable.id, invoiceId));

    await db.insert(auditEventsTable).values({
      entityType: "invoice",
      entityId: invoiceId,
      eventType: "state_change",
      actorId,
      beforeJson: { status: oldStatus, outcome: invoice.reviewOutcome },
      afterJson: { status: newStatus, outcome },
      reason: reason ?? "issue_decision",
    });
  }

  return { newStatus, outcome };
}
