import { describe, it, expect } from "vitest";

type ConfigJson = Record<string, unknown>;

function validateMeetingOverstaffingConfig(configJson: ConfigJson): string | null {
  const minAttendees = typeof configJson.min_attendees === "number" ? configJson.min_attendees : null;
  const maxAttendees = typeof configJson.max_attendees === "number" ? configJson.max_attendees : null;

  if (minAttendees !== null && (!Number.isInteger(minAttendees) || minAttendees < 1)) {
    return "min_attendees must be a positive integer (≥ 1)";
  }
  if (maxAttendees !== null && (!Number.isInteger(maxAttendees) || maxAttendees < 1)) {
    return "max_attendees must be a positive integer (≥ 1)";
  }
  if (minAttendees !== null && maxAttendees !== null && maxAttendees < minAttendees) {
    return "max_attendees must be greater than or equal to min_attendees";
  }
  return null;
}

describe("MEETING_OVERSTAFFING config validation — server-side logic", () => {
  it("VALID: min=2 max=5 → no error", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: 2, max_attendees: 5 })).toBeNull();
  });

  it("VALID: min=3 max=3 → equal is allowed", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: 3, max_attendees: 3 })).toBeNull();
  });

  it("VALID: only min_attendees provided → no error", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: 2 })).toBeNull();
  });

  it("VALID: only max_attendees provided → no error", () => {
    expect(validateMeetingOverstaffingConfig({ max_attendees: 5 })).toBeNull();
  });

  it("VALID: empty config → no error", () => {
    expect(validateMeetingOverstaffingConfig({})).toBeNull();
  });

  it("INVALID: min_attendees=0 → rejects", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: 0, max_attendees: 5 })).toBe(
      "min_attendees must be a positive integer (≥ 1)"
    );
  });

  it("INVALID: min_attendees=-1 → rejects", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: -1 })).toBe(
      "min_attendees must be a positive integer (≥ 1)"
    );
  });

  it("INVALID: max_attendees=0 → rejects", () => {
    expect(validateMeetingOverstaffingConfig({ max_attendees: 0 })).toBe(
      "max_attendees must be a positive integer (≥ 1)"
    );
  });

  it("INVALID: max < min → rejects", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: 5, max_attendees: 3 })).toBe(
      "max_attendees must be greater than or equal to min_attendees"
    );
  });

  it("INVALID: non-integer float for min_attendees → rejects", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: 2.5, max_attendees: 5 })).toBe(
      "min_attendees must be a positive integer (≥ 1)"
    );
  });

  it("INVALID: non-integer float for max_attendees → rejects", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: 2, max_attendees: 5.5 })).toBe(
      "max_attendees must be a positive integer (≥ 1)"
    );
  });

  it("VALID: non-numeric fields ignored — only numeric fields validated", () => {
    expect(validateMeetingOverstaffingConfig({ min_attendees: 2, max_attendees: 5, notes: "custom" })).toBeNull();
  });
});

