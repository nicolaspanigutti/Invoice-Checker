// T&C / Engagement Letter generator — Hargreaves & Sutton LLP
// Produces a PDF suitable for uploading via the "Upload T&C" flow
// Run: node demo/generate-tc-hs.mjs

import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "Hargreaves_Sutton_LLP_Engagement_Letter_2026.pdf"
);

const NAVY   = "#1B2A4A";
const GOLD   = "#B8963E";
const DARK   = "#1A1A1A";
const MID    = "#444444";
const LIGHT  = "#888888";
const RULE   = "#D0D0D0";

const doc = new PDFDocument({ size: "A4", margin: 60, info: {
  Title:    "Engagement Letter & Terms of Business — Hargreaves & Sutton LLP",
  Author:   "Hargreaves & Sutton LLP",
  Subject:  "Panel Appointment — Acme Industrial Group plc",
  Creator:  "Hargreaves & Sutton LLP",
}});

const stream = createWriteStream(OUT);
doc.pipe(stream);

const PW = doc.page.width;
const ML = 60;
const MR = 60;
const CW = PW - ML - MR;

// ── Header ───────────────────────────────────────────────────────────────────
doc.rect(0, 0, PW, 10).fill(NAVY);

doc.font("Helvetica-Bold").fontSize(22).fillColor(NAVY)
  .text("HARGREAVES & SUTTON LLP", ML, 28, { width: CW });
doc.font("Helvetica").fontSize(9).fillColor(LIGHT)
  .text("Solicitors · Notaries · Regulated by the Solicitors Regulation Authority", ML, 54);
doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT)
  .text("14 Gray's Inn Road  ·  London WC1X 8HN  ·  United Kingdom", ML, 66);
doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT)
  .text("Tel: +44 20 7831 4400  ·  billing@hargreaves-sutton.co.uk  ·  www.hargreaves-sutton.co.uk", ML, 78);

doc.moveTo(ML, 95).lineTo(PW - MR, 95).strokeColor(GOLD).lineWidth(1.5).stroke();

// ── Title ────────────────────────────────────────────────────────────────────
doc.font("Helvetica-Bold").fontSize(14).fillColor(NAVY)
  .text("ENGAGEMENT LETTER & TERMS OF BUSINESS", ML, 110, { align: "center", width: CW });
doc.font("Helvetica").fontSize(9).fillColor(LIGHT)
  .text("Panel Law Firm Appointment — Effective 1 March 2026", ML, 128, { align: "center", width: CW });

// ── Parties ──────────────────────────────────────────────────────────────────
let y = 152;
function section(title, content, bulletGroups) {
  doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(title, ML, y);
  y = doc.y + 4;
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
  y += 8;
  if (content) {
    doc.font("Helvetica").fontSize(9).fillColor(DARK)
      .text(content, ML, y, { width: CW, lineGap: 2 });
    y = doc.y + 8;
  }
  if (bulletGroups) {
    bulletGroups.forEach(({ label, items }) => {
      if (label) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor(MID).text(label, ML, y);
        y = doc.y + 4;
      }
      items.forEach(item => {
        doc.font("Helvetica").fontSize(9).fillColor(DARK)
          .text(`•  ${item}`, ML + 10, y, { width: CW - 10, lineGap: 1 });
        y = doc.y + 3;
      });
      y += 4;
    });
  }
  y += 10;
}

function kvRow(label, value) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MID).text(label + ":", ML, y, { continued: false, width: 190 });
  const savedY = y;
  doc.font("Helvetica").fontSize(9).fillColor(DARK).text(value, ML + 195, savedY, { width: CW - 195 });
  y = Math.max(doc.y, savedY + 14) + 3;
}

section("1.  PARTIES", `This Engagement Letter is entered into between Hargreaves & Sutton LLP ("the Firm") and Acme Industrial Group plc ("the Client"), acting through its Legal Department. The Firm is appointed to the Client's preferred legal panel effective 1 March 2026, governed by the laws of England and Wales.`);

section("2.  SCOPE OF SERVICES", `The Firm will provide legal advisory services in the following practice areas on an as-instructed basis: (i) Corporate Mergers & Acquisitions; (ii) Joint Ventures & Strategic Alliances; (iii) Corporate Governance & Compliance; (iv) Commercial Contracts; and (v) such other areas as agreed in writing by the parties from time to time.`);

// Contract terms table
doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("3.  KEY COMMERCIAL TERMS", ML, y);
y = doc.y + 4;
doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
y += 10;

kvRow("Contract Start Date",             "1 March 2026");
kvRow("Contract End Date",               "28 February 2028");
kvRow("Governing Law",                   "England and Wales");
kvRow("Default Billing Type",            "Hourly rates — time-recorded");
kvRow("Currency",                        "GBP (British Pounds Sterling)");
kvRow("Payment Terms",                   "45 days from invoice date");
kvRow("Discount Type",                   "None (fixed panel rates apply)");
kvRow("Getting Up to Speed Billable",    "No — familiarisation time is non-billable");
kvRow("Max Daily Hours per Timekeeper",  "8 hours per individual per calendar day");
kvRow("Third-Party Services Approval",   "Yes — prior written approval required from client Legal Ops");

y += 8;

// Hourly rates table
doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("4.  PANEL HOURLY RATES (GBP)", ML, y);
y = doc.y + 4;
doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
y += 10;

doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT)
  .text("The following maximum rates apply to all matters from the effective date. All rates are exclusive of VAT.", ML, y, { width: CW });
y = doc.y + 10;

