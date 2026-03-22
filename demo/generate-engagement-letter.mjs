import { createRequire } from "module";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const PDFDocument = require("../artifacts/api-server/node_modules/pdfkit");

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "Caldwell_Pryce_LLP_Engagement_Letter_ACQ2026.pdf");

const RED   = "#8B0000";
const DARK  = "#1A1A1A";
const MID   = "#444444";
const LIGHT = "#888888";
const RULE  = "#D0D0D0";

const doc = new PDFDocument({ size: "A4", margin: 72, info: {
  Title:   "Engagement Letter - Acquisition of Solaris Dynamics Ltd",
  Author:  "Caldwell & Pryce LLP",
  Subject: "Client Engagement Letter",
  Creator: "Caldwell & Pryce LLP",
}});

const stream = createWriteStream(OUT);
doc.pipe(stream);

const PW  = doc.page.width;
const PH  = doc.page.height;
const ML  = 72;
const MR  = 72;
const CW  = PW - ML - MR;

// ─── Letterhead bar ────────────────────────────────────────────────────────
doc.rect(0, 0, PW, 6).fill(RED);

// Firm name
doc.fontSize(17).font("Helvetica-Bold").fillColor(DARK)
   .text("Caldwell & Pryce LLP", ML, 22);

// Tagline
doc.fontSize(8).font("Helvetica").fillColor(LIGHT)
   .text("Solicitors  ·  12 Bishopsgate  ·  London EC2N 4AJ  ·  United Kingdom", ML, 42);
doc.fontSize(8).font("Helvetica").fillColor(LIGHT)
   .text("T: +44 20 7946 0200  ·  billing@caldwellpryce.com  ·  www.caldwellpryce.com", ML, 52);
doc.fontSize(8).font("Helvetica").fillColor(LIGHT)
   .text("Authorised and regulated by the Solicitors Regulation Authority (SRA ID: 654321)  ·  VAT No. GB 823 4471 92", ML, 62);

doc.rect(ML, 76, CW, 0.5).fill(RULE);

// ─── Date & reference ─────────────────────────────────────────────────────
let y = 88;

doc.fontSize(9).font("Helvetica").fillColor(MID)
   .text("15 November 2025", ML, y);
y += 18;

