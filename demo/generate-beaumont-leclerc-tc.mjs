// Beaumont Leclerc & Associés S.A.S. — Panel Engagement Letter & Terms of Business
// Jurisdiction: France | Currency: EUR
// Run: node demo/generate-beaumont-leclerc-tc.mjs
//
// This document is designed so the AI extractor can populate ALL ExtractedFirmTerms fields:
//   billing_type_default, discount_type, discount_payment_type, discount_thresholds_json,
//   max_daily_hours_per_timekeeper, getting_up_to_speed_billable, payment_terms_days,
//   travel_policy, expense_policy_json, third_party_services_require_approval,
//   contract_start_date, contract_end_date, best_friend_firms_json, per_role_rates_json

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, "Beaumont_Leclerc_TC_2026.pdf");

// ─── Palette ──────────────────────────────────────────────────────────────────
const NAVY   = "#1B2D4F";
const GOLD   = "#B8912A";
const DARK   = "#1A1A1A";
const MID    = "#444444";
const LIGHT  = "#777777";
const RULE   = "#D0D0D0";
const WHITE  = "#FFFFFF";
const FAINT  = "#F7F6F3";

function buildPdf() {
  const doc = new PDFDocument({ size: "A4", margin: 60, info: {
    Title:   "Beaumont Leclerc & Associés S.A.S. — Panel Engagement Letter & Terms of Business 2026",
    Author:  "Beaumont Leclerc & Associés S.A.S.",
    Subject: "Panel Engagement Letter, Hourly Rate Schedule and Terms of Business",
    Creator: "Beaumont Leclerc S.A.S. Billing Department",
  }});

  const stream = createWriteStream(OUT);
  doc.pipe(stream);

  const PW = doc.page.width;
  const ML = 60, MR = 60, CW = PW - ML - MR;
  let y = 0;

  // ─── Header ────────────────────────────────────────────────────────────────
  doc.rect(0, 0, PW, 10).fill(NAVY);
  doc.rect(0, 10, PW, 3).fill(GOLD);

  doc.font("Helvetica-Bold").fontSize(18).fillColor(NAVY)
     .text("BEAUMONT LECLERC & ASSOCIÉS S.A.S.", ML, 28, { width: CW });
  doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT)
     .text(
       "14 Avenue Kléber, 75116 Paris, France  ·  RCS Paris B 552 081 317  ·  TVA FR 87 552 081 317  ·  Barreau de Paris",
       ML, 50, { width: CW }
     );
  doc.rect(0, 68, PW, 3).fill(GOLD);
  doc.rect(0, 71, PW, 1).fill(RULE);

  y = 85;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY)
     .text("PANEL ENGAGEMENT LETTER & TERMS OF BUSINESS", ML, y, { width: CW, align: "center" });
  y += 18;
  doc.font("Helvetica").fontSize(9).fillColor(LIGHT)
     .text("Reference: BLA/PANEL/2026/001", ML, y, { width: CW, align: "center" });
  y += 22;

  // ─── Parties ───────────────────────────────────────────────────────────────
  section(doc, ML, y, CW, "1. PARTIES");
  y += 22;
  body(doc, ML, y, CW,
    "This Panel Engagement Letter and Terms of Business (the \"Agreement\") is entered into " +
    "between Beaumont Leclerc & Associés S.A.S., a société par actions simplifiée registered " +
    "under French law and duly admitted to the Barreau de Paris (the \"Firm\"), and " +
    "Acme Industrial Group plc, a company incorporated under the laws of England & Wales " +
    "(the \"Client\")."
  );
  y += 56;
  bodyKV(doc, ML, y, CW, [
    ["Governing Law / Jurisdiction:", "France"],
    ["Agreement Start Date:",         "15 January 2026"],
    ["Agreement End Date:",           "31 December 2027"],
    ["Primary Contact (Firm):",       "Maître Élodie Beaumont, Managing Partner"],
    ["Primary Contact (Client):",     "Legal Department, Acme Industrial Group plc"],
  ]);
  y += 90;

  // ─── Scope ─────────────────────────────────────────────────────────────────
  section(doc, ML, y, CW, "2. SCOPE OF SERVICES");
  y += 22;
  body(doc, ML, y, CW,
    "The Firm is appointed as a panel law firm for the following practice areas on behalf of the Client: " +
    "Corporate & M&A, Data Protection & Privacy (GDPR/CNIL), Employment Law (French labour code), " +
    "Regulatory Compliance, Commercial Litigation, and Real Estate. Services shall be governed " +
    "exclusively by the terms set out in this Agreement."
  );
  y += 56;

  // ─── Billing ───────────────────────────────────────────────────────────────
  section(doc, ML, y, CW, "3. BILLING ARRANGEMENT");
  y += 22;
  body(doc, ML, y, CW,
    "The primary billing arrangement under this Agreement is hourly billing. All fees are charged " +
    "based on time recorded by the relevant timekeeper at the applicable hourly rate set out in " +
    "Schedule A below. Time is recorded in minimum increments of six (6) minutes. No fixed fees, " +
    "blended rates, or retainer arrangements apply unless separately agreed in writing."
  );
  y += 56;

  // ─── Rate Schedule ─────────────────────────────────────────────────────────
  section(doc, ML, y, CW, "4. APPROVED HOURLY RATE SCHEDULE — SCHEDULE A");
  y += 22;
  body(doc, ML, y, CW,
    "The following maximum approved hourly rates (in EUR) apply to all matters under this Agreement " +
    "for the period 15 January 2026 to 31 December 2027. These rates are inclusive of all overhead " +
    "and profit margin. Rates are exclusive of VAT (TVA at the applicable French rate)."
  );
  y += 44;

  // Rate table
  const rateRows = [
    ["Senior Partner",    "Maître Élodie Beaumont / Maître Jean-Baptiste Marchand", "€890.00"],
    ["Partner",           "All admitted Partners",                                   "€740.00"],
    ["Counsel",           "All Of Counsel and Of Counsel equivalents",               "€630.00"],
    ["Senior Associate",  "All Senior Associates (5+ years PQE)",                   "€520.00"],
    ["Associate",         "All Associates (0–4 years PQE)",                          "€390.00"],
    ["Paralegal",         "All Paralegal staff",                                     "€230.00"],
    ["Legal Trainee",     "All stagiaires and legal trainees",                       "€180.00"],
  ];
  const rCols = [ML, ML + 130, ML + 340, ML + CW - 10];
  doc.rect(ML, y, CW, 14).fill(NAVY);
  [["Role", 0], ["Description", 1], ["Max Rate/h (EUR)", 2]].forEach(([h, ci]) => {
    doc.font("Helvetica-Bold").fontSize(7).fillColor(WHITE)
       .text(String(h), rCols[Number(ci)] + 4, y + 4, { width: rCols[Number(ci)+1] - rCols[Number(ci)] - 6, align: ci === 2 ? "right" : "left" });
  });
  y += 14;
  rateRows.forEach((row, i) => {
    doc.rect(ML, y, CW, 13).fill(i % 2 === 0 ? WHITE : FAINT);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(DARK)
       .text(row[0], rCols[0] + 4, y + 3, { width: rCols[1] - rCols[0] - 6 });
    doc.font("Helvetica").fontSize(7.5).fillColor(MID)
       .text(row[1], rCols[1] + 4, y + 3, { width: rCols[2] - rCols[1] - 6 });
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(NAVY)
       .text(row[2], rCols[2] + 4, y + 3, { width: rCols[3] - rCols[2] - 6, align: "right" });
    y += 13;
  });
  y += 8;
  body(doc, ML, y, CW,
    "Rates are fixed for the duration of this Agreement and may not be increased without prior " +
    "written consent from the Client's Legal Director. Any timekeeper whose role does not fall within " +
    "the above categories must be separately approved by the Client before billing commences."
  );
  y += 36;

  // ─── Daily Hours ───────────────────────────────────────────────────────────
  section(doc, ML, y, CW, "5. DAILY BILLING LIMITS");
  y += 22;
  body(doc, ML, y, CW,
    "No timekeeper may bill in excess of eight (8) hours per calendar day on any single client matter " +
    "or across all client matters combined, unless expressly pre-approved in writing by the Client " +
    "for a specific occasion (e.g. court deadlines). Any hours billed in excess of this limit will " +
    "be subject to mandatory write-off. This limit applies regardless of the timekeeper's seniority."
  );
  y += 56;

  // ─── Getting up to speed ───────────────────────────────────────────────────
  section(doc, ML, y, CW, "6. FAMILIARISATION AND GETTING UP TO SPEED");
  y += 22;
  body(doc, ML, y, CW,
    "Time spent by any timekeeper familiarising themselves with a matter, reviewing prior " +
    "correspondence, or getting up to speed with the background of an existing engagement is " +
    "not billable to the Client. This includes induction time for new team members joining an " +
    "ongoing matter. The Firm is expected to invest its own time in knowledge transfer internally."
  );
  y += 56;

  // ─── Payment terms ─────────────────────────────────────────────────────────
  section(doc, ML, y, CW, "7. PAYMENT TERMS");
  y += 22;
  body(doc, ML, y, CW,
    "All invoices are payable within thirty (30) calendar days of the invoice date. Invoices must be " +
    "submitted electronically to accounts.payable@acme-group.com with the matter reference number " +
    "clearly stated. Late payment interest shall accrue at the statutory French rate under " +
    "L.441-10 of the Code de commerce from the date of default."
  );
  y += 56;

  // ─── Volume Discounts ──────────────────────────────────────────────────────
  section(doc, ML, y, CW, "8. VOLUME DISCOUNT — ANNUAL REBATE SCHEDULE");
  y += 22;
  body(doc, ML, y, CW,
    "The Firm shall apply a volume discount in the form of an annual rebate, calculated on total " +
    "fees invoiced (excluding VAT and disbursements) across all matters in each calendar year. " +
    "Rebates are credit note-based — issued within 30 days of year end — and applied against the " +
    "next outstanding invoice. Discount type: volume rebate."
  );
  y += 48;

  const discRows = [
    ["EUR 0 – EUR 150,000",       "3.0%",  "Applied as rebate credit note at year end"],
    ["EUR 150,001 and above",     "5.0%",  "Applied as rebate credit note at year end"],
  ];
  const dCols = [ML, ML + 170, ML + 240, ML + CW];
  doc.rect(ML, y, CW, 14).fill(NAVY);
  [["Annual Fees Band (excl. VAT)", 0], ["Rebate %", 1], ["Method", 2]].forEach(([h, ci]) => {
    doc.font("Helvetica-Bold").fontSize(7).fillColor(WHITE)
       .text(String(h), dCols[Number(ci)] + 4, y + 4, { width: dCols[Number(ci)+1] - dCols[Number(ci)] - 6 });
  });
  y += 14;
  discRows.forEach((row, i) => {
    doc.rect(ML, y, CW, 13).fill(i % 2 === 0 ? WHITE : FAINT);
    doc.font("Helvetica").fontSize(7.5).fillColor(DARK).text(row[0], dCols[0]+4, y+3, { width: dCols[1]-dCols[0]-6 });
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(NAVY).text(row[1], dCols[1]+4, y+3, { width: dCols[2]-dCols[1]-6 });
    doc.font("Helvetica").fontSize(7.5).fillColor(MID).text(row[2], dCols[2]+4, y+3, { width: dCols[3]-dCols[2]-6 });
    y += 13;
  });
  y += 12;

  // ─── Travel ────────────────────────────────────────────────────────────────
  section(doc, ML, y, CW, "9. TRAVEL AND EXPENSE POLICY");
  y += 22;
  body(doc, ML, y, CW,
    "Travel Policy: Economy class air travel is required for all flights of five (5) hours or less. " +
    "Business class is permitted only for flights exceeding five (5) hours, subject to prior written " +
    "approval. Hotel accommodation is reimbursed at a maximum of EUR 280 per night including " +
    "breakfast. All international travel must receive prior written approval from the Client's " +
    "Legal Director before booking."
  );
  y += 56;
  body(doc, ML, y, CW,
    "Permitted expenses: reasonable local transport (taxi/Uber, capped at EUR 60 per day), meals " +
    "during court appearances or client hearings (capped at EUR 60 per person per day), and certified " +
    "legal translation services. Not permitted: business entertainment, alcohol, personal expenses, " +
    "first-class or business-class air travel under 5 hours, or any expense exceeding the caps above " +
    "without prior written approval."
  );
  y += 56;

  // ─── Third-party services ──────────────────────────────────────────────────
  section(doc, ML, y, CW, "10. THIRD-PARTY AND EXTERNAL SERVICES");
  y += 22;
  body(doc, ML, y, CW,
    "The instruction of any third-party service provider (including barristers, expert witnesses, " +
    "process servers, local counsel in other jurisdictions, or specialist consultants) requires prior " +
    "written approval from the Client before any commitment is made. The Firm must provide a written " +
    "estimate of the anticipated third-party costs. Failure to obtain prior approval will result in " +
    "the Client being entitled to reject those disbursements from the invoice."
  );
  y += 56;

  // ─── Best Friend Firms ─────────────────────────────────────────────────────
  section(doc, ML, y, CW, "11. PREFERRED NETWORK — BEST FRIEND FIRMS");
  y += 22;
  body(doc, ML, y, CW,
    "For cross-border matters requiring local counsel, the following firms have been pre-approved as " +
    "preferred best-friend firms and do not require individual approval for their instruction " +
    "(subject to clause 10 cost-estimate requirements):"
  );
  y += 36;
  ["Gleiss Lutz (Germany)", "NautaDutilh N.V. (Netherlands)", "Uría Menéndez (Spain)"].forEach(f => {
    doc.font("Helvetica").fontSize(8.5).fillColor(MID)
       .text("•  " + f, ML + 16, y, { width: CW - 16 });
    y += 14;
  });
  y += 8;

  // ─── Footer note ───────────────────────────────────────────────────────────
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
  y += 10;
  doc.font("Helvetica").fontSize(7).fillColor(LIGHT)
     .text(
       "This document constitutes the entire agreement between the parties with respect to the " +
       "panel appointment of Beaumont Leclerc & Associés S.A.S. by the Client. All prior " +
       "arrangements are superseded. This Agreement is governed by French law. " +
       "Signed in Paris on 15 January 2026.",
       ML, y, { width: CW }
     );
  y += 28;

  // Signature block
  const sCol = [ML, ML + CW / 2];
  doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK)
     .text("For Beaumont Leclerc & Associés S.A.S.", sCol[0], y, { width: CW / 2 - 10 })
     .text("For Acme Industrial Group plc", sCol[1], y, { width: CW / 2 - 10 });
  y += 30;
  doc.moveTo(sCol[0], y).lineTo(sCol[0] + CW / 2 - 30, y).strokeColor(DARK).lineWidth(0.5).stroke();
  doc.moveTo(sCol[1], y).lineTo(sCol[1] + CW / 2 - 30, y).strokeColor(DARK).lineWidth(0.5).stroke();
  y += 6;
  doc.font("Helvetica").fontSize(7.5).fillColor(LIGHT)
     .text("Maître Élodie Beaumont, Managing Partner", sCol[0], y, { width: CW / 2 - 10 })
     .text("Group Legal Counsel, Acme Industrial Group plc", sCol[1], y, { width: CW / 2 - 10 });

  // Footer bar
  const footerY = doc.page.height - 32;
  doc.rect(0, footerY, PW, 32).fill(NAVY);
  doc.rect(0, footerY, PW, 3).fill(GOLD);
  doc.font("Helvetica").fontSize(6.5).fillColor(WHITE)
     .text(
       "Beaumont Leclerc & Associés S.A.S.  ·  14 Avenue Kléber, 75116 Paris, France  ·  " +
       "RCS Paris B 552 081 317  ·  Réglementé par le Barreau de Paris  ·  STRICTLY CONFIDENTIAL",
       ML, footerY + 12, { width: CW, align: "center" }
     );

  doc.end();
  stream.on("finish", () => {
    console.log(`\n✅  T&C PDF: ${OUT}`);
    console.log(`\nAI-extractable fields in this document:`);
    console.log(`  billing_type_default:              "hourly"`);
    console.log(`  discount_type:                     "volume"`);
    console.log(`  discount_payment_type:             "rebate"`);
    console.log(`  discount_thresholds_json:          [{from:0,to:150000,pct:3},{from:150000,to:null,pct:5}]`);
    console.log(`  max_daily_hours_per_timekeeper:    8`);
    console.log(`  getting_up_to_speed_billable:      false`);
    console.log(`  payment_terms_days:                30`);
    console.log(`  travel_policy:                     (see clause 9)`);
    console.log(`  expense_policy_json:               (see clause 9)`);
    console.log(`  third_party_services_require_approval: true`);
    console.log(`  contract_start_date:               "2026-01-15"`);
    console.log(`  contract_end_date:                 "2027-12-31"`);
    console.log(`  best_friend_firms_json:            ["Gleiss Lutz (Germany)", "NautaDutilh N.V. (Netherlands)", "Uría Menéndez (Spain)"]`);
    console.log(`  per_role_rates_json:               {Senior Partner:890, Partner:740, Counsel:630, Senior Associate:520, Associate:390, Paralegal:230, Legal Trainee:180}`);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function section(doc, x, y, w, title) {
  doc.rect(x, y, w, 16).fill(FAINT);
  doc.moveTo(x, y).lineTo(x + 4, y).strokeColor(GOLD).lineWidth(3).stroke();
  doc.moveTo(x, y + 16).lineTo(x + w, y + 16).strokeColor(RULE).lineWidth(0.5).stroke();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NAVY).text(title, x + 10, y + 4, { width: w - 12 });
}

function body(doc, x, y, w, text) {
  doc.font("Helvetica").fontSize(8.5).fillColor(DARK).text(text, x, y, { width: w, lineGap: 2 });
}

function bodyKV(doc, x, y, w, rows) {
  rows.forEach(([k, v]) => {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MID).text(k, x, y, { width: 180, lineBreak: false });
    doc.font("Helvetica").fontSize(8.5).fillColor(DARK).text(v, x + 185, y, { width: w - 185 });
    y += 16;
  });
}

buildPdf();
