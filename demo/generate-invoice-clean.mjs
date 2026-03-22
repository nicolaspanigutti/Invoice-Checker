// Clean demo invoice — Mercer Voss & Partners
// No billing errors — all rates correct, math accurate, no duplicates, daily hours within limits
// Run: node demo/generate-invoice-clean.mjs

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "Mercer_Voss_INV-2026-0031.pdf"
);

const RED    = "#8B0000";
const DARK   = "#1A1A1A";
const MID    = "#444444";
const LIGHT  = "#888888";
const RULE   = "#D0D0D0";
const HEADER_BG = "#F5F5F5";

const FIRM = {
  name:    "Mercer Voss & Partners, Partnerschaftsgesellschaft mbB",
  address: ["Bockenheimer Anlage 44", "60322 Frankfurt am Main", "Germany"],
  vat:     "DE 291 834 572",
  email:   "billing@mercervoss.de",
};

const CLIENT = {
  name:    "Acme Industrial Group plc",
  dept:    "Legal Department",
  address: ["One Canada Square", "Canary Wharf", "London E14 5AB"],
  ref:     "Legal/2026/EMP-007",
};

const INVOICE = {
  number:      "INV-2026-0031",
  date:        "31 March 2026",
  due:         "30 April 2026",
  matter:      "Executive Compensation Review & German Employment Law Advisory",
  matterRef:   "MV/EMP/2026/0031",
  jurisdiction:"Germany (Frankfurt)",
  periodStart: "2026-03-01",
  periodEnd:   "2026-03-31",
  currency:    "EUR",
};

// Mercer Voss panel max rates:
//   Partner          EUR 750/h
//   Senior Associate EUR 560/h
//   Associate 2nd Yr EUR 455/h
//   Legal Trainee    EUR 280/h

const LINES = [
  // ── Week 1: 2–6 Mar ──────────────────────────────────────────────────────
  {
    date: "02 Mar 2026", tk: "Dr. K. Hoffmann", role: "Partner",
    hours: 2.0, rate: 750.00, amount: 1500.00,
    desc: "Initial advisory call with client General Counsel on proposed executive bonus clawback policy; review of German employment law framework for senior executive contracts.",
  },
  {
    date: "03 Mar 2026", tk: "A. Brandt", role: "Senior Associate",
    hours: 3.5, rate: 560.00, amount: 1960.00,
    desc: "Research on German Vorstandsvergütung disclosure requirements (AktG §87) and DAX governance standards applicable to client's German subsidiary executives.",
  },
  {
    date: "04 Mar 2026", tk: "M. Fischer", role: "Associate 2nd Year",
    hours: 4.0, rate: 455.00, amount: 1820.00,
    desc: "Preparation of comparative memo on executive compensation structures in Germany vs. UK subsidiary; analysis of variable pay components and compliance obligations.",
  },
  {
    date: "05 Mar 2026", tk: "A. Brandt", role: "Senior Associate",
    hours: 3.0, rate: 560.00, amount: 1680.00,
    desc: "Review of five senior executive employment agreements (German law, Frankfurt-based entity); identification of non-compete clauses and post-employment restrictions.",
  },
  {
    date: "06 Mar 2026", tk: "M. Fischer", role: "Associate 2nd Year",
    hours: 3.5, rate: 455.00, amount: 1592.50,
    desc: "Preparation of German works council notification checklist; analysis of Betriebsrat consultation obligations for proposed compensation scheme changes.",
  },

  // ── Week 2: 9–13 Mar ─────────────────────────────────────────────────────
  {
    date: "09 Mar 2026", tk: "Dr. K. Hoffmann", role: "Partner",
    hours: 1.5, rate: 750.00, amount: 1125.00,
    desc: "Video conference with client HR Director and GC; strategic advice on implementation of revised bonus clawback provisions under German law.",
  },
  {
    date: "10 Mar 2026", tk: "A. Brandt", role: "Senior Associate",
    hours: 4.0, rate: 560.00, amount: 2240.00,
    desc: "Drafting of revised executive service agreement template incorporating new variable pay, malus and clawback provisions; mark-up of existing contracts.",
  },
  {
    date: "11 Mar 2026", tk: "M. Fischer", role: "Associate 2nd Year",
    hours: 3.5, rate: 455.00, amount: 1592.50,
    desc: "Legal research on German Federal Labour Court (BAG) rulings on clawback enforceability; preparation of case law summary note for partner review.",
  },
  {
    date: "12 Mar 2026", tk: "F. Weber", role: "Legal Trainee",
    hours: 2.5, rate: 280.00, amount: 700.00,
    desc: "Preparation of document index and timeline of executive appointments; collation of existing employment contract versions for due diligence file.",
  },
  {
    date: "13 Mar 2026", tk: "A. Brandt", role: "Senior Associate",
    hours: 3.0, rate: 560.00, amount: 1680.00,
    desc: "Review of revised executive contract drafts; preparation of negotiation notes on key risk areas for client; correspondence with counterparty advisors.",
  },

  // ── Week 3: 16–20 Mar ────────────────────────────────────────────────────
  {
    date: "16 Mar 2026", tk: "Dr. K. Hoffmann", role: "Partner",
    hours: 2.0, rate: 750.00, amount: 1500.00,
    desc: "Review of final executive service agreement mark-ups; advice to client on German co-determination law implications of proposed board-level compensation changes.",
  },
  {
    date: "17 Mar 2026", tk: "M. Fischer", role: "Associate 2nd Year",
    hours: 3.0, rate: 455.00, amount: 1365.00,
    desc: "Preparation of works council information document (Unterrichtungsunterlage) for proposed compensation restructuring; review of Betriebsverfassungsgesetz §87 requirements.",
  },
  {
    date: "18 Mar 2026", tk: "A. Brandt", role: "Senior Associate",
    hours: 2.5, rate: 560.00, amount: 1400.00,
    desc: "Drafting of Betriebsvereinbarung (works council agreement) template for new bonus scheme; review of mandatory co-determination provisions.",
  },
  {
    date: "19 Mar 2026", tk: "F. Weber", role: "Legal Trainee",
    hours: 2.0, rate: 280.00, amount: 560.00,
    desc: "Updating project tracker; preparation of checklist for works council consultation procedure and required approval timelines.",
  },

  // ── Week 4: 23–28 Mar ────────────────────────────────────────────────────
  {
    date: "24 Mar 2026", tk: "Dr. K. Hoffmann", role: "Partner",
    hours: 1.5, rate: 750.00, amount: 1125.00,
    desc: "Finalisation of client advice memo on executive compensation implementation; sign-off on revised service agreement templates and works council documents.",
  },
  {
    date: "25 Mar 2026", tk: "A. Brandt", role: "Senior Associate",
    hours: 2.0, rate: 560.00, amount: 1120.00,
    desc: "Preparation of closing implementation report; summary of all revised executive agreements and recommended next steps for client HR and Legal teams.",
  },
  {
    date: "27 Mar 2026", tk: "M. Fischer", role: "Associate 2nd Year",
    hours: 1.5, rate: 455.00, amount: 682.50,
    desc: "Final proofreading and compilation of all deliverables; preparation of matter file for handover and archiving per firm document management procedures.",
  },
];

