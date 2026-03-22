import { describe, it, expect } from "vitest";
import { parseGreyRulesResponse, type GreyRuleParseContext } from "../lib/runAnalysis";

function allActive(_code: string): boolean { return true; }
function noneActive(_code: string): boolean { return false; }
function only(...codes: string[]): (code: string) => boolean {
  return (code: string) => codes.includes(code);
}

const baseItems = [
  { id: 10, lineNo: 1 },
  { id: 11, lineNo: 2 },
  { id: 12, lineNo: 3 },
];

function baseCtx(overrides: Partial<GreyRuleParseContext> = {}): GreyRuleParseContext {
  return {
    invoiceId: 1,
    runId: 99,
    currency: "GBP",
    matterName: "Test Matter",
    items: baseItems,
    isRuleActive: allActive,
    ...overrides,
  };
}

describe("EL_CONFLICT_WITH_PANEL_BASELINE — parse output template", () => {
  it("TRIGGER: fires=true + conflict_description → objective error to legal_ops", () => {
    const parsed = {
      EL_CONFLICT_WITH_PANEL_BASELINE: {
        fires: true,
        conflict_description: "EL rate cap GBP 600/h conflicts with panel max GBP 500/h for Partner",
        baseline_source: "Panel T&C 2024",
        baseline_value: "GBP 500/h",
        el_value: "GBP 600/h",
      },
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx());
    expect(issues).toHaveLength(1);
    const iss = issues[0];
    expect(iss.ruleCode).toBe("EL_CONFLICT_WITH_PANEL_BASELINE");
    expect(iss.ruleType).toBe("objective");
    expect(iss.severity).toBe("error");
    expect(iss.evaluatorType).toBe("heuristic");
    expect(iss.routeToRole).toBe("legal_ops");
    expect(iss.issueStatus).toBe("open");
    const ev = iss.evidenceJson as Record<string, unknown>;
    expect(ev.el_source).toBe("Engagement Letter");
    expect(ev.conflict_description).toBe("EL rate cap GBP 600/h conflicts with panel max GBP 500/h for Partner");
    expect(ev.baseline_source).toBe("Panel T&C 2024");
    expect(ev.baseline_value).toBe("GBP 500/h");
    expect(ev.el_value).toBe("GBP 600/h");
  });

  it("CLEAN: fires=false → no issues", () => {
    const parsed = { EL_CONFLICT_WITH_PANEL_BASELINE: { fires: false } };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });

  it("CLEAN: fires=true but no conflict_description → no issues", () => {
    const parsed = { EL_CONFLICT_WITH_PANEL_BASELINE: { fires: true } };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });

  it("CLEAN: rule inactive → no issues", () => {
    const parsed = {
      EL_CONFLICT_WITH_PANEL_BASELINE: {
        fires: true,
        conflict_description: "Some conflict",
      },
    };
    expect(parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: noneActive }))).toHaveLength(0);
  });
});

describe("HOURS_DISPROPORTIONATE — parse output template", () => {
  it("TRIGGER: two entries → two issues", () => {
    const parsed = {
      HOURS_DISPROPORTIONATE: [
        { fires: true, timekeeper_label: "Alice Senior", role_normalized: "senior_associate", total_hours: 90, billing_period: "January 2025", task_description: "Document review", heuristic_reasoning: "90h on one task is unusually high." },
        { fires: true, timekeeper_label: "Bob Partner", role_normalized: "partner", total_hours: 40, billing_period: "January 2025", task_description: "Client calls", heuristic_reasoning: "40h of partner calls seems high." },
      ],
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("HOURS_DISPROPORTIONATE") }));
    expect(issues).toHaveLength(2);
    for (const iss of issues) {
      expect(iss.ruleCode).toBe("HOURS_DISPROPORTIONATE");
      expect(iss.ruleType).toBe("gray");
      expect(iss.severity).toBe("warning");
      expect(iss.routeToRole).toBe("internal_lawyer");
    }
    const ev0 = issues[0].evidenceJson as Record<string, unknown>;
    expect(ev0.timekeeper_label).toBe("Alice Senior");
    expect(ev0.total_hours).toBe(90);
  });

  it("CLEAN: fires=false entry skipped", () => {
    const parsed = {
      HOURS_DISPROPORTIONATE: [
        { fires: false, timekeeper_label: "Alice", total_hours: 5 },
        { fires: true, timekeeper_label: "Bob", role_normalized: "associate", total_hours: 80, task_description: "Research" },
      ],
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("HOURS_DISPROPORTIONATE") }));
    expect(issues).toHaveLength(1);
    expect((issues[0].evidenceJson as Record<string, unknown>).timekeeper_label).toBe("Bob");
  });

  it("CLEAN: missing timekeeper_label entry skipped", () => {
    const parsed = {
      HOURS_DISPROPORTIONATE: [{ fires: true, total_hours: 99 }],
    };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });
});

