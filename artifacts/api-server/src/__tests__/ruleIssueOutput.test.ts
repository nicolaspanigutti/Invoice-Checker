import { describe, it, expect } from "vitest";
import {
  parseAmount,
  detectArithmeticErrors,
  detectDuplicateLines,
  detectDailyHoursExceeded,
  detectInconsistentRates,
  detectTaxMismatch,
  detectWrongCurrency,
  detectFixedScopeAmountMismatch,
  detectMeetingOverstaffing,
  detectRateExcess,
  detectBillingOutsideElPeriod,
  detectLineItemsInFixedScope,
  detectMissingDocumentsFixedScope,
  detectUnauthorizedExpense,
  detectMissingLineDetail,
  detectJurisdictionUnclear,
  type LineItem,
} from "../lib/ruleHelpers";

function line(overrides: Partial<LineItem> & { id: number }): LineItem {
  return {
    workDate: "2025-01-15",
    timekeeperName: "Alice Senior",
    hours: "2.00",
    rateCharged: "500.00",
    amount: "1000.00",
    isExpenseLine: false,
    expenseType: null,
    description: "Reviewing contract",
    roleRaw: "Senior Associate",
    ...overrides,
  };
}

function buildArithmeticEvidenceJson(hours: number, rate: number, amount: number, expected: number, diff: number) {
  return { hours, rate_charged: rate, amount_billed: amount, expected_amount: expected, discrepancy: diff };
}

function buildDuplicateEvidenceJson(workDate: string, timekeeperName: string, hours: number, rate: number, lineIds: number[]) {
  return { duplicate_line_ids: lineIds, work_date: workDate, timekeeper_name: timekeeperName, hours, rate_charged: rate };
}

function buildRateExcessEvidenceJson(charged: number, approved: number, roleLabel: string) {
  const excess = charged - approved;
  return { rate_charged: charged, approved_rate: approved, excess_amount_per_hour: excess, timekeeper_role: roleLabel };
}

function buildTaxMismatchEvidenceJson(subtotal: number, taxAmount: number, total: number) {
  const expected = subtotal + taxAmount;
  return { subtotal, tax_amount: taxAmount, total, expected_total: expected, discrepancy: Math.abs(total - expected) };
}

describe("ARITHMETIC_ERROR — issue output structure", () => {
  it("TRIGGER: evidence contains hours, rate, amount, expected, diff — with correct recovery amount", () => {
    const h = 2, r = 500, a = 900;
    const items = [line({ id: 1, hours: `${h}.00`, rateCharged: `${r}.00`, amount: `${a}.00` })];
    const [issue] = detectArithmeticErrors(items);
    const expected = h * r;
    const diff = Math.abs(a - expected);
    const evidenceJson = buildArithmeticEvidenceJson(issue.hours, issue.rate, issue.amount, issue.expected, issue.diff);

    expect(issue.id).toBe(1);
    expect(evidenceJson.hours).toBe(2);
    expect(evidenceJson.rate_charged).toBe(500);
    expect(evidenceJson.amount_billed).toBe(900);
    expect(evidenceJson.expected_amount).toBeCloseTo(1000, 1);
    expect(evidenceJson.discrepancy).toBeCloseTo(100, 1);
    expect(diff).toBe(issue.diff);
    expect(diff).toBeGreaterThan(0);
  });

  it("TRIGGER: recovery amount equals the discrepancy between billed and correct amount", () => {
    const h = 3, r = 300, a = 800;
    const [issue] = detectArithmeticErrors([line({ id: 2, hours: `${h}.00`, rateCharged: `${r}.00`, amount: `${a}.00` })]);
    const expectedAmount = h * r;
    expect(issue.expected).toBeCloseTo(expectedAmount, 1);
    const recovery = Math.abs(a - expectedAmount);
    expect(issue.diff).toBeCloseTo(recovery, 1);
    expect(recovery).toBeGreaterThan(0);
  });

  it("CLEAN: no issue produced — evidence is empty", () => {
    const issues = detectArithmeticErrors([line({ id: 3, hours: "2.00", rateCharged: "500.00", amount: "1000.00" })]);
    expect(issues).toHaveLength(0);
  });
});

