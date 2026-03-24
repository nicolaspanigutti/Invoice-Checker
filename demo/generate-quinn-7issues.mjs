// Quinn Abernethy LLP — Demo invoice with exactly 7 embedded billing issues
// Matter: Data Protection Compliance Review & HR Data Audit
// Run: node demo/generate-quinn-7issues.mjs
//
// DESIGN PRINCIPLES to minimise spurious AI issues:
//  - ISO dates (YYYY-MM-DD) — unambiguous, AI can't misread them as billing-period start
//  - 13 lean lines on ONE page — no multi-page date-context loss
//  - M. Quinn at £700 everywhere — no spurious INCONSISTENT_RATE for M. Quinn
//  - Internal coordination = ONE timekeeper (M. Quinn) — no PARALLEL_BILLING from meeting
//  - Arithmetic error uses small amount (no thousands comma) — clean AI parsing
//  - C. Abernethy lines on a day where no other TK is active — isolates DUPLICATE_LINE
//
// ISSUES DESIGNED TO TRIGGER (exactly 7):
//  [1] RATE_EXCESS                    — S. Lim, line 3:  £560/h exceeds cap of £530/h
//  [2] DUPLICATE_LINE                 — C. Abernethy, lines 5–6: identical entry on 2026-03-11
//  [3] ARITHMETIC_ERROR               — R. Patel, line 10: 2.0h × £270 = £540 stated as £600
//  [4] INCONSISTENT_RATE_FOR_SAME_TK  — S. Lim: £560 on line 3 vs £530 elsewhere; £560 > cap
//  [5] DAILY_HOURS_EXCEEDED           — S. Lim, lines 11–13: 4.0+3.5+2.5 = 10h on 2026-03-19
//  [6] SENIORITY_OVERKILL (AI grey)   — M. Quinn, line 8: Partner printing/filing/indexing docs
//  [7] INTERNAL_COORDINATION (AI grey)— M. Quinn, line 9: Partner billing internal team admin

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, "Quinn_Abernethy_INV-2026-0163_7Issues.pdf");

// ─── Palette ───────────────────────────────────────────────────────────────────
const NAVY  = "#1A3A5C";
const DARK  = "#1A1A1A";
const MID   = "#444444";
const LIGHT = "#888888";
const RULE  = "#D0D0D0";
const FAINT = "#FAFAFA";
const WHITE = "#FFFFFF";

// ─── Firm / Client ─────────────────────────────────────────────────────────────
const FIRM = {
  name:    "Quinn Abernethy LLP",
  address: ["22 Aldgate High Street", "London EC3N 1AL", "United Kingdom"],
  email:   "billing@quinnabernethy.co.uk",
  sra:     "SRA No. 744821",
};
const CLIENT = {
  name:    "Acme Industrial Group plc",
  dept:    "Legal Department",
  address: ["One Canada Square", "Canary Wharf", "London E14 5AB"],
  ref:     "Legal/2026/DP-163",
};
const INVOICE = {
  number:      "INV-2026-0163",
  date:        "2026-03-31",
  due:         "2026-04-30",
  matter:      "Data Protection Compliance Review & HR Data Audit",
  matterRef:   "QA/DP/2026/0163",
  jurisdiction:"England & Wales",
  period:      "2026-03-01 to 2026-03-31",
  currency:    "GBP",
};

// ─── Rate caps (reference — not printed) ──────────────────────────────────────
// Partner          £700/h   M. Quinn — all lines £700 (no excess, no inconsistency)
// Senior Associate £530/h   S. Lim   — mostly £530; one line at £560 (RATE_EXCESS + INCONSISTENT)
// Associate        £430/h   C. Abernethy
// Paralegal        £270/h   R. Patel
// Max daily hours  8h/timekeeper

