// Beaumont Leclerc & Associés S.A.S. — Invoice with 7 embedded billing issues
// Matter: RGPD Compliance Review & Contrats de Traitement de Données
// Run: node demo/generate-beaumont-leclerc-inv-issues.mjs
//
// DESIGN PRINCIPLES (same as Quinn generator):
//  - ISO dates (YYYY-MM-DD) — unambiguous, no date-collapse bug
//  - 13 lines on ONE page — no multi-page date-context loss
//  - E. Beaumont at €890 on all her lines — no spurious INCONSISTENT_RATE for E. Beaumont
//  - Internal coordination = ONE timekeeper (E. Beaumont) — no PARALLEL_BILLING from meeting
//  - Arithmetic error uses small amount — clean AI parsing
//  - A. Marchand duplicate on a day no other TK is active — isolates DUPLICATE_LINE
//  - C. Garnier has TWO lines: one at €680 (excess) and one at €630 (cap) → both RATE_EXCESS + INCONSISTENT
//
// ISSUES DESIGNED TO TRIGGER (exactly 7):
//  [1] RATE_EXCESS                    — C. Garnier, line 3:  €680/h exceeds cap of €630/h (Counsel)
//  [2] DUPLICATE_LINE                 — A. Marchand, lines 6–7: identical entry on 2026-02-11
//  [3] ARITHMETIC_ERROR               — F. Moreau, line 10: 2.0h × €390 = €780 stated as €850
//  [4] INCONSISTENT_RATE_FOR_SAME_TK  — C. Garnier: €680 on line 3 vs €630 on line 5; €680 > cap
//  [5] DAILY_HOURS_EXCEEDED           — L. Dupont, lines 11–13: 4.0+3.5+2.5 = 10h on 2026-02-19
//  [6] SENIORITY_OVERKILL (AI grey)   — E. Beaumont, line 8: Senior Partner printing/filing/archiving
//  [7] INTERNAL_COORDINATION (AI grey)— E. Beaumont, line 9: Senior Partner billing internal team admin

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, "Beaumont_Leclerc_INV-2026-0201_7Issues.pdf");

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
  ref:     "Legal/2026/RGPD-201",
};
const INVOICE = {
  number:      "INV-2026-0201",
  date:        "2026-02-28",
  due:         "2026-03-30",
  matter:      "RGPD Compliance Review & Contrats de Traitement de Données",
  matterRef:   "BLA/RGPD/2026/0201",
  jurisdiction:"France",
  period:      "2026-02-01 to 2026-02-28",
  currency:    "EUR",
};

// ─── Rate caps (reference — not printed) ──────────────────────────────────────
// Senior Partner   €890/h  E. Beaumont   — all lines €890 (no excess for her)
// Counsel          €630/h  C. Garnier    — line 3 at €680 (RATE_EXCESS + INCONSISTENT), line 5 at €630
// Partner          €740/h  A. Marchand   — £740 throughout (DUPLICATE on lines 6–7)
// Associate        €390/h  F. Moreau     — arithmetic error on line 10
// Senior Associate €520/h  L. Dupont     — 10h on 2026-02-19 (lines 11–13)
// Max daily hours  8h/timekeeper

