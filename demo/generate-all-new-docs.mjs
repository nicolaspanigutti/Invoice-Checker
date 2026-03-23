// Generates 6 demo documents:
//   1. Quinn_Abernethy_INV-2026-0112_Clean.pdf          — clean invoice, no issues
//   2. Stavros_Nikolopoulos_INV-2026-0083_Clean.pdf     — clean invoice, no issues
//   3. Quinn_Abernethy_INV-2026-0145_RateExcess.pdf     — RATE_EXCESS issue
//   4. Stavros_Nikolopoulos_INV-2026-0097_Issues.pdf    — DAILY_HOURS + INTERNAL_COORD issues
//   5. Quinn_Abernethy_LLP_Engagement_Letter_2026.pdf   — T&C / panel appointment
//   6. Stavros_Nikolopoulos_Engagement_Letter_2026.pdf  — T&C / panel appointment
//
// Run: node demo/generate-all-new-docs.mjs

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");
const DIR = path.dirname(fileURLToPath(import.meta.url));
const out = (name) => path.resolve(DIR, name);

// ─── Colour palettes ──────────────────────────────────────────────────────────
const C = {
  RED:  "#B30000", DARK: "#1A1A1A", MID:  "#444444",
  LIGHT:"#888888", RULE: "#D0D0D0", GREY: "#F5F5F5", FAINT:"#FAFAFA",
  NAVY: "#1B2A4A", GOLD: "#B8963E",
  TEAL: "#0F5F6A", SAND: "#C8A84B",
};

// ─── Shared helpers ────────────────────────────────────────────────────────────
function buildDoc(outPath, meta) {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: meta });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);
  const PW = doc.page.width;
  const ML = 50, MR = 50, CW = PW - ML - MR;
  return { doc, stream, PW, ML, MR, CW };
}

function fmtGBP(n) { return "GBP " + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtEUR(n) { return "EUR " + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

function invoiceHeader(doc, PW, ML, MR, CW, accentColor, firm, client, inv) {
  doc.rect(0, 0, PW, 8).fill(accentColor);
  doc.font("Helvetica-Bold").fontSize(17).fillColor(C.DARK).text(firm.name, ML, 26, { width: CW - 160 });
  const afterName = doc.y + 3;
  doc.font("Helvetica").fontSize(8).fillColor(C.LIGHT);
  firm.address.forEach(l => doc.text(l));
  if (firm.vat) doc.text(`VAT: ${firm.vat}   ·   ${firm.email}`);
  else doc.text(firm.email);

  doc.font("Helvetica-Bold").fontSize(20).fillColor(accentColor)
    .text("INVOICE", PW - MR - 140, 26, { width: 140, align: "right" });
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text(inv.number, PW - MR - 140, 52, { width: 140, align: "right" });

  doc.moveTo(ML, afterName + 44).lineTo(PW - MR, afterName + 44).strokeColor(C.RULE).lineWidth(0.5).stroke();

  const metaY = afterName + 54;
  const c1 = ML, c2 = ML + 175, c3 = ML + 350;
  function mf(label, value, x, y) {
    doc.font("Helvetica").fontSize(7.5).fillColor(C.LIGHT).text(label, x, y);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.DARK).text(value, x, y + 11, { width: 160 });
  }
  mf("Invoice Number", inv.number, c1, metaY);
  mf("Invoice Date", inv.date, c2, metaY);
  mf("Due Date", inv.due, c3, metaY);
  const metaY2 = metaY + 36;
  mf("Matter", inv.matter, c1, metaY2);
  mf("Client Reference", client.ref, c3, metaY2);
  const metaY3 = metaY2 + 36;
  mf("Jurisdiction", inv.jurisdiction, c1, metaY3);
  mf("Billing Period", inv.period, c2, metaY3);
  mf("Currency", inv.currency, c3, metaY3);

  const billY = metaY3 + 46;
  doc.font("Helvetica").fontSize(7.5).fillColor(C.LIGHT).text("BILL TO", ML, billY);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(C.DARK).text(client.name, ML, billY + 12);
  doc.font("Helvetica").fontSize(9).fillColor(C.MID).text(client.dept);
  client.address.forEach(l => doc.text(l));
  doc.moveTo(ML, doc.y + 12).lineTo(PW - MR, doc.y + 12).strokeColor(C.RULE).stroke();
  return doc.y + 22;
}

function linesTable(doc, ML, MR, CW, tableY, lines, fmtMoney) {
  const cols = {
    no:   { x: ML,       w: 26  },
    date: { x: ML + 26,  w: 66  },
    tk:   { x: ML + 92,  w: 96  },
    role: { x: ML + 188, w: 90  },
    desc: { x: ML + 278, w: 138 },
    hrs:  { x: ML + 416, w: 32  },
    rate: { x: ML + 448, w: 52  },
    amt:  { x: ML + 500, w: 45  },
  };
  doc.rect(ML, tableY - 4, CW, 17).fill(C.GREY);
  const h = () => doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.MID);
  h().text("No",    cols.no.x,   tableY, { width: cols.no.w   });
  h().text("Date",  cols.date.x, tableY, { width: cols.date.w });
  h().text("Timekeeper", cols.tk.x, tableY, { width: cols.tk.w });
  h().text("Role",  cols.role.x, tableY, { width: cols.role.w });
  h().text("Description", cols.desc.x, tableY, { width: cols.desc.w });
  h().text("Hrs",   cols.hrs.x,  tableY, { width: cols.hrs.w,  align: "right" });
  h().text("Rate",  cols.rate.x, tableY, { width: cols.rate.w, align: "right" });
  h().text("Amount",cols.amt.x,  tableY, { width: cols.amt.w,  align: "right" });

  let rowY = tableY + 17;
  lines.forEach((l, i) => {
    if (i % 2 === 1) doc.rect(ML, rowY - 2, CW, 28).fill(C.FAINT);
    const r = () => doc.font("Helvetica").fontSize(7.5).fillColor(C.DARK);
    r().text(String(i + 1), cols.no.x,   rowY, { width: cols.no.w   });
    r().text(l.date,        cols.date.x, rowY, { width: cols.date.w });
    r().text(l.tk,          cols.tk.x,   rowY, { width: cols.tk.w   });
    r().text(l.role,        cols.role.x, rowY, { width: cols.role.w });
    r().text(l.desc,        cols.desc.x, rowY, { width: cols.desc.w, lineGap: 1 });
    r().text(l.hours.toFixed(2), cols.hrs.x,  rowY, { width: cols.hrs.w,  align: "right" });
    r().text(l.rate.toFixed(2),  cols.rate.x, rowY, { width: cols.rate.w, align: "right" });
    r().text(l.amount.toFixed(2),cols.amt.x,  rowY, { width: cols.amt.w,  align: "right" });
    rowY += 30;
  });
  return rowY;
}