describe("PARALLEL_BILLING — parse output template", () => {
  it("TRIGGER: fires=true + date → warning to internal_lawyer", () => {
    const parsed = {
      PARALLEL_BILLING: [{
        fires: true,
        date: "2025-04-10",
        timekeeper_list: ["Alice", "Bob"],
        descriptions: ["Reviewing claim", "Review of claim documents"],
        hours_each: [3, 3],
        amounts_each: [1500, 1200],
        total_hours: 6,
        total_amount: 2700,
        heuristic_reasoning: "Both timekeepers billed overlapping review work.",
      }],
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("PARALLEL_BILLING") }));
    expect(issues).toHaveLength(1);
    const iss = issues[0];
    expect(iss.ruleCode).toBe("PARALLEL_BILLING");
    expect(iss.ruleType).toBe("gray");
    expect(iss.severity).toBe("warning");
    expect(iss.routeToRole).toBe("internal_lawyer");
    const ev = iss.evidenceJson as Record<string, unknown>;
    expect(ev.date).toBe("2025-04-10");
    expect(ev.total_hours).toBe(6);
    expect(ev.total_amount).toBe(2700);
    expect(Array.isArray(ev.timekeeper_list)).toBe(true);
    expect(iss.explanationText).toContain("GBP 2700.00");
  });

  it("CLEAN: fires=false or missing date → skipped", () => {
    const parsed = {
      PARALLEL_BILLING: [
        { fires: false, date: "2025-04-10" },
        { fires: true },
      ],
    };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });
});

describe("SCOPE_CREEP — parse output template", () => {
  it("TRIGGER: fires=true with line_no → warning + invoiceItemId resolved", () => {
    const parsed = {
      SCOPE_CREEP: [{
        fires: true,
        line_no: 2,
        description: "Drafting unrelated IP patent",
        el_scope_summary: "M&A transaction only",
        el_date: "2025-01-10",
        matter_name: "Acquisition Co.",
        heuristic_reasoning: "IP work is outside M&A scope.",
      }],
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("SCOPE_CREEP") }));
    expect(issues).toHaveLength(1);
    const iss = issues[0];
    expect(iss.ruleCode).toBe("SCOPE_CREEP");
    expect(iss.ruleType).toBe("gray");
    expect(iss.routeToRole).toBe("internal_lawyer");
    expect(iss.invoiceItemId).toBe(11);
    const ev = iss.evidenceJson as Record<string, unknown>;
    expect(ev.line_no).toBe(2);
    expect(ev.el_scope_summary).toBe("M&A transaction only");
  });

  it("CLEAN: fires=false or missing line_no → skipped", () => {
    const parsed = {
      SCOPE_CREEP: [
        { fires: false, line_no: 1 },
        { fires: true },
      ],
    };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });
});

describe("SENIORITY_OVERKILL — parse output template", () => {
  it("TRIGGER: senior billing routine task → warning + invoiceItemId", () => {
    const parsed = {
      SENIORITY_OVERKILL: [{
        fires: true,
        line_no: 1,
        timekeeper_label: "David QC",
        role_normalized: "partner",
        rate_charged: 900,
        hours: 2,
        amount: 1800,
        description: "Printing and photocopying documents",
        heuristic_reasoning: "Routine admin task billed at partner rate.",
      }],
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("SENIORITY_OVERKILL") }));
    expect(issues).toHaveLength(1);
    const iss = issues[0];
    expect(iss.ruleCode).toBe("SENIORITY_OVERKILL");
    expect(iss.ruleType).toBe("gray");
    expect(iss.invoiceItemId).toBe(10);
    const ev = iss.evidenceJson as Record<string, unknown>;
    expect(ev.rate_charged).toBe(900);
    expect(ev.description).toBe("Printing and photocopying documents");
    expect(iss.explanationText).toContain("GBP 900/h");
  });

  it("CLEAN: fires=false → skipped", () => {
    const parsed = { SENIORITY_OVERKILL: [{ fires: false, line_no: 1 }] };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });
});

