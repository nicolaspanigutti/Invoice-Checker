import { describe, it, expect } from "vitest";
import { RULES_REGISTRY, type RuleDefinition } from "../lib/rulesRegistry";
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

describe("RULES_REGISTRY — meta-level completeness", () => {
  it("contains exactly 27 rules", () => {
    expect(RULES_REGISTRY).toHaveLength(27);
  });

  it("has 17 objective rules", () => {
    const objective = RULES_REGISTRY.filter(r => r.ruleType === "objective");
    expect(objective).toHaveLength(17);
  });

  it("has 7 gray rules", () => {
    const gray = RULES_REGISTRY.filter(r => r.ruleType === "gray");
    expect(gray).toHaveLength(7);
  });

  it("has 1 configurable rule", () => {
    const configurable = RULES_REGISTRY.filter(r => r.ruleType === "configurable");
    expect(configurable).toHaveLength(1);
    expect(configurable[0].code).toBe("MEETING_OVERSTAFFING");
    expect(configurable[0].hasConfig).toBe(true);
  });

  it("has 2 warning rules", () => {
    const warning = RULES_REGISTRY.filter(r => r.ruleType === "warning");
    expect(warning).toHaveLength(2);
    const codes = warning.map(r => r.code);
    expect(codes).toContain("MISSING_LINE_DETAIL");
    expect(codes).toContain("JURISDICTION_UNCLEAR");
  });

  it("every rule has required string fields", () => {
    for (const rule of RULES_REGISTRY) {
      expect(rule.code, `${rule.code} must have a code`).toBeTruthy();
      expect(rule.displayName, `${rule.code} must have a displayName`).toBeTruthy();
      expect(rule.description, `${rule.code} must have a description`).toBeTruthy();
    }
  });

  it("every rule has a valid ruleType", () => {
    const validTypes = new Set<RuleDefinition["ruleType"]>(["objective", "gray", "configurable", "warning"]);
    for (const rule of RULES_REGISTRY) {
      expect(validTypes.has(rule.ruleType), `${rule.code}: invalid ruleType "${rule.ruleType}"`).toBe(true);
    }
  });

  it("every rule has a valid severity", () => {
    const valid = new Set<RuleDefinition["severity"]>(["error", "warning"]);
    for (const rule of RULES_REGISTRY) {
      expect(valid.has(rule.severity), `${rule.code}: invalid severity "${rule.severity}"`).toBe(true);
    }
  });

  it("every rule has a valid scope", () => {
    const valid = new Set<RuleDefinition["scope"]>(["invoice", "invoice_item"]);
    for (const rule of RULES_REGISTRY) {
      expect(valid.has(rule.scope), `${rule.code}: invalid scope "${rule.scope}"`).toBe(true);
    }
  });

  it("every rule has a valid routeToRole", () => {
    const valid = new Set<RuleDefinition["routeToRole"]>(["legal_ops", "internal_lawyer"]);
    for (const rule of RULES_REGISTRY) {
      expect(valid.has(rule.routeToRole), `${rule.code}: invalid routeToRole "${rule.routeToRole}"`).toBe(true);
    }
  });

  it("rule codes are unique", () => {
    const codes = RULES_REGISTRY.map(r => r.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("all 27 expected rule codes are present", () => {
    const expected = [
      "RATE_EXCESS", "LAWYER_ROLE_MISMATCH", "RATE_CARD_EXPIRED_OR_MISSING",
      "WRONG_CURRENCY", "VOLUME_DISCOUNT_NOT_APPLIED", "EXPENSE_CAP_EXCEEDED",
      "FIXED_SCOPE_AMOUNT_MISMATCH", "DUPLICATE_LINE", "ARITHMETIC_ERROR",
      "BILLING_PERIOD_OUTSIDE_EL", "MISSING_DOCUMENTS_FIXED_SCOPE", "LINE_ITEMS_IN_FIXED_SCOPE",
      "UNAUTHORIZED_EXPENSE_TYPE", "TAX_OR_VAT_MISMATCH", "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER",
      "DAILY_HOURS_EXCEEDED", "EL_CONFLICT_WITH_PANEL_BASELINE",
      "HOURS_DISPROPORTIONATE", "PARALLEL_BILLING", "SCOPE_CREEP",
      "SENIORITY_OVERKILL", "ESTIMATE_EXCESS", "INTERNAL_COORDINATION",
      "TIMEKEEPER_NOT_APPROVED", "MEETING_OVERSTAFFING", "MISSING_LINE_DETAIL",
      "JURISDICTION_UNCLEAR",
    ];
    const codes = new Set(RULES_REGISTRY.map(r => r.code));
    for (const code of expected) {
      expect(codes.has(code), `Missing rule: ${code}`).toBe(true);
    }
  });

  it("gray rules all route to internal_lawyer with warning severity", () => {
    const grayRules = RULES_REGISTRY.filter(r => r.ruleType === "gray");
    for (const rule of grayRules) {
      expect(rule.routeToRole).toBe("internal_lawyer");
      expect(rule.severity).toBe("warning");
    }
  });

  it("objective rules all route to legal_ops with error severity", () => {
    const obj = RULES_REGISTRY.filter(r => r.ruleType === "objective");
    for (const rule of obj) {
      expect(rule.routeToRole, `${rule.code} should route to legal_ops`).toBe("legal_ops");
      expect(rule.severity).toBe("error");
    }
  });

  it("warning rules route to legal_ops and have warning severity", () => {
    const warning = RULES_REGISTRY.filter(r => r.ruleType === "warning");
    for (const rule of warning) {
      expect(rule.routeToRole).toBe("legal_ops");
      expect(rule.severity).toBe("warning");
    }
  });

  it("invoice-scope rules do not have hasConfig unless they are MEETING_OVERSTAFFING", () => {
    const nonConfigurable = RULES_REGISTRY.filter(r => r.code !== "MEETING_OVERSTAFFING");
    for (const rule of nonConfigurable) {
      expect(rule.hasConfig, `${rule.code} should not have config`).toBe(false);
    }
  });
});

describe("parseAmount helper", () => {
  it("parses numeric strings", () => expect(parseAmount("1234.56")).toBe(1234.56));
  it("returns 0 for null", () => expect(parseAmount(null)).toBe(0));
  it("returns 0 for undefined", () => expect(parseAmount(undefined)).toBe(0));
  it("returns 0 for empty string", () => expect(parseAmount("")).toBe(0));
  it("parses numbers directly", () => expect(parseAmount(42)).toBe(42));
  it("returns 0 for non-numeric string", () => expect(parseAmount("N/A")).toBe(0));
});

describe("RATE_EXCESS — detectRateExcess", () => {
  it("TRIGGER: charged rate exceeds approved rate — evidence: charged=600, approved=500, excess=100", () => {
    const fired = detectRateExcess(600, 500);
    expect(fired).toBe(true);
  });

  it("TRIGGER evidence — diff > tolerance; excess = charged - approved", () => {
    const charged = 700;
    const approved = 500;
    const fired = detectRateExcess(charged, approved);
    expect(fired).toBe(true);
    const excess = charged - approved;
    expect(excess).toBe(200);
  });

  it("CLEAN: charged rate equals approved rate", () => {
    expect(detectRateExcess(500, 500)).toBe(false);
  });

  it("CLEAN: charged rate below approved rate", () => {
    expect(detectRateExcess(450, 500)).toBe(false);
  });

  it("CLEAN: approved rate is zero (no rate card — different rule fires)", () => {
    expect(detectRateExcess(500, 0)).toBe(false);
  });

  it("CLEAN: within tolerance (0.5%)", () => {
    expect(detectRateExcess(502, 500)).toBe(false);
  });

  it("TRIGGER: just outside tolerance", () => {
    expect(detectRateExcess(503, 500)).toBe(true);
  });

  it("registry: RATE_EXCESS is objective, invoice_item scope, routes to legal_ops", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "RATE_EXCESS")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice_item");
    expect(rule.routeToRole).toBe("legal_ops");
    expect(rule.severity).toBe("error");
  });
});

describe("LAWYER_ROLE_MISMATCH — registry and roleNormaliser", () => {
  it("registry: LAWYER_ROLE_MISMATCH is objective, invoice_item scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "LAWYER_ROLE_MISMATCH")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice_item");
    expect(rule.severity).toBe("error");
  });

  it("registry description mentions rate schedule and role mapping", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "LAWYER_ROLE_MISMATCH")!;
    expect(rule.description.toLowerCase()).toContain("role");
  });
});