const rates = [
  ["Senior Partner",      "SP",   "GBP 760.00"],
  ["Partner",             "P",    "GBP 680.00"],
  ["Counsel",             "C",    "GBP 610.00"],
  ["Senior Associate",    "SA",   "GBP 545.00"],
  ["Associate 5th Year",  "A5",   "GBP 500.00"],
  ["Associate 4th Year",  "A4",   "GBP 470.00"],
  ["Associate 3rd Year",  "A3",   "GBP 440.00"],
  ["Associate 2nd Year",  "A2",   "GBP 410.00"],
  ["Associate 1st Year",  "A1",   "GBP 380.00"],
  ["Paralegal",           "PL",   "GBP 290.00"],
  ["Legal Trainee",       "LT",   "GBP 240.00"],
];

doc.rect(ML, y - 3, CW, 15).fill("#F2F4F7");
doc.font("Helvetica-Bold").fontSize(8).fillColor(MID)
  .text("Role",         ML + 4,     y, { width: 150 })
  .text("Code",         ML + 154,   y, { width: 40,  align: "center" })
  .text("Max Rate/hr",  ML + 200,   y, { width: 80,  align: "right" });
y += 16;

rates.forEach(([role, code, rate], i) => {
  if (i % 2 === 1) doc.rect(ML, y - 2, CW, 14).fill("#FAFAFA");
  doc.font("Helvetica").fontSize(8.5).fillColor(DARK)
    .text(role,  ML + 4,   y, { width: 150 })
    .text(code,  ML + 154, y, { width: 40,  align: "center" })
    .text(rate,  ML + 200, y, { width: 80,  align: "right" });
  y += 14;
});
y += 10;

// Travel policy
doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("5.  TRAVEL POLICY", ML, y);
y = doc.y + 4;
doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
y += 8;
doc.font("Helvetica").fontSize(9).fillColor(DARK).text(
  "Economy class travel is required for all domestic and short-haul flights (under 8 hours). Business class is permitted only for international flights of 8 hours or more, and must receive prior written approval from the client's Legal Operations team before booking. Standard class rail travel is required at all times regardless of journey duration. Hotel accommodation is reimbursable at a maximum of GBP 200 per night in London and GBP 160 per night elsewhere in the UK. All travel expenses must be supported by receipts. Any travel expense exceeding GBP 500 in a single journey requires advance written authorisation.",
  ML, y, { width: CW, lineGap: 2 }
);
y = doc.y + 14;

// Expense policy
doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("6.  EXPENSE REIMBURSEMENT POLICY", ML, y);
y = doc.y + 4;
doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
y += 8;

doc.font("Helvetica-Bold").fontSize(9).fillColor("#2D7A4F").text("Allowable Expenses:", ML, y);
y = doc.y + 4;
const allowed = [
  "Economy air travel (domestic and international short-haul)",
  "Standard class rail travel",
  "Hotel accommodation at approved rates (receipts required)",
  "Taxis and ground transport for client-related travel",
  "Subsistence — meals up to GBP 30 per day with receipt",
  "Courier and postage costs for matter-related correspondence",
  "Court filing fees and official registration charges",
];
allowed.forEach(item => {
  doc.font("Helvetica").fontSize(9).fillColor(DARK)
    .text(`✓  ${item}`, ML + 10, y, { width: CW - 10, lineGap: 1 });
  y = doc.y + 3;
});

y += 8;
doc.font("Helvetica-Bold").fontSize(9).fillColor("#B00020").text("Non-Reimbursable Expenses:", ML, y);
y = doc.y + 4;
const notAllowed = [
  "Business class airfare (for flights under 8 hours)",
  "First class rail or air travel",
  "Alcohol and bar expenses",
  "Personal entertainment, theatre, cinema or sporting events",
  "Spa, gym or personal wellness costs",
  "Hotel minibar, room service (non-subsistence items)",
  "Traffic or parking fines",
];
notAllowed.forEach(item => {
  doc.font("Helvetica").fontSize(9).fillColor(DARK)
    .text(`✕  ${item}`, ML + 10, y, { width: CW - 10, lineGap: 1 });
  y = doc.y + 3;
});
y += 14;

// Signatures
doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(RULE).lineWidth(0.5).stroke();
y += 12;
doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("7.  EXECUTION", ML, y);
y = doc.y + 10;

const sigW = (CW - 40) / 2;
doc.font("Helvetica").fontSize(9).fillColor(MID).text("For and on behalf of the Firm:", ML, y);
doc.font("Helvetica").fontSize(9).fillColor(MID).text("For and on behalf of the Client:", ML + sigW + 40, y);
y += 30;
doc.moveTo(ML, y).lineTo(ML + sigW, y).strokeColor(RULE).stroke();
doc.moveTo(ML + sigW + 40, y).lineTo(ML + sigW * 2 + 40, y).strokeColor(RULE).stroke();
y += 6;
doc.font("Helvetica-Bold").fontSize(8.5).fillColor(DARK)
  .text("Eleanor Hargreaves", ML, y)
  .text("[Authorised Signatory]", ML + sigW + 40, y);
y += 12;
doc.font("Helvetica").fontSize(8.5).fillColor(MID)
  .text("Senior Partner", ML, y)
  .text("Acme Industrial Group plc", ML + sigW + 40, y);
y += 12;
doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT)
  .text("Date: ____________________", ML, y)
  .text("Date: ____________________", ML + sigW + 40, y);

// Footer
doc.rect(0, doc.page.height - 36, PW, 36).fill(NAVY);
doc.font("Helvetica").fontSize(7).fillColor("#FFFFFF")
  .text(
    "Hargreaves & Sutton LLP  ·  Authorised and regulated by the Solicitors Regulation Authority (SRA No. 628441)  ·  Registered in England & Wales (OC419832)  ·  14 Gray\'s Inn Road, London WC1X 8HN",
    ML, doc.page.height - 22, { width: CW, align: "center" }
  );

doc.end();
stream.on("finish", () => console.log(`✅  Written: ${OUT}`));