function totalsBlock(doc, PW, MR, rowY, subtotal, vatRate, vatAmt, total, fmtMoney, RULE) {
  doc.moveTo(50, rowY + 4).lineTo(PW - MR, rowY + 4).strokeColor(RULE).stroke();
  rowY += 14;
  const tx = PW - MR - 180;
  function tRow(label, value, bold) {
    const fn = bold ? "Helvetica-Bold" : "Helvetica";
    doc.font(fn).fontSize(9).fillColor(C.DARK)
      .text(label, tx, rowY, { width: 120, align: "right" })
      .text(value, tx + 124, rowY, { width: 56, align: "right" });
    rowY += 16;
  }
  tRow("Subtotal:", fmtMoney(subtotal));
  tRow(`VAT (${vatRate}%):`, fmtMoney(vatAmt));
  doc.moveTo(tx, rowY - 2).lineTo(PW - MR, rowY - 2).strokeColor(RULE).stroke();
  rowY += 4;
  tRow("TOTAL DUE:", fmtMoney(total), true);
  return rowY;
}

function invoiceFooter(doc, PW, ML, CW, accentColor, firm, payDetails) {
  const fh = doc.page.height;
  doc.rect(0, fh - 38, PW, 38).fill(accentColor);
  doc.font("Helvetica").fontSize(7).fillColor("#FFFFFF")
    .text(`${firm.name}  ·  ${payDetails}`, ML, fh - 24, { width: CW, align: "center" });
}

// ─── FIRM DATA ─────────────────────────────────────────────────────────────────
const QUINN = {
  name:    "Quinn Abernethy LLP",
  address: ["22 Aldgate High Street", "London EC3N 1AL", "United Kingdom"],
  email:   "billing@quinnabernethy.co.uk",
  sra:     "SRA No. 744821",
  color:   "#1A3A5C",   // deep navy
};

const STAVROS = {
  name:    "Stavros Nikolopoulos & Partners",
  address: ["28 Vasilissis Sofias Avenue", "Athens 106 74", "Greece"],
  vat:     "GR 098 234 561",
  email:   "billing@sn-partners.gr",
  color:   "#2D5A27",   // forest green
};