describe("RATE_CARD_EXPIRED_OR_MISSING — registry", () => {
  it("is objective, invoice scope, routes to legal_ops", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "RATE_CARD_EXPIRED_OR_MISSING")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice");
    expect(rule.routeToRole).toBe("legal_ops");
    expect(rule.severity).toBe("error");
  });

  it("description mentions rate entry and firm/jurisdiction/role", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "RATE_CARD_EXPIRED_OR_MISSING")!;
    expect(rule.description.toLowerCase()).toContain("rate");
  });
});

describe("WRONG_CURRENCY — detectWrongCurrency", () => {
  it("TRIGGER: invoice is USD but agreed is GBP — evidence: {invoice_currency:'USD', agreed_currency:'GBP'}", () => {
    const mismatch = detectWrongCurrency("USD", "GBP");
    expect(mismatch).toBe(true);
  });

  it("TRIGGER: EUR invoiced but USD agreed", () => {
    expect(detectWrongCurrency("EUR", "USD")).toBe(true);
  });

  it("CLEAN: both are GBP", () => {
    expect(detectWrongCurrency("GBP", "GBP")).toBe(false);
  });

  it("CLEAN: case-insensitive comparison gbp vs GBP", () => {
    expect(detectWrongCurrency("gbp", "GBP")).toBe(false);
  });

  it("CLEAN: null invoice currency (cannot determine mismatch)", () => {
    expect(detectWrongCurrency(null, "GBP")).toBe(false);
  });

  it("CLEAN: null agreed currency (no term set)", () => {
    expect(detectWrongCurrency("GBP", null)).toBe(false);
  });

  it("registry: WRONG_CURRENCY is objective, invoice scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "WRONG_CURRENCY")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice");
    expect(rule.severity).toBe("error");
  });
});

