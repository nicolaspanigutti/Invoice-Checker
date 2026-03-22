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
      "RATE_EXCESS",
      "LAWYER_ROLE_MISMATCH",
      "RATE_CARD_EXPIRED_OR_MISSING",
      "WRONG_CURRENCY",
      "VOLUME_DISCOUNT_NOT_APPLIED",
      "EXPENSE_CAP_EXCEEDED",
      "FIXED_SCOPE_AMOUNT_MISMATCH",
      "DUPLICATE_LINE",
      "ARITHMETIC_ERROR",
      "BILLING_PERIOD_OUTSIDE_EL",
      "MISSING_DOCUMENTS_FIXED_SCOPE",
      "LINE_ITEMS_IN_FIXED_SCOPE",
      "UNAUTHORIZED_EXPENSE_TYPE",
      "TAX_OR_VAT_MISMATCH",
      "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER",
      "DAILY_HOURS_EXCEEDED",
      "EL_CONFLICT_WITH_PANEL_BASELINE",
      "HOURS_DISPROPORTIONATE",
      "PARALLEL_BILLING",
      "SCOPE_CREEP",
      "SENIORITY_OVERKILL",
      "ESTIMATE_EXCESS",
      "INTERNAL_COORDINATION",
      "TIMEKEEPER_NOT_APPROVED",
      "MEETING_OVERSTAFFING",
      "MISSING_LINE_DETAIL",
      "JURISDICTION_UNCLEAR",
    ];
    const codes = new Set(RULES_REGISTRY.map(r => r.code));
    for (const code of expected) {
      expect(codes.has(code), `Missing rule: ${code}`).toBe(true);
    }
  });

  it("gray and warning rules route to internal_lawyer or legal_ops consistently", () => {
    const grayRules = RULES_REGISTRY.filter(r => r.ruleType === "gray");
    for (const rule of grayRules) {
      expect(rule.routeToRole).toBe("internal_lawyer");
    }
    const warningRules = RULES_REGISTRY.filter(r => r.ruleType === "warning");
    for (const rule of warningRules) {
      expect(rule.routeToRole).toBe("legal_ops");
    }
  });

  it("objective rules with error severity route to legal_ops", () => {
    const obj = RULES_REGISTRY.filter(r => r.ruleType === "objective" && r.severity === "error");
    for (const rule of obj) {
      expect(rule.routeToRole, `${rule.code} should route to legal_ops`).toBe("legal_ops");
    }
  });
});

describe("parseAmount helper", () => {
  it("parses numeric strings", () => {
    expect(parseAmount("1234.56")).toBe(1234.56);
  });
  it("returns 0 for null", () => {
    expect(parseAmount(null)).toBe(0);
  });
  it("returns 0 for undefined", () => {
    expect(parseAmount(undefined)).toBe(0);
  });
  it("returns 0 for empty string", () => {
    expect(parseAmount("")).toBe(0);
  });
  it("parses numbers directly", () => {
    expect(parseAmount(42)).toBe(42);
  });
});