describe("Reconciliation logic — issue key composite and status transition", () => {
  type IssueStatus =
    | "open"
    | "accepted_by_legal_ops"
    | "rejected_by_legal_ops"
    | "escalated_to_internal_lawyer"
    | "accepted_by_internal_lawyer"
    | "rejected_by_internal_lawyer"
    | "no_longer_applicable";

  interface MockIssue {
    ruleCode: string;
    invoiceItemId: number | null;
    issueStatus: IssueStatus;
  }

  const DECIDED_STATUSES: IssueStatus[] = [
    "accepted_by_legal_ops",
    "rejected_by_legal_ops",
    "escalated_to_internal_lawyer",
    "accepted_by_internal_lawyer",
    "rejected_by_internal_lawyer",
    "no_longer_applicable",
  ];

  function compositeKey(ruleCode: string, itemId: number | null): string {
    return `${ruleCode}::${itemId ?? "null"}`;
  }

  function reconcileIssues(
    prevIssues: MockIssue[],
    newRuleCodes: Set<string>,
  ): { code: string; newStatus: IssueStatus }[] {
    const transitions: { code: string; newStatus: IssueStatus }[] = [];

    for (const prev of prevIssues) {
      const key = compositeKey(prev.ruleCode, prev.invoiceItemId);
      const stillFires = newRuleCodes.has(key);
      if (!stillFires && !DECIDED_STATUSES.includes(prev.issueStatus)) {
        transitions.push({ code: prev.ruleCode, newStatus: "no_longer_applicable" });
      }
    }

    return transitions;
  }

  it("issue still firing → no transition", () => {
    const prev: MockIssue[] = [
      { ruleCode: "ARITHMETIC_ERROR", invoiceItemId: 1, issueStatus: "open" },
    ];
    const newKeys = new Set(["ARITHMETIC_ERROR::1"]);
    expect(reconcileIssues(prev, newKeys)).toHaveLength(0);
  });

  it("open issue no longer firing → transitions to no_longer_applicable", () => {
    const prev: MockIssue[] = [
      { ruleCode: "ARITHMETIC_ERROR", invoiceItemId: 1, issueStatus: "open" },
    ];
    const newKeys = new Set<string>();
    const transitions = reconcileIssues(prev, newKeys);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].newStatus).toBe("no_longer_applicable");
    expect(transitions[0].code).toBe("ARITHMETIC_ERROR");
  });

  it("decided issue no longer firing → skipped (not overwritten)", () => {
    for (const status of DECIDED_STATUSES) {
      const prev: MockIssue[] = [
        { ruleCode: "RATE_EXCESS", invoiceItemId: 2, issueStatus: status },
      ];
      const newKeys = new Set<string>();
      const transitions = reconcileIssues(prev, newKeys);
      expect(transitions).toHaveLength(0);
    }
  });

  it("escalated_to_internal_lawyer issue no longer firing → preserved (not overwritten)", () => {
    const prev: MockIssue[] = [
      { ruleCode: "SCOPE_CREEP", invoiceItemId: 5, issueStatus: "escalated_to_internal_lawyer" },
    ];
    const newKeys = new Set<string>();
    const transitions = reconcileIssues(prev, newKeys);
    expect(transitions).toHaveLength(0);
  });

  it("composite key correctly distinguishes same ruleCode with different line items", () => {
    const prev: MockIssue[] = [
      { ruleCode: "DUPLICATE_LINE", invoiceItemId: 10, issueStatus: "open" },
      { ruleCode: "DUPLICATE_LINE", invoiceItemId: 20, issueStatus: "open" },
    ];
    const newKeys = new Set(["DUPLICATE_LINE::10"]);
    const transitions = reconcileIssues(prev, newKeys);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].code).toBe("DUPLICATE_LINE");
  });

  it("invoice-level issue (null itemId) uses null key correctly", () => {
    const prev: MockIssue[] = [
      { ruleCode: "WRONG_CURRENCY", invoiceItemId: null, issueStatus: "open" },
    ];
    const newKeys = new Set<string>();
    const transitions = reconcileIssues(prev, newKeys);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].newStatus).toBe("no_longer_applicable");
  });

  it("multiple prev issues — only unfired non-decided transition", () => {
    const prev: MockIssue[] = [
      { ruleCode: "ARITHMETIC_ERROR", invoiceItemId: 1, issueStatus: "open" },
      { ruleCode: "RATE_EXCESS", invoiceItemId: 2, issueStatus: "accepted_by_legal_ops" },
      { ruleCode: "DUPLICATE_LINE", invoiceItemId: null, issueStatus: "open" },
      { ruleCode: "WRONG_CURRENCY", invoiceItemId: null, issueStatus: "open" },
    ];
    const newKeys = new Set(["ARITHMETIC_ERROR::1", "WRONG_CURRENCY::null"]);
    const transitions = reconcileIssues(prev, newKeys);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].code).toBe("DUPLICATE_LINE");
    expect(transitions[0].newStatus).toBe("no_longer_applicable");
  });
});