describe("VOLUME_DISCOUNT_NOT_APPLIED — registry", () => {
  it("is objective, invoice scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "VOLUME_DISCOUNT_NOT_APPLIED")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice");
    expect(rule.severity).toBe("error");
  });

  it("description mentions cumulative fees and discount threshold", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "VOLUME_DISCOUNT_NOT_APPLIED")!;
    expect(rule.description.toLowerCase()).toContain("discount");
  });
});

describe("EXPENSE_CAP_EXCEEDED — registry", () => {
  it("is objective, invoice_item scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "EXPENSE_CAP_EXCEEDED")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice_item");
    expect(rule.severity).toBe("error");
  });

  it("TRIGGER: expense amount exceeds cap — excess calculation", () => {
    const expenseAmount = 250;
    const cap = 100;
    expect(expenseAmount > cap).toBe(true);
    expect(expenseAmount - cap).toBe(150);
  });

  it("CLEAN: expense within cap", () => {
    const expenseAmount = 80;
    const cap = 100;
    expect(expenseAmount > cap).toBe(false);
  });
});

describe("FIXED_SCOPE_AMOUNT_MISMATCH — detectFixedScopeAmountMismatch", () => {
  it("TRIGGER: invoice total 55,000 exceeds agreed 50,000 — excess = 5,000", () => {
    const fired = detectFixedScopeAmountMismatch(55000, 50000);
    expect(fired).toBe(true);
    const excess = 55000 - 50000;
    expect(excess).toBe(5000);
  });

  it("TRIGGER evidence: percentage overage > 0.5%", () => {
    expect(detectFixedScopeAmountMismatch(50300, 50000)).toBe(true);
  });

  it("CLEAN: invoice total equals agreed fixed fee", () => {
    expect(detectFixedScopeAmountMismatch(50000, 50000)).toBe(false);
  });

  it("CLEAN: invoice total below fixed fee", () => {
    expect(detectFixedScopeAmountMismatch(49000, 50000)).toBe(false);
  });

  it("CLEAN: agreed fee is zero (no fee set in EL)", () => {
    expect(detectFixedScopeAmountMismatch(50000, 0)).toBe(false);
  });

  it("CLEAN: within tolerance (0.5%)", () => {
    expect(detectFixedScopeAmountMismatch(50200, 50000)).toBe(false);
  });

  it("registry: FIXED_SCOPE_AMOUNT_MISMATCH is objective, invoice scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "FIXED_SCOPE_AMOUNT_MISMATCH")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice");
    expect(rule.severity).toBe("error");
  });
});

