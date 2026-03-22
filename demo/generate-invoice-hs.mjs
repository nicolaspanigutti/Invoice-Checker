// Demo invoice — Hargreaves & Sutton LLP — 4 deliberate billing errors
// Designed for testing issue detection and escalation workflow
// Run: node demo/generate-invoice-hs.mjs
//
// DELIBERATE ERRORS:
//  [1] RATE_EXCESS         – M. Fletcher (Partner) billed at GBP 820 (panel max GBP 680) on one line.
//  [2] DAILY_HOURS_EXCEEDED – P. Okonkwo (Sr. Associate) bills 10.5 h total on 2026-02-11 (max 8 h/day).
//  [3] ARITHMETIC_ERROR    – R. Shah: 3.5 h × GBP 440 = GBP 1,540.00 but line states GBP 1,750.00.
//  [4] UNAUTHORIZED_EXPENSE_TYPE – "Business class airfare, London–Manchester" billed as disbursement;
//       T&C prohibits business class for flights under 8 hours (this is a 1-hour domestic flight).
//       → Expected to be escalated to Internal Lawyer for legal interpretation of travel policy.

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "Hargreaves_Sutton_LLP_INV-2026-0094.pdf"
);

const NAVY   = "#1B2A4A";
const DARK   = "#1A1A1A";
const MID    = "#444444";
const LIGHT  = "#888888";
const RULE   = "#D0D0D0";
const HEADER_BG = "#F2F4F7";

const FIRM = {
  name:    "Hargreaves & Sutton LLP",
  address: ["14 Gray's Inn Road", "London WC1X 8HN", "United Kingdom"],
  vat:     "GB 441 827 33",
  email:   "billing@hargreaves-sutton.co.uk",
};

const CLIENT = {
  name:    "Acme Industrial Group plc",
  dept:    "Legal Department",
  address: ["One Canada Square", "Canary Wharf", "London E14 5AB"],
  ref:     "Legal/2026/JVA-012",
};

const INVOICE = {
  number:      "INV-2026-0094",
  date:        "28 February 2026",
  due:         "14 April 2026",
  matter:      "Joint Venture Agreement — Project Ashford",
  matterRef:   "HS/JVA/2026/0094",
  jurisdiction:"England & Wales",
  periodStart: "2026-02-01",
  periodEnd:   "2026-02-28",
  currency:    "GBP",
};

// Panel max rates (GBP) — Hargreaves & Sutton:
//   Partner          GBP 680/h
//   Senior Associate GBP 545/h
//   Associate 3rd Yr GBP 440/h
//   Legal Trainee    GBP 240/h