describe("ARITHMETIC_ERROR — detectArithmeticErrors", () => {
  it("TRIGGER: amount does not match hours × rate", () => {
    const items = [line({ id: 1, hours: "2.00", rateCharged: "500.00", amount: "900.00" })];
    const issues = detectArithmeticErrors(items);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe(1);
    expect(issues[0].expected).toBeCloseTo(1000, 1);
    expect(issues[0].diff).toBeCloseTo(100, 1);
  });

  it("CLEAN: amount exactly matches hours × rate", () => {
    const items = [line({ id: 2, hours: "2.00", rateCharged: "500.00", amount: "1000.00" })];
    expect(detectArithmeticErrors(items)).toHaveLength(0);
  });

  it("CLEAN: within tolerance (0.5%)", () => {
    const items = [line({ id: 3, hours: "2.00", rateCharged: "500.00", amount: "1004.99" })];
    expect(detectArithmeticErrors(items)).toHaveLength(0);
  });

  it("TRIGGER: outside tolerance (diff > 2%)", () => {
    const items = [line({ id: 4, hours: "2.00", rateCharged: "500.00", amount: "1025.00" })];
    expect(detectArithmeticErrors(items)).toHaveLength(1);
  });

  it("CLEAN: expense lines are skipped", () => {
    const items = [line({ id: 5, isExpenseLine: true, hours: "0", rateCharged: "0", amount: "250.00" })];
    expect(detectArithmeticErrors(items)).toHaveLength(0);
  });

  it("CLEAN: zero hours or zero rate lines are skipped", () => {
    const items = [line({ id: 6, hours: "0", rateCharged: "500.00", amount: "1000.00" })];
    expect(detectArithmeticErrors(items)).toHaveLength(0);
  });

  it("TRIGGER: multiple lines, only one has error", () => {
    const items = [
      line({ id: 10, hours: "2.00", rateCharged: "500.00", amount: "1000.00" }),
      line({ id: 11, hours: "3.00", rateCharged: "300.00", amount: "800.00" }),
    ];
    const issues = detectArithmeticErrors(items);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe(11);
  });
});

describe("DUPLICATE_LINE — detectDuplicateLines", () => {
  it("TRIGGER: two lines with same date, timekeeper, hours, rate", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
    ];
    const groups = detectDuplicateLines(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toContain(1);
    expect(groups[0].ids).toContain(2);
  });

  it("CLEAN: different dates for same timekeeper", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-11", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });

  it("CLEAN: different timekeepers on same date", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Alice", hours: "3.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });

  it("CLEAN: same timekeeper and date but different hours", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Bob", hours: "2.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-10", timekeeperName: "Bob", hours: "3.00", rateCharged: "400.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });

  it("TRIGGER: timekeeper name comparison is case-insensitive", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-10", timekeeperName: "Bob Smith", hours: "3.00", rateCharged: "400.00" }),
      line({ id: 2, workDate: "2025-01-10", timekeeperName: "bob smith", hours: "3.00", rateCharged: "400.00" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(1);
  });

  it("CLEAN: expense lines are excluded from duplicate check", () => {
    const items = [
      line({ id: 1, isExpenseLine: true, workDate: "2025-01-10", timekeeperName: "Bob", hours: "0", rateCharged: "0", amount: "50" }),
      line({ id: 2, isExpenseLine: true, workDate: "2025-01-10", timekeeperName: "Bob", hours: "0", rateCharged: "0", amount: "50" }),
    ];
    expect(detectDuplicateLines(items)).toHaveLength(0);
  });
});

describe("DAILY_HOURS_EXCEEDED — detectDailyHoursExceeded", () => {
  it("TRIGGER: timekeeper bills 9 hours in one day (cap = 8)", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-15", timekeeperName: "Alice", hours: "5.00" }),
      line({ id: 2, workDate: "2025-01-15", timekeeperName: "Alice", hours: "4.00" }),
    ];
    const issues = detectDailyHoursExceeded(items, 8);
    expect(issues).toHaveLength(1);
    expect(issues[0].totalHours).toBeCloseTo(9, 1);
    expect(issues[0].timekeeperName).toBe("alice");
  });

  it("CLEAN: exactly at daily cap", () => {
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

  it("CLEAN: expense lines are excluded", () => {
    const items = [
      line({ id: 1, workDate: "2025-01-15", timekeeperName: "Alice", hours: "9.00", isExpenseLine: true }),
    ];
    expect(detectDailyHoursExceeded(items, 8)).toHaveLength(0);
  });
});