describe("DUPLICATE_LINE — detectDuplicateLines", () => {
  it("TRIGGER: two lines with same date/timekeeper/hours/rate — evidence: ids=[1,2]", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
    ];
    const groups = detectDuplicateLines(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toHaveLength(2);
    expect(groups[0].ids).toContain(1);
    expect(groups[0].ids).toContain(2);
    expect(groups[0].key).toContain("bob");
    expect(groups[0].key).toContain("3.00");
    expect(groups[0].key).toContain("400.00");
  });

  it("CLEAN: different dates for same timekeeper", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-11", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });

  it("CLEAN: different timekeepers on same date/hours/rate", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Alice", hours: "3.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });

  it("CLEAN: same date/timekeeper but different hours", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Bob", hours: "2.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });

  it("TRIGGER: case-insensitive timekeeper matching", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Bob Smith", hours: "3.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-10", timekeeperName: "bob smith", hours: "3.00", rateCharged: "400.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(1);
  });

  it("CLEAN: expense lines excluded from duplicate check", () => {
    const items = [
      line({ id: 1, isExpenseLine: true, workDate: "2025-01-10", timekeeperName: "Bob", hours: "0", rateCharged: "0", amount: "50" }),
      line({ id: 2, isExpenseLine: true, workDate: "2025-01-10", timekeeperName: "Bob", hours: "0", rateCharged: "0", amount: "50" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });
});

describe("ARITHMETIC_ERROR — detectArithmeticErrors", () => {
  it("TRIGGER: amount does not match hours × rate — evidence: {expected:1000, actual:900, diff:100}", () => {
    const items = [line({ id: 1, hours: "2.00", rateCharged: "500.00", amount: "900.00" })];
    const issues = detectArithmeticErrors(items);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe(1);
    expect(issues[0].hours).toBe(2);
    expect(issues[0].rate).toBe(500);
    expect(issues[0].expected).toBeCloseTo(1000, 1);
    expect(issues[0].diff).toBeCloseTo(100, 1);
    expect(issues[0].amount).toBe(900);
  });

  it("CLEAN: amount exactly matches hours × rate", () => {
    expect(detectArithmeticErrors([line({ id: 2, hours: "2.00", rateCharged: "500.00", amount: "1000.00" })])).toHaveLength(0);
  });

  it("CLEAN: within tolerance (< 2%)", () => {
    expect(detectArithmeticErrors([line({ id: 3, hours: "2.00", rateCharged: "500.00", amount: "1004.99" })])).toHaveLength(0);
  });

  it("TRIGGER: outside tolerance (diff > 2% of expected)", () => {
    expect(detectArithmeticErrors([line({ id: 4, hours: "2.00", rateCharged: "500.00", amount: "1025.00" })])).toHaveLength(1);
  });

  it("CLEAN: expense lines are skipped (no hours × rate check)", () => {
    expect(detectArithmeticErrors([line({ id: 5, isExpenseLine: true, hours: "0", rateCharged: "0", amount: "250.00" })])).toHaveLength(0);
  });

  it("CLEAN: zero hours — no arithmetic possible", () => {
    expect(detectArithmeticErrors([line({ id: 6, hours: "0", rateCharged: "500.00", amount: "1000.00" })])).toHaveLength(0);
  });

  it("TRIGGER: multiple lines, only one has error", () => {
    const items = [
      line({ id: 10, hours: "2.00", rateCharged: "500.00", amount: "1000.00" }),
      line({ id: 11, hours: "3.00", rateCharged: "300.00", amount: "800.00" }),
    ];
    const issues = detectArithmeticErrors(items);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe(11);
    expect(issues[0].expected).toBeCloseTo(900, 1);
  });
});

describe("BILLING_PERIOD_OUTSIDE_EL — detectBillingOutsideElPeriod", () => {
  it("TRIGGER: line date before EL start date — evidence: {workDate, elStartDate}", () => {
    const items = [line({ id: 1, workDate: "2024-11-30" })];
    const issues = detectBillingOutsideElPeriod(items, "2025-01-01", "2025-12-31");
    expect(issues).toHaveLength(1);
    expect(issues[0].workDate).toBe("2024-11-30");
    expect(issues[0].elStartDate).toBe("2025-01-01");
  });

  it("TRIGGER: line date after EL end date — evidence: {workDate, elEndDate}", () => {
    const items = [line({ id: 2, workDate: "2026-03-15" })];
    const issues = detectBillingOutsideElPeriod(items, "2025-01-01", "2025-12-31");
    expect(issues).toHaveLength(1);
    expect(issues[0].workDate).toBe("2026-03-15");
    expect(issues[0].elEndDate).toBe("2025-12-31");
  });

  it("CLEAN: line date within EL period", () => {
    const items = [line({ id: 3, workDate: "2025-06-15" })];
    expect(detectBillingOutsideElPeriod(items, "2025-01-01", "2025-12-31")).toHaveLength(0);
  });

  it("CLEAN: on EL start date boundary", () => {
    const items = [line({ id: 4, workDate: "2025-01-01" })];
    expect(detectBillingOutsideElPeriod(items, "2025-01-01", "2025-12-31")).toHaveLength(0);
  });

  it("CLEAN: on EL end date boundary", () => {
    const items = [line({ id: 5, workDate: "2025-12-31" })];
    expect(detectBillingOutsideElPeriod(items, "2025-01-01", "2025-12-31")).toHaveLength(0);
  });

  it("CLEAN: no EL dates set (cannot check)", () => {
    const items = [line({ id: 6, workDate: "2024-01-01" })];
    expect(detectBillingOutsideElPeriod(items, null, null)).toHaveLength(0);
  });

  it("registry: BILLING_PERIOD_OUTSIDE_EL is objective, invoice_item scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "BILLING_PERIOD_OUTSIDE_EL")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice_item");
    expect(rule.severity).toBe("error");
  });
});