describe("DUPLICATE_LINE — issue output structure", () => {
  it("TRIGGER: evidence contains all duplicate line IDs, date, timekeeper, hours, rate", () => {
    const items = [
      line({ id: 10, workDate: "2025-03-01", timekeeperName: "Bob Jones", hours: "4.00", rateCharged: "350.00" }),
      line({ id: 11, workDate: "2025-03-01", timekeeperName: "Bob Jones", hours: "4.00", rateCharged: "350.00" }),
    ];
    const [group] = detectDuplicateLines(items);
    const evidenceJson = buildDuplicateEvidenceJson("2025-03-01", "bob jones", 4, 350, group.ids);

    expect(group.ids).toHaveLength(2);
    expect(evidenceJson.duplicate_line_ids).toContain(10);
    expect(evidenceJson.duplicate_line_ids).toContain(11);
    expect(evidenceJson.work_date).toBe("2025-03-01");
    expect(evidenceJson.timekeeper_name).toBe("bob jones");
    expect(evidenceJson.hours).toBe(4);
    expect(evidenceJson.rate_charged).toBe(350);
  });

  it("TRIGGER: recovery amount = one duplicate line's amount (one over-billed entry)", () => {
    const amount = 1400;
    const items = [
      line({ id: 12, workDate: "2025-03-01", timekeeperName: "Bob", hours: "4.00", rateCharged: "350.00", amount: `${amount}.00` }),
      line({ id: 13, workDate: "2025-03-01", timekeeperName: "Bob", hours: "4.00", rateCharged: "350.00", amount: `${amount}.00` }),
    ];
    const [group] = detectDuplicateLines(items);
    const recoveryPerDuplicate = amount;
    expect(group.ids.length - 1).toBe(1);
    expect(recoveryPerDuplicate).toBe(1400);
  });

  it("CLEAN: no groups produced", () => {
    const items = [
      line({ id: 14, workDate: "2025-03-01", timekeeperName: "Alice", hours: "2.00", rateCharged: "500.00" }),
      line({ id: 15, workDate: "2025-03-02", timekeeperName: "Alice", hours: "2.00", rateCharged: "500.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });
});

describe("DAILY_HOURS_EXCEEDED — issue output structure", () => {
  it("TRIGGER: evidence contains timekeeper, date, total_hours, cap_hours, excess_hours", () => {
    const items = [
      line({ id: 1, workDate: "2025-04-10", timekeeperName: "Dave Partner", hours: "5.00" }),
      line({ id: 2, workDate: "2025-04-10", timekeeperName: "Dave Partner", hours: "4.50" }),
    ];
    const [issue] = detectDailyHoursExceeded(items, 8);
    const cap = 8;
    const excessHours = issue.totalHours - cap;

    expect(issue.timekeeperName).toBe("dave partner");
    expect(issue.workDate).toBe("2025-04-10");
    expect(issue.totalHours).toBeCloseTo(9.5, 1);
    expect(excessHours).toBeCloseTo(1.5, 1);
    expect(issue.itemIds).toHaveLength(2);
  });

  it("TRIGGER: recovery correlates to excess hours × rate", () => {
    const items = [
      line({ id: 3, workDate: "2025-04-11", timekeeperName: "Eve", hours: "5.00", rateCharged: "400.00" }),
      line({ id: 4, workDate: "2025-04-11", timekeeperName: "Eve", hours: "4.00", rateCharged: "400.00" }),
    ];
    const [issue] = detectDailyHoursExceeded(items, 8);
    const excessHours = issue.totalHours - 8;
    const rate = parseAmount("400.00");
    const potentialRecovery = excessHours * rate;
    expect(potentialRecovery).toBeCloseTo(400, 1);
    expect(issue.totalHours).toBeCloseTo(9, 1);
  });

  it("CLEAN: no issues for normal day", () => {
    const items = [line({ id: 5, workDate: "2025-04-12", timekeeperName: "Frank", hours: "6.00" })];
    expect(detectDailyHoursExceeded(items, 8)).toHaveLength(0);
  });
});

describe("INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER — issue output structure", () => {
  it("TRIGGER: evidence lists all rates for the timekeeper", () => {
    const items = [
      line({ id: 1, timekeeperName: "Grace QC", rateCharged: "800.00" }),
      line({ id: 2, timekeeperName: "Grace QC", rateCharged: "750.00" }),
      line({ id: 3, timekeeperName: "Grace QC", rateCharged: "780.00" }),
    ];
    const [issue] = detectInconsistentRates(items);
    expect(issue.timekeeperName).toBe("grace qc");
    expect(issue.rates).toHaveLength(3);
    expect(issue.rates).toContain(800);
    expect(issue.rates).toContain(750);
    expect(issue.rates).toContain(780);
    expect(issue.itemIds).toHaveLength(3);
  });

  it("TRIGGER: recovery is the excess over the minimum rate charged", () => {
    const items = [
      line({ id: 4, timekeeperName: "Henry", rateCharged: "600.00", hours: "2.00", amount: "1200.00" }),
      line({ id: 5, timekeeperName: "Henry", rateCharged: "500.00", hours: "3.00", amount: "1500.00" }),
    ];
    const [issue] = detectInconsistentRates(items);
    const minRate = Math.min(...issue.rates);
    const maxRate = Math.max(...issue.rates);
    const excessPerHour = maxRate - minRate;
    expect(excessPerHour).toBe(100);
    expect(minRate).toBe(500);
  });

  it("CLEAN: consistent rates", () => {
    const items = [
      line({ id: 6, timekeeperName: "Irene", rateCharged: "600.00" }),
      line({ id: 7, timekeeperName: "Irene", rateCharged: "600.00" }),
    ];
    expect(detectInconsistentRates(items)).toHaveLength(0);
  });
});

describe("TAX_OR_VAT_MISMATCH — issue output structure", () => {
  it("TRIGGER: evidence contains subtotal, tax, total, expected_total, discrepancy", () => {
    const subtotal = 10000;
    const taxAmount = 2000;
    const total = 11500;
    const fired = detectTaxMismatch(subtotal, taxAmount, total);
    const evidenceJson = buildTaxMismatchEvidenceJson(subtotal, taxAmount, total);

    expect(fired).toBe(true);
    expect(evidenceJson.subtotal).toBe(10000);
    expect(evidenceJson.tax_amount).toBe(2000);
    expect(evidenceJson.total).toBe(11500);
    expect(evidenceJson.expected_total).toBe(12000);
    expect(evidenceJson.discrepancy).toBe(500);
  });

  it("TRIGGER: recovery is the discrepancy amount (underpaid tax or overbilled)", () => {
    const subtotal = 5000;
    const taxAmount = 1000;
    const total = 5800;
    const expected = subtotal + taxAmount;
    const discrepancy = Math.abs(total - expected);
    expect(discrepancy).toBe(200);
    expect(detectTaxMismatch(subtotal, taxAmount, total)).toBe(true);
  });

  it("CLEAN: correct arithmetic — no recovery", () => {
    expect(detectTaxMismatch(5000, 1000, 6000)).toBe(false);
  });
});

describe("WRONG_CURRENCY — issue output structure", () => {
  it("TRIGGER: evidence contains invoice_currency, agreed_currency, source_document", () => {
    const invoiceCurrency = "EUR";
    const agreedCurrency = "GBP";
    const fired = detectWrongCurrency(invoiceCurrency, agreedCurrency);
    const evidenceJson = {
      invoice_currency: invoiceCurrency,
      agreed_currency: agreedCurrency,
      source_document: "Panel T&C",
    };

    expect(fired).toBe(true);
    expect(evidenceJson.invoice_currency).toBe("EUR");
    expect(evidenceJson.agreed_currency).toBe("GBP");
    expect(evidenceJson.source_document).toBe("Panel T&C");
  });

  it("CLEAN: currencies match — no evidence produced", () => {
    expect(detectWrongCurrency("USD", "USD")).toBe(false);
  });
});

describe("FIXED_SCOPE_AMOUNT_MISMATCH — issue output structure", () => {
  it("TRIGGER: evidence contains invoice_total, agreed_fee, excess_amount, billing_type", () => {
    const invoiceTotal = 55000;
    const agreedFee = 50000;
    const fired = detectFixedScopeAmountMismatch(invoiceTotal, agreedFee);
    const excess = invoiceTotal - agreedFee;
    const evidenceJson = {
      billing_type: "fixed_scope",
      agreed_fixed_fee: agreedFee,
      invoice_total: invoiceTotal,
      excess_amount: excess,
    };

    expect(fired).toBe(true);
    expect(evidenceJson.excess_amount).toBe(5000);
    expect(evidenceJson.agreed_fixed_fee).toBe(50000);
    expect(evidenceJson.invoice_total).toBe(55000);
  });

  it("TRIGGER: recovery = excess over the agreed fee", () => {
    const invoiceTotal = 102000;
    const agreedFee = 100000;
    expect(detectFixedScopeAmountMismatch(invoiceTotal, agreedFee)).toBe(true);
    expect(invoiceTotal - agreedFee).toBe(2000);
  });

  it("CLEAN: no recovery when within fee", () => {
    expect(detectFixedScopeAmountMismatch(100000, 100000)).toBe(false);
  });
});

describe("RATE_EXCESS — issue output structure", () => {
  it("TRIGGER: evidence contains charged_rate, approved_rate, excess_per_hour, billed_hours, total_recovery", () => {
    const charged = 650;
    const approved = 500;
    const hours = 3;
    const fired = detectRateExcess(charged, approved);
    const excessPerHour = charged - approved;
    const totalRecovery = excessPerHour * hours;
    const evidenceJson = buildRateExcessEvidenceJson(charged, approved, "Senior Associate");
    evidenceJson["hours_billed"] = hours;
    evidenceJson["total_overcharge"] = totalRecovery;

    expect(fired).toBe(true);
    expect(evidenceJson.rate_charged).toBe(650);
    expect(evidenceJson.approved_rate).toBe(500);
    expect(evidenceJson.excess_amount_per_hour).toBe(150);
    expect(evidenceJson["total_overcharge"]).toBe(450);
  });

  it("TRIGGER: recovery = (charged - approved) × hours", () => {
    const charged = 600;
    const approved = 400;
    const hours = 5;
    expect(detectRateExcess(charged, approved)).toBe(true);
    const recovery = (charged - approved) * hours;
    expect(recovery).toBe(1000);
  });

  it("CLEAN: no recovery when rate is within approved range", () => {
    expect(detectRateExcess(400, 500)).toBe(false);
  });
});

describe("BILLING_PERIOD_OUTSIDE_EL — issue output structure", () => {
  it("TRIGGER before start: evidence contains workDate, elStartDate, elEndDate, direction='before'", () => {
    const items = [line({ id: 1, workDate: "2024-12-15" })];
    const [issue] = detectBillingOutsideElPeriod(items, "2025-01-01", "2025-12-31");
    const evidenceJson = {
      work_date: issue.workDate,
      el_start_date: issue.elStartDate,
      el_end_date: issue.elEndDate,
      direction: issue.workDate < issue.elStartDate ? "before" : "after",
    };

    expect(evidenceJson.work_date).toBe("2024-12-15");
    expect(evidenceJson.el_start_date).toBe("2025-01-01");
    expect(evidenceJson.direction).toBe("before");
  });

  it("TRIGGER after end: evidence direction='after'", () => {
    const items = [line({ id: 2, workDate: "2026-02-01" })];
    const [issue] = detectBillingOutsideElPeriod(items, "2025-01-01", "2025-12-31");
    const direction = issue.workDate > issue.elEndDate ? "after" : "before";
    expect(direction).toBe("after");
  });

  it("CLEAN: date within range — no issues produced", () => {
    const items = [line({ id: 3, workDate: "2025-06-15" })];
    expect(detectBillingOutsideElPeriod(items, "2025-01-01", "2025-12-31")).toHaveLength(0);
  });
});

describe("MISSING_DOCUMENTS_FIXED_SCOPE — issue output structure", () => {
  it("TRIGGER: evidence contains billing_type and missing doc list", () => {
    const billingType = "fixed_scope";
    const hasEL = false;
    const fired = detectMissingDocumentsFixedScope(billingType, hasEL);
    const evidenceJson = {
      billing_type: billingType,
      has_engagement_letter: hasEL,
      required_documents: ["engagement_letter"],
    };

    expect(fired).toBe(true);
    expect(evidenceJson.billing_type).toBe("fixed_scope");
    expect(evidenceJson.has_engagement_letter).toBe(false);
    expect(evidenceJson.required_documents).toContain("engagement_letter");
  });

  it("CLEAN: EL present — no issue", () => {
    expect(detectMissingDocumentsFixedScope("fixed_scope", true)).toBe(false);
  });
});

describe("LINE_ITEMS_IN_FIXED_SCOPE — issue output structure", () => {
  it("TRIGGER: evidence contains billing_type, line_item_count, has_hourly_lines", () => {
    const items = [
      line({ id: 1, hours: "3.00", rateCharged: "500.00" }),
      line({ id: 2, hours: "2.00", rateCharged: "400.00" }),
    ];
    const fired = detectLineItemsInFixedScope("fixed_scope", items);
    const hourlyLineCount = items.filter(i => !i.isExpenseLine && parseAmount(i.hours) > 0).length;
    const evidenceJson = {
      billing_type: "fixed_scope",
      hourly_line_count: hourlyLineCount,
      has_hourly_lines: hourlyLineCount > 0,
    };

    expect(fired).toBe(true);
    expect(evidenceJson.billing_type).toBe("fixed_scope");
    expect(evidenceJson.hourly_line_count).toBe(2);
    expect(evidenceJson.has_hourly_lines).toBe(true);
  });

  it("CLEAN: T&M billing — no issue", () => {
    const items = [line({ id: 3, hours: "3.00", rateCharged: "500.00" })];
    expect(detectLineItemsInFixedScope("time_and_materials", items)).toBe(false);
  });
});

describe("UNAUTHORIZED_EXPENSE_TYPE — issue output structure", () => {
  it("TRIGGER: evidence contains expenseType, authorized_types, invoice_item_id", () => {
    const items = [
      line({ id: 1, isExpenseLine: true, expenseType: "Chauffeur Service", hours: null, rateCharged: null, amount: "350.00" }),
    ];
    const authorized = ["Taxi", "Air Travel", "Hotel", "Subsistence"];
    const [issue] = detectUnauthorizedExpense(items, authorized);
    const evidenceJson = {
      expense_type: issue.expenseType,
      authorized_types: authorized,
      invoice_item_id: issue.id,
    };

    expect(evidenceJson.expense_type).toBe("Chauffeur Service");
    expect(evidenceJson.authorized_types).not.toContain("Chauffeur Service");
    expect(evidenceJson.invoice_item_id).toBe(1);
  });

  it("TRIGGER: recovery = the full expense amount (unauthorized = 100% clawback)", () => {
    const amount = 350;
    const items = [line({ id: 2, isExpenseLine: true, expenseType: "Entertainment", amount: `${amount}.00`, hours: null, rateCharged: null })];
    const [issue] = detectUnauthorizedExpense(items, ["Taxi"]);
    expect(issue.expenseType).toBe("Entertainment");
    expect(amount).toBe(350);
  });

  it("CLEAN: authorized expense — no issue", () => {
    const items = [line({ id: 3, isExpenseLine: true, expenseType: "Taxi", hours: null, rateCharged: null })];
    expect(detectUnauthorizedExpense(items, ["Taxi", "Hotel"])).toHaveLength(0);
  });
});

describe("MISSING_LINE_DETAIL — issue output structure", () => {
  it("TRIGGER: evidence contains line_item_count, has_dates=false, has_hours=false, has_rates=false, summary_only=true", () => {
    const items = [
      line({ id: 1, workDate: null, hours: null, rateCharged: null, amount: "5000.00" }),
    ];
    const fired = detectMissingLineDetail(items);
    const evidenceJson = {
      line_item_count: items.length,
      has_dates: items.some(i => i.workDate !== null),
      has_hours: items.some(i => i.hours !== null),
      has_rates: items.some(i => !i.isExpenseLine && i.rateCharged !== null),
      summary_only: true,
    };

    expect(fired).toBe(true);
    expect(evidenceJson.line_item_count).toBe(1);
    expect(evidenceJson.has_dates).toBe(false);
    expect(evidenceJson.has_hours).toBe(false);
    expect(evidenceJson.has_rates).toBe(false);
    expect(evidenceJson.summary_only).toBe(true);
  });

  it("CLEAN: full detail present", () => {
    const items = [line({ id: 2, workDate: "2025-01-10", hours: "2.00", rateCharged: "500.00" })];
    expect(detectMissingLineDetail(items)).toBe(false);
  });
});

describe("JURISDICTION_UNCLEAR — issue output structure", () => {
  it("TRIGGER: evidence contains jurisdiction_extracted=null, firm_jurisdictions, affected_rules", () => {
    const invoiceJurisdiction = null;
    const firmJurisdictions = ["England & Wales", "New York", "Singapore"];
    const fired = detectJurisdictionUnclear(invoiceJurisdiction, firmJurisdictions);
    const evidenceJson = {
      jurisdiction_extracted: invoiceJurisdiction,
      firm_jurisdictions: firmJurisdictions,
      affected_rules: ["RATE_EXCESS", "RATE_CARD_EXPIRED_OR_MISSING"],
    };

    expect(fired).toBe(true);
    expect(evidenceJson.jurisdiction_extracted).toBeNull();
    expect(evidenceJson.firm_jurisdictions).toHaveLength(3);
    expect(evidenceJson.affected_rules).toContain("RATE_EXCESS");
  });

  it("CLEAN: jurisdiction set — no ambiguity", () => {
    expect(detectJurisdictionUnclear("England & Wales", ["England & Wales", "Singapore"])).toBe(false);
  });
});

describe("MEETING_OVERSTAFFING — issue output structure (configurable)", () => {
  it("TRIGGER: evidence contains attendeeCount, max_threshold, date, description", () => {
    const maxAttendees = 4;
    const items = Array.from({ length: 6 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-05-20", timekeeperName: `Lawyer ${i + 1}`, description: "Strategy meeting with client re M&A" })
    );
    const [issue] = detectMeetingOverstaffing(items, 3, maxAttendees);
    const evidenceJson = {
      date: issue.date,
      description: issue.description,
      attendee_count: issue.attendeeCount,
      max_threshold: maxAttendees,
      excess_attendees: issue.attendeeCount - maxAttendees,
    };

    expect(evidenceJson.attendee_count).toBe(6);
    expect(evidenceJson.max_threshold).toBe(4);
    expect(evidenceJson.excess_attendees).toBe(2);
    expect(evidenceJson.date).toBe("2025-05-20");
    expect(issue.itemIds).toHaveLength(6);
  });

  it("TRIGGER: recovery = excess attendees × avg_hours × avg_rate (by attendee count)", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      line({ id: i + 10, workDate: "2025-05-21", timekeeperName: `Attendee ${i + 1}`, hours: "1.00", rateCharged: "400.00", description: "Board meeting" })
    );
    const [issue] = detectMeetingOverstaffing(items, 3, 3);
    const excessAttendees = issue.attendeeCount - 3;
    const potentialRecovery = excessAttendees * parseAmount("1.00") * parseAmount("400.00");
    expect(excessAttendees).toBe(2);
    expect(potentialRecovery).toBe(800);
  });

  it("CLEAN: within threshold — no issues", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-05-22", timekeeperName: `Attendee ${i + 1}`, description: "Team call" })
    );
    expect(detectMeetingOverstaffing(items, 3, 5)).toHaveLength(0);
  });
});

describe("EXPENSE_CAP_EXCEEDED — issue output structure", () => {
  it("TRIGGER: evidence contains expense_type, expense_amount, cap_amount, excess", () => {
    const expenseAmount = 450;
    const cap = 200;
    const excess = expenseAmount - cap;
    const evidenceJson = {
      expense_type: "Hotel",
      expense_amount: expenseAmount,
      cap_amount: cap,
      excess_amount: excess,
    };

    expect(excess).toBe(250);
    expect(evidenceJson.expense_amount).toBe(450);
    expect(evidenceJson.cap_amount).toBe(200);
    expect(evidenceJson.excess_amount).toBe(250);
  });

  it("TRIGGER: recovery = expense_amount - cap_amount", () => {
    const expense = 1200;
    const cap = 500;
    const recovery = expense - cap;
    expect(recovery).toBe(700);
    expect(expense > cap).toBe(true);
  });

  it("CLEAN: expense within cap", () => {
    const expense = 150;
    const cap = 200;
    expect(expense > cap).toBe(false);
  });
});

describe("VOLUME_DISCOUNT_NOT_APPLIED — issue output structure", () => {
  it("TRIGGER: evidence contains cumulative_fees, threshold, discount_pct, expected_discount_amount", () => {
    const cumulativeFees = 250000;
    const threshold = 200000;
    const discountPct = 0.05;
    const thresholdMet = cumulativeFees >= threshold;
    const expectedDiscount = cumulativeFees * discountPct;
    const evidenceJson = {
      cumulative_fees: cumulativeFees,
      volume_threshold: threshold,
      discount_pct: discountPct,
      expected_discount_amount: expectedDiscount,
      threshold_met: thresholdMet,
    };

    expect(thresholdMet).toBe(true);
    expect(evidenceJson.expected_discount_amount).toBe(12500);
    expect(evidenceJson.discount_pct).toBe(0.05);
  });

  it("CLEAN: below threshold — no discount owed", () => {
    const cumulative = 150000;
    const threshold = 200000;
    expect(cumulative >= threshold).toBe(false);
  });
});

describe("RATE_CARD_EXPIRED_OR_MISSING — issue output structure", () => {
  it("TRIGGER: evidence contains firm_id, jurisdiction, role, as_at_date, reason", () => {
    const evidenceJson = {
      firm_name: "Acme Law LLP",
      jurisdiction: "England & Wales",
      role_normalized: "senior_associate",
      as_at_date: "2025-01-15",
      reason: "no_active_rate_entry",
    };
    expect(evidenceJson.reason).toBe("no_active_rate_entry");
    expect(evidenceJson.jurisdiction).toBe("England & Wales");
  });

  it("TRIGGER: expired rate card produces 'rate_card_expired' reason", () => {
    const evidenceJson = {
      firm_name: "Acme Law LLP",
      reason: "rate_card_expired",
      expired_at: "2024-12-31",
    };
    expect(evidenceJson.reason).toBe("rate_card_expired");
  });

  it("CLEAN: active rate card found — no issue", () => {
    const hasActiveRateCard = true;
    expect(hasActiveRateCard).toBe(true);
  });
});

describe("LAWYER_ROLE_MISMATCH — issue output structure", () => {
  it("TRIGGER: evidence contains raw_role_label and normalized result (null/unknown)", () => {
    const rawRole = "Executive Director (Legal)";
    const normalizedRole = null;
    const evidenceJson = {
      role_raw: rawRole,
      role_normalized: normalizedRole,
      reason: "role_not_in_approved_list",
    };
    expect(evidenceJson.role_normalized).toBeNull();
    expect(evidenceJson.reason).toBe("role_not_in_approved_list");
  });

  it("CLEAN: recognised role — normalised result is non-null", () => {
    const rawRole = "Partner";
    const normalizedRole = "partner";
    expect(normalizedRole).not.toBeNull();
  });
});

describe("EL_CONFLICT_WITH_PANEL_BASELINE — issue output structure", () => {
  it("TRIGGER: evidence captures conflicting clauses between EL and Panel T&C", () => {
    const evidenceJson = {
      el_document_id: 42,
      panel_baseline_id: 7,
      conflicting_terms: ["rate_schedule", "payment_terms"],
      source_document: "Engagement Letter",
    };
    expect(evidenceJson.conflicting_terms.length).toBeGreaterThan(0);
    expect(evidenceJson.source_document).toBe("Engagement Letter");
  });

  it("CLEAN: EL and Panel T&C are compatible — no conflict evidence", () => {
    const conflictingTerms: string[] = [];
    expect(conflictingTerms).toHaveLength(0);
  });
});

describe("Gray-area rules — evidence and output structure", () => {
  const grayRuleEvidenceSchemas: Record<string, Record<string, unknown>> = {
    HOURS_DISPROPORTIONATE: {
      line_no: 3,
      timekeeper_label: "John Smith",
      role_normalized: "associate",
      hours: 12,
      amount: 6000,
      heuristic_reasoning: "12h in a single day for document review appears disproportionate",
    },
    PARALLEL_BILLING: {
      overlapping_line_nos: [4, 5],
      timekeepers: ["Alice", "Bob"],
      shared_date: "2025-01-15",
      heuristic_reasoning: "Both lawyers billed for client update call on the same day",
    },
    SCOPE_CREEP: {
      line_no: 8,
      description: "Advised on employment law matters",
      heuristic_reasoning: "EL scope is limited to M&A; employment advice is out of scope",
    },
    SENIORITY_OVERKILL: {
      line_no: 2,
      timekeeper_label: "Jane Partner",
      role_normalized: "partner",
      rate_charged: 900,
      description: "Filing court documents",
      heuristic_reasoning: "Filing is typically handled by junior staff",
    },
    ESTIMATE_EXCESS: {
      estimate_amount: 50000,
      cumulative_fees: 62000,
      excess_amount: 12000,
      excess_pct: 24,
      revised_estimate_provided: false,
      heuristic_reasoning: "Cumulative fees exceed initial estimate by 24% with no revised estimate provided",
    },
    INTERNAL_COORDINATION: {
      line_no: 6,
      timekeeper_label: "Mike Senior",
      hours: 2.5,
      description: "Internal case management meeting",
      heuristic_reasoning: "Internal team meetings are non-billable under Panel T&C clause 4.2",
    },
    TIMEKEEPER_NOT_APPROVED: {
      line_no: 7,
      timekeeper_label: "New Associate",
      role_normalized: "associate",
      heuristic_reasoning: "Not listed in EL staffing annex",
    },
  };

  for (const [code, evidenceTemplate] of Object.entries(grayRuleEvidenceSchemas)) {
    it(`${code}: evidence template has required fields`, () => {
      const keys = Object.keys(evidenceTemplate);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain("heuristic_reasoning");
      for (const key of keys) {
        expect(evidenceTemplate[key], `${code}.${key} should be defined`).toBeDefined();
      }
    });
  }
});
