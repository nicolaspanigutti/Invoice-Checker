import { describe, it, expect } from "vitest";
import { evaluateDeterministicRules, type EvalContext, type EvalItem } from "../lib/evaluateDeterministicRules";

function allActive(_code: string): boolean { return true; }
function noneActive(_code: string): boolean { return false; }
function only(...codes: string[]): (code: string) => boolean {
  return (code: string) => codes.includes(code);
}

function makeItem(overrides: Partial<EvalItem> & { id: number; lineNo: number }): EvalItem {
  return {
    workDate: "2025-01-15",
    timekeeperLabel: "Alice Senior",
    hours: "2.00",
    rateCharged: "500.00",
    amount: "1000.00",
    isExpenseLine: false,
    expenseType: null,
    description: "Reviewing contract",
    roleRaw: "Senior Associate",
    roleNormalized: "senior_associate",
    isUnauthorized: false,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    invoiceId: 1,
    runId: 100,
    invoice: {
      currency: "GBP",
      billingType: "time_and_materials",
      totalAmount: "10000.00",
      subtotalAmount: "10000.00",
      taxAmount: "0.00",
      invoiceDate: "2025-01-31",
      jurisdiction: "England & Wales",
      matterName: "Test Matter",
      applicableLaw: null,
      lawFirmId: 42,
    },
    items: [],
    firm: { name: "Acme Law LLP", firmType: "panel", jurisdictionsJson: ["England & Wales"] },
    firmTerms: [],
    panelRates: [],
    docKinds: [],
    elData: null,
    cumulativeYtdFees: 0,
    meetingMinAttendees: 3,
    meetingMaxAttendees: 5,
    isRuleActive: allActive,
    ...overrides,
  };
}