const LINES = [
  // ── Week 1: 2–6 Feb ──────────────────────────────────────────────────────
  {
    date: "02 Feb 2026", tk: "M. Fletcher", role: "Partner",
    hours: 2.0, rate: 680.00, amount: 1360.00,
    desc: "Initial structuring call with client GC and CFO; review of proposed joint venture heads of terms and advice on governing law election and dispute resolution mechanics.",
  },
  {
    date: "03 Feb 2026", tk: "P. Okonkwo", role: "Senior Associate",
    hours: 3.5, rate: 545.00, amount: 1907.50,
    desc: "Review of draft Joint Venture Agreement received from counterparty counsel; mark-up of governance provisions, board composition and reserved matters.",
  },
  {
    date: "04 Feb 2026", tk: "R. Shah", role: "Associate 3rd Year",
    hours: 4.0, rate: 440.00, amount: 1760.00,
    desc: "Research on English law partnership and joint venture structures; analysis of fiduciary duties applicable to JV board members under Companies Act 2006.",
  },
  {
    date: "05 Feb 2026", tk: "C. Barnes", role: "Legal Trainee",
    hours: 2.5, rate: 240.00, amount: 600.00,
    desc: "Preparation of JV project tracker and document management index; collation of Companies House filings for both JV vehicle candidates.",
  },
  // [1] RATE_EXCESS — M. Fletcher billed at GBP 820 (max GBP 680)
  {
    date: "06 Feb 2026", tk: "M. Fletcher", role: "Partner",
    hours: 2.0, rate: 820.00, amount: 1640.00,          // ← [1] RATE_EXCESS
    desc: "Attendance at all-parties structuring workshop at client offices; lead negotiation of governance framework and equity contribution mechanics.",
  },

  // ── Week 2: 9–13 Feb ─────────────────────────────────────────────────────
  {
    date: "09 Feb 2026", tk: "M. Fletcher", role: "Partner",
    hours: 1.5, rate: 680.00, amount: 1020.00,
    desc: "Review of revised JVA mark-up; strategic advice on deadlock resolution provisions and tag-along/drag-along mechanics for equity exit scenarios.",
  },
  {
    date: "10 Feb 2026", tk: "P. Okonkwo", role: "Senior Associate",
    hours: 3.0, rate: 545.00, amount: 1635.00,
    desc: "Drafting of shareholders' agreement provisions cross-referenced with JVA; preparation of negotiation position note on pre-emption rights.",
  },
  // [2] DAILY_HOURS_EXCEEDED — P. Okonkwo bills 10.5 h on 11 Feb (max 8 h)
  {
    date: "11 Feb 2026", tk: "P. Okonkwo", role: "Senior Associate",
    hours: 4.5, rate: 545.00, amount: 2452.50,
    desc: "Review of all outstanding due diligence points on JV vehicle; preparation of disclosure schedule and conditions precedent checklist.",
  },
  {
    date: "11 Feb 2026", tk: "P. Okonkwo", role: "Senior Associate",
    hours: 3.5, rate: 545.00, amount: 1907.50,
    desc: "Drafting of revised warranties and indemnities schedule; cross-referencing with client's existing contractual obligations and insurance cover.",
  },
  {
    date: "11 Feb 2026", tk: "P. Okonkwo", role: "Senior Associate",
    hours: 2.5, rate: 545.00, amount: 1362.50,          // ← [2] completes 10.5 h total on 11 Feb
    desc: "Preparation of legal issues memorandum for partner review; drafting of outstanding issues list for counterparty negotiation session.",
  },

  // ── Week 3: 16–20 Feb ────────────────────────────────────────────────────
  {
    date: "16 Feb 2026", tk: "M. Fletcher", role: "Partner",
    hours: 2.0, rate: 680.00, amount: 1360.00,
    desc: "Video conference with counterparty lead partner (Silverman & Co.); negotiation of deadlock provisions, step-in rights and exit mechanics.",
  },
  // [3] ARITHMETIC_ERROR — R. Shah: 3.5 h × GBP 440 = GBP 1,540 but stated as GBP 1,750
  {
    date: "17 Feb 2026", tk: "R. Shah", role: "Associate 3rd Year",
    hours: 3.5, rate: 440.00, amount: 1750.00,          // ← [3] ARITHMETIC_ERROR (correct: GBP 1,540.00)
    desc: "Preparation of regulatory compliance checklist for JV vehicle; review of FCA authorisation requirements and competition law notification thresholds.",
  },
  {
    date: "18 Feb 2026", tk: "P. Okonkwo", role: "Senior Associate",
    hours: 3.0, rate: 545.00, amount: 1635.00,
    desc: "Mark-up of final agreed JVA draft; preparation of execution version and signing memorandum; review of conditions precedent satisfaction.",
  },
  {
    date: "19 Feb 2026", tk: "C. Barnes", role: "Legal Trainee",
    hours: 2.0, rate: 240.00, amount: 480.00,
    desc: "Preparation of board resolution templates for JV vehicle incorporation; collation of corporate authorisation documents for signing process.",
  },
  {
    date: "20 Feb 2026", tk: "R. Shah", role: "Associate 3rd Year",
    hours: 2.5, rate: 440.00, amount: 1100.00,
    desc: "Companies House incorporation filing for JV vehicle; preparation of statutory registers, share certificates and PSC register.",
  },

  // ── Week 4: 23–27 Feb ────────────────────────────────────────────────────
  {
    date: "23 Feb 2026", tk: "M. Fletcher", role: "Partner",
    hours: 1.5, rate: 680.00, amount: 1020.00,
    desc: "Attendance at JVA signing meeting; review of executed documents and advice on post-completion obligations and implementation timetable.",
  },
  {
    date: "24 Feb 2026", tk: "P. Okonkwo", role: "Senior Associate",
    hours: 2.0, rate: 545.00, amount: 1090.00,
    desc: "Post-completion filing of incorporation documents; preparation of closing memorandum and handover pack for client corporate secretarial team.",
  },
  {
    date: "25 Feb 2026", tk: "R. Shah", role: "Associate 3rd Year",
    hours: 2.0, rate: 440.00, amount: 880.00,
    desc: "Preparation of final matter report; updating of document management system; compilation of executed documents for client archive.",
  },
];

