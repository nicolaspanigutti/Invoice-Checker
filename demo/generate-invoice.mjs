// Demo invoice generator for Invoice Checker
// Uses pdfkit from artifacts/api-server/node_modules
// Run: node --experimental-vm-modules demo/generate-invoice.mjs

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("./artifacts/api-server/node_modules/pdfkit");

const OUT = "./demo/Caldwell_Pryce_LLP_INV-2026-0148_Demo.pdf";

// ─── Palette ───────────────────────────────────────────────────────────────
const RED    = "#8B0000";
const DARK   = "#1A1A1A";
const MID    = "#444444";
const LIGHT  = "#888888";
const RULE   = "#D0D0D0";
const HEADER_BG = "#F5F5F5";

// ─── Data ──────────────────────────────────────────────────────────────────

const FIRM = {
  name:    "Caldwell & Pryce LLP",
  address: ["12 Bishopsgate", "London EC2N 4AJ", "United Kingdom"],
  vat:     "GB 823 4471 92",
  email:   "billing@caldwellpryce.com",
};

const CLIENT = {
  name:    "Acme Industrial Group plc",
  dept:    "Legal Department",
  address: ["One Canada Square", "Canary Wharf", "London E14 5AB"],
  ref:     "Legal/2026/ACQ-003",
};

const INVOICE = {
  number:      "INV-2026-0148",
  date:        "28 February 2026",
  due:         "28 March 2026",
  matter:      "Acquisition of Solaris Dynamics Ltd",
  matterRef:   "CP/ACQ/2026/0148",
  jurisdiction:"England & Wales",
  periodStart: "2026-01-01",
  periodEnd:   "2026-01-31",
  currency:    "EUR",
};

// Panel rates (max):
//   Partner          EUR 720/h
//   Senior Associate EUR 580/h
//   Associate 2yr    EUR 445/h
//   Legal Trainee    EUR 275/h

// DELIBERATE BILLING ERRORS introduced:
//
//  [1] RATE_EXCESS         – H. Ashworth (Partner) billed @ EUR 820 (panel max EUR 720) → +EUR 100/h
//  [2] RATE_EXCESS         – J. Sinclair (Sr. Associate) billed @ EUR 650 (panel max EUR 580) → +EUR 70/h
//  [3] MEETING_OVERSTAFFING– 4 timekeepers on same conference call (2026-01-12)
//  [4] DAILY_HOURS_EXCEEDED– J. Sinclair bills 11.0 h on 2026-01-15 (max 10 h/day)
//  [5] DUPLICATE_LINE      – E. Montague line repeated identically on 2026-01-16
//  [6] ARITHMETIC_ERROR    – T. Whitfield: 4.0 h × EUR 275 shown as EUR 1,200 (should be EUR 1,100)
//  [7] INCONSISTENT_RATE   – H. Ashworth charged EUR 850/h on 2026-01-20 (all other lines EUR 820)