const LINES = [
  // ── 2026-02-03: normal advisory ────────────────────────────────────────────
  {
    date: "2026-02-03", tk: "E. Beaumont",  role: "Senior Partner",
    hours: 2.0, rate: 890.00, amount: 1780.00,
    desc: "Strategic advisory on RGPD compliance programme scope; initial review of legal bases for HR data processing under Article 6 RGPD and advice on accountability framework and DPO designation obligations.",
  },
  {
    date: "2026-02-03", tk: "L. Dupont",    role: "Senior Associate",
    hours: 3.5, rate: 520.00, amount: 1820.00,
    desc: "Gap analysis of existing mentions d'information against RGPD Articles 13-14; assessment of CNIL accountability requirements and documentation of recommended remediation actions.",
  },

  // ── 2026-02-05: [1] RATE_EXCESS + [4] INCONSISTENT_RATE ───────────────────
  // C. Garnier charged at €680/h (cap €630/h) → RATE_EXCESS fires
  // C. Garnier has €630 on line 5 → INCONSISTENT_RATE fires (€680 > cap)
  {
    date: "2026-02-05", tk: "C. Garnier",   role: "Counsel",
    hours: 3.0, rate: 680.00, amount: 2040.00,           // ← [1] RATE_EXCESS
    desc: "Research on CNIL enforcement guidance on employee monitoring and workplace data retention; review of recent CNIL penalty decisions on HR data processing and preparation of enforcement landscape summary.",
  },

  // ── 2026-02-07: normal associate work ──────────────────────────────────────
  {
    date: "2026-02-07", tk: "F. Moreau",    role: "Associate",
    hours: 2.5, rate: 390.00, amount:  975.00,
    desc: "Preparation of Registre des Activités de Traitement (RAT) template; compilation of initial data register entries covering recruitment, onboarding and payroll processing activities.",
  },

  // ── 2026-02-08: C. Garnier at correct rate (establishes INCONSISTENT_RATE) ─
  {
    date: "2026-02-08", tk: "C. Garnier",   role: "Counsel",
    hours: 2.0, rate: 630.00, amount: 1260.00,           // ← establishes €630 cap rate
    desc: "Drafting of Contrat de Sous-traitance de Données (DPA) for cloud computing services provider; review of standard controller-processor clauses and adaptation for French law requirements.",
  },

  // ── 2026-02-11: [2] DUPLICATE_LINE ─────────────────────────────────────────
  // A. Marchand is the only timekeeper on this date → no PARALLEL_BILLING from third parties
  // Both lines are identical → DUPLICATE_LINE fires
  {
    date: "2026-02-11", tk: "A. Marchand",  role: "Partner",
    hours: 3.5, rate: 740.00, amount: 2590.00,
    desc: "Preparation of procédure de gestion des droits des personnes (DSAR); drafting of internal access request workflow, response templates and escalation protocol for HR and payroll data requests.",
  },
  {
    date: "2026-02-11", tk: "A. Marchand",  role: "Partner",
    hours: 3.5, rate: 740.00, amount: 2590.00,           // ← [2] DUPLICATE (identical to line above)
    desc: "Preparation of procédure de gestion des droits des personnes (DSAR); drafting of internal access request workflow, response templates and escalation protocol for HR and payroll data requests.",
  },

  // ── 2026-02-12: [6] SENIORITY_OVERKILL ────────────────────────────────────
  {
    date: "2026-02-12", tk: "E. Beaumont",  role: "Senior Partner",
    hours: 1.5, rate: 890.00, amount: 1335.00,
    desc: "Review of draft RGPD compliance gap analysis; strategic advice to Group Legal Counsel on remediation priorities, data governance accountability and DPO appointment obligations.",
  },
  {
    date: "2026-02-12", tk: "E. Beaumont",  role: "Senior Partner",
    hours: 1.0, rate: 890.00, amount:  890.00,           // ← [6] SENIORITY_OVERKILL
    desc: "Impression, classement et archivage des copies papier des contrats de traitement signés; mise à jour de l'index documentaire physique, organisation du classeur client avec intercalaires et étiquettes.",
  },

  // ── 2026-02-14: [7] INTERNAL_COORDINATION ──────────────────────────────────
  {
    date: "2026-02-14", tk: "E. Beaumont",  role: "Senior Partner",
    hours: 2.0, rate: 890.00, amount: 1780.00,           // ← [7] INTERNAL_COORDINATION
    desc: "Coordination interne d'équipe: revue d'avancement des workstreams avec C. Garnier et L. Dupont, réallocation des tâches en suspens, mise à jour du suivi de dossier et préparation des prévisions de facturation internes.",
  },

  // ── 2026-02-17: [3] ARITHMETIC_ERROR ───────────────────────────────────────
  // 2.0h × €390.00 = €780.00 but stated as €850.00 (no thousands comma → clean AI parsing)
  {
    date: "2026-02-17", tk: "F. Moreau",    role: "Associate",
    hours: 2.0, rate: 390.00, amount: 850.00,            // ← [3] ARITHMETIC_ERROR (correct: €780.00)
    desc: "Population du registre de traitement (RAT): saisie des opérations de traitement avec finalité, base légale, catégories de données, durées de conservation et détails des transferts hors UE pour 8 activités RH.",
  },

  // ── 2026-02-19: [5] DAILY_HOURS_EXCEEDED ───────────────────────────────────
  // L. Dupont: 4.0 + 3.5 + 2.5 = 10.0h on same day (max 8h/day under T&C clause 5)
  {
    date: "2026-02-19", tk: "L. Dupont",    role: "Senior Associate",
    hours: 4.0, rate: 520.00, amount: 2080.00,           // ← [5] DAILY_HOURS part 1
    desc: "Revue complète de la politique de surveillance des employés et des dispositifs BYOD; rédaction de l'analyse d'intérêt légitime (LIA) au titre de l'Article 6(1)(f) RGPD; premier draft couvrant toutes les activités de monitoring.",
  },
  {
    date: "2026-02-19", tk: "L. Dupont",    role: "Senior Associate",
    hours: 3.5, rate: 520.00, amount: 1820.00,           // ← [5] DAILY_HOURS part 2
    desc: "Rédaction de la mention d'information employés conforme aux Articles 13-14 RGPD; préparation de la notice en couches pour le portail RH couvrant la paie, la gestion des absences, la performance et les données disciplinaires.",
  },
  {
    date: "2026-02-19", tk: "L. Dupont",    role: "Senior Associate",
    hours: 2.5, rate: 520.00, amount: 1300.00,           // ← [5] DAILY_HOURS part 3 → total 10.0h
    desc: "Préparation du calendrier de conservation des données RH: durées recommandées pour les contrats de travail, fiches de paie, dossiers disciplinaires, dossiers de santé et santé au travail selon les obligations légales minimales.",
  },
];

