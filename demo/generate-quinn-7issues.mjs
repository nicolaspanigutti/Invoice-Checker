// Quinn Abernethy LLP — Demo invoice with exactly 7 embedded billing issues
// Matter: Data Protection Compliance Review & HR Data Audit
// Run: node demo/generate-quinn-7issues.mjs
//
// DESIGN RULES:
//  - All 15 lines fit on ONE page → avoids AI date-parsing failures on page 2
//  - M. Quinn bills ONLY at £700/h throughout → no spurious INCONSISTENT_RATE for M. Quinn
//  - S. Lim has ONE line at £560 (above £530 cap) → fires RATE_EXCESS + INCONSISTENT_RATE
//  - Internal-meeting lines have DISTINCT descriptions per timekeeper → avoids PARALLEL_BILLING
//
// ISSUES EMBEDDED (exactly 7):
//  [1] RATE_EXCESS                    — S. Lim, line 3: £560/h exceeds cap of £530/h
//  [2] DUPLICATE_LINE                 — C. Abernethy, lines 5–6: identical entry on 07 Mar
//  [3] ARITHMETIC_ERROR               — R. Patel, line 12: 4.0h × £270 = £1,080 stated as £1,150
//  [4] INCONSISTENT_RATE_FOR_SAME_TK  — S. Lim: £560 on line 3 vs £530 elsewhere; £560 exceeds cap
//  [5] DAILY_HOURS_EXCEEDED           — S. Lim, lines 13–15: 4.0+3.5+2.5 = 10.0h on 13 Mar (max 8h)
//  [6] SENIORITY_OVERKILL (AI grey)   — M. Quinn, line 8: Partner printing, collating, indexing docs
//  [7] INTERNAL_COORDINATION (AI grey)— Lines 9–11: each timekeeper bills internal team meeting

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
const GREY  = "#F5F5F5";
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
  date:        "31 March 2026",
  due:         "30 April 2026",
  matter:      "Data Protection Compliance Review & HR Data Audit",
  matterRef:   "QA/DP/2026/0163",
  jurisdiction:"England & Wales",
  period:      "1 March 2026 to 31 March 2026",
  currency:    "GBP",
};

// ─── Panel rate limits (reference only — not printed) ─────────────────────────
// Partner         £700/h   ← M. Quinn, all lines at exactly £700 (no excess, no inconsistency)
// Senior Associate £530/h  ← S. Lim, mostly £530; one line at £560 (excess + inconsistency)
// Associate        £430/h  ← C. Abernethy
// Paralegal        £270/h  ← R. Patel
// Max daily hours  8h/timekeeper