const LINES = [
  // --- Week 1: 6–10 Jan ------------------------------------------------
  {
    date: "06 Jan 2026", tk: "H. Ashworth",    role: "Partner",
    hours: 2.0, rate: 820.00, amount: 1640.00,  // [1] rate excess
    desc: "Initial review of project Solaris target information memorandum; internal call with M&A team regarding deal structure and timetable.",
  },
  {
    date: "07 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 3.5, rate: 650.00, amount: 2275.00,  // [2] rate excess
    desc: "Review of Solaris Dynamics Ltd Companies House filings, corporate structure and share register; preparation of due diligence scope note.",
  },
  {
    date: "08 Jan 2026", tk: "E. Montague",    role: "Associate",
    hours: 4.0, rate: 445.00, amount: 1780.00,
    desc: "Research on sector-specific regulatory approvals; competition law pre-assessment for proposed acquisition under EU Merger Regulation.",
  },
  {
    date: "09 Jan 2026", tk: "T. Whitfield",   role: "Legal Trainee",
    hours: 2.5, rate: 275.00, amount:  687.50,
    desc: "Preparation of due diligence tracker; collation of target company public documents and initial indexing of disclosure materials.",
  },
  {
    date: "10 Jan 2026", tk: "H. Ashworth",    role: "Partner",
    hours: 1.5, rate: 820.00, amount: 1230.00,  // [1] rate excess
    desc: "Call with client (Head of M&A, CFO) regarding deal timetable and preliminary valuation mechanics; review of SPA heads of terms.",
  },

  // --- Week 2: 12–17 Jan -----------------------------------------------
  // [3] MEETING_OVERSTAFFING – 4 timekeepers, same call, same day
  {
    date: "12 Jan 2026", tk: "H. Ashworth",    role: "Partner",
    hours: 2.0, rate: 820.00, amount: 1640.00,  // [1] rate excess
    desc: "Conference call with Solaris management team re: acquisition structure, representations and key conditions precedent.",
  },
  {
    date: "12 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 2.0, rate: 650.00, amount: 1300.00,  // [2] rate excess
    desc: "Conference call with Solaris management team re: acquisition structure, representations and key conditions precedent.",
  },
  {
    date: "12 Jan 2026", tk: "E. Montague",    role: "Associate",
    hours: 2.0, rate: 445.00, amount:  890.00,
    desc: "Conference call with Solaris management team re: acquisition structure, representations and key conditions precedent.",
  },
  {
    date: "12 Jan 2026", tk: "T. Whitfield",   role: "Legal Trainee",
    hours: 2.0, rate: 275.00, amount:  550.00,
    desc: "Conference call with Solaris management team re: acquisition structure, representations and key conditions precedent.",
  },
  {
    date: "13 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 3.0, rate: 650.00, amount: 1950.00,  // [2] rate excess
    desc: "First review of draft Share Purchase Agreement received from seller's counsel (Mercer Voss & Partners); mark-up of key commercial provisions.",
  },
  {
    date: "14 Jan 2026", tk: "E. Montague",    role: "Associate",
    hours: 3.5, rate: 445.00, amount: 1557.50,
    desc: "Preparation of competition clearance filing checklist; review of target's EU and UK market share data for merger control analysis.",
  },
  // [4] DAILY_HOURS_EXCEEDED – J. Sinclair 11.0 h on 15 Jan
  {
    date: "15 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 4.0, rate: 650.00, amount: 2600.00,  // [2] rate excess
    desc: "Review of Solaris Dynamics disclosure bundle (Volumes 1–4); preparation of due diligence issues list – commercial contracts section.",
  },
  {
    date: "15 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 4.5, rate: 650.00, amount: 2925.00,  // [2][4] rate excess + daily hours
    desc: "Analysis of MAC clauses, material adverse change definition and closing conditions precedent; drafting negotiation note for client.",
  },
  {
    date: "15 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 2.5, rate: 650.00, amount: 1625.00,  // [2][4] rate excess + daily hours
    desc: "Drafting first draft representations and warranties schedule; cross-referencing with disclosure letter template.",
  },
  // [5] DUPLICATE_LINE – identical entries on 16 Jan
  {
    date: "16 Jan 2026", tk: "E. Montague",    role: "Associate",
    hours: 3.5, rate: 445.00, amount: 1557.50,
    desc: "Review of competition clearance requirements and regulatory filings; drafting CMA pre-notification submission outline.",
  },
  {
    date: "16 Jan 2026", tk: "E. Montague",    role: "Associate",
    hours: 3.5, rate: 445.00, amount: 1557.50,  // [5] duplicate
    desc: "Review of competition clearance requirements and regulatory filings; drafting CMA pre-notification submission outline.",
  },
  {
    date: "17 Jan 2026", tk: "T. Whitfield",   role: "Legal Trainee",
    hours: 3.0, rate: 275.00, amount:  825.00,
    desc: "Updating due diligence tracker with findings from weeks 1–2; preparation of outstanding document request list for data room.",
  },

  // --- Week 3: 20–24 Jan -----------------------------------------------
  // [7] INCONSISTENT_RATE – H. Ashworth at EUR 850 (all other lines EUR 820)
  {
    date: "20 Jan 2026", tk: "H. Ashworth",    role: "Partner",
    hours: 1.5, rate: 850.00, amount: 1275.00,  // [1][7] rate excess + inconsistent rate
    desc: "Review and approval of SPA negotiation strategy memo; call with client General Counsel on key risk areas and deal protections.",
  },
  {
    date: "21 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 4.0, rate: 650.00, amount: 2600.00,  // [2] rate excess
    desc: "Negotiation of SPA representations and warranties with counterpart (Mercer Voss); preparation of negotiation call agenda.",
  },
  {
    date: "22 Jan 2026", tk: "E. Montague",    role: "Associate",
    hours: 2.5, rate: 445.00, amount: 1112.50,
    desc: "Preparation of Phase 1 CMA filing draft; review of Solaris market position analysis and preparation of competitive effects assessment.",
  },
  // [6] ARITHMETIC_ERROR – 4.0h × 275 = EUR 1,100 but billed as EUR 1,200
  {
    date: "23 Jan 2026", tk: "T. Whitfield",   role: "Legal Trainee",
    hours: 4.0, rate: 275.00, amount: 1200.00,  // [6] arithmetic error (should be 1,100)
    desc: "Research on target company pension liabilities; review of Solaris employee benefits documentation and preparation of benefits summary.",
  },
  {
    date: "24 Jan 2026", tk: "H. Ashworth",    role: "Partner",
    hours: 2.5, rate: 820.00, amount: 2050.00,  // [1] rate excess
    desc: "Client update call; preparation of risk matrix and deal timetable; review of revised SPA draft received from seller's counsel.",
  },

  // --- Week 4: 27–31 Jan -----------------------------------------------
  {
    date: "27 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 3.5, rate: 650.00, amount: 2275.00,  // [2] rate excess
    desc: "Mark-up of revised SPA; drafting client negotiation note on indemnities, limitations of liability and W&I insurance provisions.",
  },
  {
    date: "28 Jan 2026", tk: "E. Montague",    role: "Associate",
    hours: 3.0, rate: 445.00, amount: 1335.00,
    desc: "Finalisation of CMA pre-notification submission; review of supporting economic evidence and preparation of filing timetable.",
  },
  {
    date: "29 Jan 2026", tk: "H. Ashworth",    role: "Partner",
    hours: 1.0, rate: 820.00, amount:  820.00,  // [1] rate excess
    desc: "Review and sign-off of CMA filing; call with client on final deal timetable and remaining open SPA points.",
  },
  {
    date: "30 Jan 2026", tk: "T. Whitfield",   role: "Legal Trainee",
    hours: 2.0, rate: 275.00, amount:  550.00,
    desc: "Preparation of signing checklist and conditions precedent tracker; collation of corporate authorisation documents.",
  },
  {
    date: "31 Jan 2026", tk: "J. Sinclair",    role: "Senior Associate",
    hours: 2.0, rate: 650.00, amount: 1300.00,  // [2] rate excess
    desc: "Review of final agreed SPA; preparation of execution copy and closing memorandum; updating matter file for handover.",
  },

  // --- Expenses --------------------------------------------------------
  {
    date: "14 Jan 2026", tk: "",               role: "",
    hours: null, rate: null, amount: 340.00,
    desc: "Travel – return train London/Frankfurt for SPA negotiation meeting (Mercer Voss offices)",
    isExpense: true, expType: "Travel",
  },
  {
    date: "14 Jan 2026", tk: "",               role: "",
    hours: null, rate: null, amount: 425.00,
    desc: "Hotel accommodation Frankfurt – 2 nights (H. Ashworth, J. Sinclair)",
    isExpense: true, expType: "Accommodation",
  },
];