describe("ESTIMATE_EXCESS — parse output template", () => {
  it("TRIGGER: fires=true with estimate → warning to internal_lawyer", () => {
    const parsed = {
      ESTIMATE_EXCESS: {
        fires: true,
        estimate_amount: 100000,
        source_document: "Budget Letter 2025",
        source_date: "2025-01-15",
        cumulative_fees: 120000,
        excess_amount: 20000,
        excess_pct: 20.0,
        revised_estimate_provided: false,
      },
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("ESTIMATE_EXCESS") }));
    expect(issues).toHaveLength(1);
    const iss = issues[0];
    expect(iss.ruleCode).toBe("ESTIMATE_EXCESS");
    expect(iss.ruleType).toBe("gray");
    expect(iss.routeToRole).toBe("internal_lawyer");
    const ev = iss.evidenceJson as Record<string, unknown>;
    expect(ev.estimate_amount).toBe(100000);
    expect(ev.excess_amount).toBe(20000);
    expect(ev.excess_pct).toBe(20.0);
    expect(ev.revised_estimate_provided).toBe(false);
    expect(iss.explanationText).toContain("not ");
    expect(iss.explanationText).toContain("Budget Letter 2025");
  });

  it("TRIGGER: revised estimate provided — text does not say 'not'", () => {
    const parsed = {
      ESTIMATE_EXCESS: {
        fires: true,
        estimate_amount: 50000,
        cumulative_fees: 60000,
        excess_amount: 10000,
        excess_pct: 20,
        revised_estimate_provided: true,
      },
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("ESTIMATE_EXCESS") }));
    expect(issues).toHaveLength(1);
    expect(issues[0].explanationText).not.toContain("not provided");
  });

  it("CLEAN: fires=false → no issue", () => {
    const parsed = { ESTIMATE_EXCESS: { fires: false, estimate_amount: 100000 } };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });

  it("CLEAN: fires=true but no estimate_amount → no issue", () => {
    const parsed = { ESTIMATE_EXCESS: { fires: true } };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });
});

describe("INTERNAL_COORDINATION — parse output template", () => {
  it("TRIGGER: fires=true with line_no → warning + invoiceItemId", () => {
    const parsed = {
      INTERNAL_COORDINATION: [{
        fires: true,
        line_no: 3,
        timekeeper_label: "Eve Trainee",
        role_normalized: "trainee",
        hours: 4,
        amount: 400,
        description: "Internal team briefing on matter strategy",
        heuristic_reasoning: "Internal knowledge transfer is non-billable.",
      }],
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("INTERNAL_COORDINATION") }));
    expect(issues).toHaveLength(1);
    const iss = issues[0];
    expect(iss.ruleCode).toBe("INTERNAL_COORDINATION");
    expect(iss.ruleType).toBe("gray");
    expect(iss.invoiceItemId).toBe(12);
    const ev = iss.evidenceJson as Record<string, unknown>;
    expect(ev.line_no).toBe(3);
    expect(ev.hours).toBe(4);
    expect(iss.explanationText).toContain("internal coordination");
  });

  it("CLEAN: fires=false → skipped", () => {
    const parsed = { INTERNAL_COORDINATION: [{ fires: false, line_no: 1 }] };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });

  it("CLEAN: missing line_no → skipped", () => {
    const parsed = { INTERNAL_COORDINATION: [{ fires: true }] };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });
});

describe("TIMEKEEPER_NOT_APPROVED — parse output template", () => {
  it("TRIGGER: fires=true with line_no → warning to internal_lawyer", () => {
    const parsed = {
      TIMEKEEPER_NOT_APPROVED: [{
        fires: true,
        line_no: 1,
        timekeeper_label: "Frank Consultant",
        role_normalized: "consultant",
        hours: 5,
        amount: 2500,
        heuristic_reasoning: "Not listed in EL staffing annex.",
      }],
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: only("TIMEKEEPER_NOT_APPROVED") }));
    expect(issues).toHaveLength(1);
    const iss = issues[0];
    expect(iss.ruleCode).toBe("TIMEKEEPER_NOT_APPROVED");
    expect(iss.ruleType).toBe("gray");
    expect(iss.routeToRole).toBe("internal_lawyer");
    expect(iss.invoiceItemId).toBe(10);
    const ev = iss.evidenceJson as Record<string, unknown>;
    expect(ev.timekeeper_label).toBe("Frank Consultant");
    expect(ev.source_document).toBe("Engagement Letter (staffing annex)");
    expect(ev.hours).toBe(5);
    expect(iss.explanationText).toContain("approved staffing list");
  });

  it("CLEAN: fires=false → skipped", () => {
    const parsed = { TIMEKEEPER_NOT_APPROVED: [{ fires: false, line_no: 1 }] };
    expect(parseGreyRulesResponse(parsed, baseCtx())).toHaveLength(0);
  });

  it("CLEAN: rule inactive → no issues", () => {
    const parsed = {
      TIMEKEEPER_NOT_APPROVED: [{ fires: true, line_no: 1, timekeeper_label: "X" }],
    };
    expect(parseGreyRulesResponse(parsed, baseCtx({ isRuleActive: noneActive }))).toHaveLength(0);
  });
});