describe("INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER — detectInconsistentRates", () => {
  it("TRIGGER: same timekeeper billed at two different rates", () => {
    const items = [
      line({ id: 1, timekeeperName: "Charlie", rateCharged: "500.00" }),
      line({ id: 2, timekeeperName: "Charlie", rateCharged: "550.00" }),
    ];
    const issues = detectInconsistentRates(items);
    expect(issues).toHaveLength(1);
    expect(issues[0].rates).toContain(500);
    expect(issues[0].rates).toContain(550);
  });

  it("CLEAN: same timekeeper billed consistently at one rate", () => {
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

  it("TRIGGER: name comparison is case-insensitive", () => {
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
});

describe("TAX_OR_VAT_MISMATCH — detectTaxMismatch", () => {
  it("TRIGGER: total does not equal subtotal + tax", () => {
    expect(detectTaxMismatch(1000, 200, 1150)).toBe(true);
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

  it("CLEAN: zero subtotal skipped (no tax check possible)", () => {
    expect(detectTaxMismatch(0, 0, 500)).toBe(false);
  });

  it("TRIGGER: VAT at wrong rate (20% expected but 25% applied)", () => {
    expect(detectTaxMismatch(1000, 250, 1200)).toBe(true);
  });
});

describe("WRONG_CURRENCY — detectWrongCurrency", () => {
  it("TRIGGER: invoice is USD but agreed is GBP", () => {
    expect(detectWrongCurrency("USD", "GBP")).toBe(true);
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

  it("CLEAN: null agreed currency (no agreed currency set)", () => {
    expect(detectWrongCurrency("GBP", null)).toBe(false);
  });

  it("TRIGGER: EUR invoiced but USD agreed", () => {
    expect(detectWrongCurrency("EUR", "USD")).toBe(true);
  });
});

describe("FIXED_SCOPE_AMOUNT_MISMATCH — detectFixedScopeAmountMismatch", () => {
  it("TRIGGER: invoice total exceeds agreed fixed fee", () => {
    expect(detectFixedScopeAmountMismatch(55000, 50000)).toBe(true);
  });

  it("CLEAN: invoice total equals agreed fixed fee", () => {
    expect(detectFixedScopeAmountMismatch(50000, 50000)).toBe(false);
  });

  it("CLEAN: invoice total slightly below fixed fee", () => {
    expect(detectFixedScopeAmountMismatch(49000, 50000)).toBe(false);
  });

  it("CLEAN: agreed fee is zero (no fee set)", () => {
    expect(detectFixedScopeAmountMismatch(50000, 0)).toBe(false);
  });

  it("TRIGGER: small overage above tolerance", () => {
    expect(detectFixedScopeAmountMismatch(50300, 50000)).toBe(true);
  });

  it("CLEAN: within tolerance (0.5%)", () => {
    expect(detectFixedScopeAmountMismatch(50200, 50000)).toBe(false);
  });
});

describe("RATE_EXCESS — detectRateExcess", () => {
  it("TRIGGER: charged rate exceeds approved rate", () => {
    expect(detectRateExcess(600, 500)).toBe(true);
  });

  it("CLEAN: charged rate equals approved rate", () => {
    expect(detectRateExcess(500, 500)).toBe(false);
  });

  it("CLEAN: charged rate below approved rate", () => {
    expect(detectRateExcess(450, 500)).toBe(false);
  });

  it("CLEAN: approved rate is zero (no rate card set)", () => {
    expect(detectRateExcess(500, 0)).toBe(false);
  });

  it("CLEAN: within tolerance (0.5%)", () => {
    expect(detectRateExcess(502, 500)).toBe(false);
  });

  it("TRIGGER: just outside tolerance", () => {
    expect(detectRateExcess(503, 500)).toBe(true);
  });
});

describe("MEETING_OVERSTAFFING — detectMeetingOverstaffing", () => {
  it("TRIGGER: six timekeepers billed for same meeting", () => {
    const meetingItems = Array.from({ length: 6 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-02-01", timekeeperName: `Person ${i + 1}`, description: "Client meeting re acquisition" })
    );
    const issues = detectMeetingOverstaffing(meetingItems, 3, 5);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].attendeeCount).toBe(6);
  });

  it("CLEAN: four timekeepers for a meeting within threshold of 5", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-02-01", timekeeperName: `Person ${i + 1}`, description: "Client meeting" })
    );
    const issues = detectMeetingOverstaffing(items, 3, 5);
    expect(issues).toHaveLength(0);
  });

  it("CLEAN: many billers on non-meeting tasks", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-02-01", timekeeperName: `Person ${i + 1}`, description: "Drafting contract provisions" })
    );
    expect(detectMeetingOverstaffing(items, 3, 5)).toHaveLength(0);
  });

  it("TRIGGER: meeting keyword 'conference' triggers detection", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      line({ id: i + 1, workDate: "2025-03-01", timekeeperName: `Lawyer ${i + 1}`, description: "Conference call with client" })
    );
    const issues = detectMeetingOverstaffing(items, 3, 5);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("MISSING_LINE_DETAIL — registry properties", () => {
  it("is a warning-type rule, not objective or gray", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "MISSING_LINE_DETAIL")!;
    expect(rule.ruleType).toBe("warning");
    expect(rule.severity).toBe("warning");
  });

  it("routes to legal_ops", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "MISSING_LINE_DETAIL")!;
    expect(rule.routeToRole).toBe("legal_ops");
  });
});

describe("JURISDICTION_UNCLEAR — registry properties", () => {
  it("is a warning-type rule", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "JURISDICTION_UNCLEAR")!;
    expect(rule.ruleType).toBe("warning");
    expect(rule.severity).toBe("warning");
  });

  it("routes to legal_ops", () => {
    const rule = RULES_REGISTRY.find(r => r.code === "JURISDICTION_UNCLEAR")!;
    expect(rule.routeToRole).toBe("legal_ops");
  });
});