// ─── Totals ────────────────────────────────────────────────────────────────
// The stated totals intentionally do NOT reconcile because of the arithmetic
// error on line #22 (EUR 100 excess) — the tool should catch this.
const SUBTOTAL = LINES.reduce((s, l) => s + l.amount, 0);  // intentional sum
const VAT_RATE = 0.00;  // legal services VAT not charged to corporate client
const VAT_AMT  = 0.00;
const TOTAL    = SUBTOTAL + VAT_AMT;

// ─── PDF Generation ────────────────────────────────────────────────────────
const doc = new PDFDocument({ size: "A4", margin: 50, info: {
  Title:    `${INVOICE.number} – Caldwell & Pryce LLP`,
  Author:   "Caldwell & Pryce LLP",
  Subject:  `Legal Services – ${INVOICE.matter}`,
  Creator:  "Caldwell & Pryce LLP Billing System",
}});

const stream = createWriteStream(OUT);
doc.pipe(stream);

const PW = doc.page.width;
const PH = doc.page.height;
const ML = 50; // margin left
const MR = 50; // margin right
const CW = PW - ML - MR; // content width

function fmtMoney(n) {
  return "EUR " + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmtHours(h) {
  if (h === null) return "";
  return h.toFixed(2);
}

// ─── Header bar ────────────────────────────────────────────────────────────
doc.rect(0, 0, PW, 8).fill(RED);
doc.moveDown(0);

// Firm name (top-left)
doc.fontSize(18).font("Helvetica-Bold").fillColor(DARK)
   .text(FIRM.name, ML, 30, { lineBreak: false });

// Invoice label (top-right)
doc.fontSize(22).font("Helvetica-Bold").fillColor(RED)
   .text("TAX INVOICE", ML, 28, { align: "right", width: CW });

// Firm address
doc.fontSize(8).font("Helvetica").fillColor(LIGHT)
   .text(FIRM.address.join("  ·  ") + "  ·  VAT: " + FIRM.vat, ML, 55, { width: CW });

doc.rect(ML, 68, CW, 0.5).fill(RULE);

// ─── Billing header (two columns) ─────────────────────────────────────────
const Y0 = 78;
const col2X = ML + CW / 2 + 10;

function kv(x, y, key, val, bold = false) {
  doc.fontSize(8).font("Helvetica").fillColor(LIGHT).text(key, x, y, { lineBreak: false });
  doc.fontSize(8).font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(DARK)
     .text(val, x, y + 10, { lineBreak: false });
}

kv(ML,     Y0,      "BILLED TO",         CLIENT.name, true);
doc.fontSize(8).font("Helvetica").fillColor(MID)
   .text(CLIENT.dept,            ML, Y0 + 22)
   .text(CLIENT.address[0],      ML, Y0 + 32)
   .text(CLIENT.address[1],      ML, Y0 + 42)
   .text(CLIENT.address[2],      ML, Y0 + 52)
   .text("Client Ref: " + CLIENT.ref, ML, Y0 + 64, { font: "Helvetica-Oblique" });

kv(col2X, Y0,      "INVOICE NUMBER",   INVOICE.number, true);
kv(col2X, Y0 + 25, "INVOICE DATE",     INVOICE.date);
kv(col2X, Y0 + 50, "PAYMENT DUE",      INVOICE.due);
kv(col2X, Y0 + 75, "CURRENCY",         INVOICE.currency + " (Euro)");

// ─── Matter band ──────────────────────────────────────────────────────────
const YM = Y0 + 105;
doc.rect(ML, YM, CW, 30).fill(HEADER_BG);
doc.fontSize(8).font("Helvetica").fillColor(LIGHT)
   .text("MATTER", ML + 8, YM + 5, { lineBreak: false });
doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK)
   .text(INVOICE.matter, ML + 8, YM + 15, { lineBreak: false });