describe("Gray rule deactivation — all 8 rules respect isRuleActive=false", () => {
  const greyRuleCodes = [
    "EL_CONFLICT_WITH_PANEL_BASELINE",
    "HOURS_DISPROPORTIONATE",
    "PARALLEL_BILLING",
    "SCOPE_CREEP",
    "SENIORITY_OVERKILL",
    "ESTIMATE_EXCESS",
    "INTERNAL_COORDINATION",
    "TIMEKEEPER_NOT_APPROVED",
  ];

  for (const code of greyRuleCodes) {
    it(`${code}: inactive rule produces no issues`, () => {
      const parsed = {
        EL_CONFLICT_WITH_PANEL_BASELINE: { fires: true, conflict_description: "Conflict X" },
        HOURS_DISPROPORTIONATE: [{ fires: true, timekeeper_label: "A", total_hours: 90, task_description: "Docs" }],
        PARALLEL_BILLING: [{ fires: true, date: "2025-05-01", total_hours: 6, total_amount: 2700 }],
        SCOPE_CREEP: [{ fires: true, line_no: 1, description: "Out of scope" }],
        SENIORITY_OVERKILL: [{ fires: true, line_no: 2, timekeeper_label: "B", role_normalized: "partner", rate_charged: 900, hours: 2, amount: 1800, description: "Filing" }],
        ESTIMATE_EXCESS: { fires: true, estimate_amount: 50000, cumulative_fees: 60000, excess_amount: 10000, excess_pct: 20 },
        INTERNAL_COORDINATION: [{ fires: true, line_no: 3, timekeeper_label: "C", hours: 3, amount: 300, description: "Team briefing" }],
        TIMEKEEPER_NOT_APPROVED: [{ fires: true, line_no: 1, timekeeper_label: "D", hours: 4, amount: 400 }],
      };
      const ctx = baseCtx({ isRuleActive: (c: string) => c !== code });
      const issues = parseGreyRulesResponse(parsed, ctx);
      const ruleIssues = issues.filter(i => i.ruleCode === code);
      expect(ruleIssues).toHaveLength(0);
    });
  }
});

describe("parseGreyRulesResponse — mixed response", () => {
  it("handles all 8 rules firing simultaneously", () => {
    const parsed = {
      EL_CONFLICT_WITH_PANEL_BASELINE: { fires: true, conflict_description: "Rate conflict" },
      HOURS_DISPROPORTIONATE: [{ fires: true, timekeeper_label: "A", total_hours: 80, task_description: "Research" }],
      PARALLEL_BILLING: [{ fires: true, date: "2025-05-01", total_hours: 4, total_amount: 2000 }],
      SCOPE_CREEP: [{ fires: true, line_no: 1, description: "IP filing" }],
      SENIORITY_OVERKILL: [{ fires: true, line_no: 2, timekeeper_label: "B", role_normalized: "partner", rate_charged: 900, hours: 1, amount: 900, description: "Photocopying" }],
      ESTIMATE_EXCESS: { fires: true, estimate_amount: 50000, cumulative_fees: 60000, excess_amount: 10000, excess_pct: 20 },
      INTERNAL_COORDINATION: [{ fires: true, line_no: 3, timekeeper_label: "C", hours: 2, amount: 200, description: "Team meeting" }],
      TIMEKEEPER_NOT_APPROVED: [{ fires: true, line_no: 1, timekeeper_label: "D", hours: 3, amount: 300 }],
    };
    const issues = parseGreyRulesResponse(parsed, baseCtx());
    expect(issues.length).toBeGreaterThanOrEqual(8);
    const codes = issues.map(i => i.ruleCode);
    for (const code of [
      "EL_CONFLICT_WITH_PANEL_BASELINE",
      "HOURS_DISPROPORTIONATE",
      "PARALLEL_BILLING",
      "SCOPE_CREEP",
      "SENIORITY_OVERKILL",
      "ESTIMATE_EXCESS",
      "INTERNAL_COORDINATION",
      "TIMEKEEPER_NOT_APPROVED",
    ]) {
      expect(codes).toContain(code);
    }
  });

  it("returns empty array for empty parsed response", () => {
    expect(parseGreyRulesResponse({}, baseCtx())).toHaveLength(0);
  });
});