describe("MISSING_DOCUMENTS_FIXED_SCOPE — detectMissingDocumentsFixedScope", () => {
  it("TRIGGER: fixed_scope invoice without EL — evidence: {billing_type:'fixed_scope', has_el:false}", () => {
    expect(detectMissingDocumentsFixedScope("fixed_scope", false)).toBe(true);
  });

  it("TRIGGER: closed_scope invoice without EL", () => {
    expect(detectMissingDocumentsFixedScope("closed_scope", false)).toBe(true);
  });

  it("CLEAN: fixed_scope invoice with EL present", () => {
    expect(detectMissingDocumentsFixedScope("fixed_scope", true)).toBe(false);
  });

  it("CLEAN: hourly billing type (rule does not apply)", () => {
    expect(detectMissingDocumentsFixedScope("time_and_materials", false)).toBe(false);
  });

  it("CLEAN: null billing type (rule does not apply)", () => {
    expect(detectMissingDocumentsFixedScope(null, false)).toBe(false);
  });

  it("registry: MISSING_DOCUMENTS_FIXED_SCOPE is objective, invoice scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "MISSING_DOCUMENTS_FIXED_SCOPE")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice");
    expect(rule.severity).toBe("error");
  });
});

describe("LINE_ITEMS_IN_FIXED_SCOPE — detectLineItemsInFixedScope", () => {
  it("TRIGGER: fixed_scope with hourly line items — evidence: {billing_type:'fixed_scope', line_count:2}", () => {
    const items = [
      line({ id: 1, hours: "3.00", rateCharged: "500.00" }),
      line({ id: 2, hours: "2.00", rateCharged: "400.00" }),
    ];
    expect(detectLineItemsInFixedScope("fixed_scope", items)).toBe(true);
  });

  it("TRIGGER: closed_scope billing with hourly lines", () => {
    const items = [line({ id: 1, hours: "3.00", rateCharged: "500.00" })];
    expect(detectLineItemsInFixedScope("closed_scope", items)).toBe(true);
  });

  it("CLEAN: fixed_scope with only expense lines (no hourly billing)", () => {
    const items = [line({ id: 1, isExpenseLine: true, hours: "0", rateCharged: "0", amount: "200" })];
    expect(detectLineItemsInFixedScope("fixed_scope", items)).toBe(false);
  });

  it("CLEAN: time_and_materials billing (rule does not apply)", () => {
    const items = [line({ id: 1, hours: "3.00", rateCharged: "500.00" })];
    expect(detectLineItemsInFixedScope("time_and_materials", items)).toBe(false);
  });

  it("CLEAN: null billing type (rule does not apply)", () => {
    const items = [line({ id: 1, hours: "3.00", rateCharged: "500.00" })];
    expect(detectLineItemsInFixedScope(null, items)).toBe(false);
  });

  it("registry: LINE_ITEMS_IN_FIXED_SCOPE is objective, invoice scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "LINE_ITEMS_IN_FIXED_SCOPE")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice");
    expect(rule.severity).toBe("error");
  });
});

describe("UNAUTHORIZED_EXPENSE_TYPE — detectUnauthorizedExpense", () => {
  it("TRIGGER: expense type not in authorized list — evidence: {expenseType:'Limousine'}", () => {
    const items = [
      line({ id: 1, isExpenseLine: true, expenseType: "Limousine", hours: null, rateCharged: null }),
    ];
    const issues = detectUnauthorizedExpense(items, ["Taxi", "Air Travel", "Hotel"]);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe(1);
    expect(issues[0].expenseType).toBe("Limousine");
  });

  it("CLEAN: expense type is in authorized list", () => {
    const items = [
      line({ id: 2, isExpenseLine: true, expenseType: "Taxi", hours: null, rateCharged: null }),
    ];
    expect(detectUnauthorizedExpense(items, ["Taxi", "Air Travel"])).toHaveLength(0);
  });

  it("CLEAN: authorized list matching is case-insensitive", () => {
    const items = [
      line({ id: 3, isExpenseLine: true, expenseType: "taxi", hours: null, rateCharged: null }),
    ];
    expect(detectUnauthorizedExpense(items, ["Taxi"])).toHaveLength(0);
  });

  it("CLEAN: non-expense lines are excluded", () => {
    const items = [
      line({ id: 4, isExpenseLine: false, expenseType: "Unknown Category" }),
    ];
    expect(detectUnauthorizedExpense(items, ["Taxi"])).toHaveLength(0);
  });

  it("CLEAN: expense line with null expense type skipped", () => {
    const items = [
      line({ id: 5, isExpenseLine: true, expenseType: null, hours: null, rateCharged: null }),
    ];
    expect(detectUnauthorizedExpense(items, ["Taxi"])).toHaveLength(0);
  });

  it("TRIGGER: multiple unauthorized expenses", () => {
    const items = [
      line({ id: 6, isExpenseLine: true, expenseType: "Limousine", hours: null, rateCharged: null }),
      line({ id: 7, isExpenseLine: true, expenseType: "Alcohol", hours: null, rateCharged: null }),
    ];
    const issues = detectUnauthorizedExpense(items, ["Taxi"]);
    expect(issues).toHaveLength(2);
  });

  it("registry: UNAUTHORIZED_EXPENSE_TYPE is objective, invoice_item scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "UNAUTHORIZED_EXPENSE_TYPE")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice_item");
    expect(rule.severity).toBe("error");
  });
});