const SUBTOTAL = LINES.reduce((s, l) => s + l.amount, 0);
const VAT_RATE = 0.00;
const VAT_AMT  = 0.00;
const TOTAL    = SUBTOTAL + VAT_AMT;

// ─── PDF Generation ─────────────────────────────────────────────────────────
const doc = new PDFDocument({ size: "A4", margin: 50, info: {
  Title:    `${INVOICE.number} – Mercer Voss & Partners`,
  Author:   "Mercer Voss & Partners, Partnerschaftsgesellschaft mbB",
  Subject:  `Legal Services – ${INVOICE.matter}`,
  Creator:  "Mercer Voss Billing System",
}});

const stream = createWriteStream(OUT);
doc.pipe(stream);

const PW = doc.page.width;
const ML = 50;
const MR = 50;
const CW = PW - ML - MR;

function fmtMoney(n) {
  return "EUR " + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Header bar
doc.rect(0, 0, PW, 8).fill(RED);

// Firm name
doc.font("Helvetica-Bold").fontSize(18).fillColor(DARK)
  .text(FIRM.name, ML, 30, { width: CW });

const afterName = doc.y + 4;
doc.font("Helvetica").fontSize(8).fillColor(LIGHT);
FIRM.address.forEach(line => { doc.text(line); });
doc.text(`VAT: ${FIRM.vat}   ·   ${FIRM.email}`);

// INVOICE label top-right
doc.font("Helvetica-Bold").fontSize(22).fillColor(RED)
  .text("INVOICE", PW - MR - 150, 30, { width: 150, align: "right" });
doc.font("Helvetica").fontSize(9).fillColor(LIGHT)
  .text(INVOICE.number, PW - MR - 150, 58, { width: 150, align: "right" });

doc.moveTo(ML, afterName + 48).lineTo(PW - MR, afterName + 48).stroke(RULE);

// Invoice metadata grid
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
metaField("Matter",          INVOICE.matter, col1, metaY2);
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

// Line items table
const tableY = doc.y + 24;
const cols = {
  no:    { x: ML,           w: 28  },
  date:  { x: ML + 28,      w: 68  },
  tk:    { x: ML + 96,      w: 100 },
  role:  { x: ML + 196,     w: 88  },
  desc:  { x: ML + 284,     w: 140 },
  hrs:   { x: ML + 424,     w: 34  },
  rate:  { x: ML + 458,     w: 50  },
  amt:   { x: ML + 508,     w: 37  },
};

// Table header
doc.rect(ML, tableY - 4, CW, 18).fill(HEADER_BG);
const hdrStyle = () => doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MID);
hdrStyle().text("No.",    cols.no.x,   tableY, { width: cols.no.w,   align: "left"  });
hdrStyle().text("Date",   cols.date.x, tableY, { width: cols.date.w, align: "left"  });
hdrStyle().text("Timekeeper", cols.tk.x, tableY, { width: cols.tk.w, align: "left"  });
hdrStyle().text("Role",   cols.role.x, tableY, { width: cols.role.w, align: "left"  });
hdrStyle().text("Description", cols.desc.x, tableY, { width: cols.desc.w, align: "left" });
hdrStyle().text("Hrs",    cols.hrs.x,  tableY, { width: cols.hrs.w,  align: "right" });
hdrStyle().text("Rate",   cols.rate.x, tableY, { width: cols.rate.w, align: "right" });
hdrStyle().text("Amount", cols.amt.x,  tableY, { width: cols.amt.w,  align: "right" });