const half = CW / 2;
doc.fontSize(8).font("Helvetica").fillColor(LIGHT)
   .text("MATTER REF", ML + half, YM + 5, { lineBreak: false });
doc.fontSize(9).font("Helvetica").fillColor(MID)
   .text(INVOICE.matterRef, ML + half, YM + 15, { lineBreak: false });

const half2 = CW * 3 / 4;
doc.fontSize(8).font("Helvetica").fillColor(LIGHT)
   .text("JURISDICTION", ML + half2, YM + 5, { lineBreak: false });
doc.fontSize(9).font("Helvetica").fillColor(MID)
   .text(INVOICE.jurisdiction, ML + half2, YM + 15, { lineBreak: false });

// ─── Billing period ───────────────────────────────────────────────────────
const YB = YM + 38;
doc.fontSize(8).font("Helvetica").fillColor(LIGHT)
   .text(`BILLING PERIOD:  1 January 2026  –  31 January 2026`, ML, YB)
   .text(`Issued by: ${FIRM.email}`, ML, YB + 10);

// ─── Table header ─────────────────────────────────────────────────────────
const YT = YB + 26;
const COL = {
  date:  { x: ML,          w: 62 },
  tk:    { x: ML + 62,     w: 100 },
  role:  { x: ML + 162,    w: 90 },
  desc:  { x: ML + 252,    w: 138 },
  hrs:   { x: ML + 390,    w: 36 },
  rate:  { x: ML + 426,    w: 48 },
  amt:   { x: ML + 474,    w: 71 },
};