const ACME = {
  name: "Acme Industrial Group plc",
  dept: "Legal Department",
  address: ["One Canada Square", "Canary Wharf", "London E14 5AB"],
  ref:  "Legal/2026/IP-012",
};
const ACME2 = { ...ACME, ref: "Legal/2026/GR-007" };

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 1 — Quinn Abernethy — Clean invoice (no issues)
// ═══════════════════════════════════════════════════════════════════════════════
function genQuinnClean() {
  const { doc, stream, PW, ML, MR, CW } = buildDoc(
    out("Quinn_Abernethy_INV-2026-0112_Clean.pdf"),
    { Title: "INV-2026-0112 — Quinn Abernethy LLP", Author: "Quinn Abernethy LLP", Subject: "IP Portfolio Management" }
  );

  // All rates within panel limits: Partner £700, Sr Assoc £530, Assoc £430, Paralegal £270
  const lines = [
    { date:"03 Mar 2026", tk:"M. Quinn",       role:"Partner",           hours:2.0, rate:700.00, amount:1400.00, desc:"Strategic review of client's UK and EU trademark portfolio; advice on renewal priorities and conflicting third-party applications filed Q1 2026." },
    { date:"04 Mar 2026", tk:"S. Lim",          role:"Senior Associate",  hours:3.5, rate:530.00, amount:1855.00, desc:"Detailed review of 12 UK trademark registrations in Classes 9, 35 and 42; preparation of renewal schedule and conflict search instructions." },
    { date:"05 Mar 2026", tk:"C. Abernethy",    role:"Associate",         hours:4.0, rate:430.00, amount:1720.00, desc:"Conflict searches across UKIPO and EUIPO databases for new brand AURORA; preparation of clearance opinion memorandum." },
    { date:"06 Mar 2026", tk:"S. Lim",          role:"Senior Associate",  hours:3.0, rate:530.00, amount:1590.00, desc:"Drafting of trademark watch service brief; preparation of EUIPO renewal instructions for EU trademark No. 017 843 291." },
    { date:"07 Mar 2026", tk:"R. Patel",        role:"Paralegal",         hours:2.5, rate:270.00, amount: 675.00, desc:"Filing of UKIPO renewal applications for 7 trademarks; preparation of filing receipts and docket update." },
    { date:"10 Mar 2026", tk:"M. Quinn",        role:"Partner",           hours:1.5, rate:700.00, amount:1050.00, desc:"Client call with IP Director re: AURORA brand strategy and territorial expansion plans in APAC; advice on filing strategy under Madrid Protocol." },
    { date:"11 Mar 2026", tk:"C. Abernethy",    role:"Associate",         hours:3.5, rate:430.00, amount:1505.00, desc:"Preparation of Madrid Protocol application package for AURORA mark; country selection analysis for Japan, Australia and Singapore filings." },
    { date:"12 Mar 2026", tk:"S. Lim",          role:"Senior Associate",  hours:2.5, rate:530.00, amount:1325.00, desc:"Review of Madrid Protocol application draft; analysis of local requirements for Japan (JPO) and Singapore (IPOS) designations." },
    { date:"13 Mar 2026", tk:"R. Patel",        role:"Paralegal",         hours:2.0, rate:270.00, amount: 540.00, desc:"Preparation and filing of WIPO MM2 form for international trademark application; fee calculation and docket entry." },
    { date:"17 Mar 2026", tk:"M. Quinn",        role:"Partner",           hours:1.0, rate:700.00, amount: 700.00, desc:"Review of AURORA international application; sign-off on country designations; final advice to client on monitoring strategy post-filing." },
    { date:"18 Mar 2026", tk:"C. Abernethy",    role:"Associate",         hours:2.0, rate:430.00, amount: 860.00, desc:"Preparation of IP portfolio management report for Q1 2026; update of trademark register and docket for all active matters." },
    { date:"19 Mar 2026", tk:"R. Patel",        role:"Paralegal",         hours:1.5, rate:270.00, amount: 405.00, desc:"Updating client IP database; filing correspondence and WIPO acknowledgement letters; preparation of Q2 renewal reminder schedule." },
  ];

  const SUBTOTAL = lines.reduce((s, l) => s + l.amount, 0);
  const VAT_AMT = SUBTOTAL * 0.20;
  const TOTAL = SUBTOTAL + VAT_AMT;

  const tableY = invoiceHeader(doc, PW, ML, MR, CW, QUINN.color, QUINN,
    { ...ACME, ref: "Legal/2026/IP-112" },
    { number:"INV-2026-0112", date:"31 March 2026", due:"15 May 2026",
      matter:"IP Portfolio Management — AURORA Brand & Trademark Renewals",
      jurisdiction:"England & Wales", period:"1 Mar 2026 to 31 Mar 2026", currency:"GBP" });

  const rowY = linesTable(doc, ML, MR, CW, tableY, lines, fmtGBP);
  totalsBlock(doc, PW, MR, rowY, SUBTOTAL, 20, VAT_AMT, TOTAL, fmtGBP, C.RULE);

  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.DARK).text("Payment Details", ML, doc.y + 22);
  doc.font("Helvetica").fontSize(8).fillColor(C.MID)
    .text("Bank: Barclays Bank plc, London  ·  Sort Code: 20-00-00  ·  Account: 73849201  ·  IBAN: GB82 BARC 2000 0073 8492 01  ·  Ref: INV-2026-0112",
      ML, doc.y + 10, { width: CW });

  invoiceFooter(doc, PW, ML, CW, QUINN.color, QUINN,
    "Authorised & Regulated by the Solicitors Regulation Authority (SRA No. 744821)  ·  Registered in England & Wales (OC501847)");
  doc.end();
  stream.on("finish", () => console.log("✅  Quinn Abernethy CLEAN invoice written"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 2 — Stavros Nikolopoulos — Clean invoice (no issues)
// ═══════════════════════════════════════════════════════════════════════════════
function genStavrosClean() {
  const { doc, stream, PW, ML, MR, CW } = buildDoc(
    out("Stavros_Nikolopoulos_INV-2026-0083_Clean.pdf"),
    { Title: "INV-2026-0083 — Stavros Nikolopoulos & Partners", Author: "Stavros Nikolopoulos & Partners", Subject: "Joint Venture — Greek Law Advisory" }
  );

  // All rates within panel limits: Partner €720, Sr Assoc €550, Assoc €440, Trainee €220
  const lines = [
    { date:"05 Mar 2026", tk:"K. Nikolopoulos", role:"Partner",           hours:2.5, rate:720.00, amount:1800.00, desc:"Initial strategic advisory session on proposed JV structure between client and Hellas Logistics SA; analysis of Greek commercial partnership law (Law 4072/2012) and investment framework." },
    { date:"06 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:3.5, rate:550.00, amount:1925.00, desc:"Research on Greek JV regulatory requirements; analysis of BoD approval requirements and mandatory pre-emption rights under Greek corporate law for proposed JV entity." },
    { date:"07 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:4.0, rate:440.00, amount:1760.00, desc:"Preparation of comparative analysis of JV structure options: SyE (general partnership), EPE (private company) vs AE (Société Anonyme); tax implications of each structure." },
    { date:"10 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:3.0, rate:550.00, amount:1650.00, desc:"Drafting of JV heads of terms; preparation of governance provisions covering board composition, voting rights, reserved matters and exit mechanisms." },
    { date:"11 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:3.5, rate:440.00, amount:1540.00, desc:"Legal research on Greek competition law clearance thresholds (Law 3959/2011); analysis of Hellenic Competition Commission filing obligations for proposed JV." },
    { date:"12 Mar 2026", tk:"M. Theodorou",    role:"Legal Trainee",     hours:2.0, rate:220.00, amount: 440.00, desc:"Document compilation and index preparation for JV due diligence file; preparation of Greek corporate registry extracts for Hellas Logistics SA." },
    { date:"13 Mar 2026", tk:"K. Nikolopoulos", role:"Partner",           hours:1.5, rate:720.00, amount:1080.00, desc:"Video call with client CFO and legal counsel re: JV governance structure; strategic advice on IP contribution arrangements and profit participation mechanics." },
    { date:"17 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:4.0, rate:550.00, amount:2200.00, desc:"Drafting of JV Agreement (first draft): governance, capital contributions, management committee, reserved matters and deadlock resolution provisions." },
    { date:"18 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:3.0, rate:440.00, amount:1320.00, desc:"Legal review of IP assignment schedule annexed to JV Agreement; analysis of Greek IP law requirements for technology transfer and licence provisions." },
    { date:"19 Mar 2026", tk:"M. Theodorou",    role:"Legal Trainee",     hours:2.0, rate:220.00, amount: 440.00, desc:"Updating matter file; preparation of Greek Notary requirements checklist for JV entity formation; translation review of Hellas Logistics constitutional documents." },
    { date:"24 Mar 2026", tk:"K. Nikolopoulos", role:"Partner",           hours:1.0, rate:720.00, amount: 720.00, desc:"Review of JV Agreement first draft; partner sign-off on governance provisions; preparation of issues list for negotiation with Hellas Logistics advisors." },
    { date:"25 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:2.5, rate:550.00, amount:1375.00, desc:"Revision of JV Agreement following partner review; preparation of negotiation notes and alternative drafting for key disputed provisions." },
    { date:"26 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:2.0, rate:440.00, amount: 880.00, desc:"Preparation of final clean execution copy of JV Agreement; coordination with Greek notary on authentication and apostille requirements." },
  ];

  const SUBTOTAL = lines.reduce((s, l) => s + l.amount, 0);
  const VAT_AMT = SUBTOTAL * 0.24; // Greek VAT 24%
  const TOTAL = SUBTOTAL + VAT_AMT;

  const tableY = invoiceHeader(doc, PW, ML, MR, CW, STAVROS.color, STAVROS,
    { ...ACME2, ref: "Legal/2026/GR-083" },
    { number:"INV-2026-0083", date:"31 March 2026", due:"15 May 2026",
      matter:"Joint Venture Advisory — Hellas Logistics SA — Greek Law",
      jurisdiction:"Greece (Attica)", period:"1 Mar 2026 to 31 Mar 2026", currency:"EUR" });

  const rowY = linesTable(doc, ML, MR, CW, tableY, lines, fmtEUR);
  totalsBlock(doc, PW, MR, rowY, SUBTOTAL, 24, VAT_AMT, TOTAL, fmtEUR, C.RULE);

  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.DARK).text("Payment Details", ML, doc.y + 22);
  doc.font("Helvetica").fontSize(8).fillColor(C.MID)
    .text("Bank: Alpha Bank S.A., Athens  ·  IBAN: GR16 0140 1010 1010 0002 3199 234  ·  BIC: CRBAGRAAXXX  ·  Ref: INV-2026-0083",
      ML, doc.y + 10, { width: CW });

  invoiceFooter(doc, PW, ML, CW, STAVROS.color, STAVROS,
    "Registered with the Athens Bar Association  ·  VAT: GR 098 234 561  ·  billing@sn-partners.gr");
  doc.end();
  stream.on("finish", () => console.log("✅  Stavros Nikolopoulos CLEAN invoice written"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 3 — Quinn Abernethy — Invoice with RATE_EXCESS
// Partner M. Quinn bills at £880/h vs panel maximum of £700/h (lines 2, 6, 9)
// ═══════════════════════════════════════════════════════════════════════════════
function genQuinnIssues() {
  const { doc, stream, PW, ML, MR, CW } = buildDoc(
    out("Quinn_Abernethy_INV-2026-0145_RateExcess.pdf"),
    { Title: "INV-2026-0145 — Quinn Abernethy LLP", Author: "Quinn Abernethy LLP", Subject: "Patent Litigation Support" }
  );

  // ⚠ M. Quinn (Partner) bills at £880/h — panel max is £700/h
  // All other timekeepers are within limits
  const lines = [
    { date:"04 Mar 2026", tk:"S. Lim",       role:"Senior Associate",  hours:4.0, rate:530.00, amount:2120.00, desc:"Review of patent invalidation arguments for EP 2 847 923 B1; analysis of prior art references submitted by opponent Techspin GmbH in EPO opposition proceedings." },
    { date:"04 Mar 2026", tk:"M. Quinn",      role:"Partner",           hours:2.0, rate:880.00, amount:1760.00, desc:"Strategic review of EPO opposition file and partner sign-off on invalidity arguments; advice on settlement risk assessment and litigation budget." },
    { date:"05 Mar 2026", tk:"C. Abernethy",  role:"Associate",         hours:5.0, rate:430.00, amount:2150.00, desc:"Technical review of prior art documents D1–D7; preparation of claim chart comparing patent claims against closest prior art for European Technical Board of Appeal submissions." },
    { date:"06 Mar 2026", tk:"S. Lim",        role:"Senior Associate",  hours:3.5, rate:530.00, amount:1855.00, desc:"Drafting of grounds of appeal (Article 12(4) RPBA 2020); detailed analysis of Board of Appeal case law on added matter objections under Article 123(2) EPC." },
    { date:"07 Mar 2026", tk:"R. Patel",      role:"Paralegal",         hours:2.0, rate:270.00, amount: 540.00, desc:"Compilation and formatting of appeal brief annexes; preparation of EPO submission portal files and official fee calculation for appeal proceedings." },
    { date:"10 Mar 2026", tk:"M. Quinn",      role:"Partner",           hours:1.5, rate:880.00, amount:1320.00, desc:"Client call with Chief IP Counsel and Head of Litigation re: appeal strategy and settlement options; review of revised claim set proposed by client to address added matter objection." },
    { date:"11 Mar 2026", tk:"C. Abernethy",  role:"Associate",         hours:4.0, rate:430.00, amount:1720.00, desc:"Preparation of auxiliary requests 1–4 with claim amendments; preparation of supporting argumentation for each request addressing Technical Board's preliminary opinion." },
    { date:"12 Mar 2026", tk:"S. Lim",        role:"Senior Associate",  hours:3.0, rate:530.00, amount:1590.00, desc:"Review and revision of auxiliary requests; preparation of combined reply to Board's preliminary opinion and opponent's response to appeal grounds." },
    { date:"13 Mar 2026", tk:"M. Quinn",      role:"Partner",           hours:1.0, rate:880.00, amount: 880.00, desc:"Final partner review and sign-off on appeal submissions; strategic advice on oral proceedings preparation and risk management for hearing scheduled May 2026." },
    { date:"17 Mar 2026", tk:"C. Abernethy",  role:"Associate",         hours:3.5, rate:430.00, amount:1505.00, desc:"Research on Technical Board of Appeal precedents for similar claim scope issues; preparation of case law binder for oral proceedings preparation file." },
    { date:"18 Mar 2026", tk:"S. Lim",        role:"Senior Associate",  hours:2.5, rate:530.00, amount:1325.00, desc:"Preparation of oral proceedings outline: opening statement, response to Board questions, fall-back positions for each auxiliary request." },
    { date:"19 Mar 2026", tk:"R. Patel",      role:"Paralegal",         hours:1.5, rate:270.00, amount: 405.00, desc:"Scheduling coordination with EPO for oral proceedings; preparation of travel arrangements notice and client briefing pack for May hearing." },
  ];

  const SUBTOTAL = lines.reduce((s, l) => s + l.amount, 0);
  const VAT_AMT = SUBTOTAL * 0.20;
  const TOTAL = SUBTOTAL + VAT_AMT;

  const tableY = invoiceHeader(doc, PW, ML, MR, CW, QUINN.color, QUINN,
    { ...ACME, ref: "Legal/2026/PAT-145" },
    { number:"INV-2026-0145", date:"31 March 2026", due:"15 May 2026",
      matter:"Patent Litigation Support — EPO Opposition Appeal (EP 2 847 923 B1)",
      jurisdiction:"England & Wales / EPO (Munich)", period:"1 Mar 2026 to 31 Mar 2026", currency:"GBP" });

  const rowY = linesTable(doc, ML, MR, CW, tableY, lines, fmtGBP);
  totalsBlock(doc, PW, MR, rowY, SUBTOTAL, 20, VAT_AMT, TOTAL, fmtGBP, C.RULE);

  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.DARK).text("Payment Details", ML, doc.y + 22);
  doc.font("Helvetica").fontSize(8).fillColor(C.MID)
    .text("Bank: Barclays Bank plc, London  ·  Sort Code: 20-00-00  ·  Account: 73849201  ·  IBAN: GB82 BARC 2000 0073 8492 01  ·  Ref: INV-2026-0145",
      ML, doc.y + 10, { width: CW });

  invoiceFooter(doc, PW, ML, CW, QUINN.color, QUINN,
    "Authorised & Regulated by the Solicitors Regulation Authority (SRA No. 744821)  ·  Registered in England & Wales (OC501847)");
  doc.end();
  stream.on("finish", () => console.log("✅  Quinn Abernethy RATE EXCESS invoice written  ⚠ Partner billed at £880 vs panel max £700"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 4 — Stavros Nikolopoulos — Invoice with DAILY_HOURS_EXCEEDED + INTERNAL_COORDINATION
// A. Petrakis bills 10.5h on 12 Mar (max 8h per T&C)
// 3 timekeepers each bill 1.5h for same internal team meeting on 18 Mar
// ═══════════════════════════════════════════════════════════════════════════════
function genStavrosIssues() {
  const { doc, stream, PW, ML, MR, CW } = buildDoc(
    out("Stavros_Nikolopoulos_INV-2026-0097_Issues.pdf"),
    { Title: "INV-2026-0097 — Stavros Nikolopoulos & Partners", Author: "Stavros Nikolopoulos & Partners", Subject: "M&A Due Diligence — Acquisition of Hellas Renewables" }
  );

  const lines = [
    { date:"05 Mar 2026", tk:"K. Nikolopoulos", role:"Partner",           hours:2.0, rate:720.00, amount:1440.00, desc:"Partner kick-off meeting with client M&A team; strategic planning for due diligence scope; review of Information Memorandum for Hellas Renewables SA target." },
    { date:"06 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:5.0, rate:550.00, amount:2750.00, desc:"Legal due diligence: review of corporate documents, shareholding structure and statutory registers for Hellas Renewables SA; preparation of initial findings note." },
    { date:"06 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:4.5, rate:440.00, amount:1980.00, desc:"Review of environmental licences and regulatory approvals for 3 wind farm projects; analysis of compliance with Greek energy law (Law 4685/2020)." },
    { date:"07 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:4.0, rate:550.00, amount:2200.00, desc:"Review of material contracts: grid connection agreements, PPA agreements and equipment supply contracts for Hellas Renewables wind portfolio." },
    { date:"10 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:5.0, rate:440.00, amount:2200.00, desc:"Review of employment contracts and works council arrangements; analysis of Greek labour law implications of proposed TUPE-equivalent transfer obligations." },
    { date:"11 Mar 2026", tk:"M. Theodorou",    role:"Legal Trainee",     hours:3.0, rate:220.00, amount: 660.00, desc:"Document room management; indexing of disclosed documents and preparation of VDR tracking log; translation of Greek statutory filings." },
    // ⚠ DAILY_HOURS_EXCEEDED: A. Petrakis bills 10.5h on 12 Mar (max = 8h per T&C)
    { date:"12 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:5.5, rate:550.00, amount:3025.00, desc:"Morning session: review of land registry certificates, planning permissions and court search results for all three wind farm sites in Evia and Laconia regions." },
    { date:"12 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:5.0, rate:550.00, amount:2750.00, desc:"Afternoon session: preparation of legal due diligence report sections on corporate, contracts and real estate; drafting of red flag summary for partner review." },
    { date:"13 Mar 2026", tk:"K. Nikolopoulos", role:"Partner",           hours:1.5, rate:720.00, amount:1080.00, desc:"Partner review of initial due diligence red flag summary; advice on risk assessment and SPA price adjustment mechanisms for identified issues." },
    { date:"13 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:4.0, rate:440.00, amount:1760.00, desc:"Preparation of regulatory section of due diligence report: RAAEY licences, grid operator agreements and subsidy clawback provisions under Greek renewable energy law." },
    { date:"14 Mar 2026", tk:"M. Theodorou",    role:"Legal Trainee",     hours:3.5, rate:220.00, amount: 770.00, desc:"Preparation of document request list for second VDR upload; follow-up correspondence with target's legal advisors (Kyriakidis & Associates) on outstanding items." },
    // ⚠ INTERNAL_COORDINATION: 3 timekeepers each bill 1.5h for same internal team status call on 18 Mar
    { date:"18 Mar 2026", tk:"K. Nikolopoulos", role:"Partner",           hours:1.5, rate:720.00, amount:1080.00, desc:"Internal team status call: alignment on remaining due diligence items, SPA drafting timeline and client reporting schedule for Hellas Renewables acquisition." },
    { date:"18 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:1.5, rate:550.00, amount: 825.00, desc:"Internal team status call: reporting on open due diligence items, outstanding VDR requests and regulatory red flags requiring further client instruction." },
    { date:"18 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:1.5, rate:440.00, amount: 660.00, desc:"Internal team status call: update on employment and regulatory sections; coordination on integrated due diligence report structure and delivery timeline." },
    { date:"19 Mar 2026", tk:"A. Petrakis",     role:"Senior Associate",  hours:3.5, rate:550.00, amount:1925.00, desc:"Finalisation of due diligence report: legal summary, red flag schedule and recommended SPA protections; review of representations and warranties scope." },
    { date:"20 Mar 2026", tk:"E. Stavrou",      role:"Associate",         hours:3.0, rate:440.00, amount:1320.00, desc:"Preparation of SPA schedule of key due diligence findings; drafting of material adverse change and pre-completion obligations provisions." },
    { date:"21 Mar 2026", tk:"M. Theodorou",    role:"Legal Trainee",     hours:2.0, rate:220.00, amount: 440.00, desc:"Final proofreading of due diligence report; preparation of executive summary and translation of Greek statutory extracts appended to report." },
  ];

  const SUBTOTAL = lines.reduce((s, l) => s + l.amount, 0);
  const VAT_AMT = SUBTOTAL * 0.24;
  const TOTAL = SUBTOTAL + VAT_AMT;

  const tableY = invoiceHeader(doc, PW, ML, MR, CW, STAVROS.color, STAVROS,
    { ...ACME2, ref: "Legal/2026/MA-097" },
    { number:"INV-2026-0097", date:"31 March 2026", due:"15 May 2026",
      matter:"M&A Due Diligence — Acquisition of Hellas Renewables SA",
      jurisdiction:"Greece (Attica)", period:"1 Mar 2026 to 31 Mar 2026", currency:"EUR" });

  const rowY = linesTable(doc, ML, MR, CW, tableY, lines, fmtEUR);
  totalsBlock(doc, PW, MR, rowY, SUBTOTAL, 24, VAT_AMT, TOTAL, fmtEUR, C.RULE);

  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.DARK).text("Payment Details", ML, doc.y + 22);
  doc.font("Helvetica").fontSize(8).fillColor(C.MID)
    .text("Bank: Alpha Bank S.A., Athens  ·  IBAN: GR16 0140 1010 1010 0002 3199 234  ·  BIC: CRBAGRAAXXX  ·  Ref: INV-2026-0097",
      ML, doc.y + 10, { width: CW });

  invoiceFooter(doc, PW, ML, CW, STAVROS.color, STAVROS,
    "Registered with the Athens Bar Association  ·  VAT: GR 098 234 561  ·  billing@sn-partners.gr");
  doc.end();
  stream.on("finish", () => console.log("✅  Stavros Nikolopoulos ISSUES invoice written  ⚠ DAILY_HOURS_EXCEEDED (A.Petrakis 10.5h) + INTERNAL_COORDINATION (3 timekeepers × 1.5h same call)"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 5 — Quinn Abernethy LLP — T&C / Engagement Letter
// Panel rates: Partner max £700/h (so INV-0145 at £880 is clearly over)
// ═══════════════════════════════════════════════════════════════════════════════
function genQuinnTC() {
  const { doc, stream, PW, ML, MR, CW } = buildDoc(
    out("Quinn_Abernethy_LLP_Engagement_Letter_2026.pdf"),
    { Title: "Engagement Letter — Quinn Abernethy LLP", Author: "Quinn Abernethy LLP", Subject: "Panel Appointment — Acme Industrial Group plc" }
  );

  const ACCENT = QUINN.color;
  doc.rect(0, 0, PW, 10).fill(ACCENT);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(ACCENT).text("QUINN ABERNETHY LLP", ML, 26, { width: CW });
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text("Solicitors  ·  Intellectual Property & Technology  ·  Regulated by the Solicitors Regulation Authority", ML, 50);
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text("22 Aldgate High Street  ·  London EC3N 1AL  ·  billing@quinnabernethy.co.uk  ·  +44 20 7264 5800", ML, 62);
  doc.moveTo(ML, 80).lineTo(PW - MR, 80).strokeColor(ACCENT).lineWidth(1.5).stroke();

  doc.font("Helvetica-Bold").fontSize(13).fillColor(ACCENT)
    .text("ENGAGEMENT LETTER & TERMS OF BUSINESS", ML, 94, { align: "center", width: CW });
  doc.font("Helvetica").fontSize(9).fillColor(C.LIGHT)
    .text("Panel Law Firm Appointment — Effective 1 January 2026", ML, 112, { align: "center", width: CW });

  let y = 136;

  function sec(title, body) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text(title, ML, y);
    y = doc.y + 3;
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(C.RULE).lineWidth(0.5).stroke();
    y += 7;
    if (body) {
      doc.font("Helvetica").fontSize(9).fillColor(C.DARK).text(body, ML, y, { width: CW, lineGap: 1.5 });
      y = doc.y + 10;
    }
  }

  function kv(label, value) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.MID).text(`${label}:`, ML, y, { width: 200 });
    doc.font("Helvetica").fontSize(9).fillColor(C.DARK).text(value, ML + 205, y, { width: CW - 205 });
    y = doc.y + 5;
  }

  sec("1.  PARTIES",
    "This Engagement Letter is made between Quinn Abernethy LLP (\"the Firm\") and Acme Industrial Group plc (\"the Client\"), acting through its Legal Department. The Firm is appointed to the Client's preferred legal services panel from the effective date, subject to the commercial terms set out below. This agreement is governed by the laws of England and Wales.");

  sec("2.  SCOPE OF SERVICES",
    "The Firm will provide specialist legal advisory services in the following areas on an as-instructed basis: (i) Intellectual Property — patents, trademarks, copyright, design rights and trade secrets; (ii) Technology Transactions & Licensing; (iii) Data Protection & Cybersecurity (UK GDPR / Data Protection Act 2018); (iv) Domain Name Disputes & Online Brand Protection; and (v) IP Litigation support including EPO proceedings.");

  sec("3.  KEY COMMERCIAL TERMS", null);
  kv("Contract Start Date",             "1 January 2026");
  kv("Contract End Date",               "31 December 2027");
  kv("Governing Law",                   "England and Wales");
  kv("Default Billing Type",            "Hourly rates — time-recorded");
  kv("Currency",                        "GBP (British Pounds Sterling)");
  kv("Payment Terms",                   "30 days from invoice date");
  kv("Volume Discount",                 "5% on matters exceeding GBP 50,000 in a rolling 12-month period");
  kv("Getting Up to Speed",             "Non-billable — familiarisation and learning time is not chargeable");
  kv("Max Daily Hours per Timekeeper",  "8 hours per individual per calendar day");
  kv("Internal Coordination",           "Meetings involving more than 2 fee earners require prior approval for all attendees to be billed");
  kv("Travel (Domestic)",               "Standard class rail; economy air; prior approval required over GBP 400");
  kv("Expense Cap per Invoice",         "Disbursements capped at 8% of professional fees per invoice unless pre-approved");
  y += 6;

  // Rates table
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text("4.  PANEL HOURLY RATES (GBP)", ML, y);
  y = doc.y + 3;
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(C.RULE).lineWidth(0.5).stroke();
  y += 8;
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text("Maximum rates applicable to all instructions from the effective date. All rates are exclusive of VAT at the prevailing rate.", ML, y, { width: CW });
  y = doc.y + 10;

  const rates = [
    ["Senior Partner",     "SP",  "GBP 820"],
    ["Partner",            "P",   "GBP 700"],   // ← max for Partner
    ["Legal Director",     "LD",  "GBP 660"],
    ["Senior Associate",   "SA",  "GBP 530"],
    ["Associate 4th Year", "A4",  "GBP 490"],
    ["Associate 3rd Year", "A3",  "GBP 460"],
    ["Associate 2nd Year", "A2",  "GBP 430"],
    ["Associate 1st Year", "A1",  "GBP 400"],
    ["Paralegal",          "PL",  "GBP 270"],
    ["Legal Trainee",      "LT",  "GBP 220"],
  ];

  doc.rect(ML, y - 3, CW, 15).fill(C.GREY);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.MID)
    .text("Role",         ML + 4,   y, { width: 150 })
    .text("Code",         ML + 154, y, { width: 50, align: "center" })
    .text("Max Rate/hr",  ML + 210, y, { width: 80, align: "right" });
  y += 16;

  rates.forEach(([role, code, rate], i) => {
    if (i % 2 === 1) doc.rect(ML, y - 2, CW, 14).fill(C.FAINT);
    doc.font("Helvetica").fontSize(8.5).fillColor(C.DARK)
      .text(role,  ML + 4,   y, { width: 150 })
      .text(code,  ML + 154, y, { width: 50,  align: "center" })
      .text(rate,  ML + 210, y, { width: 80,  align: "right" });
    y += 14;
  });
  y += 12;

  sec("5.  DISBURSEMENTS & EXPENSES",
    "Reasonable and properly evidenced disbursements are recoverable. Court and official filing fees, process server fees, patent office charges, WIPO and EPO filing fees, expert witness fees (pre-approved), and courier charges for matter-related correspondence are allowable. Hotel accommodation is capped at GBP 200 per night in London and GBP 150 per night elsewhere. All disbursements exceeding GBP 500 individually require advance written authorisation from the client's Legal Operations team. Non-allowable items include: alcohol, entertainment, personal meals (unless working dinner pre-approved), first class travel, and any expense not directly related to the client matter.");

  // Signatures
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(C.RULE).lineWidth(0.5).stroke();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text("6.  EXECUTION", ML, y);
  y = doc.y + 10;
  const sigW = (CW - 40) / 2;
  doc.font("Helvetica").fontSize(9).fillColor(C.MID)
    .text("For and on behalf of the Firm:", ML, y)
    .text("For and on behalf of the Client:", ML + sigW + 40, y);
  y += 28;
  doc.moveTo(ML, y).lineTo(ML + sigW, y).strokeColor(C.RULE).stroke();
  doc.moveTo(ML + sigW + 40, y).lineTo(ML + sigW * 2 + 40, y).strokeColor(C.RULE).stroke();
  y += 6;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.DARK)
    .text("M. Quinn", ML, y)
    .text("[Authorised Signatory]", ML + sigW + 40, y);
  y += 12;
  doc.font("Helvetica").fontSize(8.5).fillColor(C.MID)
    .text("Senior Partner", ML, y)
    .text("Acme Industrial Group plc", ML + sigW + 40, y);
  y += 12;
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text("Date: ____________________", ML, y)
    .text("Date: ____________________", ML + sigW + 40, y);

  doc.rect(0, doc.page.height - 36, PW, 36).fill(ACCENT);
  doc.font("Helvetica").fontSize(7).fillColor("#FFFFFF")
    .text("Quinn Abernethy LLP  ·  Authorised & regulated by the SRA (No. 744821)  ·  Registered in England & Wales (OC501847)  ·  22 Aldgate High Street, London EC3N 1AL",
      ML, doc.page.height - 22, { width: CW, align: "center" });

  doc.end();
  stream.on("finish", () => console.log("✅  Quinn Abernethy T&C written  (Partner max: GBP 700/h)"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 6 — Stavros Nikolopoulos & Partners — T&C / Engagement Letter
// Max daily hours 8h; internal coordination rules
// ═══════════════════════════════════════════════════════════════════════════════
function genStavrosTC() {
  const { doc, stream, PW, ML, MR, CW } = buildDoc(
    out("Stavros_Nikolopoulos_Engagement_Letter_2026.pdf"),
    { Title: "Engagement Letter — Stavros Nikolopoulos & Partners", Author: "Stavros Nikolopoulos & Partners", Subject: "Panel Appointment — Acme Industrial Group plc" }
  );

  const ACCENT = STAVROS.color;
  doc.rect(0, 0, PW, 10).fill(ACCENT);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(ACCENT).text("STAVROS NIKOLOPOULOS & PARTNERS", ML, 26, { width: CW });
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text("Δικηγορική Εταιρεία  ·  Δίκαιο Εταιρειών, ΣΕΑ & Εμπορικό Δίκαιο  ·  Αθήνα  |  Law Firm  ·  Corporate, M&A & Commercial Law  ·  Athens", ML, 50);
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text("28 Vasilissis Sofias Avenue, Athens 106 74, Greece  ·  billing@sn-partners.gr  ·  +30 210 7244 900", ML, 62);
  doc.moveTo(ML, 80).lineTo(PW - MR, 80).strokeColor(ACCENT).lineWidth(1.5).stroke();

  doc.font("Helvetica-Bold").fontSize(13).fillColor(ACCENT)
    .text("ENGAGEMENT LETTER & TERMS OF BUSINESS", ML, 94, { align: "center", width: CW });
  doc.font("Helvetica").fontSize(9).fillColor(C.LIGHT)
    .text("Panel Law Firm Appointment — Effective 1 February 2026", ML, 112, { align: "center", width: CW });

  let y = 136;

  function sec(title, body) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text(title, ML, y);
    y = doc.y + 3;
    doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(C.RULE).lineWidth(0.5).stroke();
    y += 7;
    if (body) {
      doc.font("Helvetica").fontSize(9).fillColor(C.DARK).text(body, ML, y, { width: CW, lineGap: 1.5 });
      y = doc.y + 10;
    }
  }

  function kv(label, value) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.MID).text(`${label}:`, ML, y, { width: 220 });
    doc.font("Helvetica").fontSize(9).fillColor(C.DARK).text(value, ML + 225, y, { width: CW - 225 });
    y = doc.y + 5;
  }

  sec("1.  PARTIES",
    "This Engagement Letter is entered into between Stavros Nikolopoulos & Partners (\"the Firm\"), a law firm registered with the Athens Bar Association, and Acme Industrial Group plc (\"the Client\"). The Firm is appointed to the Client's preferred legal services panel for matters governed by Greek law from the effective date. This agreement is governed by Greek law; any disputes shall be subject to the exclusive jurisdiction of the Athens Courts.");

  sec("2.  SCOPE OF SERVICES",
    "The Firm will provide legal advisory services in the following areas: (i) Mergers & Acquisitions and Joint Ventures under Greek law; (ii) Corporate Governance & Regulatory Compliance (Law 4548/2018); (iii) Commercial Contracts and Concession Agreements; (iv) Hellenic Competition Commission proceedings (Law 3959/2011); (v) Greek Energy Law (Law 4685/2020) and Renewable Energy transactions; and (vi) Greek Real Estate and Land Registry matters.");

  sec("3.  KEY COMMERCIAL TERMS", null);
  kv("Contract Start Date",             "1 February 2026");
  kv("Contract End Date",               "31 January 2028");
  kv("Governing Law",                   "Hellenic Republic (Greece)");
  kv("Default Billing Type",            "Hourly rates — time-recorded (6-minute increments)");
  kv("Currency",                        "EUR (Euro)");
  kv("VAT",                             "Greek VAT at 24% applies to all professional fees");
  kv("Payment Terms",                   "45 days from invoice date");
  kv("Getting Up to Speed",             "Non-billable — new matter familiarisation time is not chargeable");
  kv("Max Daily Hours per Timekeeper",  "8 hours per individual per calendar day");
  kv("Internal Coordination Meetings",  "Where 3 or more fee earners attend the same internal meeting, only 2 may bill time for that meeting unless the Client's Legal Ops provides prior written approval");
  kv("Expense Cap",                     "Disbursements capped at 10% of professional fees per invoice; excess requires advance written approval");
  kv("Third-Party Expert Fees",         "All third-party expert, valuer and notary fees require prior written authorisation");
  y += 6;

  // Rates table
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text("4.  PANEL HOURLY RATES (EUR)", ML, y);
  y = doc.y + 3;
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(C.RULE).lineWidth(0.5).stroke();
  y += 8;
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text("Maximum rates from the effective date. All rates are exclusive of VAT. Partner rate of EUR 720 applies to all named partners.", ML, y, { width: CW });
  y = doc.y + 10;

  const rates = [
    ["Senior Partner",     "SP",  "EUR 820"],
    ["Partner",            "P",   "EUR 720"],   // ← max for Partner
    ["Of Counsel",         "OC",  "EUR 660"],
    ["Senior Associate",   "SA",  "EUR 550"],
    ["Associate 4th Year", "A4",  "EUR 500"],
    ["Associate 3rd Year", "A3",  "EUR 470"],
    ["Associate 2nd Year", "A2",  "EUR 440"],
    ["Associate 1st Year", "A1",  "EUR 400"],
    ["Paralegal",          "PL",  "EUR 280"],
    ["Legal Trainee",      "LT",  "EUR 220"],
  ];

  doc.rect(ML, y - 3, CW, 15).fill(C.GREY);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.MID)
    .text("Role",         ML + 4,   y, { width: 150 })
    .text("Code",         ML + 154, y, { width: 50, align: "center" })
    .text("Max Rate/hr",  ML + 210, y, { width: 80, align: "right" });
  y += 16;

  rates.forEach(([role, code, rate], i) => {
    if (i % 2 === 1) doc.rect(ML, y - 2, CW, 14).fill(C.FAINT);
    doc.font("Helvetica").fontSize(8.5).fillColor(C.DARK)
      .text(role,  ML + 4,   y, { width: 150 })
      .text(code,  ML + 154, y, { width: 50,  align: "center" })
      .text(rate,  ML + 210, y, { width: 80,  align: "right" });
    y += 14;
  });
  y += 12;

  sec("5.  TRAVEL & EXPENSES POLICY",
    "Economy class is required for all air travel under 6 hours. Business class requires prior written approval for flights of 6 hours or more. Standard class rail only. Accommodation is capped at EUR 180 per night in Athens and EUR 150 elsewhere in Greece. Subsistence at EUR 35 per day maximum. All receipts are required for any expense. Individual expenses exceeding EUR 600 require advance written authorisation from the Client's Legal Operations team. Non-allowable: alcohol, entertainment, personal wellness, fines, and any expense not directly related to the client matter.");

  // Signatures
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(C.RULE).lineWidth(0.5).stroke();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text("6.  EXECUTION", ML, y);
  y = doc.y + 10;
  const sigW = (CW - 40) / 2;
  doc.font("Helvetica").fontSize(9).fillColor(C.MID)
    .text("For and on behalf of the Firm:", ML, y)
    .text("For and on behalf of the Client:", ML + sigW + 40, y);
  y += 28;
  doc.moveTo(ML, y).lineTo(ML + sigW, y).strokeColor(C.RULE).stroke();
  doc.moveTo(ML + sigW + 40, y).lineTo(ML + sigW * 2 + 40, y).strokeColor(C.RULE).stroke();
  y += 6;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.DARK)
    .text("K. Nikolopoulos", ML, y)
    .text("[Authorised Signatory]", ML + sigW + 40, y);
  y += 12;
  doc.font("Helvetica").fontSize(8.5).fillColor(C.MID)
    .text("Senior Partner", ML, y)
    .text("Acme Industrial Group plc", ML + sigW + 40, y);
  y += 12;
  doc.font("Helvetica").fontSize(8.5).fillColor(C.LIGHT)
    .text("Date: ____________________", ML, y)
    .text("Date: ____________________", ML + sigW + 40, y);

  doc.rect(0, doc.page.height - 36, PW, 36).fill(ACCENT);
  doc.font("Helvetica").fontSize(7).fillColor("#FFFFFF")
    .text("Stavros Nikolopoulos & Partners  ·  Athens Bar Association  ·  VAT: GR 098 234 561  ·  28 Vasilissis Sofias Avenue, Athens 106 74, Greece",
      ML, doc.page.height - 22, { width: CW, align: "center" });

  doc.end();
  stream.on("finish", () => console.log("✅  Stavros Nikolopoulos T&C written  (Partner max: EUR 720/h · Daily max: 8h · Internal coord: max 2 billers)"));
}

// ─── Run all ──────────────────────────────────────────────────────────────────
genQuinnClean();
genStavrosClean();
genQuinnIssues();
genStavrosIssues();
genQuinnTC();
genStavrosTC();
