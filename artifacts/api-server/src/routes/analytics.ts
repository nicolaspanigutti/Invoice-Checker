import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

router.get(
  "/analytics",
  requireRole("super_admin", "legal_ops", "internal_lawyer"),
  async (_req: Request, res: Response) => {
    try {
      const [summary, roiSummary, recoveryByMonth, rejectedVsAcknowledgedByMonth, issuesByRule, issuesByStatus, byFirm, byJurisdiction, byBillingType] =
        await Promise.all([
          // ── Summary KPIs ──────────────────────────────────────────────
          db.execute(sql`
            SELECT
              COUNT(*)::int                                                        AS total_invoices,
              COUNT(*) FILTER (WHERE invoice_status = 'accepted')::int            AS accepted_invoices,
              COUNT(*) FILTER (WHERE invoice_status = 'disputed')::int            AS disputed_invoices,
              COUNT(*) FILTER (WHERE invoice_status IN ('in_review','escalated'))::int AS in_progress_invoices,
              COALESCE(SUM(total_amount),0)::numeric                              AS total_amount_reviewed,
              COALESCE(SUM(confirmed_recovery),0)::numeric                        AS total_confirmed_recovery,
              COALESCE(SUM(amount_at_risk),0)::numeric                            AS total_amount_at_risk
            FROM invoices
            WHERE invoice_status != 'pending'
          `),

          // ── ROI / recovery funnel ─────────────────────────────────────
          db.execute(sql`
            SELECT
              -- Value detected: sum of recoverable_amount across ALL issues from completed runs
              COALESCE(SUM(i.recoverable_amount),0)::numeric                        AS total_detected_value,
              -- Rejected by our team (confirmed billing errors we dispute with the firm)
              COALESCE(SUM(i.recoverable_amount) FILTER (
                WHERE i.issue_status IN ('rejected_by_legal_ops','rejected_by_internal_lawyer')
              ),0)::numeric                                                          AS total_rejected_value,
              COUNT(*) FILTER (
                WHERE i.issue_status IN ('rejected_by_legal_ops','rejected_by_internal_lawyer')
              )::int                                                                 AS rejected_count,
              -- Acknowledged by the firm (net recovery actually received/confirmed by firm)
              COALESCE(SUM(i.recoverable_amount) FILTER (
                WHERE i.firm_acknowledged = true
              ),0)::numeric                                                          AS total_acknowledged_value,
              COUNT(*) FILTER (WHERE i.firm_acknowledged = true)::int               AS acknowledged_count
            FROM issues i
            JOIN analysis_runs ar ON ar.id = i.analysis_run_id
            WHERE ar.status = 'complete'
          `),

          // ── Recovery & volume by month ────────────────────────────────
          db.execute(sql`
            SELECT
              TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')  AS month,
              COUNT(*)::int                                          AS invoice_count,
              COALESCE(SUM(total_amount),0)::numeric                AS amount_reviewed,
              COALESCE(SUM(confirmed_recovery),0)::numeric          AS confirmed_recovery,
              COALESCE(SUM(amount_at_risk),0)::numeric              AS amount_at_risk
            FROM invoices
            WHERE invoice_status != 'pending'
              AND created_at >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', created_at)
            ORDER BY DATE_TRUNC('month', created_at)
          `),

          // ── Rejected vs Firm-Acknowledged by month ────────────────────
          db.execute(sql`
            SELECT
              TO_CHAR(DATE_TRUNC('month', i.created_at), 'YYYY-MM')  AS month,
              COALESCE(SUM(i.recoverable_amount) FILTER (
                WHERE i.issue_status IN ('rejected_by_legal_ops','rejected_by_internal_lawyer')
              ),0)::numeric   AS rejected_value,
              COALESCE(SUM(i.recoverable_amount) FILTER (
                WHERE i.firm_acknowledged = true
              ),0)::numeric   AS acknowledged_value,
              COUNT(*) FILTER (
                WHERE i.issue_status IN ('rejected_by_legal_ops','rejected_by_internal_lawyer')
              )::int          AS rejected_count,
              COUNT(*) FILTER (WHERE i.firm_acknowledged = true)::int AS acknowledged_count
            FROM issues i
            JOIN analysis_runs ar ON ar.id = i.analysis_run_id
            WHERE ar.status = 'complete'
              AND i.created_at >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', i.created_at)
            ORDER BY DATE_TRUNC('month', i.created_at)
          `),

          // ── Issues by rule code ───────────────────────────────────────
          db.execute(sql`
            SELECT
              i.rule_code,
              i.severity,
              i.evaluator_type,
              COUNT(*)::int                                           AS issue_count,
              COALESCE(SUM(i.recoverable_amount),0)::numeric         AS total_recoverable,
              COUNT(*) FILTER (
                WHERE i.issue_status IN ('rejected_by_legal_ops','rejected_by_internal_lawyer')
              )::int                                                  AS confirmed_count,
              COUNT(*) FILTER (
                WHERE i.issue_status IN ('accepted_by_legal_ops','accepted_by_internal_lawyer')
              )::int                                                  AS false_positive_count
            FROM issues i
            JOIN analysis_runs ar ON ar.id = i.analysis_run_id
            WHERE ar.status = 'complete'
            GROUP BY i.rule_code, i.severity, i.evaluator_type
            ORDER BY issue_count DESC
          `),

          // ── Issues by decision status ─────────────────────────────────
          db.execute(sql`
            SELECT
              issue_status,
              COUNT(*)::int AS count
            FROM issues i
            JOIN analysis_runs ar ON ar.id = i.analysis_run_id
            WHERE ar.status = 'complete'
            GROUP BY issue_status
          `),

          // ── By law firm (top 10) ──────────────────────────────────────
          // Uses two separate subqueries to avoid multiplying invoice-level
          // amounts (confirmed_recovery, amount_at_risk) when joining to issues.
          db.execute(sql`
            SELECT
              lf.id                                                         AS firm_id,
              lf.name                                                       AS firm_name,
              lf.firm_type,
              COALESCE(inv_agg.invoice_count, 0)::int                      AS invoice_count,
              COALESCE(inv_agg.total_amount, 0)::numeric                   AS total_amount,
              COALESCE(inv_agg.confirmed_recovery, 0)::numeric             AS confirmed_recovery,
              COALESCE(inv_agg.amount_at_risk, 0)::numeric                 AS amount_at_risk,
              COALESCE(iss_agg.issue_count, 0)::int                        AS issue_count,
              COALESCE(iss_agg.confirmed_issues, 0)::int                   AS confirmed_issues
            FROM law_firms lf
            LEFT JOIN (
              SELECT
                law_firm_id,
                COUNT(*)::int                                   AS invoice_count,
                SUM(total_amount::numeric)                      AS total_amount,
                SUM(confirmed_recovery::numeric)                AS confirmed_recovery,
                SUM(amount_at_risk::numeric)                    AS amount_at_risk
              FROM invoices
              WHERE invoice_status != 'pending'
              GROUP BY law_firm_id
            ) inv_agg ON inv_agg.law_firm_id = lf.id
            LEFT JOIN (
              SELECT
                inv.law_firm_id,
                COUNT(iss.id)::int                              AS issue_count,
                COUNT(iss.id) FILTER (
                  WHERE iss.issue_status IN ('rejected_by_legal_ops','rejected_by_internal_lawyer')
                )::int                                          AS confirmed_issues
              FROM invoices inv
              JOIN issues iss ON iss.invoice_id = inv.id
              WHERE inv.invoice_status != 'pending'
              GROUP BY inv.law_firm_id
            ) iss_agg ON iss_agg.law_firm_id = lf.id
            WHERE inv_agg.invoice_count IS NOT NULL
            ORDER BY inv_agg.total_amount DESC NULLS LAST
            LIMIT 10
          `),

          // ── By jurisdiction ───────────────────────────────────────────
          db.execute(sql`
            SELECT
              COALESCE(jurisdiction, 'Unknown')                       AS jurisdiction,
              COUNT(*)::int                                           AS invoice_count,
              COALESCE(SUM(total_amount),0)::numeric                 AS total_amount,
              COALESCE(SUM(confirmed_recovery),0)::numeric           AS confirmed_recovery
            FROM invoices
            WHERE invoice_status != 'pending'
            GROUP BY jurisdiction
            ORDER BY invoice_count DESC
          `),

          // ── By billing type ───────────────────────────────────────────
          db.execute(sql`
            SELECT
              COALESCE(billing_type, 'unknown')                      AS billing_type,
              COUNT(*)::int                                           AS count,
              COALESCE(SUM(total_amount),0)::numeric                 AS total_amount,
              COALESCE(SUM(confirmed_recovery),0)::numeric           AS confirmed_recovery
            FROM invoices
            WHERE invoice_status != 'pending'
            GROUP BY billing_type
          `),
        ]);

      const s = summary.rows[0] as Record<string, unknown>;
      const roi = roiSummary.rows[0] as Record<string, unknown>;

      const totalIssues = (issuesByStatus.rows as Record<string, unknown>[]).reduce(
        (acc, r) => acc + Number(r.count),
        0
      );
      const confirmedCount = (issuesByStatus.rows as Record<string, unknown>[])
        .filter(r => String(r.issue_status).includes("rejected"))
        .reduce((acc, r) => acc + Number(r.count), 0);
      const falsePositiveCount = (issuesByStatus.rows as Record<string, unknown>[])
        .filter(r => String(r.issue_status).includes("accepted"))
        .reduce((acc, r) => acc + Number(r.count), 0);
      const escalatedCount = (issuesByStatus.rows as Record<string, unknown>[])
        .filter(r => String(r.issue_status).includes("escalated"))
        .reduce((acc, r) => acc + Number(r.count), 0);

      const totalAmountReviewed = Number(s.total_amount_reviewed);
      const totalConfirmedRecovery = Number(s.total_confirmed_recovery);

      res.json({
        summary: {
          totalInvoices: Number(s.total_invoices),
          acceptedInvoices: Number(s.accepted_invoices),
          disputedInvoices: Number(s.disputed_invoices),
          inProgressInvoices: Number(s.in_progress_invoices),
          totalAmountReviewed,
          totalConfirmedRecovery,
          totalAmountAtRisk: Number(s.total_amount_at_risk),
          recoveryRate: totalAmountReviewed > 0
            ? (totalConfirmedRecovery / totalAmountReviewed) * 100
            : 0,
          totalIssues,
          confirmedIssues: confirmedCount,
          falsePositives: falsePositiveCount,
          escalatedIssues: escalatedCount,
          confirmRate: totalIssues > 0 ? (confirmedCount / totalIssues) * 100 : 0,
          escalationRate: totalIssues > 0 ? (escalatedCount / totalIssues) * 100 : 0,
        },
        roiSummary: {
          totalDetectedValue: Number(roi.total_detected_value),
          totalRejectedValue: Number(roi.total_rejected_value),
          rejectedCount: Number(roi.rejected_count),
          totalAcknowledgedValue: Number(roi.total_acknowledged_value),
          acknowledgedCount: Number(roi.acknowledged_count),
          acknowledgementRate: Number(roi.total_rejected_value) > 0
            ? (Number(roi.total_acknowledged_value) / Number(roi.total_rejected_value)) * 100
            : 0,
        },
        recoveryByMonth: (recoveryByMonth.rows as Record<string, unknown>[]).map(r => ({
          month: r.month,
          invoiceCount: Number(r.invoice_count),
          amountReviewed: Number(r.amount_reviewed),
          confirmedRecovery: Number(r.confirmed_recovery),
          amountAtRisk: Number(r.amount_at_risk),
        })),
        rejectedVsAcknowledgedByMonth: (rejectedVsAcknowledgedByMonth.rows as Record<string, unknown>[]).map(r => ({
          month: r.month,
          rejectedValue: Number(r.rejected_value),
          acknowledgedValue: Number(r.acknowledged_value),
          rejectedCount: Number(r.rejected_count),
          acknowledgedCount: Number(r.acknowledged_count),
        })),
        issuesByRule: (issuesByRule.rows as Record<string, unknown>[]).map(r => ({
          ruleCode: r.rule_code,
          severity: r.severity,
          evaluatorType: r.evaluator_type,
          issueCount: Number(r.issue_count),
          totalRecoverable: Number(r.total_recoverable),
          confirmedCount: Number(r.confirmed_count),
          falsePositiveCount: Number(r.false_positive_count),
        })),
        issuesByStatus: (issuesByStatus.rows as Record<string, unknown>[]).map(r => ({
          status: r.issue_status,
          count: Number(r.count),
        })),
        byFirm: (byFirm.rows as Record<string, unknown>[]).map(r => ({
          firmId: Number(r.firm_id),
          firmName: r.firm_name,
          firmType: r.firm_type,
          invoiceCount: Number(r.invoice_count),
          totalAmount: Number(r.total_amount),
          confirmedRecovery: Number(r.confirmed_recovery),
          amountAtRisk: Number(r.amount_at_risk),
          issueCount: Number(r.issue_count),
          confirmedIssues: Number(r.confirmed_issues),
        })),
        byJurisdiction: (byJurisdiction.rows as Record<string, unknown>[]).map(r => ({
          jurisdiction: r.jurisdiction,
          invoiceCount: Number(r.invoice_count),
          totalAmount: Number(r.total_amount),
          confirmedRecovery: Number(r.confirmed_recovery),
        })),
        byBillingType: (byBillingType.rows as Record<string, unknown>[]).map(r => ({
          billingType: r.billing_type,
          count: Number(r.count),
          totalAmount: Number(r.total_amount),
          confirmedRecovery: Number(r.confirmed_recovery),
        })),
      });
    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ error: "Failed to fetch analytics data" });
    }
  }
);

export default router;