// ─── Totals ────────────────────────────────────────────────────────────────────
// Note: subtotal includes arithmetic error (€850 instead of €780 on line 10)
// and the duplicate line (both lines 6 and 7 counted)
const SUBTOTAL = LINES.reduce((s, l) => s + l.amount, 0);
const VAT_RATE = 20;
const VAT_AMT  = SUBTOTAL * 0.20;
const TOTAL    = SUBTOTAL + VAT_AMT;

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
  console.log(`\n13-line, single-page invoice (EUR/France) — issues designed to trigger:`);
  console.log(`  [1] RATE_EXCESS                   — Line 3:  C. Garnier €680/h vs €630/h cap (Counsel)`);
  console.log(`  [2] DUPLICATE_LINE                — Lines 6-7: A. Marchand 2026-02-11 identical`);
  console.log(`  [3] ARITHMETIC_ERROR              — Line 10: F. Moreau 2.0h × €390 = €780 stated €850`);
  console.log(`  [4] INCONSISTENT_RATE_FOR_SAME_TK — C. Garnier: €680 (line 3) vs €630 (line 5)`);
  console.log(`  [5] DAILY_HOURS_EXCEEDED          — Lines 11-13: L. Dupont 10.0h on 2026-02-19`);
  console.log(`  [6] SENIORITY_OVERKILL (AI)       — Line 8: E. Beaumont Sr Partner printing/filing`);
  console.log(`  [7] INTERNAL_COORDINATION (AI)    — Line 9: E. Beaumont billing internal team admin`);
  console.log(`\n  No thousands commas in amounts → clean AI arithmetic parsing`);
  console.log(`  ISO dates → unambiguous date parsing`);
  console.log(`\n  Subtotal (incl errors): ${fmtEUR(SUBTOTAL)}`);
  console.log(`  VAT (20%):              ${fmtEUR(VAT_AMT)}`);
  console.log(`  Total TTC:              ${fmtEUR(TOTAL)}`);
});
