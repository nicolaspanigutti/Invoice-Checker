// Beaumont Leclerc & Associés S.A.S. — Clean invoice with ZERO billing issues
// Matter: M&A Due Diligence — Acquisition of Société Alpine Packaging SAS
// Run: node demo/generate-beaumont-leclerc-inv-clean.mjs
//
// DESIGN PRINCIPLES — ZERO ISSUES:
//  - Every timekeeper billed strictly AT or BELOW their approved panel rate cap
//  - All arithmetic correct: hours × rate = amount (to the cent)
//  - No duplicate lines (unique date+timekeeper+description per line)
//  - No timekeeper exceeds 8h on any single day
//  - No seniority overkill: each timekeeper performs work appropriate to their level
//  - No internal coordination: all work is substantive client-facing legal work
//  - No parallel billing: when two timekeepers work the same day they are on different tasks
//  - ISO dates throughout (YYYY-MM-DD)
//  - Expected result: 0 errors, 0 warnings → ACCEPTED

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, "Beaumont_Leclerc_INV-2026-0218_Clean.pdf");

// ─── Palette (navy/gold — Beaumont Leclerc brand) ─────────────────────────────
const NAVY  = "#1B2D4F";
const GOLD  = "#B8912A";
const DARK  = "#1A1A1A";
const MID   = "#444444";
const LIGHT = "#888888";
const RULE  = "#D0D0D0";
const FAINT = "#FAFAFA";
const WHITE = "#FFFFFF";

// ─── Firm / Client ─────────────────────────────────────────────────────────────
const FIRM = {
  name:    "Beaumont Leclerc & Associés S.A.S.",
  address: ["14 Avenue Kléber", "75116 Paris, France"],
  email:   "facturation@beaumont-leclerc.fr",
  bar:     "Barreau de Paris — TVA FR 87 552 081 317",
};
const CLIENT = {
  name:    "Acme Industrial Group plc",
  dept:    "Legal Department",
  address: ["One Canada Square", "Canary Wharf", "London E14 5AB"],
  ref:     "Legal/2026/MA-218",
};
const INVOICE = {
  number:      "INV-2026-0218",
  date:        "2026-04-30",
  due:         "2026-05-30",
  matter:      "M&A Due Diligence — Acquisition of Société Alpine Packaging SAS",
  matterRef:   "BLA/MA/2026/0218",
  jurisdiction:"France",
  period:      "2026-04-01 to 2026-04-30",
  currency:    "EUR",
};

// ─── Approved rate caps used in this invoice ───────────────────────────────────
// Senior Partner   €890/h  E. Beaumont  — billed at €890 ✓
// Partner          €740/h  A. Marchand  — billed at €740 ✓
// Counsel          €630/h  C. Garnier   — billed at €630 ✓
// Senior Associate €520/h  L. Dupont    — billed at €520 ✓
// Associate        €390/h  F. Moreau    — billed at €390 ✓
// Paralegal        €230/h  P. Lefevre   — billed at €230 ✓
// Max daily hours  8h/timekeeper — every single timekeeper ≤ 8h on every day