const LINES = [
  // ── 03 Mar: normal advisory work ─────────────────────────────────────────────
  {
    date: "03 Mar 2026", tk: "M. Quinn",     role: "Partner",
    hours: 2.0, rate: 700.00, amount: 1400.00,
    desc: "Strategic advisory session on GDPR compliance programme scope and data breach response policy framework; initial review of client's lawful basis assessment across UK and EU HR data processing activities.",
  },
  {
    date: "03 Mar 2026", tk: "S. Lim",       role: "Senior Associate",
    hours: 3.5, rate: 530.00, amount: 1855.00,
    desc: "Detailed review of client's existing privacy notices and data subject rights procedures; gap analysis against UK GDPR Articles 13–14 requirements and ICO accountability framework.",
  },

  // ── 05 Mar: [1] RATE_EXCESS + [4] INCONSISTENT_RATE — S. Lim at £560 (cap £530) ──
  {
    date: "05 Mar 2026", tk: "S. Lim",       role: "Senior Associate",
    hours: 3.0, rate: 560.00, amount: 1680.00,
    desc: "Research on ICO enforcement guidance on employee monitoring and workplace data retention policies; review of recent ICO monetary penalty notices and enforcement decisions on HR data processing compliance.",
  },

  // ── 06 Mar: normal ───────────────────────────────────────────────────────────
  {
    date: "06 Mar 2026", tk: "R. Patel",     role: "Paralegal",
    hours: 2.5, rate: 270.00, amount:  675.00,
    desc: "Preparation of Records of Processing Activities (ROPA) template; compilation of initial data register entries for recruitment and onboarding processing activities.",
  },

  // ── 07 Mar: [2] DUPLICATE_LINE — C. Abernethy, two identical entries ─────────
  {
    date: "07 Mar 2026", tk: "C. Abernethy", role: "Associate",
    hours: 3.5, rate: 430.00, amount: 1505.00,
    desc: "Preparation of data subject access request (DSAR) handling procedure; drafting of internal DSAR workflow, response templates and escalation protocol for HR and payroll data requests.",
  },
  {
    date: "07 Mar 2026", tk: "C. Abernethy", role: "Associate",
    hours: 3.5, rate: 430.00, amount: 1505.00,  // ← [2] DUPLICATE LINE (identical to line above)
    desc: "Preparation of data subject access request (DSAR) handling procedure; drafting of internal DSAR workflow, response templates and escalation protocol for HR and payroll data requests.",
  },

  // ── 10 Mar: M. Quinn advisory + [6] SENIORITY_OVERKILL ──────────────────────
  {
    date: "10 Mar 2026", tk: "M. Quinn",     role: "Partner",
    hours: 1.5, rate: 700.00, amount: 1050.00,
    desc: "Review of draft GDPR compliance gap analysis report; strategic advice to Group Legal Counsel on remediation priorities and data governance accountability framework for all HR data processing.",
  },
  {
    date: "10 Mar 2026", tk: "M. Quinn",     role: "Partner",
    hours: 1.0, rate: 700.00, amount:  700.00,  // ← [6] SENIORITY_OVERKILL (Partner doing admin)
    desc: "Printing, collating and filing hard copies of signed data processing agreements; updating physical document index with filing references and organising client binder with dividers and section labels.",
  },

  // ── 11 Mar: [7] INTERNAL_COORDINATION — internal team meeting (distinct per-TK descs) ─
  {
    date: "11 Mar 2026", tk: "M. Quinn",     role: "Partner",
    hours: 1.5, rate: 700.00, amount: 1050.00,  // ← [7] INTERNAL_COORDINATION
    desc: "Partner supervision: internal team progress meeting; review of workstream status, task reallocation among junior team members, and update of internal billing forecast for data protection matter.",
  },
  {
    date: "11 Mar 2026", tk: "S. Lim",       role: "Senior Associate",
    hours: 1.5, rate: 530.00, amount:  795.00,  // ← [7] INTERNAL_COORDINATION
    desc: "Attendance at internal team progress review meeting; presentation of status update on privacy notice drafting, ROPA completion and outstanding ICO enforcement research workstreams.",
  },
  {
    date: "11 Mar 2026", tk: "C. Abernethy", role: "Associate",
    hours: 1.5, rate: 430.00, amount:  645.00,  // ← [7] INTERNAL_COORDINATION
    desc: "Attendance at internal team progress review meeting; update on DSAR procedure drafting and data processing agreement review; receipt of task instructions for outstanding compliance workstreams.",
  },

  // ── 12 Mar: [3] ARITHMETIC_ERROR — R. Patel 4.0h × £270 = £1,080 stated as £1,150 ─
  {
    date: "12 Mar 2026", tk: "R. Patel",     role: "Paralegal",
    hours: 4.0, rate: 270.00, amount: 1150.00,  // ← [3] ARITHMETIC_ERROR (correct: £1,080.00)
    desc: "Population of Records of Processing Activities (ROPA) data register: entry of 18 processing operations with purpose, legal basis, data categories, retention periods and third-country transfer details.",
  },

  // ── 13 Mar: [5] DAILY_HOURS_EXCEEDED — S. Lim 4.0+3.5+2.5 = 10.0h (max 8h) ─
  {
    date: "13 Mar 2026", tk: "S. Lim",       role: "Senior Associate",
    hours: 4.0, rate: 530.00, amount: 2120.00,  // ← [5] DAILY_HOURS part 1
    desc: "Full review of client's employee monitoring policy and BYOD arrangements; analysis of Article 6(1)(f) UK GDPR legitimate interests balancing test for workplace monitoring; drafting of legitimate interests assessment (LIA) first draft.",
  },
  {
    date: "13 Mar 2026", tk: "S. Lim",       role: "Senior Associate",
    hours: 3.5, rate: 530.00, amount: 1855.00,  // ← [5] DAILY_HOURS part 2
    desc: "Drafting of updated employee privacy notice compliant with UK GDPR Articles 13–14; preparation of layered notice for display on HR portal covering payroll, absence, performance and disciplinary data processing.",
  },
  {
    date: "13 Mar 2026", tk: "S. Lim",       role: "Senior Associate",
    hours: 2.5, rate: 530.00, amount: 1325.00,  // ← [5] DAILY_HOURS part 3 → total 10.0h on 13 Mar
    desc: "Review of client's HR data retention schedule; preparation of recommended retention periods table covering employment contracts, payroll, disciplinary, health and occupational health records against statutory obligations.",
  },
];

// ─── Totals ────────────────────────────────────────────────────────────────────
// Subtotal includes the arithmetic error (£1,150 vs correct £1,080 for line 12)
// and the duplicate line (both lines 5 and 6 counted).
const SUBTOTAL = LINES.reduce((s, l) => s + l.amount, 0);
const VAT_RATE = 20;
const VAT_AMT  = SUBTOTAL * 0.20;
const TOTAL    = SUBTOTAL + VAT_AMT;

function fmtGBP(n) {
  return "£" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
mf("Currency",        "GBP (Pound Sterling)", c3, 138);

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
  date: { x: ML + 22,  w: 64  },
  tk:   { x: ML + 86,  w: 90  },
  role: { x: ML + 176, w: 80  },
  desc: { x: ML + 256, w: 158 },
  hrs:  { x: ML + 414, w: 30  },
  rate: { x: ML + 444, w: 48  },
  amt:  { x: ML + 492, w: 53  },
};