let rowY = tableY + 18;
LINES.forEach((l, i) => {
  const even = i % 2 === 1;
  if (even) doc.rect(ML, rowY - 2, CW, 28).fill("#FAFAFA");

  const rowStyle = () => doc.font("Helvetica").fontSize(7.5).fillColor(DARK);
  rowStyle().text(String(i + 1),  cols.no.x,   rowY, { width: cols.no.w,   align: "left"  });
  rowStyle().text(l.date,         cols.date.x, rowY, { width: cols.date.w, align: "left"  });
  rowStyle().text(l.tk,           cols.tk.x,   rowY, { width: cols.tk.w,   align: "left"  });
  rowStyle().text(l.role,         cols.role.x, rowY, { width: cols.role.w, align: "left"  });
  rowStyle().text(l.desc,         cols.desc.x, rowY, { width: cols.desc.w, align: "left", lineGap: 1 });
  rowStyle().text(l.hours.toFixed(2), cols.hrs.x, rowY, { width: cols.hrs.w, align: "right" });
  rowStyle().text(l.rate.toFixed(2),  cols.rate.x, rowY, { width: cols.rate.w, align: "right" });
  rowStyle().text(l.amount.toFixed(2), cols.amt.x, rowY, { width: cols.amt.w, align: "right" });

  rowY += 30;
});

// Totals
doc.moveTo(ML, rowY + 4).lineTo(PW - MR, rowY + 4).stroke(RULE);
rowY += 14;

const totalX = PW - MR - 180;
function totalRow(label, value, bold = false) {
  const fn = bold ? "Helvetica-Bold" : "Helvetica";
  doc.font(fn).fontSize(9).fillColor(DARK)
    .text(label, totalX, rowY, { width: 120, align: "right" });
  doc.font(fn).fontSize(9).fillColor(DARK)
    .text(value, totalX + 124, rowY, { width: 56, align: "right" });
  rowY += 16;
}

totalRow("Subtotal:", fmtMoney(SUBTOTAL));
totalRow("VAT (0%):", fmtMoney(VAT_AMT));
doc.moveTo(totalX, rowY - 2).lineTo(PW - MR, rowY - 2).stroke(RULE);
rowY += 4;
totalRow("TOTAL DUE:", fmtMoney(TOTAL), true);

// Payment details
rowY += 20;
doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK).text("Payment Details", ML, rowY);
rowY += 12;
doc.font("Helvetica").fontSize(8).fillColor(MID)
  .text("Bank: Deutsche Bank AG, Frankfurt · IBAN: DE89 5007 0010 0012 3456 78 · BIC: DEUTDEDB500", ML, rowY, { width: CW });

// Footer
doc.moveTo(0, doc.page.height - 40).lineTo(PW, doc.page.height - 40).stroke(RED).lineWidth(4);
doc.font("Helvetica").fontSize(7).fillColor(LIGHT)
  .text(
    `${FIRM.name}  ·  Registered in Germany  ·  ${FIRM.email}`,
    ML, doc.page.height - 30, { width: CW, align: "center" }
  );

doc.end();
stream.on("finish", () => console.log(`✅  Written: ${OUT}`));