const LINES = [
  // ── 2026-03-04: normal advisory ────────────────────────────────────────────
  {
    date: "2026-03-04", tk: "M. Quinn",     role: "Partner",
    hours: 2.0, rate: 700.00, amount: 1400.00,
    desc: "Strategic advisory session on GDPR compliance programme scope; initial review of lawful basis assessments across UK HR data processing activities and advice on accountability framework.",
  },
  {
    date: "2026-03-04", tk: "S. Lim",       role: "Senior Associate",
    hours: 3.5, rate: 530.00, amount: 1855.00,
    desc: "Gap analysis of existing privacy notices against UK GDPR Articles 13-14; assessment of ICO accountability framework requirements and documentation of recommended remediation actions.",
  },

  // ── 2026-03-06: [1] RATE_EXCESS + [4] INCONSISTENT_RATE ───────────────────
  // S. Lim charged at £560/h (cap £530/h) → RATE_EXCESS fires
  // S. Lim has £530 on all other lines → INCONSISTENT_RATE fires (£560 > cap)
  {
    date: "2026-03-06", tk: "S. Lim",       role: "Senior Associate",
    hours: 3.0, rate: 560.00, amount: 1680.00,
    desc: "Research on ICO enforcement guidance on employee monitoring and workplace data retention; review of recent ICO penalty notices on HR data processing and preparation of enforcement landscape summary.",
  },

  // ── 2026-03-07: normal ─────────────────────────────────────────────────────
  {
    date: "2026-03-07", tk: "R. Patel",     role: "Paralegal",
    hours: 2.5, rate: 270.00, amount: 675.00,
    desc: "Preparation of Records of Processing Activities (ROPA) template; compilation of initial data register entries covering recruitment, onboarding and payroll processing activities.",
  },

  // ── 2026-03-11: [2] DUPLICATE_LINE ─────────────────────────────────────────
  // C. Abernethy is the only timekeeper on this date → no PARALLEL_BILLING from third parties
  // Both lines are identical → DUPLICATE_LINE fires
  {
    date: "2026-03-11", tk: "C. Abernethy", role: "Associate",
    hours: 3.5, rate: 430.00, amount: 1505.00,
    desc: "Preparation of data subject access request (DSAR) handling procedure; drafting of internal DSAR workflow, response templates and escalation protocol for HR and payroll data requests.",
  },
  {
    date: "2026-03-11", tk: "C. Abernethy", role: "Associate",
    hours: 3.5, rate: 430.00, amount: 1505.00,   // ← [2] DUPLICATE (identical to line above)
    desc: "Preparation of data subject access request (DSAR) handling procedure; drafting of internal DSAR workflow, response templates and escalation protocol for HR and payroll data requests.",
  },

  // ── 2026-03-12: normal advisory + [6] SENIORITY_OVERKILL ──────────────────
  {
    date: "2026-03-12", tk: "M. Quinn",     role: "Partner",
    hours: 1.5, rate: 700.00, amount: 1050.00,
    desc: "Review of draft GDPR compliance gap analysis; strategic advice to Group Legal Counsel on remediation priorities, data governance accountability and data protection officer appointment obligations.",
  },
  {
    date: "2026-03-12", tk: "M. Quinn",     role: "Partner",
    hours: 1.0, rate: 700.00, amount:  700.00,   // ← [6] SENIORITY_OVERKILL
    desc: "Printing, collating and filing hard copies of signed data processing agreements; updating physical document index with filing references and organising client binder with section dividers and labels.",
  },

  // ── 2026-03-14: [7] INTERNAL_COORDINATION ──────────────────────────────────
  // Single timekeeper billing for clearly internal administrative work
  {
    date: "2026-03-14", tk: "M. Quinn",     role: "Partner",
    hours: 2.0, rate: 700.00, amount: 1400.00,   // ← [7] INTERNAL_COORDINATION
    desc: "Internal team supervision and coordination: review of workstream progress with S. Lim and C. Abernethy, reallocation of outstanding tasks, update of internal matter status tracker and preparation of internal billing forecast.",
  },

  // ── 2026-03-17: [3] ARITHMETIC_ERROR ───────────────────────────────────────
  // 2.0h × £270.00 = £540.00 but stated as £600.00 (no thousands comma → clean AI parsing)
  {
    date: "2026-03-17", tk: "R. Patel",     role: "Paralegal",
    hours: 2.0, rate: 270.00, amount: 600.00,    // ← [3] ARITHMETIC_ERROR (correct: £540.00)
    desc: "Population of ROPA data register: entry of processing operations with purpose, legal basis, data categories, retention periods and third-country transfer details for 8 HR processing activities.",
  },

  // ── 2026-03-19: [5] DAILY_HOURS_EXCEEDED ───────────────────────────────────
  // S. Lim: 4.0 + 3.5 + 2.5 = 10.0h on same day (max 8h/day under T&C)
  {
    date: "2026-03-19", tk: "S. Lim",       role: "Senior Associate",
    hours: 4.0, rate: 530.00, amount: 2120.00,   // ← [5] DAILY_HOURS part 1
    desc: "Full review of employee monitoring policy and BYOD arrangements; drafting of legitimate interests assessment (LIA) for Article 6(1)(f) UK GDPR; preparation of LIA first draft covering all monitoring activities.",
  },
  {
    date: "2026-03-19", tk: "S. Lim",       role: "Senior Associate",
    hours: 3.5, rate: 530.00, amount: 1855.00,   // ← [5] DAILY_HOURS part 2
    desc: "Drafting of updated employee privacy notice compliant with UK GDPR Articles 13-14; preparation of layered notice for HR portal covering payroll, absence management, performance and disciplinary data processing.",
  },
  {
    date: "2026-03-19", tk: "S. Lim",       role: "Senior Associate",
    hours: 2.5, rate: 530.00, amount: 1325.00,   // ← [5] DAILY_HOURS part 3 → total 10.0h
    desc: "Preparation of HR data retention schedule: recommended retention periods for employment contracts, payroll, disciplinary records, health and occupational health records against statutory minimum obligations.",
  },
];