// ─── Addressee ────────────────────────────────────────────────────────────
doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK)
   .text("Acme Industrial Group plc", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(MID)
   .text("FAO: Ms Catherine Holloway, General Counsel", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(MID)
   .text("One Canada Square, Canary Wharf", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(MID)
   .text("London E14 5AB", ML, y);
y += 22;

// ─── Subject line ─────────────────────────────────────────────────────────
doc.fontSize(10).font("Helvetica-Bold").fillColor(DARK)
   .text("ENGAGEMENT LETTER", ML, y);
y += 14;
doc.fontSize(10).font("Helvetica-Bold").fillColor(RED)
   .text("Re:  Acquisition of Solaris Dynamics Ltd -- Matter Ref. CP/ACQ/2026/0148", ML, y);
y += 22;

// ─── Body ─────────────────────────────────────────────────────────────────
function para(text, indent = 0) {
  doc.fontSize(9.5).font("Helvetica").fillColor(DARK)
     .text(text, ML + indent, y, { width: CW - indent, align: "justify", lineGap: 2 });
  y = doc.y + 10;
}

function section(title) {
  y += 4;
  doc.fontSize(9.5).font("Helvetica-Bold").fillColor(DARK)
     .text(title, ML, y);
  y = doc.y + 6;
  doc.rect(ML, y - 3, CW, 0.5).fill(RULE);
  y += 2;
}

function bullet(text) {
  doc.fontSize(9.5).font("Helvetica").fillColor(DARK)
     .text("•  " + text, ML + 10, y, { width: CW - 10, align: "justify", lineGap: 2 });
  y = doc.y + 5;
}

para("Dear Ms Holloway,");

para('We are writing to confirm the terms on which Caldwell & Pryce LLP (the "Firm") has been instructed by Acme Industrial Group plc (the "Client") in connection with the above referenced matter. This engagement letter, together with our Standard Terms of Business enclosed herewith, forms the basis of our relationship and should be read carefully.');

section("1.  SCOPE OF INSTRUCTIONS");

para('You have instructed us to advise and assist with all legal aspects of the proposed acquisition of the entire issued share capital of Solaris Dynamics Ltd (the "Target"), a company incorporated under the laws of England and Wales. Our instructions include:');

bullet("Conducting legal due diligence on the Target and its subsidiaries, including corporate, commercial, employment, property, IP and financial matters;");
bullet("Advising on the structure of the proposed transaction and drafting and negotiating the Share Purchase Agreement and ancillary transaction documents;");
bullet("Advising on competition law implications, including pre-notification to the Competition and Markets Authority (CMA) and, if required, the European Commission;");
bullet("Advising on regulatory approvals and consents required to complete the transaction;");
bullet("Coordinating with local counsel in other relevant jurisdictions as required;");
bullet("Supporting you through exchange of contracts, satisfaction of conditions precedent and completion.");

para("Any material change to the scope of our instructions, or any additional matters, will be agreed in writing before we proceed.");

section("2.  SUPERVISING PARTNER AND TEAM");

para("The supervising partner with overall responsibility for this matter is:");

y += 2;
doc.fontSize(9.5).font("Helvetica-Bold").fillColor(DARK)
   .text("Helena Ashworth, Partner", ML + 14, y);
y = doc.y + 2;
doc.fontSize(9.5).font("Helvetica").fillColor(MID)
   .text("Direct: +44 20 7946 0210  ·  h.ashworth@caldwellpryce.com", ML + 14, y);
y = doc.y + 10;

para("Day-to-day conduct of the matter will be led by James Sinclair (Senior Associate). Additional support will be provided by Eleanor Montague (Associate) and Thomas Whitfield (Legal Trainee) under the supervision of the above. The Firm reserves the right to change the composition of the team and will notify you of any significant changes.");

section("3.  FEES AND HOURLY RATES");

para("Our fees for this matter will be charged on a time-spent basis at the following hourly rates, agreed in accordance with the Panel Terms & Conditions dated 1 October 2025 (the Panel T&C), applicable for the duration of this engagement:");

// Rates table
y += 6;
const tML = ML + 14;
const tW  = CW - 14;
const cols = [180, 80, 80, tW - 340];

function tableHeaderRow(headers) {
  doc.rect(tML, y, tW, 16).fill("#F0F0F0");
  let cx = tML;
  headers.forEach(([label, w, align]) => {
    doc.fontSize(8).font("Helvetica-Bold").fillColor(DARK)
       .text(label, cx + 4, y + 5, { width: w - 8, align: align || "left" });
    cx += w;
  });
  y += 16;
}

function tableRow(cells, alt) {
  if (alt) doc.rect(tML, y, tW, 15).fill("#FAFAFA");
  let cx = tML;
  cells.forEach(([val, w, align, bold]) => {
    doc.fontSize(8.5).font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(DARK)
       .text(val, cx + 4, y + 4, { width: w - 8, align: align || "left" });
    cx += w;
  });
  doc.rect(tML, y + 15, tW, 0.5).fill(RULE);
  y += 15;
}

tableHeaderRow([
  ["Timekeeper / Role", cols[0]],
  ["Currency", cols[1], "center"],
  ["Rate/hour", cols[2], "right"],
  ["Notes", cols[3]],
]);

tableRow([
  ["Helena Ashworth -- Partner",          cols[0]],
  ["EUR", cols[1], "center"],
  ["720.00", cols[2], "right", true],
  ["Supervising partner", cols[3]],
], false);

tableRow([
  ["James Sinclair -- Senior Associate",  cols[0]],
  ["EUR", cols[1], "center"],
  ["580.00", cols[2], "right", true],
  ["Day-to-day conduct", cols[3]],
], true);

tableRow([
  ["Eleanor Montague -- Associate",       cols[0]],
  ["EUR", cols[1], "center"],
  ["445.00", cols[2], "right", true],
  ["2nd year associate", cols[3]],
], false);

tableRow([
  ["Thomas Whitfield -- Legal Trainee",   cols[0]],
  ["EUR", cols[1], "center"],
  ["275.00", cols[2], "right", true],
  ["Under supervision", cols[3]],
], true);

y += 6;
para("These rates are fixed until 30 September 2026 in accordance with the Panel T&C. Any rate changes thereafter will be notified to you in writing with a minimum of 30 days' notice. All fees are exclusive of VAT, which will be applied where applicable under UK law.", 14);

section("4.  BILLING AND PAYMENT");

para("Invoices will be issued monthly, in arrears, covering time recorded to this matter during the preceding calendar month. Each invoice will specify the work performed, the timekeeper who performed it, the time recorded and the applicable hourly rate.");

para("Payment is due within 30 calendar days of the invoice date. Late payments will attract statutory interest at 8% per annum above the Bank of England base rate under the Late Payment of Commercial Debts (Interest) Act 1998. All payments should be made by bank transfer to:");

y += 4;
const piPairs = [
  ["Account name:",  "Caldwell & Pryce LLP Client Account"],
  ["Bank:",          "Barclays Bank plc, 1 Churchill Place, London E14 5HP"],
  ["Sort code:",     "20-32-06"],
  ["Account No.:",   "83471200"],
  ["IBAN:",          "GB82 BARC 2032 0683 4712 00"],
  ["SWIFT/BIC:",     "BARCGB22"],
];
piPairs.forEach(([k, v]) => {
  doc.fontSize(9).font("Helvetica").fillColor(LIGHT)
     .text(k, ML + 14, y, { width: 85, lineBreak: false });
  doc.fontSize(9).font("Helvetica").fillColor(MID)
     .text(v, ML + 99, y, { lineBreak: false });
  y += 13;
});
y += 4;

section("5.  EXPENSES AND DISBURSEMENTS");

para("In addition to our professional fees, we will charge for all reasonable and necessary disbursements and out-of-pocket expenses incurred on your behalf, including but not limited to: court and filing fees, travel and accommodation, specialist searches and external copying charges. The following conditions apply:");

bullet("Travel expenses (rail, air) and accommodation will only be incurred where attendance is necessary and pre-approved by your nominated contact.");
bullet("Expenses for a single trip shall not exceed EUR 1,500 without prior written authorisation from you.");
bullet("All expense items will be documented with receipts and itemised on your invoice.");

section("6.  BILLING GOVERNANCE -- PANEL TERMS SUMMARY");

para("As a panel firm, our billing is subject to the Panel Terms & Conditions agreed between the Firm and Acme Industrial Group plc, dated 1 October 2025. Key provisions relevant to this engagement are summarised below for reference:");

bullet("Maximum chargeable hours per timekeeper per working day: 10 hours. Any hours in excess must be pre-approved in writing by the Client.");
bullet("Meetings and calls: attendance by more than 3 fee earners from the Firm requires prior approval from the supervising partner and the Client. Internal costs of excess attendees will not be billed.");
bullet("'Getting up to speed' time: time spent by any fee earner familiarising themselves with background material on a matter is not chargeable unless agreed otherwise in writing.");
bullet("Rate consistency: the same timekeeper shall be billed at the same agreed rate throughout a matter. Any variation must be agreed in advance in writing.");
bullet("Discounts: volume discount thresholds as set out in the Panel T&C apply to the aggregate of all fees invoiced in any calendar year. Applicable discounts will be applied automatically to each invoice.");

section("7.  CONFLICT OF INTEREST");

para("We have carried out a conflict of interest check and are not aware of any existing or potential conflict of interest that would prevent us from acting for you in this matter. Should any conflict arise during the course of this engagement we will notify you immediately.");

section("8.  CONFIDENTIALITY AND DATA PROTECTION");

para("All information provided to us in the course of this engagement will be treated as strictly confidential and will not be disclosed to third parties save as required by law or as necessary for us to carry out your instructions. We will process personal data in accordance with our Privacy Notice, a copy of which is available on request or on our website.");

section("9.  COMPLAINTS");

para("We are committed to providing a high-quality service. If at any time you are dissatisfied with any aspect of our service, please contact Helena Ashworth in the first instance. If the matter cannot be resolved, our Complaints Partner is James Whitmore, whose contact details are available on request. You also have the right to complain to the Legal Ombudsman (www.legalombudsman.org.uk).");

section("10.  ACCEPTANCE");

para("Please confirm your acceptance of the terms of this engagement by countersigning below and returning a signed copy to us. Alternatively, your continued instructions to us following receipt of this letter will be taken as acceptance of these terms.");

y += 14;

// Signature blocks
const sigW = (CW - 40) / 2;

doc.fontSize(9).font("Helvetica").fillColor(MID)
   .text("Yours sincerely,", ML, y);
y += 32;

doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK)
   .text("Helena Ashworth", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(MID)
   .text("Partner, Caldwell & Pryce LLP", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(LIGHT)
   .text("Signed: ________________________________", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(LIGHT)
   .text("Date:     ________________________________", ML, y);
y += 28;

doc.rect(ML, y, CW, 0.5).fill(RULE);
y += 12;

doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK)
   .text("ACCEPTED on behalf of Acme Industrial Group plc:", ML, y);
y += 20;
doc.fontSize(9).font("Helvetica").fillColor(LIGHT)
   .text("Name:   ________________________________", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(LIGHT)
   .text("Title:    ________________________________", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(LIGHT)
   .text("Signed: ________________________________", ML, y);
y += 13;
doc.fontSize(9).font("Helvetica").fillColor(LIGHT)
   .text("Date:     ________________________________", ML, y);
y += 20;

// ─── Footer ───────────────────────────────────────────────────────────────
const footY = PH - 45;
doc.rect(0, footY - 4, PW, 0.5).fill(RULE);
doc.fontSize(6.5).font("Helvetica").fillColor(LIGHT)
   .text(
     "Caldwell & Pryce LLP is a limited liability partnership registered in England and Wales (OC412988). " +
     "Authorised and regulated by the Solicitors Regulation Authority (SRA ID: 654321). Registered for VAT: GB 823 4471 92. " +
     "A list of members is available for inspection at our registered office.",
     ML, footY, { width: CW - 50 }
   );
doc.fontSize(7).font("Helvetica-Bold").fillColor(RED)
   .text("PRIVATE & CONFIDENTIAL", PW - MR - 105, footY + 3, { width: 105, align: "right" });

doc.end();
stream.on("finish", () => {
  console.log(`✅  Engagement letter written to: ${OUT}`);
  console.log(`   Key agreed rates (relevant to invoice INV-2026-0148):`);
  console.log(`   Partner (H. Ashworth):          EUR 720/h  →  invoice bills EUR 820-850 [RATE_EXCESS]`);
  console.log(`   Senior Associate (J. Sinclair):  EUR 580/h  →  invoice bills EUR 650     [RATE_EXCESS]`);
  console.log(`   Associate (E. Montague):         EUR 445/h  →  invoice bills EUR 445     [OK]`);
  console.log(`   Legal Trainee (T. Whitfield):    EUR 275/h  →  invoice bills EUR 275     [OK]`);
});