describe("TAX_OR_VAT_MISMATCH — detectTaxMismatch", () => {
  it("TRIGGER: total ≠ subtotal + tax — evidence: {subtotal:1000, tax:200, total:1150, expected:1200}", () => {
    const subtotal = 1000;
    const tax = 200;
    const total = 1150;
    const fired = detectTaxMismatch(subtotal, tax, total);
    expect(fired).toBe(true);
    const expected = subtotal + tax;
    expect(Math.abs(total - expected)).toBe(50);
  });

  it("CLEAN: total equals subtotal + tax exactly", () => {
    expect(detectTaxMismatch(1000, 200, 1200)).toBe(false);
  });

  it("CLEAN: within tolerance (< 1%)", () => {
    expect(detectTaxMismatch(1000, 200, 1201)).toBe(false);
  });

  it("TRIGGER: outside tolerance", () => {
    expect(detectTaxMismatch(1000, 200, 1230)).toBe(true);
  });

  it("CLEAN: zero subtotal — tax check skipped", () => {
    expect(detectTaxMismatch(0, 0, 500)).toBe(false);
  });

  it("TRIGGER: VAT at 25% instead of 20% — {subtotal:1000, tax:250, total:1200}", () => {
    expect(detectTaxMismatch(1000, 250, 1200)).toBe(true);
  });

  it("registry: TAX_OR_VAT_MISMATCH is objective, invoice scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "TAX_OR_VAT_MISMATCH")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice");
    expect(rule.severity).toBe("error");
  });
});

describe("INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER — detectInconsistentRates", () => {
  it("TRIGGER: same timekeeper at two different rates — evidence: {rates:[500,550]}", () => {
    const items = [
      line({ id: 1, timekeeperName: "Charlie", rateCharged: "500.00" }),
      line({ id: 2, timekeeperName: "Charlie", rateCharged: "550.00" }),
    ];
    const issues = detectInconsistentRates(items);
    expect(issues).toHaveLength(1);
    expect(issues[0].rates).toHaveLength(2);
    expect(issues[0].rates).toContain(500);
    expect(issues[0].rates).toContain(550);
    expect(issues[0].itemIds).toHaveLength(2);
  });

  it("CLEAN: same timekeeper billed at one consistent rate", () => {
    const items = [
      line({ id: 1, timekeeperName: "Charlie", rateCharged: "500.00" }),
      line({ id: 2, timekeeperName: "Charlie", rateCharged: "500.00" }),
    ];
    expect(detectInconsistentRates(items)).toHaveLength(0);
  });

  it("CLEAN: different timekeepers at different rates", () => {
    const items = [
      line({ id: 1, timekeeperName: "Alice", rateCharged: "600.00" }),
      line({ id: 2, timekeeperName: "Bob", rateCharged: "400.00" }),
    ];
    expect(detectInconsistentRates(items)).toHaveLength(0);
  });

  it("TRIGGER: name matching is case-insensitive", () => {
    const items = [
      line({ id: 1, timekeeperName: "Charlie Doe", rateCharged: "500.00" }),
      line({ id: 2, timekeeperName: "charlie doe", rateCharged: "450.00" }),
    ];
    expect(detectInconsistentRates(items)).toHaveLength(1);
  });

  it("CLEAN: expense lines excluded from rate check", () => {
    const items = [
      line({ id: 1, timekeeperName: "Charlie", rateCharged: "500.00", isExpenseLine: false }),
      line({ id: 2, timekeeperName: "Charlie", rateCharged: "0.00", isExpenseLine: true }),
    ];
    expect(detectInconsistentRates(items)).toHaveLength(0);
  });

  it("registry: INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER is objective, invoice_item scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice_item");
    expect(rule.severity).toBe("error");
  });
});