let curY = billY + 76;
let rowIndex = 0;

// Table header
doc.rect(ML, curY, CW, 15).fill(NAVY);
const hds = [
  ["No",          COL.no,   "left"],
  ["Date",        COL.date, "left"],
  ["Timekeeper",  COL.tk,   "left"],
  ["Role",        COL.role, "left"],
  ["Description", COL.desc, "left"],
  ["Hrs",         COL.hrs,  "right"],
  ["Rate £/h",    COL.rate, "right"],
  ["Amount £",    COL.amt,  "right"],
];
hds.forEach(([label, col, align]) => {
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
     .text(String(i + 1),          COL.no.x + 2,  ty, { width: COL.no.w - 2   })
     .text(line.date,              COL.date.x + 2, ty, { width: COL.date.w - 2 });
  doc.font("Helvetica-Bold").fontSize(7).fillColor(DARK)
     .text(line.tk,                COL.tk.x + 2,   ty, { width: COL.tk.w - 2   });
  doc.font("Helvetica").fontSize(6.5).fillColor(LIGHT)
     .text(line.role,              COL.role.x + 2,  ty, { width: COL.role.w - 2 });
  doc.font("Helvetica").fontSize(7).fillColor(DARK)
     .text(line.desc,              COL.desc.x + 2,  ty, { width: COL.desc.w - 4 });
  doc.font("Helvetica").fontSize(7).fillColor(MID)
     .text(line.hours.toFixed(2),  COL.hrs.x,       ty, { width: COL.hrs.w - 2,  align: "right" })
     .text(line.rate.toFixed(2),   COL.rate.x,      ty, { width: COL.rate.w - 2, align: "right" });
  doc.font("Helvetica-Bold").fontSize(7).fillColor(DARK)
     .text(line.amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
           COL.amt.x, ty, { width: COL.amt.w - 2, align: "right" });

  curY += rowH;
  rowIndex++;
});

// ─── Totals ────────────────────────────────────────────────────────────────────
curY += 6;
doc.moveTo(ML, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 10;

const tx = PW - MR - 195;
function totRow(label, value, bold = false, accent = false) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
     .fillColor(bold ? DARK : MID)
     .text(label, tx, curY, { width: 125, align: "right" });
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
     .fillColor(accent ? NAVY : (bold ? DARK : MID))
     .text(value, tx + 130, curY, { width: 65, align: "right" });
  curY += 14;
}
totRow("Subtotal (professional fees):", fmtGBP(SUBTOTAL));
totRow(`VAT @ ${VAT_RATE}%:`,           fmtGBP(VAT_AMT));
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
const pi = [
  ["Bank:",         "Barclays Bank plc, London"],
  ["Account:",      "Quinn Abernethy LLP Client Account"],
  ["Sort Code:",    "20-00-00"],
  ["IBAN:",         "GB82 BARC 2000 0073 8492 01"],
  ["Reference:",    INVOICE.number],
  ["Terms:",        "30 days from invoice date"],
];
pi.forEach(([k, v]) => {
  doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT)
     .text(k, ML, curY, { width: 80, lineBreak: false });
  doc.font("Helvetica").fontSize(7.5).fillColor(MID)
     .text(v, ML + 80, curY, { lineBreak: false });
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
  console.log(`\n15-line single-page invoice — issues designed to trigger:`);
  console.log(`  [1] RATE_EXCESS                   — Line 3:  S. Lim £560/h vs £530/h cap`);
  console.log(`  [2] DUPLICATE_LINE                — Lines 5–6: C. Abernethy 07 Mar identical entries`);
  console.log(`  [3] ARITHMETIC_ERROR              — Line 12: R. Patel 4.0h × £270 = £1,080 stated as £1,150`);
  console.log(`  [4] INCONSISTENT_RATE_FOR_SAME_TK — S. Lim: £560 (line 3) vs £530 (lines 2,9,10,13,14,15)`);
  console.log(`  [5] DAILY_HOURS_EXCEEDED          — Lines 13–15: S. Lim 10.0h on 13 Mar (max 8h)`);
  console.log(`  [6] SENIORITY_OVERKILL (AI)       — Line 8: M. Quinn (Partner) printing/filing/indexing`);
  console.log(`  [7] INTERNAL_COORDINATION (AI)    — Lines 9–11: each timekeeper bills internal meeting`);
  console.log(`\n  M. Quinn: all lines at £700 → no INCONSISTENT_RATE, no RATE_EXCESS for M. Quinn`);
  console.log(`  Single page → correct date parsing → no spurious DAILY_HOURS for C. Abernethy / R. Patel`);
  console.log(`  Distinct per-TK meeting descriptions → no PARALLEL_BILLING warning`);
});
