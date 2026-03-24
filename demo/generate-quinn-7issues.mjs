// Quinn Abernethy LLP — Demo invoice with 7 embedded billing issues
// Matter: Data Protection Compliance Review & HR Data Audit
// Run: node demo/generate-quinn-7issues.mjs
//
// ISSUES EMBEDDED:
//  [1] RATE_EXCESS                    — M. Quinn (Partner) @ £880/h; panel max £700/h (line 1)
//  [2] DUPLICATE_LINE                 — C. Abernethy, 07 Mar, identical entry twice (lines 7 & 8)
//  [3] ARITHMETIC_ERROR               — R. Patel, 11 Mar: 4.0h × £270 = £1,080 stated as £1,150 (line 13)
//  [4] INCONSISTENT_RATE_FOR_SAME_TK  — S. Lim billed at £490/h on one line; all others at £530/h (line 4)
//  [5] DAILY_HOURS_EXCEEDED           — S. Lim: 4.0 + 3.5 + 2.5 = 10.0h on 13 Mar (lines 15–17)
//  [6] SENIORITY_OVERKILL             — M. Quinn (Partner) printing, filing and indexing documents (line 10)
//  [7] INTERNAL_COORDINATION          — 3 timekeepers bill for internal-only team meeting (lines 11–13)

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, "Quinn_Abernethy_INV-2026-0163_7Issues.pdf");

// ─── Palette ───────────────────────────────────────────────────────────────────
const NAVY   = "#1A3A5C";   // Quinn Abernethy accent
const DARK   = "#1A1A1A";
const MID    = "#444444";
const LIGHT  = "#888888";
const RULE   = "#D0D0D0";
const GREY   = "#F5F5F5";
const FAINT  = "#FAFAFA";
const WHITE  = "#FFFFFF";

// ─── Firm / client data ────────────────────────────────────────────────────────
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

// ─── Panel rate limits (for reference comments only — not printed on invoice) ──
// Partner         £700/h
// Senior Associate £530/h
// Associate        £430/h
// Paralegal        £270/h
// Max daily hours  8h per timekeeper

