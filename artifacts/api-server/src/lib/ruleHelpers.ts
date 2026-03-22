export function parseAmount(v: string | number | null | undefined): number {
  return parseFloat(String(v ?? "0")) || 0;
}

export interface LineItem {
  id: number;
  workDate: string | null;
  timekeeperName: string | null;
  hours: string | null;
  rateCharged: string | null;
  amount: string | null;
  isExpenseLine: boolean;
  expenseType: string | null;
  description: string | null;
  roleRaw: string | null;
}

export interface ArithmeticIssue {
  id: number;
  hours: number;
  rate: number;
  amount: number;
  expected: number;
  diff: number;
}

export function detectArithmeticErrors(items: LineItem[], tolerancePct = 0.02): ArithmeticIssue[] {
  const issues: ArithmeticIssue[] = [];
  for (const item of items) {
    if (item.isExpenseLine) continue;
    const hours = parseAmount(item.hours);
    const rate = parseAmount(item.rateCharged);
    const amount = parseAmount(item.amount);
    if (hours <= 0 || rate <= 0 || amount <= 0) continue;
    const expected = hours * rate;
    const diff = Math.abs(amount - expected);
    const tolerance = expected * tolerancePct;
    if (diff > tolerance && diff > 0.01) {
      issues.push({ id: item.id, hours, rate, amount, expected, diff });
    }
  }
  return issues;
}

export interface DuplicateGroup {
  key: string;
  ids: number[];
}

export function detectDuplicateLines(items: LineItem[]): DuplicateGroup[] {
  const seen = new Map<string, number[]>();
  for (const item of items) {
    if (item.isExpenseLine) continue;
    const hours = parseAmount(item.hours);
    const rate = parseAmount(item.rateCharged);
    if (!item.workDate || hours <= 0 || rate <= 0) continue;
    const key = `${item.workDate}|${(item.timekeeperName ?? "").toLowerCase().trim()}|${hours.toFixed(2)}|${rate.toFixed(2)}`;
    const group = seen.get(key) ?? [];
    group.push(item.id);
    seen.set(key, group);
  }
  return Array.from(seen.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

export interface DailyHoursIssue {
  timekeeperName: string;
  workDate: string;
  totalHours: number;
  itemIds: number[];
}

export function detectDailyHoursExceeded(items: LineItem[], maxHours = 8): DailyHoursIssue[] {
  const daily = new Map<string, { totalHours: number; itemIds: number[] }>();
  for (const item of items) {
    if (item.isExpenseLine) continue;
    const hours = parseAmount(item.hours);
    if (!item.workDate || !item.timekeeperName || hours <= 0) continue;
    const key = `${item.workDate}|${item.timekeeperName.toLowerCase().trim()}`;
    const entry = daily.get(key) ?? { totalHours: 0, itemIds: [] };
    entry.totalHours += hours;
    entry.itemIds.push(item.id);
    daily.set(key, entry);
  }
  const issues: DailyHoursIssue[] = [];
  for (const [key, { totalHours, itemIds }] of daily.entries()) {
    if (totalHours > maxHours) {
      const [workDate, timekeeperName] = key.split("|");
      issues.push({ timekeeperName, workDate, totalHours, itemIds });
    }
  }
  return issues;
}

export interface InconsistentRateIssue {
  timekeeperName: string;
  rates: number[];
  itemIds: number[];
}

export function detectInconsistentRates(items: LineItem[]): InconsistentRateIssue[] {
  const byTimekeeper = new Map<string, { rates: Set<number>; itemIds: number[] }>();
  for (const item of items) {
    if (item.isExpenseLine) continue;
    const rate = parseAmount(item.rateCharged);
    if (!item.timekeeperName || rate <= 0) continue;
    const key = item.timekeeperName.toLowerCase().trim();
    const entry = byTimekeeper.get(key) ?? { rates: new Set(), itemIds: [] };
    entry.rates.add(rate);
    entry.itemIds.push(item.id);
    byTimekeeper.set(key, entry);
  }
  const issues: InconsistentRateIssue[] = [];
  for (const [key, { rates, itemIds }] of byTimekeeper.entries()) {
    if (rates.size > 1) {
      issues.push({ timekeeperName: key, rates: Array.from(rates), itemIds });
    }
  }
  return issues;
}

export function detectTaxMismatch(
  subtotal: number,
  taxAmount: number,
  total: number,
  tolerancePct = 0.01
): boolean {
  if (subtotal <= 0) return false;
  const expected = subtotal + taxAmount;
  const diff = Math.abs(total - expected);
  const tolerance = Math.max(expected * tolerancePct, 0.02);
  return diff > tolerance;
}

export function detectWrongCurrency(
  invoiceCurrency: string | null,
  agreedCurrency: string | null
): boolean {
  if (!invoiceCurrency || !agreedCurrency) return false;
  return invoiceCurrency.toUpperCase() !== agreedCurrency.toUpperCase();
}

export function detectFixedScopeAmountMismatch(
  invoiceTotal: number,
  agreedFee: number,
  tolerancePct = 0.005
): boolean {
  if (agreedFee <= 0) return false;
  const tolerance = agreedFee * tolerancePct;
  return invoiceTotal > agreedFee + tolerance;
}

export function detectMeetingOverstaffing(
  items: LineItem[],
  minAttendees = 3,
  maxAttendees = 5
): { date: string; description: string; attendeeCount: number; itemIds: number[] }[] {
  const MEETING_KEYWORDS = ["meeting", "call", "conference", "discussion", "debrief", "briefing"];
  const byMeeting = new Map<string, { attendeeCount: number; itemIds: number[] }>();
  for (const item of items) {
    if (item.isExpenseLine) continue;
    const desc = (item.description ?? "").toLowerCase();
    const isMeeting = MEETING_KEYWORDS.some(kw => desc.includes(kw));
    if (!isMeeting || !item.workDate) continue;
    const key = `${item.workDate}|${desc.slice(0, 60)}`;
    const entry = byMeeting.get(key) ?? { attendeeCount: 0, itemIds: [] };
    entry.attendeeCount += 1;
    entry.itemIds.push(item.id);
    byMeeting.set(key, entry);
  }
  const issues: { date: string; description: string; attendeeCount: number; itemIds: number[] }[] = [];
  for (const [key, { attendeeCount, itemIds }] of byMeeting.entries()) {
    if (attendeeCount >= minAttendees && attendeeCount > maxAttendees) {
      const [date, description] = key.split("|");
      issues.push({ date, description, attendeeCount, itemIds });
    }
  }
  return issues;
}

export function detectRateExcess(
  charged: number,
  approved: number,
  tolerancePct = 0.005
): boolean {
  if (approved <= 0) return false;
  const tolerance = approved * tolerancePct;
  return charged > approved + tolerance;
}