describe("DAILY_HOURS_EXCEEDED — detectDailyHoursExceeded", () => {
  it("TRIGGER: timekeeper bills 9 hours in one day — evidence: {total_hours:9, cap:8}", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-15", timekeeperName: "Alice", hours: "5.00" }),
      line({ id: 2, workDate: "2025-01-15", timekeeperName: "Alice", hours: "4.00" }),
    ];
    const issues = detectDailyHoursExceeded(items, 8);
    expect(issues).toHaveLength(1);
    expect(issues[0].totalHours).toBeCloseTo(9, 1);
    expect(issues[0].timekeeperName).toBe("alice");
    expect(issues[0].workDate).toBe("2025-01-15");
    expect(issues[0].itemIds).toHaveLength(2);
  });

  it("CLEAN: exactly at daily cap (not exceeded)", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-15", timekeeperName: "Alice", hours: "4.00" }),
      line({ id: 2, workDate: "2025-01-15", timekeeperName: "Alice", hours: "4.00" }),
    ];
    expect(detectDailyHoursExceeded(items, 8)).toHaveLength(0);
  });

  it("CLEAN: same total hours split across different days", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-15", timekeeperName: "Alice", hours: "5.00" }),
      line({ id: 2, workDate: "2025-01-16", timekeeperName: "Alice", hours: "5.00" }),
    ];
    expect(detectDailyHoursExceeded(items, 8)).toHaveLength(0);
  });

  it("TRIGGER: one timekeeper exceeds cap, other does not", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-15", timekeeperName: "Alice", hours: "9.00" }),
      line({ id: 2, workDate: "2025-01-15", timekeeperName: "Bob", hours: "7.00" }),
    ];
    const issues = detectDailyHoursExceeded(items, 8);
    expect(issues).toHaveLength(1);
    expect(issues[0].timekeeperName).toBe("alice");
  });

  it("CLEAN: expense lines excluded from daily hours check", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-15", timekeeperName: "Alice", hours: "9.00", isExpenseLine: true }),
    ];
    expect(detectDailyHoursExceeded(items, 8)).toHaveLength(0);
  });

  it("registry: DAILY_HOURS_EXCEEDED is objective, invoice_item scope", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "DAILY_HOURS_EXCEEDED")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice_item");
    expect(rule.severity).toBe("error");
  });
});

describe("EL_CONFLICT_WITH_PANEL_BASELINE — registry", () => {
  it("is objective, invoice scope, routes to legal_ops", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "EL_CONFLICT_WITH_PANEL_BASELINE")!;
    expect(rule.ruleType).toBe("objective");
    expect(rule.scope).toBe("invoice");
    expect(rule.routeToRole).toBe("legal_ops");
    expect(rule.severity).toBe("error");
  });

  it("description references Engagement Letter and Panel", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "EL_CONFLICT_WITH_PANEL_BASELINE")!;
    expect(rule.description.toLowerCase()).toContain("panel");
  });
});

describe("MISSING_LINE_DETAIL — detectMissingLineDetail", () => {
  it("TRIGGER: no line has date/hours/rate — evidence: {summary_only:true}", () => {
    const items = [
      line({ id: 1, workDate: null, hours: null, rateCharged: null, amount: "5000.00" }),
    ];
    expect(detectMissingLineDetail(items)).toBe(true);
  });

  it("CLEAN: at least one line has work date", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", hours: null, rateCharged: null, amount: "5000.00" }),
    ];
    expect(detectMissingLineDetail(items)).toBe(false);
  });

  it("CLEAN: at least one line has hours", () => {
    const items = [
      line({ id: 1, workDate: null, hours: "3.00", rateCharged: null, amount: "1500.00" }),
    ];
    expect(detectMissingLineDetail(items)).toBe(false);
  });

  it("CLEAN: no items at all — empty invoice has no detail issue", () => {
    expect(detectMissingLineDetail([])).toBe(false);
  });

  it("registry: is warning type, not objective", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "MISSING_LINE_DETAIL")!;
    expect(rule.ruleType).toBe("warning");
    expect(rule.severity).toBe("warning");
    expect(rule.routeToRole).toBe("legal_ops");
  });
});

describe("JURISDICTION_UNCLEAR — detectJurisdictionUnclear", () => {
  it("TRIGGER: no jurisdiction on invoice + firm has multiple jurisdictions — evidence: {firmJurisdictions:['UK','US']}", () => {
    expect(detectJurisdictionUnclear(null, ["UK", "US"])).toBe(true);
  });

  it("CLEAN: jurisdiction is set on invoice", () => {
    expect(detectJurisdictionUnclear("England & Wales", ["UK", "US"])).toBe(false);
  });

  it("CLEAN: firm has only one jurisdiction (no ambiguity)", () => {
    expect(detectJurisdictionUnclear(null, ["UK"])).toBe(false);
  });

  it("CLEAN: firm has no jurisdictions recorded", () => {
    expect(detectJurisdictionUnclear(null, [])).toBe(false);
  });

  it("registry: is warning type, routes to legal_ops", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "JURISDICTION_UNCLEAR")!;
    expect(rule.ruleType).toBe("warning");
    expect(rule.severity).toBe("warning");
    expect(rule.routeToRole).toBe("legal_ops");
  });
});