// ─── Line items ───────────────────────────────────────────────────────────────
const LINES = [
  // ── Week 1: 3–7 Mar ───────────────────────────────────────────────────────

  // [1] RATE_EXCESS — M. Quinn at £880 (panel max £700)
  {
    date: "03 Mar 2026", tk: "M. Quinn",       role: "Partner",
    hours: 2.0, rate: 880.00, amount: 1760.00,
    desc: "Strategic advisory session on GDPR compliance programme scope and data breach response policy; review of client's lawful basis assessment across HR and payroll data processing activities.",
  },
  // clean
  {
    date: "03 Mar 2026", tk: "S. Lim",         role: "Senior Associate",
    hours: 3.5, rate: 530.00, amount: 1855.00,
    desc: "Detailed review of client's existing privacy notices and data subject rights procedures; gap analysis against UK GDPR Articles 13–14 requirements and ICO accountability framework.",
  },
  // clean
  {
    date: "04 Mar 2026", tk: "C. Abernethy",   role: "Associate",
    hours: 4.0, rate: 430.00, amount: 1720.00,
    desc: "Review of HR data flows and employee monitoring arrangements; preparation of data flow mapping schedule covering recruitment, payroll, absence management and performance review systems.",
  },
  // [4] INCONSISTENT_RATE — S. Lim at £560 on this line (cap £530); all other S. Lim lines at £530
  // This ALSO triggers RATE_EXCESS for this specific line (£560 > cap £530)
  {
    date: "05 Mar 2026", tk: "S. Lim",         role: "Senior Associate",
    hours: 3.0, rate: 560.00, amount: 1680.00,
    desc: "Research on ICO enforcement guidance on employee monitoring and workplace data retention; review of recent ICO enforcement decisions and monetary penalty notices relevant to HR data processing.",
  },
  // clean
  {
    date: "06 Mar 2026", tk: "R. Patel",       role: "Paralegal",
    hours: 2.5, rate: 270.00, amount:  675.00,
    desc: "Preparation of Records of Processing Activities (ROPA) template; compilation of data register entries for recruitment and onboarding processing activities.",
  },
  // clean
  {
    date: "06 Mar 2026", tk: "C. Abernethy",   role: "Associate",
    hours: 3.0, rate: 430.00, amount: 1290.00,
    desc: "Review and mark-up of data processing agreements with 12 third-party HR software providers; analysis of Article 28 UK GDPR processor obligations and standard contractual clauses compliance.",
  },
  // [2] DUPLICATE_LINE — C. Abernethy, 07 Mar (identical entry appears twice)
  {
    date: "07 Mar 2026", tk: "C. Abernethy",   role: "Associate",
    hours: 3.5, rate: 430.00, amount: 1505.00,
    desc: "Preparation of data subject access request (DSAR) handling procedure; drafting of internal DSAR workflow, response templates and escalation protocol for HR and payroll data requests.",
  },
  // [2] DUPLICATE_LINE — identical to line above
  {
    date: "07 Mar 2026", tk: "C. Abernethy",   role: "Associate",
    hours: 3.5, rate: 430.00, amount: 1505.00,
    desc: "Preparation of data subject access request (DSAR) handling procedure; drafting of internal DSAR workflow, response templates and escalation protocol for HR and payroll data requests.",
  },

  // ── Week 2: 10–14 Mar ─────────────────────────────────────────────────────

  // clean
  {
    date: "10 Mar 2026", tk: "M. Quinn",       role: "Partner",
    hours: 1.5, rate: 700.00, amount: 1050.00,
    desc: "Review of draft GDPR compliance gap analysis report; strategic advice to Group Legal Counsel on remediation priorities and data governance accountability framework for HR data.",
  },
  // [6] SENIORITY_OVERKILL — Partner performing admin filing and indexing tasks
  {
    date: "10 Mar 2026", tk: "M. Quinn",       role: "Partner",
    hours: 1.0, rate: 700.00, amount:  700.00,
    desc: "Printing, collating and filing hard copies of signed data processing agreements; updating document index with filing references and organising physical client binder with dividers and labels.",
  },
  // [7] INTERNAL_COORDINATION — internal team meeting, 3 timekeepers (lines 11–13)
  {
    date: "11 Mar 2026", tk: "M. Quinn",       role: "Partner",
    hours: 1.5, rate: 700.00, amount: 1050.00,
    desc: "Internal team meeting to review progress on data compliance audit workstreams, allocate remaining tasks among team members and update internal matter status tracker and billing forecast.",
  },
  {
    date: "11 Mar 2026", tk: "S. Lim",         role: "Senior Associate",
    hours: 1.5, rate: 530.00, amount:  795.00,
    desc: "Internal team meeting to review progress on data compliance audit workstreams, allocate remaining tasks among team members and update internal matter status tracker and billing forecast.",
  },
  {
    date: "11 Mar 2026", tk: "C. Abernethy",   role: "Associate",
    hours: 1.5, rate: 430.00, amount:  645.00,
    desc: "Internal team meeting to review progress on data compliance audit workstreams, allocate remaining tasks among team members and update internal matter status tracker and billing forecast.",
  },
  // [3] ARITHMETIC_ERROR — R. Patel: 4.0h × £270 = £1,080 stated as £1,150
  {
    date: "12 Mar 2026", tk: "R. Patel",       role: "Paralegal",
    hours: 4.0, rate: 270.00, amount: 1150.00,  // ← correct amount is £1,080.00
    desc: "Population of Records of Processing Activities (ROPA) data register with 18 processing operations; entry of purpose, legal basis, data categories, retention periods and third-country transfer details for all HR processing activities.",
  },

  // ── Week 3: 13 Mar — DAILY_HOURS_EXCEEDED ─────────────────────────────────

  // [5] DAILY_HOURS_EXCEEDED — S. Lim: 4.0 + 3.5 + 2.5 = 10.0h on 13 Mar (max 8h)
  {
    date: "13 Mar 2026", tk: "S. Lim",         role: "Senior Associate",
    hours: 4.0, rate: 530.00, amount: 2120.00,
    desc: "First full review of client's employee monitoring policy and BYOD arrangements; detailed analysis of compliance requirements under Article 6(1)(f) UK GDPR legitimate interests for workplace monitoring and preparation of LIA draft.",
  },
  {
    date: "13 Mar 2026", tk: "S. Lim",         role: "Senior Associate",
    hours: 3.5, rate: 530.00, amount: 1855.00,
    desc: "Drafting of updated employee privacy notice compliant with UK GDPR Articles 13–14; drafting of layered notice for display on HR systems covering payroll, absence, performance and disciplinary data processing.",
  },
  {
    date: "13 Mar 2026", tk: "S. Lim",         role: "Senior Associate",
    hours: 2.5, rate: 530.00, amount: 1325.00,  // ← 4.0 + 3.5 + 2.5 = 10.0h total on 13 Mar
    desc: "Review of client's data retention schedule for HR records; preparation of recommended retention periods table covering contracts, payroll, disciplinary, health and occupational health records against statutory minimum obligations.",
  },

  // ── Week 4: 17–21 Mar ─────────────────────────────────────────────────────

  // clean
  {
    date: "17 Mar 2026", tk: "M. Quinn",       role: "Partner",
    hours: 1.0, rate: 700.00, amount:  700.00,
    desc: "Review and sign-off on completed GDPR gap analysis report; preparation of board-level executive summary and remediation roadmap for presentation to client's Data Protection Steering Committee.",
  },
  // clean
  {
    date: "18 Mar 2026", tk: "S. Lim",         role: "Senior Associate",
    hours: 2.5, rate: 530.00, amount: 1325.00,
    desc: "Preparation of data protection impact assessment (DPIA) template and screening questionnaire for client's new HR analytics platform; analysis of high-risk processing triggers under ICO DPIA guidance.",
  },
  // clean
  {
    date: "19 Mar 2026", tk: "C. Abernethy",   role: "Associate",
    hours: 2.0, rate: 430.00, amount:  860.00,
    desc: "Preparation of Data Protection Officer appointment documentation and scope of role memorandum; review of Article 37–39 UK GDPR requirements and ICO DPO guidance for semi-public authority.",
  },
  // clean
  {
    date: "20 Mar 2026", tk: "R. Patel",       role: "Paralegal",
    hours: 2.0, rate: 270.00, amount:  540.00,
    desc: "Preparation of final compliance report annexes; compilation of completed ROPA, privacy notices, DSAR procedure, DPO appointment letter and updated data processing agreements into client deliverable binder.",
  },
  // clean
  {
    date: "21 Mar 2026", tk: "M. Quinn",       role: "Partner",
    hours: 1.0, rate: 700.00, amount:  700.00,
    desc: "Presentation of GDPR compliance programme outcomes to client's board; advice on outstanding remediation actions, ICO registration obligations and ongoing compliance monitoring programme.",
  },
];