// ─── Totals ────────────────────────────────────────────────────────────────────
// Note: subtotal includes the arithmetic error (£600 instead of correct £540 for line 10)
// and the duplicate line (both lines 5 and 6 counted).
const SUBTOTAL = LINES.reduce((s, l) => s + l.amount, 0);
const VAT_RATE = 20;
const VAT_AMT  = SUBTOTAL * 0.20;
const TOTAL    = SUBTOTAL + VAT_AMT;

function fmtGBP(n) {
  // Intentionally NO thousands comma for amounts < £10,000 to avoid AI misreading
  return "£" + n.toFixed(2);
}

// ─── Build PDF ─────────────────────────────────────────────────────────────────
const doc = new PDFDocument({ size: "A4", margin: 50, info: {
  Title:   `${INVOICE.number} – Quinn Abernethy LLP`,
  Author:  "Quinn Abernethy LLP",
  Subject: `Legal Services – ${INVOICE.matter}`,
  Creator: "Quinn Abernethy LLP Billing System v4",
}});
const stream = createWriteStream(OUT);
doc.pipe(stream);

const PW = doc.page.width;
const PH = doc.page.height;
const ML = 50;
const MR = 50;
const CW = PW - ML - MR;

// ─── Header bar ───────────────────────────────────────────────────────────────
doc.rect(0, 0, PW, 8).fill(NAVY);
doc.font("Helvetica-Bold").fontSize(16).fillColor(DARK)
   .text(FIRM.name, ML, 24, { width: CW - 150 });
doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT)
   .text(FIRM.address.join("  ·  "), ML, 46)
   .text(`${FIRM.sra}   ·   ${FIRM.email}`, ML, 56);
doc.font("Helvetica-Bold").fontSize(19).fillColor(NAVY)
   .text("INVOICE", PW - MR - 130, 24, { width: 130, align: "right" });
doc.font("Helvetica").fontSize(8).fillColor(LIGHT)
   .text(INVOICE.number, PW - MR - 130, 48, { width: 130, align: "right" });
doc.moveTo(ML, 70).lineTo(PW - MR, 70).strokeColor(RULE).lineWidth(0.5).stroke();