// [4] UNAUTHORIZED_EXPENSE_TYPE — Business class airfare on a domestic 1-hour flight
const EXPENSES = [
  {
    date: "11 Feb 2026",
    description: "Business class airfare — London Heathrow to Manchester Airport (M. Fletcher travel to client site meeting). Duration: approx. 1 hour.",
    expenseType: "Business class airfare",
    amount: 485.00,
    receipt: "EXP-2026-0211-MF",
  },
  {
    date: "11 Feb 2026",
    description: "Taxi — Canary Wharf to London Heathrow (pre-flight).",
    expenseType: "Ground transport / taxi",
    amount: 58.00,
    receipt: "EXP-2026-0211-TX",
  },
  {
    date: "11 Feb 2026",
    description: "Hotel — The Lowry Hotel, Manchester, 1 night (M. Fletcher overnight stay).",
    expenseType: "Hotel accommodation",
    amount: 195.00,
    receipt: "EXP-2026-0211-HTL",
  },
];

const FEES_SUBTOTAL = LINES.reduce((s, l) => s + l.amount, 0);
const EXP_SUBTOTAL  = EXPENSES.reduce((s, e) => s + e.amount, 0);
const SUBTOTAL      = FEES_SUBTOTAL + EXP_SUBTOTAL;
const VAT_RATE      = 0.00;
const VAT_AMT       = 0.00;
const TOTAL         = SUBTOTAL + VAT_AMT;

// ─── PDF Generation ──────────────────────────────────────────────────────────
const doc = new PDFDocument({ size: "A4", margin: 50, info: {
  Title:    `${INVOICE.number} – Hargreaves & Sutton LLP`,
  Author:   "Hargreaves & Sutton LLP",
  Subject:  `Legal Services – ${INVOICE.matter}`,
  Creator:  "Hargreaves & Sutton LLP Billing System",
}});

const stream = createWriteStream(OUT);
doc.pipe(stream);

const PW = doc.page.width;
const ML = 50;
const MR = 50;
const CW = PW - ML - MR;

function fmtMoney(n) {
  return "GBP " + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Header bar
doc.rect(0, 0, PW, 8).fill(NAVY);

// Firm name
doc.font("Helvetica-Bold").fontSize(18).fillColor(NAVY)
  .text(FIRM.name, ML, 30, { width: CW });
const afterName = doc.y + 4;
doc.font("Helvetica").fontSize(8).fillColor(LIGHT);
FIRM.address.forEach(line => doc.text(line));
doc.text(`VAT: ${FIRM.vat}   ·   ${FIRM.email}`);

// INVOICE label
doc.font("Helvetica-Bold").fontSize(22).fillColor(NAVY)
  .text("INVOICE", PW - MR - 150, 30, { width: 150, align: "right" });
doc.font("Helvetica").fontSize(9).fillColor(LIGHT)
  .text(INVOICE.number, PW - MR - 150, 58, { width: 150, align: "right" });

doc.moveTo(ML, afterName + 48).lineTo(PW - MR, afterName + 48).stroke(RULE);

// Metadata
const metaY = afterName + 58;
const col1 = ML, col2 = ML + 180, col3 = ML + 360;

function metaField(label, value, x, y) {
  doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT).text(label, x, y);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK).text(value, x, y + 11, { width: 160 });
}

metaField("Invoice Number", INVOICE.number, col1, metaY);
metaField("Invoice Date",   INVOICE.date, col2, metaY);
metaField("Due Date",       INVOICE.due, col3, metaY);

const metaY2 = metaY + 38;
metaField("Matter", INVOICE.matter, col1, metaY2);
metaField("Client Reference", CLIENT.ref, col3, metaY2);