describe("ARITHMETIC_ERROR — production pipeline trigger/clean", () => {
  it("TRIGGER: fires with correct evidence (hours × rate ≠ amount)", () => {
    const ctx = baseCtx({
      isRuleActive: only("ARITHMETIC_ERROR"),
      items: [makeItem({ id: 1, lineNo: 1, hours: "2.00", rateCharged: "500.00", amount: "900.00" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    const iss = issues[0];
    expect(iss.ruleCode).toBe("ARITHMETIC_ERROR");
    expect(iss.ruleType).toBe("objective");
    expect(iss.severity).toBe("error");
    expect(iss.routeToRole).toBe("legal_ops");
    const ev = iss.evidenceJson as Record<string, unknown>;
    expect(ev.expected_amount).toBeCloseTo(1000, 1);
    expect(ev.actual_amount).toBeCloseTo(900, 1);
    expect(ev.difference).toBeCloseTo(100, 1);
    expect(iss.recoverableAmount).toBeNull();
  });

  it("TRIGGER: overbilling sets recoverableAmount = overcharge", () => {
    const ctx = baseCtx({
      isRuleActive: only("ARITHMETIC_ERROR"),
      items: [makeItem({ id: 2, lineNo: 2, hours: "2.00", rateCharged: "500.00", amount: "1100.00" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(100, 1);
    expect(issues[0].recoveryGroupKey).toBe("arithmetic_2");
  });

  it("CLEAN: no issue when amount matches hours × rate", () => {
    const ctx = baseCtx({
      isRuleActive: only("ARITHMETIC_ERROR"),
      items: [makeItem({ id: 3, lineNo: 3, hours: "2.00", rateCharged: "500.00", amount: "1000.00" })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });

  it("CLEAN: rule inactive — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: noneActive,
      items: [makeItem({ id: 4, lineNo: 4, hours: "2.00", rateCharged: "500.00", amount: "900.00" })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("DUPLICATE_LINE — production pipeline trigger/clean", () => {
  it("TRIGGER: fires when two lines share date + timekeeper + hours + rate", () => {
    const ctx = baseCtx({
      isRuleActive: only("DUPLICATE_LINE"),
      items: [
        makeItem({ id: 10, lineNo: 1, workDate: "2025-03-01", timekeeperLabel: "Bob Jones", hours: "4.00", rateCharged: "350.00", amount: "1400.00" }),
        makeItem({ id: 11, lineNo: 2, workDate: "2025-03-01", timekeeperLabel: "Bob Jones", hours: "4.00", rateCharged: "350.00", amount: "1400.00" }),
      ],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("DUPLICATE_LINE");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.line_no_a).toBe(1);
    expect(ev.line_no_b).toBe(2);
    expect(ev.amount).toBeCloseTo(1400, 1);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(1400, 1);
  });

  it("CLEAN: different dates — no duplicate issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("DUPLICATE_LINE"),
      items: [
        makeItem({ id: 12, lineNo: 1, workDate: "2025-03-01", timekeeperLabel: "Alice", hours: "2.00", rateCharged: "500.00" }),
        makeItem({ id: 13, lineNo: 2, workDate: "2025-03-02", timekeeperLabel: "Alice", hours: "2.00", rateCharged: "500.00" }),
      ],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("DAILY_HOURS_EXCEEDED — production pipeline trigger/clean", () => {
  it("TRIGGER: fires when timekeeper exceeds daily cap", () => {
    const ctx = baseCtx({
      isRuleActive: only("DAILY_HOURS_EXCEEDED"),
      items: [
        makeItem({ id: 1, lineNo: 1, workDate: "2025-04-10", timekeeperLabel: "Dave Partner", hours: "5.00" }),
        makeItem({ id: 2, lineNo: 2, workDate: "2025-04-10", timekeeperLabel: "Dave Partner", hours: "4.50" }),
      ],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("DAILY_HOURS_EXCEEDED");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.total_hours).toBeCloseTo(9.5, 1);
    expect(ev.cap_hours).toBe(8);
    expect(ev.excess_hours).toBeCloseTo(1.5, 1);
    expect(Array.isArray(ev.affected_line_nos)).toBe(true);
  });

  it("TRIGGER: custom cap from firmTerms", () => {
    const ctx = baseCtx({
      isRuleActive: only("DAILY_HOURS_EXCEEDED"),
      firmTerms: [{ termKey: "max_daily_hours_per_timekeeper", termValueJson: 7 }],
      items: [
        makeItem({ id: 3, lineNo: 1, workDate: "2025-04-11", timekeeperLabel: "Eve", hours: "8.00" }),
      ],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.cap_hours).toBe(7);
    expect(ev.total_hours).toBeCloseTo(8, 1);
  });

  it("CLEAN: under cap — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("DAILY_HOURS_EXCEEDED"),
      items: [makeItem({ id: 4, lineNo: 1, workDate: "2025-04-12", timekeeperLabel: "Frank", hours: "6.00" })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("WRONG_CURRENCY — production pipeline trigger/clean", () => {
  it("TRIGGER: fires when invoice currency ≠ agreed currency", () => {
    const ctx = baseCtx({
      isRuleActive: only("WRONG_CURRENCY"),
      invoice: { ...baseCtx().invoice, currency: "EUR" },
      firmTerms: [{ termKey: "agreed_currency", termValueJson: "GBP" }],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("WRONG_CURRENCY");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.invoice_currency).toBe("EUR");
    expect(ev.agreed_currency).toBe("GBP");
    expect(ev.source_document).toBe("Panel T&C");
  });

  it("CLEAN: matching currencies — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("WRONG_CURRENCY"),
      firmTerms: [{ termKey: "agreed_currency", termValueJson: "GBP" }],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("TAX_OR_VAT_MISMATCH — production pipeline trigger/clean", () => {
  it("TRIGGER: subtotal + tax ≠ total fires with evidence", () => {
    const ctx = baseCtx({
      isRuleActive: only("TAX_OR_VAT_MISMATCH"),
      invoice: { ...baseCtx().invoice, totalAmount: "11500.00", subtotalAmount: "10000.00", taxAmount: "2000.00" },
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("TAX_OR_VAT_MISMATCH");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.difference).toBeCloseTo(500, 1);
    expect(issues[0].recoverableAmount).toBeNull();
  });

  it("TRIGGER: overbilling = recoverableAmount", () => {
    const ctx = baseCtx({
      isRuleActive: only("TAX_OR_VAT_MISMATCH"),
      invoice: { ...baseCtx().invoice, totalAmount: "12500.00", subtotalAmount: "10000.00", taxAmount: "2000.00" },
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(500, 1);
  });

  it("CLEAN: correct arithmetic — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("TAX_OR_VAT_MISMATCH"),
      invoice: { ...baseCtx().invoice, totalAmount: "12000.00", subtotalAmount: "10000.00", taxAmount: "2000.00" },
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("FIXED_SCOPE_AMOUNT_MISMATCH — production pipeline trigger/clean", () => {
  it("TRIGGER: invoice total > agreed fee fires with excess recovery", () => {
    const ctx = baseCtx({
      isRuleActive: only("FIXED_SCOPE_AMOUNT_MISMATCH"),
      invoice: { ...baseCtx().invoice, billingType: "fixed_scope", totalAmount: "55000.00" },
      docKinds: ["engagement_letter"],
      elData: { totalAmount: "50000" },
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("FIXED_SCOPE_AMOUNT_MISMATCH");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.excess_amount).toBeCloseTo(5000, 1);
    expect(ev.agreed_fee).toBeCloseTo(50000, 1);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(5000, 1);
    expect(issues[0].recoveryGroupKey).toBe("fixed_scope_excess_1");
  });

  it("CLEAN: invoice total ≤ agreed fee — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("FIXED_SCOPE_AMOUNT_MISMATCH"),
      invoice: { ...baseCtx().invoice, billingType: "fixed_scope", totalAmount: "50000.00" },
      docKinds: ["engagement_letter"],
      elData: { totalAmount: "50000" },
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("MISSING_DOCUMENTS_FIXED_SCOPE — production pipeline trigger/clean", () => {
  it("TRIGGER: fixed scope without EL document", () => {
    const ctx = baseCtx({
      isRuleActive: only("MISSING_DOCUMENTS_FIXED_SCOPE"),
      invoice: { ...baseCtx().invoice, billingType: "fixed_scope" },
      docKinds: [],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("MISSING_DOCUMENTS_FIXED_SCOPE");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.billing_type).toBe("fixed_scope");
  });

  it("CLEAN: EL present — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("MISSING_DOCUMENTS_FIXED_SCOPE"),
      invoice: { ...baseCtx().invoice, billingType: "fixed_scope" },
      docKinds: ["engagement_letter"],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("LINE_ITEMS_IN_FIXED_SCOPE — production pipeline trigger/clean", () => {
  it("TRIGGER: hourly line items present in fixed scope", () => {
    const ctx = baseCtx({
      isRuleActive: only("LINE_ITEMS_IN_FIXED_SCOPE"),
      invoice: { ...baseCtx().invoice, billingType: "fixed_scope" },
      items: [
        makeItem({ id: 1, lineNo: 1, hours: "3.00", rateCharged: "500.00" }),
        makeItem({ id: 2, lineNo: 2, hours: "2.00", rateCharged: "400.00" }),
      ],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("LINE_ITEMS_IN_FIXED_SCOPE");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.line_item_count).toBe(2);
  });

  it("CLEAN: time & materials — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("LINE_ITEMS_IN_FIXED_SCOPE"),
      items: [makeItem({ id: 3, lineNo: 3, hours: "3.00", rateCharged: "500.00" })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("UNAUTHORIZED_EXPENSE_TYPE — production pipeline trigger/clean", () => {
  it("TRIGGER: unlisted expense type fires — full amount recoverable", () => {
    const ctx = baseCtx({
      isRuleActive: only("UNAUTHORIZED_EXPENSE_TYPE"),
      firmTerms: [{ termKey: "expense_policy_json", termValueJson: { taxi: {}, hotel: {} } }],
      items: [makeItem({
        id: 1, lineNo: 1, isExpenseLine: true, expenseType: "Chauffeur Service",
        amount: "350.00", hours: null, rateCharged: null,
      })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("UNAUTHORIZED_EXPENSE_TYPE");
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(350, 1);
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.expense_type).toBe("Chauffeur Service");
  });

  it("CLEAN: authorized expense type — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("UNAUTHORIZED_EXPENSE_TYPE"),
      firmTerms: [{ termKey: "expense_policy_json", termValueJson: { taxi: {}, hotel: {} } }],
      items: [makeItem({ id: 2, lineNo: 2, isExpenseLine: true, expenseType: "Taxi", hours: null, rateCharged: null })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("EXPENSE_CAP_EXCEEDED — production pipeline trigger/clean", () => {
  it("TRIGGER: expense exceeds cap — excess recoverable", () => {
    const ctx = baseCtx({
      isRuleActive: only("EXPENSE_CAP_EXCEEDED"),
      firmTerms: [{ termKey: "expense_policy_json", termValueJson: { hotel: { cap: 200 } } }],
      items: [makeItem({
        id: 1, lineNo: 1, isExpenseLine: true, expenseType: "Hotel",
        amount: "450.00", hours: null, rateCharged: null,
      })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("EXPENSE_CAP_EXCEEDED");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.cap_amount).toBe(200);
    expect(ev.excess_amount).toBeCloseTo(250, 1);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(250, 1);
  });

  it("CLEAN: expense within cap — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("EXPENSE_CAP_EXCEEDED"),
      firmTerms: [{ termKey: "expense_policy_json", termValueJson: { hotel: { cap: 500 } } }],
      items: [makeItem({ id: 2, lineNo: 2, isExpenseLine: true, expenseType: "Hotel", amount: "350.00", hours: null, rateCharged: null })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("BILLING_PERIOD_OUTSIDE_EL — production pipeline trigger/clean", () => {
  it("TRIGGER: work date before EL start — fires with evidence", () => {
    const ctx = baseCtx({
      isRuleActive: only("BILLING_PERIOD_OUTSIDE_EL"),
      elData: { billingPeriodStart: "2025-01-01", billingPeriodEnd: "2025-12-31" },
      items: [makeItem({ id: 1, lineNo: 1, workDate: "2024-12-15" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("BILLING_PERIOD_OUTSIDE_EL");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.el_start).toBe("2025-01-01");
    expect(ev.el_end).toBe("2025-12-31");
    expect(Array.isArray(ev.affected_line_nos)).toBe(true);
  });

  it("TRIGGER: work date after EL end", () => {
    const ctx = baseCtx({
      isRuleActive: only("BILLING_PERIOD_OUTSIDE_EL"),
      elData: { billingPeriodStart: "2025-01-01", billingPeriodEnd: "2025-06-30" },
      items: [makeItem({ id: 2, lineNo: 2, workDate: "2025-08-01" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("BILLING_PERIOD_OUTSIDE_EL");
  });

  it("CLEAN: all work within EL period — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("BILLING_PERIOD_OUTSIDE_EL"),
      elData: { billingPeriodStart: "2025-01-01", billingPeriodEnd: "2025-12-31" },
      items: [makeItem({ id: 3, lineNo: 3, workDate: "2025-06-15" })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER — production pipeline trigger/clean", () => {
  it("TRIGGER: two rates for the same timekeeper — fires with excess amount", () => {
    const ctx = baseCtx({
      isRuleActive: only("INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER"),
      items: [
        makeItem({ id: 1, lineNo: 1, timekeeperLabel: "Grace QC", rateCharged: "800.00", hours: "2.00", amount: "1600.00" }),
        makeItem({ id: 2, lineNo: 2, timekeeperLabel: "Grace QC", rateCharged: "750.00", hours: "3.00", amount: "2250.00" }),
      ],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(Array.isArray(ev.rates_observed)).toBe(true);
    expect((ev.rates_observed as string[]).length).toBeGreaterThanOrEqual(2);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(100, 1);
  });

  it("CLEAN: single consistent rate — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER"),
      items: [
        makeItem({ id: 3, lineNo: 3, timekeeperLabel: "Henry", rateCharged: "600.00" }),
        makeItem({ id: 4, lineNo: 4, timekeeperLabel: "Henry", rateCharged: "600.00" }),
      ],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("LAWYER_ROLE_MISMATCH — production pipeline trigger/clean", () => {
  it("TRIGGER: unrecognised role label fires", () => {
    const ctx = baseCtx({
      isRuleActive: only("LAWYER_ROLE_MISMATCH"),
      items: [makeItem({ id: 1, lineNo: 1, roleRaw: "Executive Director (Legal)", roleNormalized: null, isUnauthorized: false, amount: "2000.00" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("LAWYER_ROLE_MISMATCH");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.role_raw).toBe("Executive Director (Legal)");
    expect(ev.is_unauthorised_role).toBe(false);
  });

  it("TRIGGER: unauthorized (machine) role is fully recoverable", () => {
    const ctx = baseCtx({
      isRuleActive: only("LAWYER_ROLE_MISMATCH"),
      items: [makeItem({ id: 2, lineNo: 2, roleRaw: "AI Translation Tool", roleNormalized: null, isUnauthorized: true, amount: "500.00" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(500, 1);
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.is_unauthorised_role).toBe(true);
  });

  it("CLEAN: recognised role — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("LAWYER_ROLE_MISMATCH"),
      items: [makeItem({ id: 3, lineNo: 3, roleRaw: "Partner", roleNormalized: "partner", isUnauthorized: false })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("RATE_EXCESS — production pipeline trigger/clean", () => {
  it("TRIGGER: charged > max approved rate — fires with per-hour and total excess", () => {
    const ctx = baseCtx({
      isRuleActive: only("RATE_EXCESS"),
      panelRates: [{
        r: {
          roleCode: "senior_associate",
          lawFirmName: "Acme Law LLP",
          jurisdiction: "England & Wales",
          currency: "GBP",
          maxRate: "500.00",
          validFrom: "2020-01-01",
          validTo: null,
        },
      }],
      items: [makeItem({ id: 1, lineNo: 1, rateCharged: "650.00", hours: "3.00", amount: "1950.00" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("RATE_EXCESS");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.rate_charged).toBeCloseTo(650, 1);
    expect(ev.max_rate).toBeCloseTo(500, 1);
    expect(ev.excess_per_hour).toBeCloseTo(150, 1);
    expect(ev.excess_total).toBeCloseTo(450, 1);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(450, 1);
  });

  it("CLEAN: rate within approved limit — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("RATE_EXCESS"),
      panelRates: [{
        r: {
          roleCode: "senior_associate",
          lawFirmName: "Acme Law LLP",
          jurisdiction: "England & Wales",
          currency: "GBP",
          maxRate: "700.00",
          validFrom: "2020-01-01",
          validTo: null,
        },
      }],
      items: [makeItem({ id: 2, lineNo: 2, rateCharged: "650.00" })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("RATE_CARD_EXPIRED_OR_MISSING — production pipeline trigger/clean", () => {
  it("TRIGGER: missing rate card for panel firm — fires with reason=missing", () => {
    const ctx = baseCtx({
      isRuleActive: only("RATE_CARD_EXPIRED_OR_MISSING"),
      items: [makeItem({ id: 1, lineNo: 1, roleNormalized: "senior_associate" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("RATE_CARD_EXPIRED_OR_MISSING");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.reason).toBe("missing");
    expect(ev.law_firm).toBe("Acme Law LLP");
  });

  it("TRIGGER: expired rate card — fires with reason=expired", () => {
    const ctx = baseCtx({
      isRuleActive: only("RATE_CARD_EXPIRED_OR_MISSING"),
      panelRates: [{
        r: {
          roleCode: "senior_associate",
          lawFirmName: "Acme Law LLP",
          jurisdiction: "England & Wales",
          currency: "GBP",
          maxRate: "500.00",
          validFrom: "2022-01-01",
          validTo: "2024-12-31",
        },
      }],
      items: [makeItem({ id: 2, lineNo: 2, roleNormalized: "senior_associate" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.reason).toBe("expired");
    expect(ev.latest_valid_to_in_system).toBe("2024-12-31");
  });

  it("CLEAN: valid active rate card — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("RATE_CARD_EXPIRED_OR_MISSING"),
      panelRates: [{
        r: {
          roleCode: "senior_associate",
          lawFirmName: "Acme Law LLP",
          jurisdiction: "England & Wales",
          currency: "GBP",
          maxRate: "500.00",
          validFrom: "2020-01-01",
          validTo: null,
        },
      }],
      items: [makeItem({ id: 3, lineNo: 3, roleNormalized: "senior_associate" })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("MEETING_OVERSTAFFING — production pipeline trigger/clean (configurable)", () => {
  it("TRIGGER: 6 timekeepers for same meeting day > max 4 — fires with config snapshot", () => {
    const ctx = baseCtx({
      isRuleActive: only("MEETING_OVERSTAFFING"),
      meetingMaxAttendees: 4,
      meetingMinAttendees: 2,
      items: Array.from({ length: 6 }, (_, i) =>
        makeItem({
          id: i + 1, lineNo: i + 1,
          workDate: "2025-05-20",
          timekeeperLabel: `Lawyer ${i + 1}`,
          description: "Strategy meeting with client",
        })
      ),
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("MEETING_OVERSTAFFING");
    expect(issues[0].ruleType).toBe("configurable");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.attendee_count).toBe(6);
    expect(ev.max_attendees_threshold).toBe(4);
    expect(issues[0].configSnapshotJson).toMatchObject({ min_attendees: 2, max_attendees: 4 });
  });

  it("CLEAN: attendee count within threshold — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("MEETING_OVERSTAFFING"),
      meetingMaxAttendees: 5,
      meetingMinAttendees: 3,
      items: Array.from({ length: 3 }, (_, i) =>
        makeItem({ id: i + 1, lineNo: i + 1, workDate: "2025-05-21", timekeeperLabel: `Attendee ${i + 1}`, description: "Client call" })
      ),
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("MISSING_LINE_DETAIL — production pipeline trigger/clean (warning)", () => {
  it("TRIGGER: invoice with no dates/hours/rates fires warning", () => {
    const ctx = baseCtx({
      isRuleActive: only("MISSING_LINE_DETAIL"),
      items: [makeItem({ id: 1, lineNo: 1, workDate: null, hours: null, rateCharged: null, amount: "5000.00" })],
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("MISSING_LINE_DETAIL");
    expect(issues[0].ruleType).toBe("warning");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.summary_only).toBe(true);
  });

  it("CLEAN: line detail present — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("MISSING_LINE_DETAIL"),
      items: [makeItem({ id: 2, lineNo: 2, workDate: "2025-01-10", hours: "2.00", rateCharged: "500.00" })],
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("JURISDICTION_UNCLEAR — production pipeline trigger/clean (warning)", () => {
  it("TRIGGER: no jurisdiction + multi-jurisdiction firm fires warning", () => {
    const ctx = baseCtx({
      isRuleActive: only("JURISDICTION_UNCLEAR"),
      invoice: { ...baseCtx().invoice, jurisdiction: null },
      firm: { name: "Global Law LLP", firmType: "panel", jurisdictionsJson: ["England & Wales", "New York", "Singapore"] },
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("JURISDICTION_UNCLEAR");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(Array.isArray(ev.affected_rules)).toBe(true);
  });

  it("CLEAN: jurisdiction set — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("JURISDICTION_UNCLEAR"),
      firm: { name: "Local Law LLP", firmType: "panel", jurisdictionsJson: ["England & Wales", "Singapore"] },
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("VOLUME_DISCOUNT_NOT_APPLIED — production pipeline trigger/clean", () => {
  it("TRIGGER: cumulative + invoice exceeds threshold — fires with expected_discount", () => {
    const ctx = baseCtx({
      isRuleActive: only("VOLUME_DISCOUNT_NOT_APPLIED"),
      firmTerms: [{ termKey: "discount_thresholds_json", termValueJson: [{ threshold: 200000, pct: 5, method: "step" }] }],
      cumulativeYtdFees: 190000,
      invoice: { ...baseCtx().invoice, totalAmount: "20000.00" },
    });
    const issues = evaluateDeterministicRules(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe("VOLUME_DISCOUNT_NOT_APPLIED");
    const ev = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev.discount_method).toBe("step");
    expect(ev.cumulative_with_invoice).toBeCloseTo(210000, 0);
    expect(parseFloat(issues[0].recoverableAmount as string)).toBeCloseTo(1000, 1);
  });

  it("CLEAN: below threshold — no issue", () => {
    const ctx = baseCtx({
      isRuleActive: only("VOLUME_DISCOUNT_NOT_APPLIED"),
      firmTerms: [{ termKey: "discount_thresholds_json", termValueJson: [{ threshold: 500000, pct: 5 }] }],
      cumulativeYtdFees: 50000,
      invoice: { ...baseCtx().invoice, totalAmount: "10000.00" },
    });
    expect(evaluateDeterministicRules(ctx)).toHaveLength(0);
  });
});

describe("Rule deactivation — all 17 objective rules respect isRuleActive=false", () => {
  const rulesToTest = [
    "ARITHMETIC_ERROR",
    "DUPLICATE_LINE",
    "DAILY_HOURS_EXCEEDED",
    "WRONG_CURRENCY",
    "TAX_OR_VAT_MISMATCH",
    "FIXED_SCOPE_AMOUNT_MISMATCH",
    "MISSING_DOCUMENTS_FIXED_SCOPE",
    "LINE_ITEMS_IN_FIXED_SCOPE",
    "UNAUTHORIZED_EXPENSE_TYPE",
    "EXPENSE_CAP_EXCEEDED",
    "BILLING_PERIOD_OUTSIDE_EL",
    "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER",
    "LAWYER_ROLE_MISMATCH",
    "RATE_EXCESS",
    "RATE_CARD_EXPIRED_OR_MISSING",
    "MEETING_OVERSTAFFING",
    "VOLUME_DISCOUNT_NOT_APPLIED",
    "MISSING_LINE_DETAIL",
    "JURISDICTION_UNCLEAR",
  ];

  for (const ruleCode of rulesToTest) {
    it(`${ruleCode}: inactive rule produces no issues`, () => {
      const ctx = baseCtx({
        isRuleActive: (code: string) => code !== ruleCode,
        items: [
          makeItem({ id: 1, lineNo: 1, hours: "2.00", rateCharged: "500.00", amount: "900.00" }),
          makeItem({ id: 2, lineNo: 2, hours: "2.00", rateCharged: "500.00", amount: "900.00", workDate: "2025-01-15", timekeeperLabel: "Alice Senior" }),
        ],
        firmTerms: [
          { termKey: "agreed_currency", termValueJson: "EUR" },
          { termKey: "expense_policy_json", termValueJson: { taxi: {} } },
          { termKey: "discount_thresholds_json", termValueJson: [{ threshold: 100, pct: 5 }] },
        ],
        invoice: { ...baseCtx().invoice, billingType: "fixed_scope", totalAmount: "55000.00", subtotalAmount: "10000.00", taxAmount: "2000.00", jurisdiction: null },
        elData: { billingPeriodStart: "2025-06-01", billingPeriodEnd: "2025-12-31", totalAmount: "50000" },
        docKinds: [],
        firm: { name: "Acme Law LLP", firmType: "panel", jurisdictionsJson: ["England & Wales", "Singapore"] },
        cumulativeYtdFees: 200000,
        meetingMaxAttendees: 1,
      });
      const issues = evaluateDeterministicRules(ctx);
      const ruleIssues = issues.filter(i => i.ruleCode === ruleCode);
      expect(ruleIssues).toHaveLength(0);
    });
  }
});