const LINES = [
  // ── 2026-04-03 ─────────────────────────────────────────────────────────────
  // E. Beaumont: 2.5h ≤ 8h  ✓ | €890 ≤ €890 cap ✓ | 2.5 × 890 = 2225.00 ✓
  {
    date: "2026-04-03", tk: "E. Beaumont",  role: "Senior Partner",
    hours: 2.5, rate: 890.00, amount: 2225.00,
    desc: "Strategic advice on acquisition structure and proposed consideration mechanism for Société Alpine Packaging SAS; review of initial term sheet and identification of key deal risks for Group Legal Counsel.",
  },
  // A. Marchand: 4.0h ≤ 8h  ✓ | €740 ≤ €740 cap ✓ | 4.0 × 740 = 2960.00 ✓
  {
    date: "2026-04-03", tk: "A. Marchand",  role: "Partner",
    hours: 4.0, rate: 740.00, amount: 2960.00,
    desc: "Preparation of M&A due diligence framework and project plan; drafting of due diligence request list covering corporate, regulatory, employment, real estate and IP workstreams; coordination with specialist teams.",
  },

  // ── 2026-04-07 ─────────────────────────────────────────────────────────────
  // C. Garnier: 3.5h ≤ 8h  ✓ | €630 ≤ €630 cap ✓ | 3.5 × 630 = 2205.00 ✓
  {
    date: "2026-04-07", tk: "C. Garnier",   role: "Counsel",
    hours: 3.5, rate: 630.00, amount: 2205.00,
    desc: "Legal due diligence — corporate structure review: analysis of target's corporate governance documents, shareholders' agreements, statutory accounts and verification of registered office and corporate objects.",
  },

  // ── 2026-04-08 ─────────────────────────────────────────────────────────────
  // L. Dupont: 4.0h ≤ 8h  ✓ | €520 ≤ €520 cap ✓ | 4.0 × 520 = 2080.00 ✓
  {
    date: "2026-04-08", tk: "L. Dupont",    role: "Senior Associate",
    hours: 4.0, rate: 520.00, amount: 2080.00,
    desc: "Legal due diligence — regulatory compliance: review of target's RGPD compliance programme, CNIL notifications, product certifications, CE markings and environmental authorisations applicable to packaging operations.",
  },

  // ── 2026-04-10 ─────────────────────────────────────────────────────────────
  // F. Moreau: 3.5h ≤ 8h  ✓ | €390 ≤ €390 cap ✓ | 3.5 × 390 = 1365.00 ✓
  {
    date: "2026-04-10", tk: "F. Moreau",    role: "Associate",
    hours: 3.5, rate: 390.00, amount: 1365.00,
    desc: "Legal due diligence — document review: review and summary of target's 47 material commercial contracts; identification of change of control provisions, consent requirements and assignment restrictions.",
  },

  // ── 2026-04-11 ─────────────────────────────────────────────────────────────
  // P. Lefevre: 3.0h ≤ 8h  ✓ | €230 ≤ €230 cap ✓ | 3.0 × 230 = 690.00 ✓
  {
    date: "2026-04-11", tk: "P. Lefevre",   role: "Paralegal",
    hours: 3.0, rate: 230.00, amount:  690.00,
    desc: "Preparation of due diligence data room index; organisation and categorisation of 312 documents uploaded to the Ansarada virtual data room; preparation of document tracking schedule for review team.",
  },

  // ── 2026-04-14 ─────────────────────────────────────────────────────────────
  // A. Marchand: 2.0h ≤ 8h  ✓ | €740 ≤ €740 cap ✓ | 2.0 × 740 = 1480.00 ✓
  // (Different day from first A. Marchand line — no daily hours issue)
  {
    date: "2026-04-14", tk: "A. Marchand",  role: "Partner",
    hours: 2.0, rate: 740.00, amount: 1480.00,
    desc: "Negotiation strategy advice on key due diligence findings; advice on price adjustment mechanism, locked box structure and W&I insurance parameters; preparation of issues list for management presentation.",
  },

  // ── 2026-04-15 ─────────────────────────────────────────────────────────────
  // C. Garnier: 2.5h ≤ 8h  ✓ | €630 ≤ €630 cap ✓ | 2.5 × 630 = 1575.00 ✓
  // (Different day from first C. Garnier line — no daily hours issue; same rate ✓)
  {
    date: "2026-04-15", tk: "C. Garnier",   role: "Counsel",
    hours: 2.5, rate: 630.00, amount: 1575.00,
    desc: "Review of Autorisation de mise sur le marché (AMM) documentation and environmental permits; assessment of ICPE classification and applicable Seveso threshold implications for the target's manufacturing sites.",
  },

  // ── 2026-04-16 ─────────────────────────────────────────────────────────────
  // L. Dupont: 3.0h ≤ 8h  ✓ | €520 ≤ €520 cap ✓ | 3.0 × 520 = 1560.00 ✓
  // (Different day from first L. Dupont line — no daily hours issue)
  {
    date: "2026-04-16", tk: "L. Dupont",    role: "Senior Associate",
    hours: 3.0, rate: 520.00, amount: 1560.00,
    desc: "Drafting of due diligence report — employment law section: review of collective bargaining agreements (CCT), mandatory employee representative elections (CSE), employee benefit plans and key employment contracts.",
  },

  // ── 2026-04-17 ─────────────────────────────────────────────────────────────
  // F. Moreau: 4.0h ≤ 8h  ✓ | €390 ≤ €390 cap ✓ | 4.0 × 390 = 1560.00 ✓
  // (Different day from first F. Moreau line — no daily hours issue)
  {
    date: "2026-04-17", tk: "F. Moreau",    role: "Associate",
    hours: 4.0, rate: 390.00, amount: 1560.00,
    desc: "Drafting of representations and warranties schedules relating to corporate, regulatory and IP matters; preparation of specific indemnity schedule for identified environmental and regulatory contingencies.",
  },
];