const metaY3 = metaY2 + 38;
metaField("Jurisdiction", INVOICE.jurisdiction, col1, metaY3);
metaField("Billing Period", `${INVOICE.periodStart} to ${INVOICE.periodEnd}`, col2, metaY3);
metaField("Currency", INVOICE.currency, col3, metaY3);

// Bill To
const billY = metaY3 + 50;
doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT).text("BILL TO", ML, billY);
doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text(CLIENT.name, ML, billY + 12);
doc.font("Helvetica").fontSize(9).fillColor(MID).text(CLIENT.dept);
CLIENT.address.forEach(line => doc.text(line));

doc.moveTo(ML, doc.y + 14).lineTo(PW - MR, doc.y + 14).stroke(RULE);

// Section A: Professional Fees
let tableY = doc.y + 24;
doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("A.  PROFESSIONAL FEES", ML, tableY);
tableY = doc.y + 8;

const cols = {
  no:   { x: ML,           w: 24  },
  date: { x: ML + 24,      w: 66  },
  tk:   { x: ML + 90,      w: 98  },
  role: { x: ML + 188,     w: 86  },
  desc: { x: ML + 274,     w: 142 },
  hrs:  { x: ML + 416,     w: 32  },
  rate: { x: ML + 448,     w: 48  },
  amt:  { x: ML + 496,     w: 49  },
};

doc.rect(ML, tableY - 4, CW, 18).fill(HEADER_BG);
const hdr = () => doc.font("Helvetica-Bold").fontSize(7).fillColor(MID);
hdr().text("No",   cols.no.x,   tableY, { width: cols.no.w,   align: "left"  });
hdr().text("Date", cols.date.x, tableY, { width: cols.date.w, align: "left"  });
hdr().text("Timekeeper", cols.tk.x, tableY, { width: cols.tk.w, align: "left" });
hdr().text("Role", cols.role.x, tableY, { width: cols.role.w, align: "left"  });
hdr().text("Description", cols.desc.x, tableY, { width: cols.desc.w, align: "left" });
hdr().text("Hrs",  cols.hrs.x,  tableY, { width: cols.hrs.w,  align: "right" });
hdr().text("Rate", cols.rate.x, tableY, { width: cols.rate.w, align: "right" });
hdr().text("Amount", cols.amt.x, tableY, { width: cols.amt.w, align: "right" });

let rowY = tableY + 18;
LINES.forEach((l, i) => {
  const even = i % 2 === 1;
  if (even) doc.rect(ML, rowY - 2, CW, 28).fill("#FAFAFA");
  const row = () => doc.font("Helvetica").fontSize(7).fillColor(DARK);
  row().text(String(i + 1), cols.no.x, rowY, { width: cols.no.w, align: "left" });
  row().text(l.date,        cols.date.x, rowY, { width: cols.date.w });
  row().text(l.tk,          cols.tk.x, rowY, { width: cols.tk.w });
  row().text(l.role,        cols.role.x, rowY, { width: cols.role.w });
  row().text(l.desc,        cols.desc.x, rowY, { width: cols.desc.w, lineGap: 1 });
  row().text(l.hours.toFixed(2),   cols.hrs.x,  rowY, { width: cols.hrs.w,  align: "right" });
  row().text(l.rate.toFixed(2),    cols.rate.x, rowY, { width: cols.rate.w, align: "right" });
  row().text(l.amount.toFixed(2),  cols.amt.x,  rowY, { width: cols.amt.w,  align: "right" });
  rowY += 30;
});

// Fees subtotal
doc.moveTo(ML, rowY + 2).lineTo(PW - MR, rowY + 2).stroke(RULE);
rowY += 10;
const totX = PW - MR - 160;
doc.font("Helvetica").fontSize(8).fillColor(MID)
  .text("Fees Sub-total:", totX, rowY, { width: 110, align: "right" });
doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK)
  .text(fmtMoney(FEES_SUBTOTAL), totX + 110, rowY, { width: 50, align: "right" });
rowY += 18;

// Section B: Disbursements
doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text("B.  DISBURSEMENTS & EXPENSES", ML, rowY);
rowY = doc.y + 10;