// ─── Totals ────────────────────────────────────────────────────────────────────
// The SUBTOTAL includes the arithmetic error (£1,150 instead of £1,080 for line 13)
// and the duplicate line (both lines 7 and 8 counted).
// This means the stated total will be wrong in two ways — the tool should catch this.
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

doc.font("Helvetica-Bold").fontSize(17).fillColor(DARK)
   .text(FIRM.name, ML, 26, { width: CW - 160 });

doc.font("Helvetica").fontSize(8).fillColor(LIGHT)
   .text(FIRM.address.join("  ·  "), ML, 49)
   .text(`${FIRM.sra}   ·   ${FIRM.email}`, ML, 59);

doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY)
   .text("INVOICE", PW - MR - 140, 26, { width: 140, align: "right" });
doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT)
   .text(INVOICE.number, PW - MR - 140, 52, { width: 140, align: "right" });

doc.moveTo(ML, 73).lineTo(PW - MR, 73).strokeColor(RULE).lineWidth(0.5).stroke();

// ─── Invoice meta ─────────────────────────────────────────────────────────────
const c1 = ML, c2 = ML + 175, c3 = ML + 370;
function mf(label, value, x, y) {
  doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT).text(label, x, y, { width: 160 });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK).text(value, x, y + 11, { width: 160 });
}
mf("Invoice Number",  INVOICE.number,      c1, 82);
mf("Invoice Date",    INVOICE.date,        c2, 82);
mf("Due Date",        INVOICE.due,         c3, 82);
mf("Matter",          INVOICE.matter,      c1, 118);
mf("Client Reference",CLIENT.ref,          c3, 118);
mf("Jurisdiction",    INVOICE.jurisdiction,c1, 154);
mf("Billing Period",  INVOICE.period,      c2, 154);
mf("Currency",        "GBP (Pound Sterling)", c3, 154);