// ─── Totals (all arithmetic correct — no errors intended) ─────────────────────
// 2225 + 2960 + 2205 + 2080 + 1365 + 690 + 1480 + 1575 + 1560 + 1560 = 17700
const SUBTOTAL = LINES.reduce((s, l) => s + l.amount, 0);
const VAT_RATE = 20;
const VAT_AMT  = SUBTOTAL * 0.20;
const TOTAL    = SUBTOTAL + VAT_AMT;

// Verify arithmetic at generation time
LINES.forEach((l, i) => {
  const expected = Math.round(l.hours * l.rate * 100) / 100;
  if (Math.abs(expected - l.amount) > 0.01) {
    console.error(`❌  Line ${i+1} arithmetic check FAILED: ${l.hours} × ${l.rate} = ${expected}, stated ${l.amount}`);
    process.exit(1);
  }
});
console.log("✔  All arithmetic checks passed (no errors in this invoice)");

function fmtEUR(n) {
  return "€" + n.toFixed(2);
}

// ─── Build PDF ─────────────────────────────────────────────────────────────────
const doc = new PDFDocument({ size: "A4", margin: 50, info: {
  Title:   `${INVOICE.number} – Beaumont Leclerc & Associés S.A.S.`,
  Author:  "Beaumont Leclerc & Associés S.A.S.",
  Subject: `Services Juridiques – ${INVOICE.matter}`,
  Creator: "Beaumont Leclerc Billing System v2",
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
doc.rect(0, 8, PW, 2).fill(GOLD);
doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY)
   .text(FIRM.name, ML, 24, { width: CW - 150 });
doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT)
   .text(FIRM.address.join("  ·  "), ML, 46)
   .text(`${FIRM.bar}   ·   ${FIRM.email}`, ML, 56);
doc.font("Helvetica-Bold").fontSize(19).fillColor(NAVY)
   .text("FACTURE", PW - MR - 130, 24, { width: 130, align: "right" });
doc.font("Helvetica").fontSize(8).fillColor(LIGHT)
   .text(INVOICE.number, PW - MR - 130, 48, { width: 130, align: "right" });
doc.moveTo(ML, 70).lineTo(PW - MR, 70).strokeColor(RULE).lineWidth(0.5).stroke();

// ─── Invoice meta ─────────────────────────────────────────────────────────────
const c1 = ML, c2 = ML + 168, c3 = ML + 370;
function mf(label, value, x, y, w) {
  doc.font("Helvetica").fontSize(7).fillColor(LIGHT).text(label, x, y, { width: w ?? 160 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(DARK).text(value, x, y + 10, { width: w ?? 160 });
}
mf("Numéro de facture", INVOICE.number,         c1, 78);
mf("Date de facture",   INVOICE.date,           c2, 78);
mf("Échéance",          INVOICE.due,            c3, 78);
mf("Dossier",           INVOICE.matter,         c1, 108, 330);
mf("Référence client",  CLIENT.ref,             c3, 108);
mf("Juridiction",       INVOICE.jurisdiction,   c1, 138);
mf("Période",           INVOICE.period,         c2, 138, 200);
mf("Devise",            "EUR — Euro",           c3, 138);

// ─── Bill to ──────────────────────────────────────────────────────────────────
const billY = 172;
doc.font("Helvetica").fontSize(7).fillColor(LIGHT).text("DESTINATAIRE", ML, billY);
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
  ["N°",          COL.no,   "left"],
  ["Date",        COL.date, "left"],
  ["Intervenant", COL.tk,   "left"],
  ["Rôle",        COL.role, "left"],
  ["Description", COL.desc, "left"],
  ["Hres",        COL.hrs,  "right"],
  ["Taux €/h",    COL.rate, "right"],
  ["Montant €",   COL.amt,  "right"],
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
totRow("Sous-total HT:", fmtEUR(SUBTOTAL));
totRow(`TVA ${VAT_RATE}%:`, fmtEUR(VAT_AMT));
curY += 2;
doc.moveTo(tx, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 5;
totRow("TOTAL TTC:", fmtEUR(TOTAL), true, true);

// ─── Payment instructions ──────────────────────────────────────────────────────
curY += 14;
doc.moveTo(ML, curY).lineTo(PW - MR, curY).strokeColor(RULE).stroke();
curY += 10;
doc.font("Helvetica-Bold").fontSize(7.5).fillColor(DARK).text("COORDONNÉES BANCAIRES", ML, curY);
curY += 12;
[
  ["Banque:",     "BNP Paribas S.A., Paris"],
  ["Compte:",     "Beaumont Leclerc & Associés S.A.S. — Compte Honoraires"],
  ["IBAN:",       "FR76 3000 6000 0112 3456 7890 189"],
  ["BIC:",        "BNPAFRPPXXX"],
  ["Référence:",  INVOICE.number],
  ["Conditions:", "30 jours à compter de la date de facturation"],
].forEach(([k, v]) => {
  doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT).text(k, ML, curY, { width: 80, lineBreak: false });
  doc.font("Helvetica").fontSize(7.5).fillColor(MID).text(v, ML + 80, curY, { lineBreak: false });
  curY += 12;
});

// ─── Footer bar ───────────────────────────────────────────────────────────────
const footerY = PH - 34;
doc.rect(0, footerY, PW, 34).fill(NAVY);
doc.rect(0, footerY, PW, 2).fill(GOLD);
doc.font("Helvetica").fontSize(6.5).fillColor(WHITE)
   .text(
     "Beaumont Leclerc & Associés S.A.S.  ·  RCS Paris B 552 081 317  ·  TVA FR 87 552 081 317  ·  " +
     "Réglementé par le Barreau de Paris  ·  CONFIDENTIEL",
     ML, footerY + 11, { width: CW, align: "center" }
   );

doc.end();

stream.on("finish", () => {
  console.log(`\n✅  Invoice PDF: ${OUT}`);
  console.log(`\n10-line clean invoice (EUR/France) — ZERO issues expected:`);
  console.log(`  All rates at or below approved caps: Senior Partner €890, Partner €740, Counsel €630`);
  console.log(`                                       Senior Associate €520, Associate €390, Paralegal €230`);
  console.log(`  All arithmetic correct: hours × rate = amount (verified at generation time)`);
  console.log(`  No duplicate lines`);
  console.log(`  No timekeeper exceeds 8h on any single day`);
  console.log(`  All timekeepers perform work appropriate to their seniority`);
  console.log(`  No internal coordination or admin billed`);
  console.log(`  Expected result: 0 errors, 0 warnings → ACCEPTED`);
  console.log(`\n  Subtotal HT: ${fmtEUR(SUBTOTAL)}`);
  console.log(`  TVA (20%):   ${fmtEUR(VAT_AMT)}`);
  console.log(`  Total TTC:   ${fmtEUR(TOTAL)}`);
});