// ─── Invoice meta ─────────────────────────────────────────────────────────────
const c1 = ML, c2 = ML + 168, c3 = ML + 370;
function mf(label, value, x, y, w) {
  doc.font("Helvetica").fontSize(7).fillColor(LIGHT).text(label, x, y, { width: w ?? 160 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(DARK).text(value, x, y + 10, { width: w ?? 160 });
}
mf("Invoice Number",  INVOICE.number,         c1, 78);
mf("Invoice Date",    INVOICE.date,           c2, 78);
mf("Due Date",        INVOICE.due,            c3, 78);
mf("Matter",          INVOICE.matter,         c1, 108, 330);
mf("Client Ref",      CLIENT.ref,             c3, 108);
mf("Jurisdiction",    INVOICE.jurisdiction,   c1, 138);
mf("Billing Period",  INVOICE.period,         c2, 138, 200);
mf("Currency",        "GBP — Pound Sterling", c3, 138);

// ─── Bill to ──────────────────────────────────────────────────────────────────
const billY = 172;
doc.font("Helvetica").fontSize(7).fillColor(LIGHT).text("BILL TO", ML, billY);
doc.font("Helvetica-Bold").fontSize(9.5).fillColor(DARK).text(CLIENT.name, ML, billY + 10);
doc.font("Helvetica").fontSize(8.5).fillColor(MID)
   .text(CLIENT.dept,       ML, billY + 22)
   .text(CLIENT.address[0], ML, billY + 32)
   .text(CLIENT.address[1], ML, billY + 42)
   .text(CLIENT.address[2], ML, billY + 52);
doc.moveTo(ML, billY + 66).lineTo(PW - MR, billY + 66).strokeColor(RULE).stroke();

// ─── Table ────────────────────────────────────────────────────────────────────
const COL = {
  no:   { x: ML,       w: 22  },
  date: { x: ML + 22,  w: 76  },
  tk:   { x: ML + 98,  w: 90  },
  role: { x: ML + 188, w: 78  },
  desc: { x: ML + 266, w: 150 },
  hrs:  { x: ML + 416, w: 28  },
  rate: { x: ML + 444, w: 46  },
  amt:  { x: ML + 490, w: 55  },
};

let curY = billY + 76;
let rowIndex = 0;

// Table header
doc.rect(ML, curY, CW, 15).fill(NAVY);
[
  ["No",         COL.no,   "left"],
  ["Date",       COL.date, "left"],
  ["Timekeeper", COL.tk,   "left"],
  ["Role",       COL.role, "left"],
  ["Description",COL.desc, "left"],
  ["Hrs",        COL.hrs,  "right"],
  ["Rate £/h",   COL.rate, "right"],
  ["Amount £",   COL.amt,  "right"],
].forEach(([label, col, align]) => {
  doc.fontSize(6.5).font("Helvetica-Bold").fillColor(WHITE)
     .text(label, col.x + 2, curY + 5, { width: col.w - 2, align });
});
curY += 15;

LINES.forEach((line, i) => {
  const bg = rowIndex % 2 === 0 ? WHITE : FAINT;
  const descH = doc.heightOfString(line.desc, { width: COL.desc.w - 4, fontSize: 7 });
  const rowH = Math.max(18, descH + 7);

  doc.rect(ML, curY, CW, rowH).fill(bg);
  doc.rect(ML, curY + rowH - 0.3, CW, 0.3).fill("#E8E8E8");

  const ty = curY + 3;
  doc.font("Helvetica").fontSize(7).fillColor(MID)
     .text(String(i + 1), COL.no.x + 2,  ty, { width: COL.no.w - 2 })
     .text(line.date,     COL.date.x + 2, ty, { width: COL.date.w - 2 });
  doc.font("Helvetica-Bold").fontSize(7).fillColor(DARK)
     .text(line.tk,       COL.tk.x + 2,   ty, { width: COL.tk.w - 2 });
  doc.font("Helvetica").fontSize(6.5).fillColor(LIGHT)
     .text(line.role,     COL.role.x + 2, ty, { width: COL.role.w - 2 });
  doc.font("Helvetica").fontSize(7).fillColor(DARK)
     .text(line.desc,     COL.desc.x + 2, ty, { width: COL.desc.w - 4 });
  doc.font("Helvetica").fontSize(7).fillColor(MID)
     .text(line.hours.toFixed(2), COL.hrs.x,  ty, { width: COL.hrs.w - 2,  align: "right" })
     .text(line.rate.toFixed(2),  COL.rate.x, ty, { width: COL.rate.w - 2, align: "right" });
  doc.font("Helvetica-Bold").fontSize(7).fillColor(DARK)
     .text(line.amount.toFixed(2), COL.amt.x, ty, { width: COL.amt.w - 2, align: "right" });

  curY += rowH;
  rowIndex++;
});

// ─── Totals ────────────────────────────────────────────────────────────────────
curY += 6;
doc.moveTo(ML, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 10;

const tx = PW - MR - 190;
function totRow(label, value, bold = false, accent = false) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
     .fillColor(bold ? DARK : MID)
     .text(label, tx, curY, { width: 120, align: "right" });
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
     .fillColor(accent ? NAVY : (bold ? DARK : MID))
     .text(value, tx + 125, curY, { width: 65, align: "right" });
  curY += 14;
}
totRow("Subtotal:", fmtGBP(SUBTOTAL));
totRow(`VAT @ ${VAT_RATE}%:`, fmtGBP(VAT_AMT));
curY += 2;
doc.moveTo(tx, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 5;
totRow("TOTAL DUE:", fmtGBP(TOTAL), true, true);

// ─── Payment instructions ──────────────────────────────────────────────────────
curY += 14;
doc.moveTo(ML, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 10;
doc.font("Helvetica-Bold").fontSize(7.5).fillColor(DARK).text("PAYMENT INSTRUCTIONS", ML, curY);
curY += 12;
[
  ["Bank:",      "Barclays Bank plc, London"],
  ["Account:",   "Quinn Abernethy LLP Client Account"],
  ["Sort Code:", "20-00-00"],
  ["IBAN:",      "GB82 BARC 2000 0073 8492 01"],
  ["Reference:", INVOICE.number],
  ["Terms:",     "30 days from invoice date"],
].forEach(([k, v]) => {
  doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT).text(k, ML, curY, { width: 80, lineBreak: false });
  doc.font("Helvetica").fontSize(7.5).fillColor(MID).text(v, ML + 80, curY, { lineBreak: false });
  curY += 12;
});

// ─── Footer bar ───────────────────────────────────────────────────────────────
const footerY = PH - 34;
doc.rect(0, footerY, PW, 34).fill(NAVY);
doc.font("Helvetica").fontSize(6.5).fillColor(WHITE)
   .text(
     "Quinn Abernethy LLP  ·  Registered in England & Wales (OC501847)  ·  " +
     "Authorised and regulated by the Solicitors Regulation Authority (SRA No. 744821)  ·  " +
     "VAT not charged — legal services outside scope",
     ML, footerY + 10, { width: CW, align: "center" }
   );

doc.end();

stream.on("finish", () => {
  console.log(`\n✅  Invoice PDF: ${OUT}`);
  console.log(`\n13-line, single-page invoice with ISO dates — issues designed to trigger:`);
  console.log(`  [1] RATE_EXCESS                   — Line 3:  S. Lim £560/h vs £530/h cap`);
  console.log(`  [2] DUPLICATE_LINE                — Lines 5-6: C. Abernethy 2026-03-11 identical`);
  console.log(`  [3] ARITHMETIC_ERROR              — Line 10: R. Patel 2.0h × £270 = £540 stated £600`);
  console.log(`  [4] INCONSISTENT_RATE_FOR_SAME_TK — S. Lim: £560 (line 3) vs £530 (other lines)`);
  console.log(`  [5] DAILY_HOURS_EXCEEDED          — Lines 11-13: S. Lim 10.0h on 2026-03-19`);
  console.log(`  [6] SENIORITY_OVERKILL (AI)       — Line 8: M. Quinn Partner printing/filing`);
  console.log(`  [7] INTERNAL_COORDINATION (AI)    — Line 9: M. Quinn billing internal team admin`);
  console.log(`\n  No thousands commas in amounts → clean AI arithmetic parsing`);
  console.log(`  ISO dates → unambiguous date parsing, no date→2026-03-01 collapse`);
});
