import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existing.length > 0) {
    logger.info("Database already seeded — skipping.");
    return;
  }

  logger.info("Empty database detected — running seed...");

  await db.transaction(async (tx) => {
    /* ── 1. USERS ─────────────────────────────────────────────────────── */
    await tx.execute(sql`
      INSERT INTO users (id, display_name, email, password_hash, role, is_active, created_at, updated_at)
      OVERRIDING SYSTEM VALUE VALUES
      (1, 'Nicolas Panigutti', 'admin@company.com',
       '$2b$12$hdzdEBOHkl.7CB.Ev6Ay.eLeIeU.UP8ysmM3f3cAsZs8hWK.XGNHW', 'super_admin', true,
       NOW(), NOW()),
      (2, 'Daniel Whitfield', 'daniel.whitfield@arcturusgroup.com',
       '$2b$12$K9WTAoyCDPuk/Ad4oJwx/ugWlVFsQGMq50MzIoorvwOVCtMudRABG', 'legal_ops', true,
       NOW(), NOW()),
      (3, 'Sophie Cartwright', 'sophie.cartwright@arcturusgroup.com',
       '$2b$12$K9WTAoyCDPuk/Ad4oJwx/ugWlVFsQGMq50MzIoorvwOVCtMudRABG', 'internal_lawyer', true,
       NOW(), NOW()),
      (4, 'Test Legal Ops', 'test.legalops@example.com',
       '$2b$12$K9WTAoyCDPuk/Ad4oJwx/ugWlVFsQGMq50MzIoorvwOVCtMudRABG', 'legal_ops', false,
       NOW(), NOW())
    `);
    await tx.execute(sql`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))`);

    /* ── 2. LAW FIRMS ─────────────────────────────────────────────────── */
    await tx.execute(sql`
      INSERT INTO law_firms (id, name, firm_type, jurisdictions_json, practice_areas_json,
        contact_name, contact_email, contact_phone, relationship_partner, notes, is_active, created_at, updated_at)
      OVERRIDING SYSTEM VALUE VALUES
      (1, 'Caldwell & Pryce LLP', 'panel',
       '["England & Wales"]', '["M&A"]',
       'Jonathan Caldwell', 'j.caldwell@caldwell.com', NULL, 'Juan Gutierrez',
       'Panel Law Firm appointed by Arcturus Financial Group S.A. under Terms of Engagement effective 1 October 2025, governed by the laws of England and Wales. The agreement includes volume discounts and added value proposals (secondee placements, free routine advice hours, quarterly regulatory updates, and an annual compliance seminar).',
       true, NOW(), NOW()),
      (2, 'Mercer Voss & Partners, Partnerschaftsgesellschaft mbB', 'panel',
       '["Germany", "England and Wales"]', '["Litigation & Dispute Resolution", "Real Estate"]',
       'Dr. Katharina Mercer', NULL, NULL, 'Michael Fraser',
       'Panel law firm engaged by Arcturus Financial Group S.A. to provide legal services across all practice areas from 1 October 2025; governed by the laws of England and Wales, with services rendered from the Frankfurt, Germany office.',
       true, NOW(), NOW()),
      (3, 'Tanaka Osei & Associates', 'panel',
       '["Japan", "England and Wales"]', '["Banking & Finance", "Intellectual Property"]',
       'H. Tanaka', NULL, NULL, 'Victoria Pence',
       'Engaged by Arcturus Financial Group S.A. to provide legal services in Japan and other Asian jurisdictions from 1 October 2025. Managing Partner H. Tanaka signed the agreement; added value includes one free secondee per year (Tokyo or London) and an annual Japan regulatory update.',
       true, NOW(), NOW()),
      (4, 'Reyes Montoya Abogados S.L.P.', 'non_panel',
       '["Spain (Madrid)", "España"]', '["Mergers & Acquisitions", "Corporate Finance", "Regulatory & Compliance"]',
       'Isabel Reyes', NULL, NULL, NULL,
       'Engagement/terms of engagement for legal services governed by Spanish law with non-exclusive jurisdiction of the courts of Madrid; includes capped hourly rates, volume discounts, and value-added items (one free secondee per year, 15 free hours annually, quarterly regulatory alerts).',
       true, NOW(), NOW()),
      (5, 'Hargreaves & Sutton LLP', 'panel',
       '["England & Wales"]', '["Mergers & Acquisitions", "Corporate Finance", "Regulatory & Compliance"]',
       'Eleanor Hargreaves', 'e.hargreaves@hargreaves-sutton.co.uk', '+44 20 7831 4400', 'Sarah Chen',
       NULL, true, NOW(), NOW()),
      (7, 'Quinn Abernethy LLP', 'panel',
       '["England & Wales"]', '["Intellectual Property", "Litigation & Dispute Resolution", "Regulatory & Compliance"]',
       'M. Quinn', 'billing@quinnabernethy.co.uk', '+44 20 7264 5800', 'Victoria Pence',
       'Engagement letter appointing the firm to Acme Industrial Group plc''s preferred legal services panel effective 1 January 2026. Firm is regulated by the Solicitors Regulation Authority (SRA No. 744821) and registered in England & Wales (OC501847).',
       true, NOW(), NOW()),
      (9, 'Beaumont Leclerc & Associés S.A.S.', 'panel',
       '["France", "England & Wales", "Germany", "Netherlands", "Spain"]',
       '["Mergers & Acquisitions", "Regulatory & Compliance", "Employment & Labor", "Litigation & Dispute Resolution", "Real Estate"]',
       'Maître Élodie Beaumont', NULL, NULL, 'Catherine Lawton',
       'Panel engagement letter governed by French law for the period 15 January 2026 to 31 December 2027; primary firm contact is Maître Élodie Beaumont (Managing Partner). The document also lists pre-approved best-friend firms for cross-border matters in Germany, the Netherlands, and Spain.',
       true, NOW(), NOW())
    `);
    await tx.execute(sql`SELECT setval('law_firms_id_seq', (SELECT MAX(id) FROM law_firms))`);

    /* ── 3. PANEL BASELINE DOCUMENTS ──────────────────────────────────── */
    await tx.execute(sql`
      INSERT INTO panel_baseline_documents (id, document_kind, version_label, file_name, storage_path,
        raw_text, extracted_json, verification_status, uploaded_by_id, verified_by_id, created_at, activated_at)
      OVERRIDING SYSTEM VALUE VALUES
      (1, 'rates', 'Panel Rates v1', 'RATES-001_Global_Panel_Rates_v1.pdf', NULL,
       NULL, NULL, 'draft', 1, 1, NOW(), NULL),
      (2, 'terms_conditions', 'T&C — Tanaka Osei & Associates', 'TC-003_Tanaka_Osei_Associates.docx', NULL,
       NULL, NULL, 'verified', 1, 2, NOW(), NULL),
      (3, 'terms_conditions', 'T&C — Reyes Montoya Abogados S.L.P.', 'TC-004_Reyes_Montoya_Abogados.docx', NULL,
       NULL, NULL, 'draft', 1, 3, NOW(), NULL),
      (4, 'rates', 'H&S Panel Rates v1', 'RATES-002_Hargreaves_Sutton_Panel_Rates_v1.pdf', NULL,
       NULL, NULL, 'draft', 1, 1, NOW(), NULL),
      (5, 'terms_conditions', 'T&C — Quinn Abernethy LLP', 'T&C - Quinn.pdf', NULL,
       NULL, NULL, 'draft', 1, 4, NOW(), NULL),
      (6, 'terms_conditions', 'T&C — Quinn Abernethy LLP', 'T&C - Quinn.pdf', NULL,
       NULL, NULL, 'draft', 1, 5, NOW(), NULL),
      (8, 'terms_conditions', 'T&C — Beaumont Leclerc & Associés S.A.S.', 'T&C - Beaumont.pdf', NULL,
       NULL, NULL, 'draft', 1, 6, NOW(), NULL)
    `);
    await tx.execute(sql`SELECT setval('panel_baseline_documents_id_seq', (SELECT MAX(id) FROM panel_baseline_documents))`);

    /* ── 4. PANEL RATES (52 rows) ─────────────────────────────────────── */
    await tx.execute(sql`
      INSERT INTO panel_rates (id, baseline_document_id, law_firm_name, best_friend_name,
        jurisdiction, role_code, role_label, currency, max_rate, valid_from, valid_to)
      OVERRIDING SYSTEM VALUE VALUES
      -- Caldwell & Pryce (doc 1, England & Wales, EUR)
      (1, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','LegalTrainee','Legal Trainee','EUR',275.00,'2025-10-01',NULL),
      (2, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','Paralegal','Paralegal','EUR',310.00,'2025-10-01',NULL),
      (3, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','Associate1stYear','Associate 1st year','EUR',415.00,'2025-10-01',NULL),
      (4, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','Associate2ndYear','Associate 2nd year','EUR',445.00,'2025-10-01',NULL),
      (5, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','Associate3rdYear','Associate 3rd year','EUR',480.00,'2025-10-01',NULL),
      (6, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','Associate4thYear','Associate 4th year','EUR',510.00,'2025-10-01',NULL),
      (7, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','Associate5thYear','Associate 5th year','EUR',545.00,'2025-10-01',NULL),
      (8, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','SeniorAssociate','Senior Associate','EUR',580.00,'2025-10-01',NULL),
      (9, 1,'Caldwell & Pryce LLP',NULL,'England & Wales','Counsel','Counsel','EUR',640.00,'2025-10-01',NULL),
      (10,1,'Caldwell & Pryce LLP',NULL,'England & Wales','Partner','Partner','EUR',720.00,'2025-10-01',NULL),
      (11,1,'Caldwell & Pryce LLP',NULL,'England & Wales','SeniorPartner','Senior Partner','EUR',790.00,'2025-10-01',NULL),
      -- Mercer Voss (doc 1, Germany Frankfurt, EUR)
      (12,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','LegalTrainee','Legal Trainee','EUR',280.00,'2025-10-01',NULL),
      (13,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','Paralegal','Paralegal','EUR',320.00,'2025-10-01',NULL),
      (14,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','Associate1stYear','Associate 1st year','EUR',420.00,'2025-10-01',NULL),
      (15,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','Associate2ndYear','Associate 2nd year','EUR',455.00,'2025-10-01',NULL),
      (16,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','Associate3rdYear','Associate 3rd year','EUR',490.00,'2025-10-01',NULL),
      (17,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','Associate4thYear','Associate 4th year','EUR',520.00,'2025-10-01',NULL),
      (18,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','SeniorAssociate','Senior Associate','EUR',560.00,'2025-10-01',NULL),
      (19,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','Counsel','Counsel','EUR',630.00,'2025-10-01',NULL),
      (20,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','Partner','Partner','EUR',750.00,'2025-10-01',NULL),
      (21,1,'Mercer Voss & Partners',NULL,'Germany (Frankfurt)','SeniorPartner','Senior Partner','EUR',820.00,'2025-10-01',NULL),
      -- Tanaka Osei (doc 1, Japan Tokyo, EUR)
      (22,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','LegalTrainee','Legal Trainee','EUR',280.00,'2025-10-01',NULL),
      (23,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','Paralegal','Paralegal','EUR',315.00,'2025-10-01',NULL),
      (24,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','Associate1stYear','Associate 1st year','EUR',420.00,'2025-10-01',NULL),
      (25,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','Associate2ndYear','Associate 2nd year','EUR',455.00,'2025-10-01',NULL),
      (26,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','Associate3rdYear','Associate 3rd year','EUR',490.00,'2025-10-01',NULL),
      (27,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','Associate4thYear','Associate 4th year','EUR',525.00,'2025-10-01',NULL),
      (28,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','SeniorAssociate','Senior Associate','EUR',570.00,'2025-10-01',NULL),
      (29,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','Counsel','Counsel','EUR',640.00,'2025-10-01',NULL),
      (30,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','Partner','Partner','EUR',820.00,'2025-10-01',NULL),
      (31,1,'Tanaka Osei & Associates',NULL,'Japan (Tokyo)','SeniorPartner','Senior Partner','EUR',900.00,'2025-10-01',NULL),
      -- Reyes Montoya (doc 1, Spain Madrid, EUR)
      (32,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','LegalTrainee','Legal Trainee','EUR',260.00,'2025-10-01',NULL),
      (33,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','Paralegal','Paralegal','EUR',300.00,'2025-10-01',NULL),
      (34,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','Associate1stYear','Associate 1st year','EUR',400.00,'2025-10-01',NULL),
      (35,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','Associate2ndYear','Associate 2nd year','EUR',430.00,'2025-10-01',NULL),
      (36,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','Associate3rdYear','Associate 3rd year','EUR',465.00,'2025-10-01',NULL),
      (37,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','Associate4thYear','Associate 4th year','EUR',500.00,'2025-10-01',NULL),
      (38,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','SeniorAssociate','Senior Associate','EUR',545.00,'2025-10-01',NULL),
      (39,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','Counsel','Counsel','EUR',610.00,'2025-10-01',NULL),
      (40,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','Partner','Partner','EUR',700.00,'2025-10-01',NULL),
      (41,1,'Reyes Montoya Abogados',NULL,'Spain (Madrid)','SeniorPartner','Senior Partner','EUR',760.00,'2025-10-01',NULL),
      -- Hargreaves & Sutton (doc 4, England & Wales, GBP)
      (42,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','LegalTrainee','Legal Trainee','GBP',240.00,'2026-03-01',NULL),
      (43,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','Paralegal','Paralegal','GBP',290.00,'2026-03-01',NULL),
      (44,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','Associate1stYear','Associate 1st Year','GBP',380.00,'2026-03-01',NULL),
      (45,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','Associate2ndYear','Associate 2nd Year','GBP',410.00,'2026-03-01',NULL),
      (46,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','Associate3rdYear','Associate 3rd Year','GBP',440.00,'2026-03-01',NULL),
      (47,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','Associate4thYear','Associate 4th Year','GBP',470.00,'2026-03-01',NULL),
      (48,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','Associate5thYear','Associate 5th Year','GBP',500.00,'2026-03-01',NULL),
      (49,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','SeniorAssociate','Senior Associate','GBP',545.00,'2026-03-01',NULL),
      (50,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','Counsel','Counsel','GBP',610.00,'2026-03-01',NULL),
      (51,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','Partner','Partner','GBP',680.00,'2026-03-01',NULL),
      (52,4,'Hargreaves & Sutton LLP',NULL,'England & Wales','SeniorPartner','Senior Partner','GBP',760.00,'2026-03-01',NULL)
    `);
    await tx.execute(sql`SELECT setval('panel_rates_id_seq', (SELECT MAX(id) FROM panel_rates))`);

    /* ── 5. INVOICES ─────────────────────────────────────────────────── */
    await tx.execute(sql`
      INSERT INTO invoices (id, law_firm_id, document_type, invoice_number, invoice_date, due_date,
        currency, subtotal_amount, tax_amount, total_amount, billing_type, matter_name,
        project_reference, jurisdiction, invoice_status, review_outcome, amount_at_risk,
        created_at, updated_at)
      OVERRIDING SYSTEM VALUE VALUES
      (1,  1,'invoice','INV-2026-001','2026-01-08',NULL,'GBP',41850.00,7503.00,49353.00,'time_and_materials','M&A Transaction Support','MAT-2026-001','England & Wales','pending',NULL,0.00,NOW(),NOW()),
      (2,  5,'invoice','INV-2026-002','2026-01-14',NULL,'EUR',27100.00,4882.00,31982.00,'time_and_materials','Employment Tribunal Preparation','MAT-2026-002','England & Wales','pending',NULL,0.00,NOW(),NOW()),
      (3,  2,'invoice','INV-2026-003','2026-01-20',NULL,'EUR',63200.00,11376.00,74576.00,'time_and_materials','Regulatory Compliance Advisory','MAT-2026-003','Germany','pending',NULL,0.00,NOW(),NOW()),
      (4,  4,'invoice','INV-2026-004','2026-01-22',NULL,'EUR',18700.00,3366.00,22066.00,'time_and_materials','Commercial Contract Negotiation','MAT-2026-004','Spain','pending',NULL,0.00,NOW(),NOW()),
      (5,  3,'invoice','INV-2026-005','2026-01-28',NULL,'GBP',30800.00,5544.00,36344.00,'time_and_materials','IP Infringement Investigation','MAT-2026-005','England & Wales','pending',NULL,0.00,NOW(),NOW()),
      (6,  1,'invoice','INV-2026-006','2026-02-03',NULL,'GBP',53400.00,9612.00,63012.00,'time_and_materials','Acquisition Due Diligence','MAT-2026-006','England & Wales','in_review',NULL,1680.00,NOW(),NOW()),
      (7,  5,'invoice','INV-2026-007','2026-02-10',NULL,'EUR',39100.00,7038.00,46138.00,'time_and_materials','Employment Restructuring Advisory','MAT-2026-007','England & Wales','disputed','fully_rejected',0.00,NOW(),NOW()),
      (8,  2,'invoice','INV-2026-008','2026-02-14',NULL,'EUR',83800.00,15084.00,98884.00,'time_and_materials','Data Protection Compliance Programme','MAT-2026-008','Germany','escalated',NULL,2760.00,NOW(),NOW()),
      (9,  1,'invoice','INV-2026-009','2026-02-18',NULL,'GBP',71400.00,12852.00,84252.00,'time_and_materials','Competition Law Investigation','MAT-2026-009','England & Wales','escalated',NULL,3190.00,NOW(),NOW()),
      (10, 3,'invoice','INV-2026-010','2026-02-05',NULL,'GBP',19800.00,3564.00,23364.00,'time_and_materials','Trademark Portfolio Review','MAT-2026-010','England & Wales','accepted',NULL,0.00,NOW(),NOW()),
      (11, 4,'invoice','INV-2026-011','2026-02-07',NULL,'EUR',14500.00,2610.00,17110.00,'fixed_scope','Commercial Contract Review Package','MAT-2026-011','Spain','accepted',NULL,0.00,NOW(),NOW()),
      (12, 5,'invoice','INV-2026-012','2026-02-20',NULL,'EUR',32400.00,5832.00,38232.00,'time_and_materials','Employment Settlement Negotiation','MAT-2026-012','England & Wales','accepted',NULL,0.00,NOW(),NOW()),
      (13, 1,'invoice','INV-2026-013','2026-01-15',NULL,'GBP',86500.00,15570.00,102070.00,'time_and_materials','Cross-Border M&A — Phase 2 Closing','MAT-2026-013','England & Wales','disputed',NULL,0.00,NOW(),NOW()),
      (14, 2,'invoice','INV-2026-014','2026-01-18',NULL,'EUR',66800.00,12024.00,78824.00,'time_and_materials','EU Antitrust Investigation Support','MAT-2026-014','Germany','disputed',NULL,0.00,NOW(),NOW()),
      (15, 5,'invoice','INV-2026-015','2026-01-25',NULL,'EUR',44700.00,8046.00,52746.00,'time_and_materials','Commercial Real Estate Acquisition','MAT-2026-015','England & Wales','disputed',NULL,0.00,NOW(),NOW()),
      (16, 4,'invoice','INV-2026-016','2026-02-01',NULL,'EUR',35900.00,6462.00,42362.00,'time_and_materials','IP Licensing Negotiation','MAT-2026-016','Spain','disputed',NULL,0.00,NOW(),NOW()),
      (17, 3,'invoice','INV-2026-017','2026-02-08',NULL,'GBP',57300.00,10314.00,67614.00,'time_and_materials','Construction Dispute — Quantum Phase','MAT-2026-017','England & Wales','disputed',NULL,0.00,NOW(),NOW()),
      (19, 7,'invoice','INV-000015','2026-03-31',NULL,'GBP',13625.00,2725.00,16350.00,'time_and_materials',
       'IP Portfolio Management — AURORA Brand & Trademark Renewals','Legal/2026/IP-112','England & Wales','accepted','accepted_with_comments',0.00,NOW(),NOW())
    `);
    await tx.execute(sql`SELECT setval('invoices_id_seq', (SELECT MAX(id) FROM invoices))`);

    /* ── 6. INVOICE ITEMS ─────────────────────────────────────────────── */
    await tx.execute(sql`
      INSERT INTO invoice_items (invoice_id, line_no, timekeeper_label, role_raw, role_normalized,
        work_date, hours, rate_charged, amount, description, is_expense_line, expense_type)
      VALUES
      -- Invoice 6 (Acquisition Due Diligence)
      (6,1,'J. Thornton','Senior Associate','senior_associate','2026-02-03',8.00,620.00,4960.00,'Due diligence review — Share Purchase Agreement',false,NULL),
      (6,2,'S. Webb','Trainee Solicitor','trainee','2026-02-03',8.00,280.00,2240.00,'Data room document review',false,NULL),
      (6,3,'S. Webb','Trainee Solicitor','trainee','2026-02-04',8.00,280.00,2240.00,'Data room document review (continued)',false,NULL),
      (6,4,'M. Davies','Partner','partner','2026-02-03',6.50,850.00,5525.00,'Client calls and SPA negotiation strategy',false,NULL),
      (6,5,'C. Singh','Senior Associate','senior_associate','2026-02-04',7.00,550.00,3850.00,'Regulatory filing preparation',false,NULL),
      -- Invoice 7 (Employment Restructuring Advisory)
      (7,1,'H. Parker','Partner','partner','2026-02-10',4.00,780.00,3120.00,'Consultation — restructuring strategy and redundancy terms',false,NULL),
      (7,2,'T. Wright','Associate','associate','2026-02-10',6.00,420.00,2520.00,'Drafting settlement agreements',false,NULL),
      (7,3,'T. Wright','Associate','associate','2026-02-11',5.50,420.00,2310.00,'Employee consultation documentation',false,NULL),
      (7,4,NULL,NULL,NULL,'2026-02-10',NULL,NULL,1380.00,'Courier charges — document delivery to Employment Tribunal (incl. markup)',true,NULL),
      (7,5,NULL,NULL,NULL,'2026-02-11',NULL,NULL,220.00,'Internal team coordination — Restructuring Matter',true,NULL),
      -- Invoice 8 (Data Protection Compliance Programme)
      (8,1,'Dr. K. Weber','Partner','partner','2026-02-14',12.00,980.00,11760.00,'GDPR compliance gap analysis and remediation roadmap',false,NULL),
      (8,2,'A. Schmidt','Senior Associate','senior_associate','2026-02-14',6.00,520.00,3120.00,'Data mapping and processing register review',false,NULL),
      (8,3,'T. Müller','Associate','associate','2026-02-14',6.00,320.00,1920.00,'Privacy notice drafting and review',false,NULL),
      (8,4,'A. Schmidt','Senior Associate','senior_associate','2026-02-15',7.50,520.00,3900.00,'Supervisory authority filing preparation',false,NULL),
      (8,5,'T. Müller','Associate','associate','2026-02-15',5.00,320.00,1600.00,'Controller-processor agreement templates',false,NULL),
      -- Invoice 9 (Competition Law Investigation)
      (9,1,'C. Evans','Senior Associate','senior_associate','2026-02-18',14.00,580.00,8120.00,'Competition authority investigation response — document review',false,NULL),
      (9,2,'R. Hughes','Partner','partner','2026-02-18',5.00,900.00,4500.00,'Strategy call with client and submission drafting',false,NULL),
      (9,3,'C. Evans','Senior Associate','senior_associate','2026-02-19',6.00,580.00,3480.00,'Follow-up document analysis',false,NULL),
      (9,4,'C. Evans','Senior Associate','senior_associate','2026-02-19',1.00,580.00,580.00,'Short call with client (15 min) — charged at 1h minimum',false,NULL),
      (9,5,'C. Evans','Senior Associate','senior_associate','2026-02-19',1.00,580.00,580.00,'Short call with counsel (12 min) — charged at 1h minimum',false,NULL),
      -- Invoice 10 (Trademark Portfolio Review)
      (10,1,'K. Tanaka','Associate','associate','2026-02-05',4.00,380.00,1520.00,'Trademark search — Classes 9, 35, 42',false,NULL),
      (10,2,'K. Tanaka','Associate','associate','2026-02-06',4.00,380.00,1520.00,'Trademark search — remaining classes and conflict report',false,NULL),
      (10,3,'D. Osei','Senior Associate','senior_associate','2026-02-06',5.50,520.00,2860.00,'Review of search results and filing strategy memo',false,NULL),
      -- Invoice 11 (Commercial Contract Review Package)
      (11,1,NULL,NULL,NULL,'2026-02-07',NULL,NULL,14500.00,'Fixed-scope contract review — commercial agency agreement (as per engagement letter)',false,NULL),
      -- Invoice 12 (Employment Settlement Negotiation)
      (12,1,'P. Hargreaves','Partner','partner','2026-02-20',6.00,820.00,4920.00,'Settlement negotiation — attendance at mediation',false,NULL),
      (12,2,'B. Morrison','Associate','associate','2026-02-20',8.00,440.00,3520.00,'Drafting settlement agreement and schedule of loss',false,NULL),
      (12,3,'B. Morrison','Associate','associate','2026-02-21',5.00,440.00,2200.00,'Finalising compromise agreement — all parties',false,NULL),
      (12,4,NULL,NULL,NULL,'2026-02-20',NULL,NULL,198.00,'Employment Tribunal filing fees (incl. 5% admin charge)',true,NULL),
      -- Invoice 13 (Cross-Border M&A — Phase 2 Closing)
      (13,1,'Sir R. Caldwell','Senior Partner','partner','2026-01-15',12.00,1100.00,13200.00,'M&A transaction management — completion board meetings',false,NULL),
      (13,2,'J. Thornton','Senior Associate','senior_associate','2026-01-15',9.00,550.00,4950.00,'Conditions precedent checklist and completion mechanics',false,NULL),
      (13,3,'M. Davies','Partner','partner','2026-01-16',7.50,850.00,6375.00,'Regulatory clearance strategy — CMA submission',false,NULL),
      (13,4,'L. Foster','Trainee Solicitor','trainee','2026-01-15',8.00,280.00,2240.00,'Bible preparation and execution copies',false,NULL),
      (13,5,NULL,NULL,NULL,'2026-01-15',NULL,NULL,1200.00,'Document management software licence — billed to matter',true,NULL),
      -- Invoice 14 (EU Antitrust Investigation Support)
      (14,1,'Prof. H. Braun','Partner','partner','2026-01-18',13.50,780.00,10530.00,'Antitrust investigation defence — document production',false,NULL),
      (14,2,'A. Schmidt','Senior Associate','senior_associate','2026-01-18',6.00,520.00,3120.00,'Economic analysis — market share evidence',false,NULL),
      (14,3,'T. Müller','Associate','associate','2026-01-18',5.00,320.00,1600.00,'Privilege review — investigative documents',false,NULL),
      (14,4,'C. Fischer','Associate','associate','2026-01-18',1.00,320.00,320.00,'Meeting attendance — all day strategy session (shared billing)',false,NULL),
      (14,5,'R. Klein','Trainee','trainee','2026-01-18',1.00,220.00,220.00,'Meeting attendance — all day strategy session (shared billing)',false,NULL),
      -- Invoice 15 (Commercial Real Estate Acquisition)
      (15,1,'N. Sutton','Partner','partner','2026-01-25',5.50,820.00,4510.00,'Title investigation and report on title',false,NULL),
      (15,2,'A. Patel','Associate','associate','2026-01-25',7.00,440.00,3080.00,'Searches, enquiries and SDLT analysis',false,NULL),
      (15,3,'A. Patel','Associate','associate','2026-01-26',6.50,440.00,2860.00,'Completion — finance and registration documents',false,NULL),
      (15,4,NULL,NULL,NULL,'2026-01-25',NULL,NULL,800.00,'Independent surveyor report (25% handling surcharge applied)',true,NULL),
      (15,5,NULL,NULL,NULL,'2026-01-26',NULL,NULL,450.00,'Internal coordination meeting — Hargreaves Real Estate team',true,NULL),
      -- Invoice 16 (IP Licensing Negotiation)
      (16,1,'C. Reyes','Partner','partner','2026-02-01',4.00,450.00,1800.00,'IP licensing strategy and term sheet review',false,NULL),
      (16,2,'E. García','Junior Solicitor','associate','2026-02-01',8.00,380.00,3040.00,'Licence agreement drafting — exclusivity and royalty terms',false,NULL),
      (16,3,'E. García','Junior Solicitor','associate','2026-02-02',6.00,380.00,2280.00,'Negotiation preparation and counterparty review',false,NULL),
      (16,4,NULL,NULL,NULL,'2026-02-01',NULL,NULL,4800.00,'Travel — business class flights Madrid–London–Madrid (client meeting)',true,NULL),
      -- Invoice 17 (Construction Dispute — Quantum Phase)
      (17,1,'D. Osei','Senior Associate','senior_associate','2026-02-08',7.50,520.00,3900.00,'Quantum assessment — contractor delay claims',false,NULL),
      (17,2,'M. Adeyemi','Paralegal','paralegal','2026-02-08',8.00,280.00,2240.00,'Document review — site records and progress reports',false,NULL),
      (17,3,'M. Adeyemi','Paralegal','paralegal','2026-02-09',8.00,280.00,2240.00,'Document review (continued)',false,NULL),
      (17,4,'M. Adeyemi','Paralegal','paralegal','2026-02-10',8.00,280.00,2240.00,'Chronology preparation',false,NULL),
      (17,5,'K. Tanaka','Associate','associate','2026-02-08',6.00,380.00,2280.00,'Expert witness briefing and quantum report review',false,NULL),
      -- Invoice 19 (Quinn — IP Portfolio Management)
      (19,1,'M. Quinn','Partner','Partner','2026-03-03',2.00,700.00,1400.00,'Strategic review of client''s UK and EU trademark portfolio; advice on renewal priorities and conflicting third-party applications filed Q1 2026.',false,NULL),
      (19,2,'S. Lim','Senior Associate','Senior Associate','2026-03-04',3.50,530.00,1855.00,'Detailed review of 12 UK trademark registrations in Classes 9, 35 and 42; preparation of renewal schedule and conflict search instructions.',false,NULL),
      (19,3,'C. Abernethy','Associate','Associate','2026-03-05',4.00,430.00,1720.00,'Conflict searches across UKIPO and EUIPO databases for new brand AURORA; preparation of clearance opinion memorandum.',false,NULL),
      (19,4,'S. Lim','Senior Associate','Senior Associate','2026-03-06',3.00,530.00,1590.00,'Drafting of trademark watch service brief; preparation of EUIPO renewal instructions for EU trademark No. 017 843 291.',false,NULL),
      (19,5,'R. Patel','Paralegal','Paralegal','2026-03-07',2.50,270.00,675.00,'Filing of UKIPO renewal applications for 7 trademarks; preparation of filing receipts and docket update.',false,NULL),
      (19,6,'M. Quinn','Partner','Partner','2026-03-10',1.50,700.00,1050.00,'Client call with IP Director re: AURORA brand strategy and territorial expansion plans in APAC; advice on filing strategy under Madrid Protocol.',false,NULL),
      (19,7,'C. Abernethy','Associate','Associate','2026-03-11',3.50,430.00,1505.00,'Preparation of Madrid Protocol application package for AURORA mark; country selection analysis for Japan, Australia and Singapore filings.',false,NULL),
      (19,8,'S. Lim','Senior Associate','Senior Associate','2026-03-12',2.50,530.00,1325.00,'Review of Madrid Protocol application draft; analysis of local requirements for Japan (JPO) and Singapore (IPOS) designations.',false,NULL),
      (19,9,'R. Patel','Paralegal','Paralegal','2026-03-13',2.00,270.00,540.00,'Preparation and filing of WIPO MM2 form for international trademark application; fee calculation and docket entry.',false,NULL),
      (19,10,'M. Quinn','Partner','Partner','2026-03-17',1.00,700.00,700.00,'Review of AURORA international application; sign-off on country designations; final advice to client on monitoring strategy post-filing.',false,NULL),
      (19,11,'C. Abernethy','Associate','Associate','2026-03-18',2.00,430.00,860.00,'Preparation of IP portfolio management report for Q1 2026; update of trademark register and docket for all active matters.',false,NULL),
      (19,12,'R. Patel','Paralegal','Paralegal','2026-03-19',1.50,270.00,405.00,'Updating client IP database; filing correspondence and WIPO acknowledgement letters; preparation of Q2 renewal reminder schedule.',false,NULL)
    `);

    /* ── 7. INVOICE DOCUMENT (Quinn PDF — lives in shared object storage) */
    await tx.execute(sql`
      INSERT INTO invoice_documents (invoice_id, document_kind, file_name, mime_type, storage_path, extraction_status)
      VALUES (19, 'invoice_file', 'Invoice Quinn.pdf', 'application/pdf',
              '/objects/uploads/77811b73-7ecb-437c-bf86-3a95ed0a6ffa', 'done')
    `);

    /* ── 8. Reset invoice_number_seq (next free invoice number) ───────── */
    await tx.execute(sql`SELECT setval('invoice_number_seq', 22)`);
  });

  logger.info("Seed complete.");
}