function tableHeader(y) {
  doc.rect(ML, y, CW, 16).fill(RED);
  const headers = [
    ["DATE",        COL.date, "left"],
    ["TIMEKEEPER",  COL.tk,   "left"],
    ["ROLE",        COL.role, "left"],
    ["DESCRIPTION", COL.desc, "left"],
    ["HRS",         COL.hrs,  "right"],
    ["RATE €/h",    COL.rate, "right"],
    ["AMOUNT €",    COL.amt,  "right"],
  ];
  headers.forEach(([label, col, align]) => {
    doc.fontSize(7).font("Helvetica-Bold").fillColor("#FFFFFF")
       .text(label, col.x + 3, y + 5, { width: col.w - 3, align });
  });
  return y + 16;
}

let curY = tableHeader(YT);
let rowIndex = 0;
let pageNo = 1;

function checkNewPage() {
  if (curY > PH - 160) {
    doc.addPage();
    // continuation bar
    doc.rect(0, 0, PW, 8).fill(RED);
    doc.fontSize(7).font("Helvetica").fillColor(LIGHT)
       .text(`${FIRM.name}  ·  ${INVOICE.number}  ·  Page ${++pageNo}`, ML, 14);
    curY = tableHeader(30);
  }
}

LINES.forEach((line, i) => {
  checkNewPage();
  const isExpense = !!line.isExpense;
  const bg = isExpense ? "#FFF8F0" : (rowIndex % 2 === 0 ? "#FFFFFF" : "#FAFAFA");

  // measure description height
  const descHeight = doc.heightOfString(line.desc, { width: COL.desc.w - 6, fontSize: 7.5 });
  const rowH = Math.max(18, descHeight + 8);

  doc.rect(ML, curY, CW, rowH).fill(bg);

  // thin rule between rows
  doc.rect(ML, curY + rowH - 0.5, CW, 0.5).fill("#E8E8E8");

  const textY = curY + 5;
  const fColor = isExpense ? "#7A5C00" : DARK;
  const fColorMid = isExpense ? "#A07820" : MID;

  doc.fontSize(7.5).font("Helvetica").fillColor(fColorMid)
     .text(line.date, COL.date.x + 3, textY, { width: COL.date.w - 3 });

  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(fColor)
     .text(isExpense ? "— Expense —" : line.tk, COL.tk.x + 3, textY, { width: COL.tk.w - 3 });

  if (!isExpense) {
    doc.fontSize(7).font("Helvetica").fillColor(LIGHT)
       .text(line.role, COL.role.x + 3, textY, { width: COL.role.w - 3 });
  } else {
    doc.fontSize(7).font("Helvetica").fillColor("#A07820")
       .text(line.expType, COL.role.x + 3, textY, { width: COL.role.w - 3 });
  }

  doc.fontSize(7.5).font("Helvetica").fillColor(fColor)
     .text(line.desc, COL.desc.x + 3, textY, { width: COL.desc.w - 6 });

  if (!isExpense) {
    doc.fontSize(7.5).font("Helvetica").fillColor(MID)
       .text(fmtHours(line.hours), COL.hrs.x, textY, { width: COL.hrs.w - 3, align: "right" });
    doc.fontSize(7.5).font("Helvetica").fillColor(MID)
       .text(line.rate ? line.rate.toFixed(2) : "", COL.rate.x, textY, { width: COL.rate.w - 3, align: "right" });
  }

  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(fColor)
     .text(line.amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
           COL.amt.x, textY, { width: COL.amt.w - 3, align: "right" });

  curY += rowH;
  rowIndex++;
});

// ─── Totals block ─────────────────────────────────────────────────────────
checkNewPage();

const totX = ML + CW - 230;
const totW = 230;

curY += 4;
doc.rect(ML, curY, CW, 0.5).fill(RULE);
curY += 8;

function totRow(label, value, bold = false, redVal = false) {
  doc.fontSize(8.5)
     .font(bold ? "Helvetica-Bold" : "Helvetica")
     .fillColor(bold ? DARK : MID)
     .text(label, totX, curY, { width: totW - 80, align: "right" });
  doc.fontSize(8.5)
     .font(bold ? "Helvetica-Bold" : "Helvetica")
     .fillColor(redVal ? RED : (bold ? DARK : MID))
     .text(value, totX + totW - 80, curY, { width: 77, align: "right" });
  curY += 14;
}