describe("Gray-area rules — registry properties", () => {
  const grayCodes = [
    "HOURS_DISPROPORTIONATE",
    "PARALLEL_BILLING",
    "SCOPE_CREEP",
    "SENIORITY_OVERKILL",
    "ESTIMATE_EXCESS",
    "INTERNAL_COORDINATION",
    "TIMEKEEPER_NOT_APPROVED",
  ];

  for (const code of grayCodes) {
    it(`${code} is AI-evaluated, routes to internal_lawyer, has warning severity`, () => {
      const rule = RULES_REGISTRY.find(r => r.code === code)!;
      expect(rule, `Rule ${code} not found`).toBeTruthy();
      expect(rule.ruleType).toBe("gray");
      expect(rule.severity).toBe("warning");
      expect(rule.routeToRole).toBe("internal_lawyer");
    });
  }
});

describe("Objective rules — presence check", () => {
  const objectiveCodes = [
    "RATE_EXCESS",
    "LAWYER_ROLE_MISMATCH",
    "RATE_CARD_EXPIRED_OR_MISSING",
    "WRONG_CURRENCY",
    "VOLUME_DISCOUNT_NOT_APPLIED",
    "EXPENSE_CAP_EXCEEDED",
    "FIXED_SCOPE_AMOUNT_MISMATCH",
    "DUPLICATE_LINE",
    "ARITHMETIC_ERROR",
    "BILLING_PERIOD_OUTSIDE_EL",
    "MISSING_DOCUMENTS_FIXED_SCOPE",
    "LINE_ITEMS_IN_FIXED_SCOPE",
    "UNAUTHORIZED_EXPENSE_TYPE",
    "TAX_OR_VAT_MISMATCH",
    "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER",
    "DAILY_HOURS_EXCEEDED",
    "EL_CONFLICT_WITH_PANEL_BASELINE",
  ];

  for (const code of objectiveCodes) {
    it(`${code} is an objective rule with error severity`, () => {
      const rule = RULES_REGISTRY.find(r => r.code === code)!;
      expect(rule, `Rule ${code} not found`).toBeTruthy();
      expect(rule.ruleType).toBe("objective");
      expect(rule.severity).toBe("error");
    });
  }
});