const ecols = {
  no:   { x: ML,           w: 24  },
  date: { x: ML + 24,      w: 66  },
  type: { x: ML + 90,      w: 100 },
  desc: { x: ML + 190,     w: 230 },
  rcpt: { x: ML + 420,     w: 75  },
  amt:  { x: ML + 495,     w: 50  },
};

doc.rect(ML, rowY - 4, CW, 18).fill(HEADER_BG);
const ehdr = () => doc.font("Helvetica-Bold").fontSize(7).fillColor(MID);
ehdr().text("No",          ecols.no.x,   rowY, { width: ecols.no.w });
ehdr().text("Date",        ecols.date.x, rowY, { width: ecols.date.w });
ehdr().text("Type",        ecols.type.x, rowY, { width: ecols.type.w });
ehdr().text("Description", ecols.desc.x, rowY, { width: ecols.desc.w });
ehdr().text("Receipt Ref", ecols.rcpt.x, rowY, { width: ecols.rcpt.w });
ehdr().text("Amount",      ecols.amt.x,  rowY, { width: ecols.amt.w,  align: "right" });
rowY += 18;

EXPENSES.forEach((e, i) => {
  const even = i % 2 === 1;
  if (even) doc.rect(ML, rowY - 2, CW, 26).fill("#FAFAFA");
  const row = () => doc.font("Helvetica").fontSize(7).fillColor(DARK);
  row().text(String(LINES.length + i + 1), ecols.no.x, rowY, { width: ecols.no.w });
  row().text(e.date,        ecols.date.x, rowY, { width: ecols.date.w });
  row().text(e.expenseType, ecols.type.x, rowY, { width: ecols.type.w });
  row().text(e.description, ecols.desc.x, rowY, { width: ecols.desc.w, lineGap: 1 });
  row().text(e.receipt,     ecols.rcpt.x, rowY, { width: ecols.rcpt.w });
  row().text(e.amount.toFixed(2), ecols.amt.x, rowY, { width: ecols.amt.w, align: "right" });
  rowY += 30;
});

// Grand total
doc.moveTo(ML, rowY + 2).lineTo(PW - MR, rowY + 2).stroke(RULE);
rowY += 12;

function totRow(label, value, bold = false) {
  const fn = bold ? "Helvetica-Bold" : "Helvetica";
  doc.font(fn).fontSize(9).fillColor(DARK)
    .text(label, totX, rowY, { width: 110, align: "right" });
  doc.font(fn).fontSize(9).fillColor(DARK)
    .text(value, totX + 110, rowY, { width: 50, align: "right" });
  rowY += 16;
}

totRow("Fees:",         fmtMoney(FEES_SUBTOTAL));
totRow("Disbursements:", fmtMoney(EXP_SUBTOTAL));
totRow("Sub-total:",    fmtMoney(SUBTOTAL));
totRow("VAT (0%):",     fmtMoney(VAT_AMT));
doc.moveTo(totX, rowY - 2).lineTo(PW - MR, rowY - 2).stroke(RULE);
rowY += 4;
totRow("TOTAL DUE:",    fmtMoney(TOTAL), true);

// Payment details
rowY += 16;
doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK).text("Payment Details", ML, rowY);
rowY += 12;
doc.font("Helvetica").fontSize(8).fillColor(MID)
  .text("Bank: Barclays Bank PLC  ·  Account Name: Hargreaves & Sutton LLP Client Account  ·  Sort Code: 20-18-74  ·  Account No: 63841200  ·  IBAN: GB92 BARC 2018 7463 8412 00", ML, rowY, { width: CW });

// Footer
doc.moveTo(0, doc.page.height - 40).lineTo(PW, doc.page.height - 40).stroke(NAVY).lineWidth(3);
doc.font("Helvetica").fontSize(7).fillColor(LIGHT)
  .text(
    `${FIRM.name}  ·  Authorised and regulated by the Solicitors Regulation Authority (SRA No. 628441)  ·  ${FIRM.email}`,
    ML, doc.page.height - 30, { width: CW, align: "center" }
  );

doc.end();
stream.on("finish", () => console.log(`✅  Written: ${OUT}`));