totRow("Subtotal (fees)",            fmtMoney(SUBTOTAL - 765));  // exclude expenses
totRow("Disbursements",              fmtMoney(765.00));
totRow("Subtotal",                   fmtMoney(SUBTOTAL));
totRow("VAT (0% – outside scope)",   "EUR 0.00");
curY += 4;
doc.rect(totX, curY, totW, 0.5).fill(RULE);
curY += 8;
totRow("TOTAL DUE",                  fmtMoney(TOTAL), true, true);

// ─── Payment instructions ─────────────────────────────────────────────────
curY += 10;
doc.rect(ML, curY, CW, 0.5).fill(RULE);
curY += 10;

doc.fontSize(8).font("Helvetica-Bold").fillColor(DARK)
   .text("PAYMENT INSTRUCTIONS", ML, curY);
curY += 12;

const piLines = [
  ["Account Name:",  "Caldwell & Pryce LLP Client Account"],
  ["Bank:",          "Barclays Bank plc, London"],
  ["Sort Code:",     "20-32-06"],
  ["Account No.:",   "83471200"],
  ["IBAN:",          "GB82 BARC 2032 0683 4712 00"],
  ["SWIFT/BIC:",     "BARCGB22"],
  ["Reference:",     INVOICE.number],
];
piLines.forEach(([k, v]) => {
  doc.fontSize(7.5).font("Helvetica").fillColor(LIGHT)
     .text(k, ML, curY, { width: 85, lineBreak: false });
  doc.fontSize(7.5).font("Helvetica").fillColor(MID)
     .text(v, ML + 85, curY, { lineBreak: false });
  curY += 11;
});

// ─── Legal footer ─────────────────────────────────────────────────────────
const footY = PH - 42;
doc.rect(0, footY - 6, PW, 0.5).fill(RULE);

doc.fontSize(6.5).font("Helvetica").fillColor(LIGHT)
   .text(
     "Caldwell & Pryce LLP is a limited liability partnership registered in England and Wales (OC412988). " +
     "Authorised and regulated by the Solicitors Regulation Authority (SRA ID: 654321). " +
     "Registered for VAT: GB 823 4471 92. " +
     "This invoice is subject to Caldwell & Pryce LLP standard terms of business and the applicable Panel Terms & Conditions. " +
     "Payment is due 30 days from invoice date. Late payments may attract interest under the Late Payment of Commercial Debts (Interest) Act 1998.",
     ML, footY, { width: CW - 60, lineBreak: true }
   );

doc.fontSize(7).font("Helvetica-Bold").fillColor(RED)
   .text("Page " + pageNo + " / " + pageNo, PW - MR - 40, footY + 4, { width: 40, align: "right" });

// ─── Error annotation box (for demo reference only) ───────────────────────
// (NOT part of the real invoice — helps demonstrate during the video)
doc.addPage();
doc.rect(0, 0, PW, 8).fill(RED);

doc.fontSize(14).font("Helvetica-Bold").fillColor(RED)
   .text("DEMO ANNOTATION — NOT FOR CLIENT", ML, 24, { align: "center", width: CW });

doc.fontSize(8).font("Helvetica").fillColor(DARK)
   .text("This page lists the deliberate billing errors embedded in this invoice for demonstration purposes.\nThe Invoice Checker tool should detect and flag each of the following issues:", ML, 55, { width: CW });