// ─── Bill to ──────────────────────────────────────────────────────────────────
const billY = 194;
doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT).text("BILL TO", ML, billY);
doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text(CLIENT.name, ML, billY + 12);
doc.font("Helvetica").fontSize(9).fillColor(MID)
   .text(CLIENT.dept, ML, billY + 25)
   .text(CLIENT.address[0], ML, billY + 36)
   .text(CLIENT.address[1], ML, billY + 46)
   .text(CLIENT.address[2], ML, billY + 56);

doc.moveTo(ML, billY + 72).lineTo(PW - MR, billY + 72).strokeColor(RULE).stroke();

// ─── Table setup ──────────────────────────────────────────────────────────────
const COL = {
  no:   { x: ML,       w: 24  },
  date: { x: ML + 24,  w: 66  },
  tk:   { x: ML + 90,  w: 96  },
  role: { x: ML + 186, w: 82  },
  desc: { x: ML + 268, w: 150 },
  hrs:  { x: ML + 418, w: 32  },
  rate: { x: ML + 450, w: 46  },
  amt:  { x: ML + 496, w: 49  },
};

let curY = billY + 82;
let rowIndex = 0;
let pageNo = 1;

function drawTableHeader(y) {
  doc.rect(ML, y, CW, 16).fill(NAVY);
  const heads = [
    ["No",           COL.no,   "left"],
    ["Date",         COL.date, "left"],
    ["Timekeeper",   COL.tk,   "left"],
    ["Role",         COL.role, "left"],
    ["Description",  COL.desc, "left"],
    ["Hrs",          COL.hrs,  "right"],
    ["Rate £/h",     COL.rate, "right"],
    ["Amount £",     COL.amt,  "right"],
  ];
  heads.forEach(([label, col, align]) => {
    doc.fontSize(7).font("Helvetica-Bold").fillColor(WHITE)
       .text(label, col.x + 2, y + 5, { width: col.w - 2, align });
  });
  return y + 16;
}

function checkNewPage() {
  if (curY > PH - 180) {
    doc.addPage();
    doc.rect(0, 0, PW, 8).fill(NAVY);
    doc.fontSize(7).font("Helvetica").fillColor(LIGHT)
       .text(`${FIRM.name}  ·  ${INVOICE.number}  ·  continued`, ML, 14);
    curY = drawTableHeader(28);
  }
}

curY = drawTableHeader(curY);

LINES.forEach((line, i) => {
  checkNewPage();
  const bg = rowIndex % 2 === 0 ? WHITE : FAINT;
  const descH = doc.heightOfString(line.desc, { width: COL.desc.w - 4, fontSize: 7.5 });
  const rowH = Math.max(20, descH + 8);

  doc.rect(ML, curY, CW, rowH).fill(bg);
  doc.rect(ML, curY + rowH - 0.5, CW, 0.5).fill("#E8E8E8");

  const ty = curY + 4;
  const r = () => doc.font("Helvetica").fontSize(7.5).fillColor(MID);
  const rb = () => doc.font("Helvetica-Bold").fontSize(7.5).fillColor(DARK);

  r().text(String(i + 1),          COL.no.x + 2,   ty, { width: COL.no.w   });
  r().text(line.date,              COL.date.x + 2,  ty, { width: COL.date.w });
  rb().text(line.tk,               COL.tk.x + 2,    ty, { width: COL.tk.w   });
  doc.font("Helvetica").fontSize(7).fillColor(LIGHT)
     .text(line.role,              COL.role.x + 2,  ty, { width: COL.role.w });
  doc.font("Helvetica").fontSize(7.5).fillColor(DARK)
     .text(line.desc,              COL.desc.x + 2,  ty, { width: COL.desc.w - 4 });
  r().text(line.hours.toFixed(2),  COL.hrs.x,       ty, { width: COL.hrs.w,  align: "right" });
  r().text(line.rate.toFixed(2),   COL.rate.x,      ty, { width: COL.rate.w, align: "right" });
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(DARK)
     .text(line.amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
           COL.amt.x, ty, { width: COL.amt.w - 2, align: "right" });

  curY += rowH;
  rowIndex++;
});