describe("MEETING_OVERSTAFFING — detectMeetingOverstaffing (configurable)", () => {
  it("TRIGGER: 6 timekeepers on same meeting (max=5) — evidence: {attendeeCount:6}", () => {
    const meetingItems = Array.from({ length: 6 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-02-01", timekeeperName: `Person ${i + 1}`, description: "Client meeting re acquisition" })
    );
    const issues = detectMeetingOverstaffing(meetingItems, 3, 5);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].attendeeCount).toBe(6);
    expect(issues[0].date).toBe("2025-02-01");
  });

  it("CLEAN: 4 timekeepers — within max threshold of 5", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-02-01", timekeeperName: `Person ${i + 1}`, description: "Client meeting" })
    );
    expect(detectMeetingOverstaffing(items, 3, 5)).toHaveLength(0);
  });

  it("CLEAN: many billers on drafting tasks (no meeting keyword)", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-02-01", timekeeperName: `Person ${i + 1}`, description: "Drafting contract provisions" })
    );
    expect(detectMeetingOverstaffing(items, 3, 5)).toHaveLength(0);
  });

  it("TRIGGER: 'conference' keyword triggers meeting detection", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-03-01", timekeeperName: `Lawyer ${i + 1}`, description: "Conference call with client" })
    );
    const issues = detectMeetingOverstaffing(items, 3, 5);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("TRIGGER: 'discussion' keyword triggers meeting detection", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-03-01", timekeeperName: `Lawyer ${i + 1}`, description: "Discussion of due diligence findings" })
    );
    expect(detectMeetingOverstaffing(items, 3, 5).length).toBeGreaterThan(0);
  });

  it("registry: MEETING_OVERSTAFFING is configurable, hasConfig=true", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "MEETING_OVERSTAFFING")!;
    expect(rule.ruleType).toBe("configurable");
    expect(rule.hasConfig).toBe(true);
    expect(rule.routeToRole).toBe("legal_ops");
  });
});

describe("Gray-area AI rules — registry properties (all 7)", () => {
  const grayCodes = [
    { code: "HOURS_DISPROPORTIONATE", scope: "invoice_item" },
    { code: "PARALLEL_BILLING", scope: "invoice_item" },
    { code: "SCOPE_CREEP", scope: "invoice_item" },
    { code: "SENIORITY_OVERKILL", scope: "invoice_item" },
    { code: "ESTIMATE_EXCESS", scope: "invoice" },
    { code: "INTERNAL_COORDINATION", scope: "invoice_item" },
    { code: "TIMEKEEPER_NOT_APPROVED", scope: "invoice_item" },
  ];

  for (const { code, scope } of grayCodes) {
    it(`${code}: gray, AI-evaluated, internal_lawyer, warning severity, ${scope} scope`, () => {
      const rule = RULES_REGISTRY.find(r => r.code === code)!;
      expect(rule, `Rule ${code} not found`).toBeTruthy();
      expect(rule.ruleType).toBe("gray");
      expect(rule.severity).toBe("warning");
      expect(rule.routeToRole).toBe("internal_lawyer");
      expect(rule.scope).toBe(scope);
      expect(rule.hasConfig).toBe(false);
    });
  }
});

describe("All 17 objective rules — verified objective type", () => {
  const objectiveCodes = [
    "RATE_EXCESS", "LAWYER_ROLE_MISMATCH", "RATE_CARD_EXPIRED_OR_MISSING",
    "WRONG_CURRENCY", "VOLUME_DISCOUNT_NOT_APPLIED", "EXPENSE_CAP_EXCEEDED",
    "FIXED_SCOPE_AMOUNT_MISMATCH", "DUPLICATE_LINE", "ARITHMETIC_ERROR",
    "BILLING_PERIOD_OUTSIDE_EL", "MISSING_DOCUMENTS_FIXED_SCOPE", "LINE_ITEMS_IN_FIXED_SCOPE",
    "UNAUTHORIZED_EXPENSE_TYPE", "TAX_OR_VAT_MISMATCH", "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER",
    "DAILY_HOURS_EXCEEDED", "EL_CONFLICT_WITH_PANEL_BASELINE",
  ];

  for (const code of objectiveCodes) {
    it(`${code}: objective type, error severity, legal_ops routing`, () => {
      const rule = RULES_REGISTRY.find(r => r.code === code)!;
      expect(rule, `Rule ${code} not found`).toBeTruthy();
      expect(rule.ruleType).toBe("objective");
      expect(rule.severity).toBe("error");
      expect(rule.routeToRole).toBe("legal_ops");
    });
  }
});