const ISSUES = [
  {
    rule: "RATE_EXCESS",
    sev:  "Error",
    desc: "H. Ashworth (Partner) billed at EUR 820/h on multiple dates. Panel max = EUR 720/h. Excess = EUR 100/h.",
    lines: "Lines: 06 Jan, 10 Jan, 12 Jan, 24 Jan, 29 Jan",
  },
  {
    rule: "RATE_EXCESS",
    sev:  "Error",
    desc: "J. Sinclair (Senior Associate) billed at EUR 650/h throughout. Panel max = EUR 580/h. Excess = EUR 70/h.",
    lines: "Lines: 07 Jan, 12 Jan, 13 Jan, 15 Jan (×3), 21 Jan, 27 Jan, 31 Jan",
  },
  {
    rule: "MEETING_OVERSTAFFING",
    sev:  "Warning",
    desc: "Four timekeepers (Partner, Sr. Associate, Associate, Legal Trainee) all billed the same 2.0 h for an identical conference call description on 12 Jan 2026. Policy threshold = 3.",
    lines: "Lines: 12 Jan 2026 (all four timekeepers)",
  },
  {
    rule: "DAILY_HOURS_EXCEEDED",
    sev:  "Error",
    desc: "J. Sinclair billed 4.0 + 4.5 + 2.5 = 11.0 hours on 15 January 2026. Panel max = 10 hours/day per timekeeper.",
    lines: "Lines: 15 Jan 2026 (three entries for J. Sinclair)",
  },
  {
    rule: "DUPLICATE_LINE",
    sev:  "Error",
    desc: "E. Montague has two identical line items on 16 Jan 2026: 3.5 h @ EUR 445 = EUR 1,557.50 with the same description. One entry is duplicated.",
    lines: "Lines: 16 Jan 2026 (rows 15 & 16)",
  },
  {
    rule: "ARITHMETIC_ERROR",
    sev:  "Error",
    desc: "T. Whitfield line on 23 Jan 2026: 4.0 h × EUR 275/h = EUR 1,100.00 but invoice shows EUR 1,200.00. Overcharge = EUR 100.00.",
    lines: "Line: 23 Jan 2026",
  },
  {
    rule: "INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER",
    sev:  "Error",
    desc: "H. Ashworth charged at EUR 820/h on all lines except 20 Jan 2026, where the rate is EUR 850/h. Rate inconsistency for same timekeeper.",
    lines: "Affected line: 20 Jan 2026",
  },
];

let annY = 88;
ISSUES.forEach((issue, i) => {
  const isErr = issue.sev === "Error";
  doc.rect(ML, annY, CW, 1).fill(RULE);
  annY += 6;

  const badgeColor = isErr ? "#B91C1C" : "#92400E";
  const badgeBg    = isErr ? "#FEE2E2" : "#FEF3C7";

  // Rule code badge
  doc.roundedRect(ML, annY, 180, 14, 3).fill(badgeBg);
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(badgeColor)
     .text(`[${issue.sev.toUpperCase()}]  ${issue.rule}`, ML + 4, annY + 3.5, { width: 172, lineBreak: false });

  doc.fontSize(8).font("Helvetica").fillColor(DARK)
     .text(issue.desc, ML, annY + 18, { width: CW });
  const dH = doc.heightOfString(issue.desc, { width: CW });

  doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(LIGHT)
     .text(issue.lines, ML, annY + 18 + dH + 2, { width: CW });
  const lH = doc.heightOfString(issue.lines, { width: CW });

  annY += 14 + 4 + dH + lH + 10;
});

doc.rect(ML, annY + 4, CW, 1).fill(RULE);
annY += 14;
doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(LIGHT)
   .text(
     "Note: This is a synthetic demo invoice created to showcase Invoice Checker capabilities. " +
     "All names, firms and matter references are fictitious.",
     ML, annY, { width: CW }
   );

// ─── Finalise ─────────────────────────────────────────────────────────────
doc.end();
stream.on("finish", () => {
  console.log(`\n✅  Invoice PDF written to: ${OUT}`);
  console.log(`   Total lines: ${LINES.length}`);
  console.log(`   Stated total: ${fmtMoney(TOTAL)}`);
  console.log(`\n   Embedded errors:`);
  console.log(`   [1] RATE_EXCESS            – H. Ashworth @ EUR 820-850 (panel max EUR 720)`);
  console.log(`   [2] RATE_EXCESS            – J. Sinclair @ EUR 650 (panel max EUR 580)`);
  console.log(`   [3] MEETING_OVERSTAFFING   – 4 timekeepers on same call (12 Jan)`);
  console.log(`   [4] DAILY_HOURS_EXCEEDED   – J. Sinclair: 11.0 h on 15 Jan`);
  console.log(`   [5] DUPLICATE_LINE         – E. Montague row repeated (16 Jan)`);
  console.log(`   [6] ARITHMETIC_ERROR       – T. Whitfield: 4.0h × EUR 275 shown as EUR 1,200`);
  console.log(`   [7] INCONSISTENT_RATE      – H. Ashworth EUR 820 vs EUR 850 (20 Jan)\n`);
});