// ─── Totals block ─────────────────────────────────────────────────────────────
checkNewPage();
curY += 6;
doc.moveTo(ML, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 12;

const totX = PW - MR - 200;
function totRow(label, value, bold = false, accent = false) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica")
     .fontSize(9).fillColor(bold ? DARK : MID)
     .text(label, totX, curY, { width: 125, align: "right" });
  doc.font(bold ? "Helvetica-Bold" : "Helvetica")
     .fontSize(9).fillColor(accent ? NAVY : (bold ? DARK : MID))
     .text(value, totX + 130, curY, { width: 70, align: "right" });
  curY += 15;
}

totRow("Subtotal (professional fees):", fmtGBP(SUBTOTAL));
totRow(`VAT @ ${VAT_RATE}%:`,           fmtGBP(VAT_AMT));
curY += 3;
doc.moveTo(totX, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 6;
totRow("TOTAL DUE:", fmtGBP(TOTAL), true, true);

// ─── Payment instructions ──────────────────────────────────────────────────────
checkNewPage();
curY += 16;
doc.moveTo(ML, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 12;
doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK)
   .text("PAYMENT INSTRUCTIONS", ML, curY);
curY += 14;
const piLines = [
  ["Account Name:",  "Quinn Abernethy LLP Client Account"],
  ["Bank:",          "Barclays Bank plc, London"],
  ["Sort Code:",     "20-00-00"],
  ["Account No.:",   "73849201"],
  ["IBAN:",          "GB82 BARC 2000 0073 8492 01"],
  ["SWIFT/BIC:",     "BARCGB22"],
  ["Reference:",     INVOICE.number],
];
piLines.forEach(([k, v]) => {
  doc.font("Helvetica").fontSize(8).fillColor(LIGHT)
     .text(k, ML, curY, { width: 90, lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor(MID)
     .text(v, ML + 90, curY, { lineBreak: false });
  curY += 13;
});

// ─── Footer bar ───────────────────────────────────────────────────────────────
const footerY = PH - 38;
doc.rect(0, footerY, PW, 38).fill(NAVY);
doc.font("Helvetica").fontSize(7).fillColor(WHITE)
   .text(
     "Quinn Abernethy LLP is a limited liability partnership registered in England & Wales (OC501847)  ·  " +
     "Authorised and regulated by the Solicitors Regulation Authority (SRA No. 744821)  ·  " +
     "Payment terms: 30 days from invoice date",
     ML, footerY + 12, { width: CW, align: "center" }
   );

doc.end();

stream.on("finish", () => {
  console.log(`\n✅  Invoice PDF written: ${OUT}`);
  console.log(`\nIssues embedded in INV-2026-0163:`);
  console.log(`  [1] RATE_EXCESS                   — Line 1:  M. Quinn (Partner) @ £880/h vs max £700/h`);
  console.log(`  [2] DUPLICATE_LINE                — Lines 7–8: C. Abernethy, 07 Mar, identical entries`);
  console.log(`  [3] ARITHMETIC_ERROR              — Line 13: R. Patel 4.0h × £270 = £1,080 stated as £1,150`);
  console.log(`  [4] INCONSISTENT_RATE_FOR_SAME_TK — Line 4:  S. Lim at £560/h (exceeds £530 cap); all others at £530/h → also fires RATE_EXCESS`);
  console.log(`  [5] DAILY_HOURS_EXCEEDED          — Lines 15–17: S. Lim 10.0h on 13 Mar (max 8h)`);
  console.log(`  [6] SENIORITY_OVERKILL (AI)       — Line 10: Partner M. Quinn printing/filing/indexing docs`);
  console.log(`  [7] INTERNAL_COORDINATION (AI)    — Lines 11–13: 3 timekeepers bill internal team meeting`);
  console.log(`\n  Total recoverable: £70 arithmetic error + duplicate line amount + rate excess`);
});
