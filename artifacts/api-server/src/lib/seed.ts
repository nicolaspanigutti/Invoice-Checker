import { analysisRunsTable, db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);

  if (existing.length > 0) {
    /* Users already exist — check if analysis runs are also present.
       If not, this is a DB that was seeded before section 8 (analysis runs)
       was added; backfill only those sections now. */
    const existingRuns = await db
      .select({ id: analysisRunsTable.id })
      .from(analysisRunsTable)
      .limit(1);

    if (existingRuns.length > 0) {
      /* Check whether Beaumont invoices were included in this seed version.
         If not, this is a DB seeded before Beaumont data was added; backfill now. */
      const beaumontCheck = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM invoices WHERE id IN (30, 31)`);
      if (beaumontCheck.rows && (beaumontCheck.rows[0] as { cnt: number }).cnt === 2) {
        logger.info("Database already seeded — skipping.");
        return;
      }

      logger.info("Backfill: inserting Beaumont Leclerc firm, invoices, items, documents, runs and issues...");
      await db.transaction(async (tx) => {
        /* Beaumont Leclerc & Associés S.A.S. — seed id=11, same as dev.
           ON CONFLICT (id) DO NOTHING makes this idempotent. */
        await tx.execute(sql`
          INSERT INTO law_firms (id, name, firm_type, jurisdictions_json, practice_areas_json,
            contact_name, contact_email, contact_phone,
            relationship_partner, notes, is_active, created_at, updated_at)
          OVERRIDING SYSTEM VALUE VALUES
          (11, 'Beaumont Leclerc & Associés S.A.S.', 'panel',
           '["France", "England & Wales", "Germany", "Netherlands", "Spain"]',
           '["Mergers & Acquisitions", "Regulatory & Compliance", "Employment & Labor", "Litigation & Dispute Resolution", "Real Estate"]',
           'Maître Élodie Beaumont', NULL, NULL, 'Sophia Belmont',
           'Panel engagement letter governed by French law for the period 15 January 2026 to 31 December 2027; primary firm contact is Maître Élodie Beaumont (Managing Partner). The document also lists pre-approved best-friend firms for cross-border matters in Germany, the Netherlands, and Spain.',
           true, NOW(), NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await tx.execute(sql`SELECT setval('law_firms_id_seq', (SELECT MAX(id) FROM law_firms))`);

        /* Panel baseline document for Beaumont (id=8) — needed if firm was also absent */
        await tx.execute(sql`
          INSERT INTO panel_baseline_documents (id, document_kind, version_label, file_name, storage_path,
            raw_text, extracted_json, verification_status, uploaded_by_id, verified_by_id, created_at, activated_at)
          OVERRIDING SYSTEM VALUE VALUES
          (8, 'terms_conditions', 'T&C — Beaumont Leclerc & Associés S.A.S.', 'T&C - Beaumont.pdf', NULL,
           NULL, NULL, 'draft', 1, 6, NOW(), NULL)
          ON CONFLICT (id) DO NOTHING
        `);
        await tx.execute(sql`SELECT setval('panel_baseline_documents_id_seq', (SELECT MAX(id) FROM panel_baseline_documents))`);

        /* Invoices 30 and 31 — law_firm_id=11 (Beaumont Leclerc) */
        await tx.execute(sql`
          INSERT INTO invoices (id, law_firm_id, document_type, invoice_number, invoice_date, due_date,
            currency, subtotal_amount, tax_amount, total_amount, billing_type, matter_name,
            project_reference, jurisdiction, invoice_status, review_outcome, amount_at_risk,
            created_at, updated_at)
          OVERRIDING SYSTEM VALUE VALUES
          (30, 11,'invoice','INV-000026','2026-02-28',NULL,'EUR',23110.00,4622.00,27732.00,'time_and_materials',
           'Mise en conformité RGPD — Phase II','LEG/2026/RGPD-02','France','disputed','fully_rejected',0.00,NOW(),NOW()),
          (31, 11,'invoice','INV-000027','2026-03-07',NULL,'EUR',23110.00,4622.00,27732.00,'time_and_materials',
           'Mise en conformité RGPD — Phase III','LEG/2026/RGPD-03','France','disputed','fully_rejected',0.00,NOW(),NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await tx.execute(sql`SELECT setval('invoices_id_seq', (SELECT MAX(id) FROM invoices))`);

        /* Invoice items — explicit IDs 65-92 so issues can reference them */
        await tx.execute(sql`
          INSERT INTO invoice_items (id, invoice_id, line_no, timekeeper_label, role_raw, role_normalized,
            work_date, hours, rate_charged, amount, description, is_expense_line, expense_type)
          OVERRIDING SYSTEM VALUE VALUES
          -- Invoice 30 items (IDs 65-78) — sum = 850+4800+2040+390+1890+2590+2590+425+425+1700+850+1440+1440+1680 = 23,110
          (65,30, 1,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-18', 1.00,850.00, 850.00,'RGPD — réunion stratégique avec le DPO du client',false,NULL),
          (66,30, 2,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-19',10.00,480.00,4800.00,'Cartographie des traitements — analyse des lacunes RGPD (10h billed)',false,NULL),
          (67,30, 3,'C. Garnier', 'Collaborateur Senior','senior_associate', '2026-02-19', 3.00,680.00,2040.00,'Recherche sur les bases légales — art. 6 RGPD (legitimate interests assessment)',false,NULL),
          (68,30, 4,'F. Moreau',  'Collaborateur',       'associate',        '2026-02-20', 1.00,390.00, 390.00,'Préparation du modèle d''analyse des risques',false,NULL),
          (69,30, 5,'C. Garnier', 'Collaborateur Senior','senior_associate', '2026-02-20', 3.00,630.00,1890.00,'Rédaction des clauses types CCT — accord responsable-sous-traitant',false,NULL),
          (70,30, 6,'A. Marchand','Collaborateur Junior', 'associate',        '2026-02-21', 7.00,370.00,2590.00,'Documentation procédure DSA — réponse aux demandes de droits (Phase 1)',false,NULL),
          (71,30, 7,'A. Marchand','Collaborateur Junior', 'associate',        '2026-02-21', 7.00,370.00,2590.00,'Documentation procédure DSA — réponse aux demandes de droits (Phase 1)',false,NULL),
          (72,30, 8,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-22', 0.50,850.00, 425.00,'Revue de l''analyse des lacunes et note d''information au DPO',false,NULL),
          (73,30, 9,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-22', 0.50,850.00, 425.00,'Impression et classement des documents de cartographie (50 pages)',false,NULL),
          (74,30,10,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-24', 2.00,850.00,1700.00,'Coordination interne — réunion équipe projet RGPD',false,NULL),
          (75,30,11,'F. Moreau',  'Collaborateur',       'associate',        '2026-02-24', 2.00,390.00, 850.00,'Population du modèle d''analyse des risques — registre des traitements',false,NULL),
          (76,30,12,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-25', 3.00,480.00,1440.00,'Rédaction de la politique de surveillance et monitoring des salariés',false,NULL),
          (77,30,13,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-25', 3.00,480.00,1440.00,'Revue juridique des mentions RGPD dans les actes RH',false,NULL),
          (78,30,14,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-26', 3.50,480.00,1680.00,'Revue du tableau de conservation et politique de suppression',false,NULL),
          -- Invoice 31 items (IDs 79-92) — identical structure, same sum = 23,110
          (79,31, 1,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-18', 1.00,850.00, 850.00,'RGPD — réunion stratégique avec le DPO du client',false,NULL),
          (80,31, 2,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-19',10.00,480.00,4800.00,'Cartographie des traitements — analyse des lacunes RGPD (10h billed)',false,NULL),
          (81,31, 3,'C. Garnier', 'Collaborateur Senior','senior_associate', '2026-02-19', 3.00,680.00,2040.00,'Recherche sur les bases légales — art. 6 RGPD (legitimate interests assessment)',false,NULL),
          (82,31, 4,'F. Moreau',  'Collaborateur',       'associate',        '2026-02-20', 1.00,390.00, 390.00,'Préparation du modèle d''analyse des risques',false,NULL),
          (83,31, 5,'C. Garnier', 'Collaborateur Senior','senior_associate', '2026-02-20', 3.00,630.00,1890.00,'Rédaction des clauses types CCT — accord responsable-sous-traitant',false,NULL),
          (84,31, 6,'A. Marchand','Collaborateur Junior', 'associate',        '2026-02-21', 7.00,370.00,2590.00,'Documentation procédure DSA — réponse aux demandes de droits (Phase 1)',false,NULL),
          (85,31, 7,'A. Marchand','Collaborateur Junior', 'associate',        '2026-02-21', 7.00,370.00,2590.00,'Documentation procédure DSA — réponse aux demandes de droits (Phase 1)',false,NULL),
          (86,31, 8,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-22', 0.50,850.00, 425.00,'Revue de l''analyse des lacunes et note d''information au DPO',false,NULL),
          (87,31, 9,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-22', 0.50,850.00, 425.00,'Impression et classement des documents de cartographie (50 pages)',false,NULL),
          (88,31,10,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-24', 2.00,850.00,1700.00,'Coordination interne — réunion équipe projet RGPD',false,NULL),
          (89,31,11,'F. Moreau',  'Collaborateur',       'associate',        '2026-02-24', 2.00,390.00, 850.00,'Population du modèle d''analyse des risques — registre des traitements',false,NULL),
          (90,31,12,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-25', 3.00,480.00,1440.00,'Rédaction de la politique de surveillance et monitoring des salariés',false,NULL),
          (91,31,13,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-25', 3.00,480.00,1440.00,'Revue juridique des mentions RGPD dans les actes RH',false,NULL),
          (92,31,14,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-26', 3.50,480.00,1680.00,'Revue du tableau de conservation et politique de suppression',false,NULL)
          ON CONFLICT (id) DO NOTHING
        `);
        await tx.execute(sql`SELECT setval('invoice_items_id_seq', (SELECT MAX(id) FROM invoice_items))`);

        /* Invoice documents — Beaumont PDFs in shared object storage */
        await tx.execute(sql`
          INSERT INTO invoice_documents (invoice_id, document_kind, file_name, mime_type, storage_path, extraction_status)
          VALUES
            (30,'invoice_file','Beaumont_INV-000026.pdf','application/pdf',
             '/objects/uploads/23fee94d-9da8-4a5f-a4c2-3728c87228ff','done'),
            (31,'invoice_file','Beaumont_INV-000027.pdf','application/pdf',
             '/objects/uploads/43639e35-721a-4fe6-b96d-87b4b28a5b2d','done')
          ON CONFLICT DO NOTHING
        `);

        /* Analysis runs 14 and 15 */
        await tx.execute(sql`
          INSERT INTO analysis_runs (id, invoice_id, version_no, trigger_reason, status, started_by_id, started_at, finished_at)
          OVERRIDING SYSTEM VALUE VALUES
          (14, 30, 1, 'manual', 'complete', 1, NOW(), NOW()),
          (15, 31, 1, 'manual', 'complete', 1, NOW(), NOW())
          ON CONFLICT (id) DO NOTHING
        `);
        await tx.execute(sql`SELECT setval('analysis_runs_id_seq', (SELECT MAX(id) FROM analysis_runs))`);

        /* 14 issues — 7 per invoice */
        await tx.execute(sql`
          INSERT INTO issues
            (id, invoice_id, analysis_run_id, invoice_item_id,
             rule_code, rule_type, severity, evaluator_type,
             issue_status, route_to_role, explanation_text,
             suggested_action, recoverable_amount, recovery_group_key,
             created_at, updated_at, firm_acknowledged)
          OVERRIDING SYSTEM VALUE VALUES
          -- Invoice 30 issues
          (33,30,14,71,'DUPLICATE_LINE',                       'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Line 7 is an exact duplicate of line 6: A. Marchand billed 7.0 hours for ''Documentation procédure DSA — réponse aux demandes de droits (Phase 1)'' on 21 Feb 2026 at €370/h (€2,590) twice. The duplicate line is rejected in full.',                                                                                           NULL,2590.00,NULL,NOW(),NOW(),false),
          (34,30,14,75,'ARITHMETIC_ERROR',                     'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Line 11: F. Moreau billed €850.00 for 2.0 hours at €390/h. The correct amount is 2 × €390 = €780.00. The arithmetic discrepancy results in an overcharge of €70.00.',                                                                                                                                                          NULL,70.00,  NULL,NOW(),NOW(),false),
          (35,30,14,66,'DAILY_HOURS_EXCEEDED',                 'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Senior Associate L. Dupont billed 10.0 hours on 19 Feb 2026, exceeding the 8-hour daily cap in the engagement terms. The excess 2.0 hours (2 × €480 = €960) are not recoverable without prior client authorisation.',                                                                                                           NULL,960.00, NULL,NOW(),NOW(),false),
          (36,30,14,67,'INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER','heuristic','warning','heuristic','rejected_by_legal_ops','legal_ops',      'C. Garnier (Senior Associate) appears at two different hourly rates on this invoice: €680/h on line 3 and €630/h on line 5. The panel engagement letter specifies a single rate per grade. Applying the lower confirmed rate of €630/h to line 3 yields an exposure of €50/h × 3h = €150.',                                    NULL,150.00, NULL,NOW(),NOW(),false),
          (37,30,14,67,'RATE_EXCESS',                          'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'C. Garnier (Senior Associate) billed at €680/h on line 3. The agreed panel rate for Senior Associate grade under the Beaumont engagement letter is €630/h. Excess: €50/h × 3.0 hours = €150.',                                                                                                                                NULL,150.00, NULL,NOW(),NOW(),false),
          (38,30,14,73,'SENIORITY_OVERKILL',                   'gray',     'warning','heuristic','rejected_by_legal_ops','legal_ops',      'Line 9: Maître É. Beaumont (Managing Partner, €850/h) billed 0.5 hours for printing and filing 50 pages of data-mapping documents. This is a routine administrative task that should be delegated to support staff at a significantly lower cost.',                                                                              'Accept | Reject | Delegate to Internal Lawyer',0.00,NULL,NOW(),NOW(),false),
          (39,30,14,74,'INTERNAL_COORDINATION',                'ai',       'error',  'ai',       'rejected_by_legal_ops','legal_ops',      'Line 10: Maître É. Beaumont (Managing Partner, €850/h) billed 2.0 hours for an internal GDPR project team coordination meeting (€1,700). Internal firm coordination meetings are expressly non-billable under the engagement terms. This item is rejected in full.',                                                             NULL,1700.00,NULL,NOW(),NOW(),false),
          -- Invoice 31 issues (same rule pattern, item_ids offset by +14)
          (40,31,15,85,'DUPLICATE_LINE',                       'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Line 7 is an exact duplicate of line 6: A. Marchand billed 7.0 hours for ''Documentation procédure DSA — réponse aux demandes de droits (Phase 1)'' on 21 Feb 2026 at €370/h (€2,590) twice. The duplicate line is rejected in full.',                                                                                           NULL,2590.00,NULL,NOW(),NOW(),false),
          (41,31,15,89,'ARITHMETIC_ERROR',                     'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Line 11: F. Moreau billed €850.00 for 2.0 hours at €390/h. The correct amount is 2 × €390 = €780.00. The arithmetic discrepancy results in an overcharge of €70.00.',                                                                                                                                                          NULL,70.00,  NULL,NOW(),NOW(),false),
          (42,31,15,80,'DAILY_HOURS_EXCEEDED',                 'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Senior Associate L. Dupont billed 10.0 hours on 19 Feb 2026, exceeding the 8-hour daily cap in the engagement terms. The excess 2.0 hours (2 × €480 = €960) are not recoverable without prior client authorisation.',                                                                                                           NULL,960.00, NULL,NOW(),NOW(),false),
          (43,31,15,81,'INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER','heuristic','warning','heuristic','rejected_by_legal_ops','legal_ops',      'C. Garnier (Senior Associate) appears at two different hourly rates on this invoice: €680/h on line 3 and €630/h on line 5. The panel engagement letter specifies a single rate per grade. Applying the lower confirmed rate of €630/h to line 3 yields an exposure of €50/h × 3h = €150.',                                    NULL,150.00, NULL,NOW(),NOW(),false),
          (44,31,15,81,'RATE_EXCESS',                          'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'C. Garnier (Senior Associate) billed at €680/h on line 3. The agreed panel rate for Senior Associate grade under the Beaumont engagement letter is €630/h. Excess: €50/h × 3.0 hours = €150.',                                                                                                                                NULL,150.00, NULL,NOW(),NOW(),false),
          (45,31,15,87,'SENIORITY_OVERKILL',                   'gray',     'warning','heuristic','rejected_by_legal_ops','legal_ops',      'Line 9: Maître É. Beaumont (Managing Partner, €850/h) billed 0.5 hours for printing and filing 50 pages of data-mapping documents. This is a routine administrative task that should be delegated to support staff at a significantly lower cost.',                                                                              'Accept | Reject | Delegate to Internal Lawyer',0.00,NULL,NOW(),NOW(),false),
          (46,31,15,88,'INTERNAL_COORDINATION',                'ai',       'error',  'ai',       'rejected_by_legal_ops','legal_ops',      'Line 10: Maître É. Beaumont (Managing Partner, €850/h) billed 2.0 hours for an internal GDPR project team coordination meeting (€1,700). Internal firm coordination meetings are expressly non-billable under the engagement terms. This item is rejected in full.',                                                             NULL,1700.00,NULL,NOW(),NOW(),false)
          ON CONFLICT (id) DO NOTHING
        `);
        await tx.execute(sql`SELECT setval('issues_id_seq', (SELECT MAX(id) FROM issues))`);
        await tx.execute(sql`SELECT setval('invoice_number_seq', GREATEST(28, (SELECT last_value FROM invoice_number_seq)))`);
      });
      logger.info("Beaumont backfill complete.");
      return;
    }

    logger.info("Backfill: inserting analysis runs and issues into existing DB...");
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO analysis_runs (id, invoice_id, version_no, trigger_reason, status, started_by_id, started_at, finished_at)
        OVERRIDING SYSTEM VALUE VALUES
        (1,  6,  1, 'manual', 'complete', 2, NOW(), NOW()),
        (2,  7,  1, 'manual', 'complete', 2, NOW(), NOW()),
        (3,  8,  1, 'manual', 'complete', 2, NOW(), NOW()),
        (4,  9,  1, 'manual', 'complete', 2, NOW(), NOW()),
        (5,  10, 1, 'manual', 'complete', 2, NOW(), NOW()),
        (6,  11, 1, 'manual', 'complete', 2, NOW(), NOW()),
        (7,  12, 1, 'manual', 'complete', 2, NOW(), NOW()),
        (8,  13, 1, 'manual', 'complete', 2, NOW(), NOW()),
        (9,  14, 1, 'manual', 'complete', 2, NOW(), NOW()),
        (10, 15, 1, 'manual', 'complete', 2, NOW(), NOW()),
        (11, 16, 1, 'manual', 'complete', 2, NOW(), NOW()),
        (12, 17, 1, 'manual', 'complete', 2, NOW(), NOW()),
        (13, 19, 1, 'manual', 'complete', 1, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.execute(sql`SELECT setval('analysis_runs_id_seq', (SELECT MAX(id) FROM analysis_runs))`);

      await tx.execute(sql`
        INSERT INTO issues
          (id, invoice_id, analysis_run_id, invoice_item_id,
           rule_code, rule_type, severity, evaluator_type,
           issue_status, route_to_role, explanation_text,
           suggested_action, recoverable_amount, recovery_group_key,
           created_at, updated_at, firm_acknowledged)
        OVERRIDING SYSTEM VALUE VALUES
        (1,  6, 1, 1,  'RATE_EXCESS',            'heuristic', 'error',   'heuristic', 'open',                    'legal_ops',       'Senior Associate J. Thornton billed at £620/h against the agreed panel rate of £550/h. Excess: £70/h × 8 hours = £560.',                                                                                                                                                                             NULL, 560.00,  NULL, NOW(), NOW(), false),
        (2,  6, 1, 2,  'HOURS_DISPROPORTIONATE', 'heuristic', 'warning', 'heuristic', 'open',                    'legal_ops',       'Trainee S. Webb billed exactly 8.0 hours on 3 Feb 2026. Uniform round-number entries on consecutive days are inconsistent with genuine time recording — please verify against timesheets.',                                                                                                          NULL, 560.00,  NULL, NOW(), NOW(), false),
        (3,  6, 1, 3,  'HOURS_DISPROPORTIONATE', 'heuristic', 'warning', 'heuristic', 'open',                    'legal_ops',       'Trainee S. Webb billed exactly 8.0 hours on 4 Feb 2026. Uniform round-number entries on consecutive days are inconsistent with genuine time recording — please verify against timesheets.',                                                                                                          NULL, 560.00,  NULL, NOW(), NOW(), false),
        (4,  7, 2, 9,  'UNAUTHORIZED_EXPENSE_TYPE', 'ai',     'warning', 'ai',        'rejected_by_legal_ops',   'legal_ops',       'Courier charges include a 15% handling markup (€180). Only the actual disbursement cost is recoverable under the engagement terms — firm handling surcharges are not permitted.',                                                                                                                  NULL, 180.00,  NULL, NOW(), NOW(), false),
        (5,  7, 2, 10, 'INTERNAL_COORDINATION',  'ai',        'error',   'ai',        'rejected_by_legal_ops',   'legal_ops',       '''Internal team coordination — Restructuring Matter'' billed at €220. Internal firm coordination meetings are expressly non-billable under the engagement terms.',                                                                                                                                NULL, 220.00,  NULL, NOW(), NOW(), false),
        (6,  8, 3, 11, 'RATE_EXCESS',            'heuristic', 'error',   'heuristic', 'escalated_to_internal_lawyer', 'internal_lawyer', 'Partner Dr. K. Weber billed at €980/h. The agreed panel rate for Partner grade is €750/h. Excess: €230/h × 12 hours = €2,760. Issue escalated for senior review given the magnitude of the discrepancy.',                                                                                  NULL, 2760.00, NULL, NOW(), NOW(), false),
        (7,  8, 3, 12, 'HOURS_DISPROPORTIONATE', 'heuristic', 'warning', 'heuristic', 'open',                    'legal_ops',       'Senior Associate A. Schmidt billed exactly 6.0 hours on 14 Feb 2026 — the same date and identical duration as Associate T. Müller. Simultaneous round-number entries across timekeepers warrant verification.',                                                                                    NULL, 0.00,    NULL, NOW(), NOW(), false),
        (8,  8, 3, 13, 'HOURS_DISPROPORTIONATE', 'heuristic', 'warning', 'heuristic', 'open',                    'legal_ops',       'Associate T. Müller billed exactly 6.0 hours on 14 Feb 2026 — the same date and identical duration as Senior Associate A. Schmidt. Simultaneous round-number entries across timekeepers warrant verification.',                                                                                     NULL, 0.00,    NULL, NOW(), NOW(), false),
        (9,  9, 4, 16, 'DAILY_HOURS_EXCEEDED',   'heuristic', 'error',   'heuristic', 'escalated_to_internal_lawyer', 'internal_lawyer', 'Senior Associate C. Evans billed 14.0 hours on 18 Feb 2026, exceeding the 10-hour daily cap in the engagement terms. The excess 4.0 hours (4 × £580 = £2,320) is not recoverable without prior client authorisation.',                                                                   NULL, 2320.00, NULL, NOW(), NOW(), false),
        (10, 9, 4, 19, 'PARALLEL_BILLING',       'ai',        'warning', 'ai',        'open',                    'legal_ops',       'Telephone call of approximately 15 minutes billed at the 1-hour minimum unit (£580). The agreed minimum billing unit is 6 minutes. Estimated overbilling on this entry: £435 (45 min × £580/h).',                                                                                                  NULL, 435.00,  NULL, NOW(), NOW(), false),
        (11, 9, 4, 20, 'PARALLEL_BILLING',       'ai',        'warning', 'ai',        'open',                    'legal_ops',       'Telephone call of approximately 12 minutes billed at the 1-hour minimum unit (£580). The agreed minimum billing unit is 6 minutes. Estimated overbilling on this entry: £435 (45 min × £580/h).',                                                                                                  NULL, 435.00,  NULL, NOW(), NOW(), false),
        (12, 10, 5, 21, 'HOURS_DISPROPORTIONATE','heuristic', 'warning', 'heuristic', 'accepted_by_legal_ops',   'legal_ops',       'Associate K. Tanaka billed exactly 4.0 hours on 5 Feb 2026. System flagged as potential round-number entry. Timesheet review confirmed hours are accurate — trademark search scope matches recorded time.',                                                                                        NULL, 0.00,    NULL, NOW(), NOW(), false),
        (13, 10, 5, 22, 'HOURS_DISPROPORTIONATE','heuristic', 'warning', 'heuristic', 'accepted_by_legal_ops',   'legal_ops',       'Associate K. Tanaka billed exactly 4.0 hours on 6 Feb 2026. System flagged as potential round-number entry. Timesheet review confirmed hours are accurate — trademark search scope matches recorded time.',                                                                                        NULL, 0.00,    NULL, NOW(), NOW(), false),
        (14, 12, 7, 28, 'UNAUTHORIZED_EXPENSE_TYPE','ai',     'warning', 'ai',        'accepted_by_legal_ops',   'legal_ops',       'Employment Tribunal filing fee includes a 5% administration charge (£9). The engagement letter permits a handling charge of up to 5%, so this falls within contractual tolerance.',                                                                                                                NULL, 0.00,    NULL, NOW(), NOW(), false),
        (15, 13, 8, 33, 'INTERNAL_COORDINATION',  'ai',       'error',   'ai',        'rejected_by_legal_ops',   'legal_ops',       '''Document management software licence'' of £1,200 billed as a disbursement. Software subscriptions are a firm overhead cost and cannot be passed to the client under the engagement terms.',                                                                                                     NULL, 1200.00, NULL, NOW(), NOW(), false),
        (16, 13, 8, 29, 'RATE_EXCESS',            'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Senior Partner Sir R. Caldwell billed at £1,100/h. The agreed Senior Partner rate is £850/h. Excess: £250/h × 30 hours billed this period = £7,500 to be recovered.',                                                                                                                           NULL, 7500.00, NULL, NOW(), NOW(), false),
        (17, 13, 8, NULL,'PARALLEL_BILLING',      'ai',       'warning', 'ai',        'rejected_by_legal_ops',   'legal_ops',       'Partner, Senior Associate, and Trainee simultaneously billed for overlapping completion tasks during the same board session on 15 Jan 2026. Estimated parallel billing excess after deducting the lead fee earner: £4,000.',                                                                       NULL, 4000.00, NULL, NOW(), NOW(), false),
        (18, 14, 9, 34, 'DAILY_HOURS_EXCEEDED',   'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Partner Prof. H. Braun billed 13.5 hours on 18 Jan 2026, exceeding the 10-hour daily cap. Excess: 3.5 hours × €780/h = €2,730. €2,200 disputed as irrecoverable excess.',                                                                                                                       NULL, 2200.00, NULL, NOW(), NOW(), false),
        (19, 14, 9, 37, 'MEETING_OVERSTAFFING',   'ai',       'warning', 'ai',        'rejected_by_legal_ops',   'legal_ops',       'Associate C. Fischer attended the full-day antitrust strategy session on 18 Jan 2026. The engagement terms cap attendance at 3 fee earners per client meeting without prior approval. C. Fischer is one of two attendees above the agreed quota. Rejected: €2,063.',                               NULL, 2063.00, NULL, NOW(), NOW(), false),
        (20, 14, 9, 38, 'MEETING_OVERSTAFFING',   'ai',       'warning', 'ai',        'rejected_by_legal_ops',   'legal_ops',       'Trainee R. Klein attended the full-day antitrust strategy session on 18 Jan 2026. The engagement terms cap attendance at 3 fee earners per client meeting without prior approval. R. Klein is one of two attendees above the agreed quota. Rejected: €2,062.',                                    NULL, 2062.00, NULL, NOW(), NOW(), false),
        (21, 15, 10, 42, 'UNAUTHORIZED_EXPENSE_TYPE','ai',    'error',   'ai',        'rejected_by_legal_ops',   'legal_ops',       'Independent surveyor report passed through with a 25% handling surcharge (€800). The engagement letter caps disbursement markups at 5%. The excess 20% surcharge (€800) is rejected.',                                                                                                            NULL, 800.00,  NULL, NOW(), NOW(), false),
        (22, 15, 10, 43, 'INTERNAL_COORDINATION', 'ai',       'error',   'ai',        'rejected_by_legal_ops',   'legal_ops',       '''Internal coordination meeting — Hargreaves Real Estate team'' charged at €450. Internal firm meetings are non-billable; this item is rejected in full.',                                                                                                                                        NULL, 450.00,  NULL, NOW(), NOW(), false),
        (23, 16, 11, 47, 'EXPENSE_CAP_EXCEEDED',  'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Business class flights charged at €4,800. The travel policy requires economy class for journeys under 5 hours, with a per-trip cap of €2,000. Excess above cap: €2,800.',                                                                                                                        NULL, 2800.00, NULL, NOW(), NOW(), false),
        (24, 16, 11, 45, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Junior Solicitor E. García billed at €380/h on 1 Feb 2026 (8.0 hours). The agreed rate for this grade is €280/h. Excess: €100/h × 8 hours = €800.',                                                                                                                                             NULL, 800.00,  NULL, NOW(), NOW(), false),
        (25, 16, 11, 46, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Junior Solicitor E. García billed at €380/h on 2 Feb 2026 (6.0 hours). The agreed rate for this grade is €280/h. Excess: €100/h × 6 hours = €600.',                                                                                                                                             NULL, 600.00,  NULL, NOW(), NOW(), false),
        (26, 17, 12, 49, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed at £280/h on 8 Feb 2026 (8.0 hours). The agreed panel cap for paralegals is £180/h. Excess: £100/h × 8 hours = £800.',                                                                                                                                              NULL, 800.00,  NULL, NOW(), NOW(), false),
        (27, 17, 12, 50, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed at £280/h on 9 Feb 2026 (8.0 hours). The agreed panel cap for paralegals is £180/h. Excess: £100/h × 8 hours = £800.',                                                                                                                                              NULL, 800.00,  NULL, NOW(), NOW(), false),
        (28, 17, 12, 51, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed at £280/h on 10 Feb 2026 (8.0 hours). The agreed panel cap for paralegals is £180/h. Excess: £100/h × 8 hours = £800.',                                                                                                                                             NULL, 800.00,  NULL, NOW(), NOW(), false),
        (29, 17, 12, 49, 'HOURS_DISPROPORTIONATE','heuristic','warning', 'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed exactly 8.0 hours on 8 Feb 2026. Combined with identical entries on 9 and 10 Feb, this three-day pattern of uniform daily billing is inconsistent with genuine time recording.',                                                                                      NULL, 1167.00, NULL, NOW(), NOW(), false),
        (30, 17, 12, 50, 'HOURS_DISPROPORTIONATE','heuristic','warning', 'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed exactly 8.0 hours on 9 Feb 2026. Combined with identical entries on 8 and 10 Feb, this three-day pattern of uniform daily billing is inconsistent with genuine time recording.',                                                                                      NULL, 1167.00, NULL, NOW(), NOW(), false),
        (31, 17, 12, 51, 'HOURS_DISPROPORTIONATE','heuristic','warning', 'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed exactly 8.0 hours on 10 Feb 2026. Combined with identical entries on 8 and 9 Feb, this three-day pattern of uniform daily billing is inconsistent with genuine time recording.',                                                                                     NULL, 1166.00, NULL, NOW(), NOW(), false),
        (32, 19, 13, 62, 'SENIORITY_OVERKILL',    'gray',     'warning', 'heuristic', 'accepted_by_legal_ops',   'internal_lawyer', 'Line 10: M. Quinn (Partner, GBP 700/h) billed 1h for reviewing the AURORA international application and signing off on country designations. This task appears routine and could typically be handled by a Senior Associate at a lower rate. Flagged as seniority overkill.', 'Accept | Reject | Delegate to Internal Lawyer', 0.00, NULL, NOW(), NOW(), false)
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.execute(sql`SELECT setval('issues_id_seq', (SELECT MAX(id) FROM issues))`);
    });
    logger.info("Backfill complete.");
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
      (11, 'Beaumont Leclerc & Associés S.A.S.', 'panel',
       '["France", "England & Wales", "Germany", "Netherlands", "Spain"]',
       '["Mergers & Acquisitions", "Regulatory & Compliance", "Employment & Labor", "Litigation & Dispute Resolution", "Real Estate"]',
       'Maître Élodie Beaumont', NULL, NULL, 'Sophia Belmont',
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
       'IP Portfolio Management — AURORA Brand & Trademark Renewals','Legal/2026/IP-112','England & Wales','accepted','accepted_with_comments',0.00,NOW(),NOW()),
      (30, 11,'invoice','INV-000026','2026-02-28',NULL,'EUR',23110.00,4622.00,27732.00,'time_and_materials',
       'Mise en conformité RGPD — Phase II','LEG/2026/RGPD-02','France','disputed','fully_rejected',0.00,NOW(),NOW()),
      (31, 11,'invoice','INV-000027','2026-03-07',NULL,'EUR',23110.00,4622.00,27732.00,'time_and_materials',
       'Mise en conformité RGPD — Phase III','LEG/2026/RGPD-03','France','disputed','fully_rejected',0.00,NOW(),NOW())
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

    /* ── 6b. BEAUMONT INVOICE ITEMS (explicit IDs 65-92 for issue FK references)
       Each invoice sums to 23,110 subtotal (+ 20% TVA = 27,732 total).
       Items are identical across both invoices — same RGPD matter, same timekeepers. */
    await tx.execute(sql`
      INSERT INTO invoice_items (id, invoice_id, line_no, timekeeper_label, role_raw, role_normalized,
        work_date, hours, rate_charged, amount, description, is_expense_line, expense_type)
      OVERRIDING SYSTEM VALUE VALUES
      -- Invoice 30 items (IDs 65-78) — sum = 850+4800+2040+390+1890+2590+2590+425+425+1700+850+1440+1440+1680 = 23,110
      (65,30, 1,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-18', 1.00,850.00, 850.00,'RGPD — réunion stratégique avec le DPO du client',false,NULL),
      (66,30, 2,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-19',10.00,480.00,4800.00,'Cartographie des traitements — analyse des lacunes RGPD (10h billed)',false,NULL),
      (67,30, 3,'C. Garnier', 'Collaborateur Senior','senior_associate', '2026-02-19', 3.00,680.00,2040.00,'Recherche sur les bases légales — art. 6 RGPD (legitimate interests assessment)',false,NULL),
      (68,30, 4,'F. Moreau',  'Collaborateur',       'associate',        '2026-02-20', 1.00,390.00, 390.00,'Préparation du modèle d''analyse des risques',false,NULL),
      (69,30, 5,'C. Garnier', 'Collaborateur Senior','senior_associate', '2026-02-20', 3.00,630.00,1890.00,'Rédaction des clauses types CCT — accord responsable-sous-traitant',false,NULL),
      (70,30, 6,'A. Marchand','Collaborateur Junior', 'associate',        '2026-02-21', 7.00,370.00,2590.00,'Documentation procédure DSA — réponse aux demandes de droits (Phase 1)',false,NULL),
      (71,30, 7,'A. Marchand','Collaborateur Junior', 'associate',        '2026-02-21', 7.00,370.00,2590.00,'Documentation procédure DSA — réponse aux demandes de droits (Phase 1)',false,NULL),
      (72,30, 8,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-22', 0.50,850.00, 425.00,'Revue de l''analyse des lacunes et note d''information au DPO',false,NULL),
      (73,30, 9,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-22', 0.50,850.00, 425.00,'Impression et classement des documents de cartographie (50 pages)',false,NULL),
      (74,30,10,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-24', 2.00,850.00,1700.00,'Coordination interne — réunion équipe projet RGPD',false,NULL),
      (75,30,11,'F. Moreau',  'Collaborateur',       'associate',        '2026-02-24', 2.00,390.00, 850.00,'Population du modèle d''analyse des risques — registre des traitements',false,NULL),
      (76,30,12,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-25', 3.00,480.00,1440.00,'Rédaction de la politique de surveillance et monitoring des salariés',false,NULL),
      (77,30,13,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-25', 3.00,480.00,1440.00,'Revue juridique des mentions RGPD dans les actes RH',false,NULL),
      (78,30,14,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-26', 3.50,480.00,1680.00,'Revue du tableau de conservation et politique de suppression',false,NULL),
      -- Invoice 31 items (IDs 79-92) — identical structure, same sum = 23,110
      (79,31, 1,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-18', 1.00,850.00, 850.00,'RGPD — réunion stratégique avec le DPO du client',false,NULL),
      (80,31, 2,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-19',10.00,480.00,4800.00,'Cartographie des traitements — analyse des lacunes RGPD (10h billed)',false,NULL),
      (81,31, 3,'C. Garnier', 'Collaborateur Senior','senior_associate', '2026-02-19', 3.00,680.00,2040.00,'Recherche sur les bases légales — art. 6 RGPD (legitimate interests assessment)',false,NULL),
      (82,31, 4,'F. Moreau',  'Collaborateur',       'associate',        '2026-02-20', 1.00,390.00, 390.00,'Préparation du modèle d''analyse des risques',false,NULL),
      (83,31, 5,'C. Garnier', 'Collaborateur Senior','senior_associate', '2026-02-20', 3.00,630.00,1890.00,'Rédaction des clauses types CCT — accord responsable-sous-traitant',false,NULL),
      (84,31, 6,'A. Marchand','Collaborateur Junior', 'associate',        '2026-02-21', 7.00,370.00,2590.00,'Documentation procédure DSA — réponse aux demandes de droits (Phase 1)',false,NULL),
      (85,31, 7,'A. Marchand','Collaborateur Junior', 'associate',        '2026-02-21', 7.00,370.00,2590.00,'Documentation procédure DSA — réponse aux demandes de droits (Phase 1)',false,NULL),
      (86,31, 8,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-22', 0.50,850.00, 425.00,'Revue de l''analyse des lacunes et note d''information au DPO',false,NULL),
      (87,31, 9,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-22', 0.50,850.00, 425.00,'Impression et classement des documents de cartographie (50 pages)',false,NULL),
      (88,31,10,'É. Beaumont','Associée Gérante',   'partner',          '2026-02-24', 2.00,850.00,1700.00,'Coordination interne — réunion équipe projet RGPD',false,NULL),
      (89,31,11,'F. Moreau',  'Collaborateur',       'associate',        '2026-02-24', 2.00,390.00, 850.00,'Population du modèle d''analyse des risques — registre des traitements',false,NULL),
      (90,31,12,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-25', 3.00,480.00,1440.00,'Rédaction de la politique de surveillance et monitoring des salariés',false,NULL),
      (91,31,13,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-25', 3.00,480.00,1440.00,'Revue juridique des mentions RGPD dans les actes RH',false,NULL),
      (92,31,14,'L. Dupont',  'Collaborateur Senior','senior_associate', '2026-02-26', 3.50,480.00,1680.00,'Revue du tableau de conservation et politique de suppression',false,NULL)
    `);
    await tx.execute(sql`SELECT setval('invoice_items_id_seq', (SELECT MAX(id) FROM invoice_items))`);

    /* ── 7. INVOICE DOCUMENTS (Quinn + Beaumont PDFs in shared object storage) */
    await tx.execute(sql`
      INSERT INTO invoice_documents (invoice_id, document_kind, file_name, mime_type, storage_path, extraction_status)
      VALUES
        (19, 'invoice_file', 'Invoice Quinn.pdf', 'application/pdf',
         '/objects/uploads/77811b73-7ecb-437c-bf86-3a95ed0a6ffa', 'done'),
        (30, 'invoice_file', 'Beaumont_INV-000026.pdf', 'application/pdf',
         '/objects/uploads/23fee94d-9da8-4a5f-a4c2-3728c87228ff', 'done'),
        (31, 'invoice_file', 'Beaumont_INV-000027.pdf', 'application/pdf',
         '/objects/uploads/43639e35-721a-4fe6-b96d-87b4b28a5b2d', 'done')
    `);

    /* ── 8. ANALYSIS RUNS ────────────────────────────────────────────── */
    await tx.execute(sql`
      INSERT INTO analysis_runs (id, invoice_id, version_no, trigger_reason, status, started_by_id, started_at, finished_at)
      OVERRIDING SYSTEM VALUE VALUES
      (1,  6,  1, 'manual', 'complete', 2, NOW(), NOW()),
      (2,  7,  1, 'manual', 'complete', 2, NOW(), NOW()),
      (3,  8,  1, 'manual', 'complete', 2, NOW(), NOW()),
      (4,  9,  1, 'manual', 'complete', 2, NOW(), NOW()),
      (5,  10, 1, 'manual', 'complete', 2, NOW(), NOW()),
      (6,  11, 1, 'manual', 'complete', 2, NOW(), NOW()),
      (7,  12, 1, 'manual', 'complete', 2, NOW(), NOW()),
      (8,  13, 1, 'manual', 'complete', 2, NOW(), NOW()),
      (9,  14, 1, 'manual', 'complete', 2, NOW(), NOW()),
      (10, 15, 1, 'manual', 'complete', 2, NOW(), NOW()),
      (11, 16, 1, 'manual', 'complete', 2, NOW(), NOW()),
      (12, 17, 1, 'manual', 'complete', 2, NOW(), NOW()),
      (13, 19, 1, 'manual', 'complete', 1, NOW(), NOW()),
      (14, 30, 1, 'manual', 'complete', 1, NOW(), NOW()),
      (15, 31, 1, 'manual', 'complete', 1, NOW(), NOW())
    `);
    await tx.execute(sql`SELECT setval('analysis_runs_id_seq', (SELECT MAX(id) FROM analysis_runs))`);

    /* ── 9. ISSUES ────────────────────────────────────────────────────── */
    await tx.execute(sql`
      INSERT INTO issues
        (id, invoice_id, analysis_run_id, invoice_item_id,
         rule_code, rule_type, severity, evaluator_type,
         issue_status, route_to_role, explanation_text,
         suggested_action, recoverable_amount, recovery_group_key,
         created_at, updated_at, firm_acknowledged)
      OVERRIDING SYSTEM VALUE VALUES
      -- Invoice 6 — Acquisition Due Diligence (in_review)
      (1,  6, 1, 1,  'RATE_EXCESS',            'heuristic', 'error',   'heuristic', 'open',                    'legal_ops',       'Senior Associate J. Thornton billed at £620/h against the agreed panel rate of £550/h. Excess: £70/h × 8 hours = £560.',                                                                                                                                                                             NULL, 560.00,  NULL, NOW(), NOW(), false),
      (2,  6, 1, 2,  'HOURS_DISPROPORTIONATE', 'heuristic', 'warning', 'heuristic', 'open',                    'legal_ops',       'Trainee S. Webb billed exactly 8.0 hours on 3 Feb 2026. Uniform round-number entries on consecutive days are inconsistent with genuine time recording — please verify against timesheets.',                                                                                                          NULL, 560.00,  NULL, NOW(), NOW(), false),
      (3,  6, 1, 3,  'HOURS_DISPROPORTIONATE', 'heuristic', 'warning', 'heuristic', 'open',                    'legal_ops',       'Trainee S. Webb billed exactly 8.0 hours on 4 Feb 2026. Uniform round-number entries on consecutive days are inconsistent with genuine time recording — please verify against timesheets.',                                                                                                          NULL, 560.00,  NULL, NOW(), NOW(), false),
      -- Invoice 7 — Employment Restructuring Advisory (disputed / fully_rejected)
      (4,  7, 2, 9,  'UNAUTHORIZED_EXPENSE_TYPE', 'ai',      'warning', 'ai',        'rejected_by_legal_ops',   'legal_ops',       'Courier charges include a 15% handling markup (€180). Only the actual disbursement cost is recoverable under the engagement terms — firm handling surcharges are not permitted.',                                                                                                                  NULL, 180.00,  NULL, NOW(), NOW(), false),
      (5,  7, 2, 10, 'INTERNAL_COORDINATION',  'ai',        'error',   'ai',         'rejected_by_legal_ops',   'legal_ops',       '''Internal team coordination — Restructuring Matter'' billed at €220. Internal firm coordination meetings are expressly non-billable under the engagement terms.',                                                                                                                                NULL, 220.00,  NULL, NOW(), NOW(), false),
      -- Invoice 8 — Data Protection Compliance Programme (escalated)
      (6,  8, 3, 11, 'RATE_EXCESS',            'heuristic', 'error',   'heuristic', 'escalated_to_internal_lawyer', 'internal_lawyer', 'Partner Dr. K. Weber billed at €980/h. The agreed panel rate for Partner grade is €750/h. Excess: €230/h × 12 hours = €2,760. Issue escalated for senior review given the magnitude of the discrepancy.',                                                                                  NULL, 2760.00, NULL, NOW(), NOW(), false),
      (7,  8, 3, 12, 'HOURS_DISPROPORTIONATE', 'heuristic', 'warning', 'heuristic', 'open',                    'legal_ops',       'Senior Associate A. Schmidt billed exactly 6.0 hours on 14 Feb 2026 — the same date and identical duration as Associate T. Müller. Simultaneous round-number entries across timekeepers warrant verification.',                                                                                    NULL, 0.00,    NULL, NOW(), NOW(), false),
      (8,  8, 3, 13, 'HOURS_DISPROPORTIONATE', 'heuristic', 'warning', 'heuristic', 'open',                    'legal_ops',       'Associate T. Müller billed exactly 6.0 hours on 14 Feb 2026 — the same date and identical duration as Senior Associate A. Schmidt. Simultaneous round-number entries across timekeepers warrant verification.',                                                                                     NULL, 0.00,    NULL, NOW(), NOW(), false),
      -- Invoice 9 — Competition Law Investigation (escalated)
      (9,  9, 4, 16, 'DAILY_HOURS_EXCEEDED',   'heuristic', 'error',   'heuristic', 'escalated_to_internal_lawyer', 'internal_lawyer', 'Senior Associate C. Evans billed 14.0 hours on 18 Feb 2026, exceeding the 10-hour daily cap in the engagement terms. The excess 4.0 hours (4 × £580 = £2,320) is not recoverable without prior client authorisation.',                                                                   NULL, 2320.00, NULL, NOW(), NOW(), false),
      (10, 9, 4, 19, 'PARALLEL_BILLING',       'ai',        'warning', 'ai',        'open',                    'legal_ops',       'Telephone call of approximately 15 minutes billed at the 1-hour minimum unit (£580). The agreed minimum billing unit is 6 minutes. Estimated overbilling on this entry: £435 (45 min × £580/h).',                                                                                                  NULL, 435.00,  NULL, NOW(), NOW(), false),
      (11, 9, 4, 20, 'PARALLEL_BILLING',       'ai',        'warning', 'ai',        'open',                    'legal_ops',       'Telephone call of approximately 12 minutes billed at the 1-hour minimum unit (£580). The agreed minimum billing unit is 6 minutes. Estimated overbilling on this entry: £435 (45 min × £580/h).',                                                                                                  NULL, 435.00,  NULL, NOW(), NOW(), false),
      -- Invoice 10 — Trademark Portfolio Review (accepted — issues resolved)
      (12, 10, 5, 21, 'HOURS_DISPROPORTIONATE','heuristic', 'warning', 'heuristic', 'accepted_by_legal_ops',   'legal_ops',       'Associate K. Tanaka billed exactly 4.0 hours on 5 Feb 2026. System flagged as potential round-number entry. Timesheet review confirmed hours are accurate — trademark search scope matches recorded time.',                                                                                        NULL, 0.00,    NULL, NOW(), NOW(), false),
      (13, 10, 5, 22, 'HOURS_DISPROPORTIONATE','heuristic', 'warning', 'heuristic', 'accepted_by_legal_ops',   'legal_ops',       'Associate K. Tanaka billed exactly 4.0 hours on 6 Feb 2026. System flagged as potential round-number entry. Timesheet review confirmed hours are accurate — trademark search scope matches recorded time.',                                                                                        NULL, 0.00,    NULL, NOW(), NOW(), false),
      -- Invoice 12 — Employment Settlement Negotiation (accepted)
      (14, 12, 7, 28, 'UNAUTHORIZED_EXPENSE_TYPE','ai',     'warning', 'ai',        'accepted_by_legal_ops',   'legal_ops',       'Employment Tribunal filing fee includes a 5% administration charge (£9). The engagement letter permits a handling charge of up to 5%, so this falls within contractual tolerance.',                                                                                                                NULL, 0.00,    NULL, NOW(), NOW(), false),
      -- Invoice 13 — Cross-Border M&A Phase 2 (disputed)
      (15, 13, 8, 33, 'INTERNAL_COORDINATION',  'ai',       'error',   'ai',        'rejected_by_legal_ops',   'legal_ops',       '''Document management software licence'' of £1,200 billed as a disbursement. Software subscriptions are a firm overhead cost and cannot be passed to the client under the engagement terms.',                                                                                                     NULL, 1200.00, NULL, NOW(), NOW(), false),
      (16, 13, 8, 29, 'RATE_EXCESS',            'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Senior Partner Sir R. Caldwell billed at £1,100/h. The agreed Senior Partner rate is £850/h. Excess: £250/h × 30 hours billed this period = £7,500 to be recovered.',                                                                                                                           NULL, 7500.00, NULL, NOW(), NOW(), false),
      (17, 13, 8, NULL,'PARALLEL_BILLING',      'ai',       'warning', 'ai',        'rejected_by_legal_ops',   'legal_ops',       'Partner, Senior Associate, and Trainee simultaneously billed for overlapping completion tasks during the same board session on 15 Jan 2026. Estimated parallel billing excess after deducting the lead fee earner: £4,000.',                                                                       NULL, 4000.00, NULL, NOW(), NOW(), false),
      -- Invoice 14 — EU Antitrust Investigation Support (disputed)
      (18, 14, 9, 34, 'DAILY_HOURS_EXCEEDED',   'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Partner Prof. H. Braun billed 13.5 hours on 18 Jan 2026, exceeding the 10-hour daily cap. Excess: 3.5 hours × €780/h = €2,730. €2,200 disputed as irrecoverable excess.',                                                                                                                       NULL, 2200.00, NULL, NOW(), NOW(), false),
      (19, 14, 9, 37, 'MEETING_OVERSTAFFING',   'ai',       'warning', 'ai',        'rejected_by_legal_ops',   'legal_ops',       'Associate C. Fischer attended the full-day antitrust strategy session on 18 Jan 2026. The engagement terms cap attendance at 3 fee earners per client meeting without prior approval. C. Fischer is one of two attendees above the agreed quota. Rejected: €2,063.',                               NULL, 2063.00, NULL, NOW(), NOW(), false),
      (20, 14, 9, 38, 'MEETING_OVERSTAFFING',   'ai',       'warning', 'ai',        'rejected_by_legal_ops',   'legal_ops',       'Trainee R. Klein attended the full-day antitrust strategy session on 18 Jan 2026. The engagement terms cap attendance at 3 fee earners per client meeting without prior approval. R. Klein is one of two attendees above the agreed quota. Rejected: €2,062.',                                    NULL, 2062.00, NULL, NOW(), NOW(), false),
      -- Invoice 15 — Commercial Real Estate Acquisition (disputed)
      (21, 15, 10, 42, 'UNAUTHORIZED_EXPENSE_TYPE','ai',    'error',   'ai',        'rejected_by_legal_ops',   'legal_ops',       'Independent surveyor report passed through with a 25% handling surcharge (€800). The engagement letter caps disbursement markups at 5%. The excess 20% surcharge (€800) is rejected.',                                                                                                            NULL, 800.00,  NULL, NOW(), NOW(), false),
      (22, 15, 10, 43, 'INTERNAL_COORDINATION', 'ai',       'error',   'ai',        'rejected_by_legal_ops',   'legal_ops',       '''Internal coordination meeting — Hargreaves Real Estate team'' charged at €450. Internal firm meetings are non-billable; this item is rejected in full.',                                                                                                                                        NULL, 450.00,  NULL, NOW(), NOW(), false),
      -- Invoice 16 — IP Licensing Negotiation (disputed)
      (23, 16, 11, 47, 'EXPENSE_CAP_EXCEEDED',  'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Business class flights charged at €4,800. The travel policy requires economy class for journeys under 5 hours, with a per-trip cap of €2,000. Excess above cap: €2,800.',                                                                                                                        NULL, 2800.00, NULL, NOW(), NOW(), false),
      (24, 16, 11, 45, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Junior Solicitor E. García billed at €380/h on 1 Feb 2026 (8.0 hours). The agreed rate for this grade is €280/h. Excess: €100/h × 8 hours = €800.',                                                                                                                                             NULL, 800.00,  NULL, NOW(), NOW(), false),
      (25, 16, 11, 46, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Junior Solicitor E. García billed at €380/h on 2 Feb 2026 (6.0 hours). The agreed rate for this grade is €280/h. Excess: €100/h × 6 hours = €600.',                                                                                                                                             NULL, 600.00,  NULL, NOW(), NOW(), false),
      -- Invoice 17 — Construction Dispute Quantum Phase (disputed)
      (26, 17, 12, 49, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed at £280/h on 8 Feb 2026 (8.0 hours). The agreed panel cap for paralegals is £180/h. Excess: £100/h × 8 hours = £800.',                                                                                                                                              NULL, 800.00,  NULL, NOW(), NOW(), false),
      (27, 17, 12, 50, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed at £280/h on 9 Feb 2026 (8.0 hours). The agreed panel cap for paralegals is £180/h. Excess: £100/h × 8 hours = £800.',                                                                                                                                              NULL, 800.00,  NULL, NOW(), NOW(), false),
      (28, 17, 12, 51, 'RATE_EXCESS',           'heuristic','error',   'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed at £280/h on 10 Feb 2026 (8.0 hours). The agreed panel cap for paralegals is £180/h. Excess: £100/h × 8 hours = £800.',                                                                                                                                             NULL, 800.00,  NULL, NOW(), NOW(), false),
      (29, 17, 12, 49, 'HOURS_DISPROPORTIONATE','heuristic','warning', 'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed exactly 8.0 hours on 8 Feb 2026. Combined with identical entries on 9 and 10 Feb, this three-day pattern of uniform daily billing is inconsistent with genuine time recording.',                                                                                      NULL, 1167.00, NULL, NOW(), NOW(), false),
      (30, 17, 12, 50, 'HOURS_DISPROPORTIONATE','heuristic','warning', 'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed exactly 8.0 hours on 9 Feb 2026. Combined with identical entries on 8 and 10 Feb, this three-day pattern of uniform daily billing is inconsistent with genuine time recording.',                                                                                      NULL, 1167.00, NULL, NOW(), NOW(), false),
      (31, 17, 12, 51, 'HOURS_DISPROPORTIONATE','heuristic','warning', 'heuristic', 'rejected_by_legal_ops',   'legal_ops',       'Paralegal M. Adeyemi billed exactly 8.0 hours on 10 Feb 2026. Combined with identical entries on 8 and 9 Feb, this three-day pattern of uniform daily billing is inconsistent with genuine time recording.',                                                                                     NULL, 1166.00, NULL, NOW(), NOW(), false),
      -- Invoice 19 — IP Portfolio Management (accepted_with_comments)
      (32, 19, 13, 62, 'SENIORITY_OVERKILL',    'gray',     'warning', 'heuristic', 'accepted_by_legal_ops',   'internal_lawyer', 'Line 10: M. Quinn (Partner, GBP 700/h) billed 1h for reviewing the AURORA international application and signing off on country designations. This task appears routine and could typically be handled by a Senior Associate at a lower rate. Flagged as seniority overkill.', 'Accept | Reject | Delegate to Internal Lawyer', 0.00, NULL, NOW(), NOW(), false),
      -- Invoice 30 — Beaumont RGPD Phase II (disputed / fully_rejected)
      (33,30,14,71,'DUPLICATE_LINE',                       'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Line 7 is an exact duplicate of line 6: A. Marchand billed 7.0 hours for ''Documentation procédure DSA — réponse aux demandes de droits (Phase 1)'' on 21 Feb 2026 at €370/h (€2,590) twice. The duplicate line is rejected in full.',                                                                                           NULL,2590.00,NULL,NOW(),NOW(),false),
      (34,30,14,75,'ARITHMETIC_ERROR',                     'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Line 11: F. Moreau billed €850.00 for 2.0 hours at €390/h. The correct amount is 2 × €390 = €780.00. The arithmetic discrepancy results in an overcharge of €70.00.',                                                                                                                                                          NULL,70.00,  NULL,NOW(),NOW(),false),
      (35,30,14,66,'DAILY_HOURS_EXCEEDED',                 'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Senior Associate L. Dupont billed 10.0 hours on 19 Feb 2026, exceeding the 8-hour daily cap in the engagement terms. The excess 2.0 hours (2 × €480 = €960) are not recoverable without prior client authorisation.',                                                                                                           NULL,960.00, NULL,NOW(),NOW(),false),
      (36,30,14,67,'INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER','heuristic','warning','heuristic','rejected_by_legal_ops','legal_ops',      'C. Garnier (Senior Associate) appears at two different hourly rates on this invoice: €680/h on line 3 and €630/h on line 5. The panel engagement letter specifies a single rate per grade. Applying the lower confirmed rate of €630/h to line 3 yields an exposure of €50/h × 3h = €150.',                                    NULL,150.00, NULL,NOW(),NOW(),false),
      (37,30,14,67,'RATE_EXCESS',                          'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'C. Garnier (Senior Associate) billed at €680/h on line 3. The agreed panel rate for Senior Associate grade under the Beaumont engagement letter is €630/h. Excess: €50/h × 3.0 hours = €150.',                                                                                                                                NULL,150.00, NULL,NOW(),NOW(),false),
      (38,30,14,73,'SENIORITY_OVERKILL',                   'gray',     'warning','heuristic','rejected_by_legal_ops','legal_ops',      'Line 9: Maître É. Beaumont (Managing Partner, €850/h) billed 0.5 hours for printing and filing 50 pages of data-mapping documents. This is a routine administrative task that should be delegated to support staff at a significantly lower cost.',                                                                              'Accept | Reject | Delegate to Internal Lawyer',0.00,NULL,NOW(),NOW(),false),
      (39,30,14,74,'INTERNAL_COORDINATION',                'ai',       'error',  'ai',       'rejected_by_legal_ops','legal_ops',      'Line 10: Maître É. Beaumont (Managing Partner, €850/h) billed 2.0 hours for an internal GDPR project team coordination meeting (€1,700). Internal firm coordination meetings are expressly non-billable under the engagement terms. This item is rejected in full.',                                                             NULL,1700.00,NULL,NOW(),NOW(),false),
      -- Invoice 31 — Beaumont RGPD Phase III (disputed / fully_rejected)
      (40,31,15,85,'DUPLICATE_LINE',                       'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Line 7 is an exact duplicate of line 6: A. Marchand billed 7.0 hours for ''Documentation procédure DSA — réponse aux demandes de droits (Phase 1)'' on 21 Feb 2026 at €370/h (€2,590) twice. The duplicate line is rejected in full.',                                                                                           NULL,2590.00,NULL,NOW(),NOW(),false),
      (41,31,15,89,'ARITHMETIC_ERROR',                     'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Line 11: F. Moreau billed €850.00 for 2.0 hours at €390/h. The correct amount is 2 × €390 = €780.00. The arithmetic discrepancy results in an overcharge of €70.00.',                                                                                                                                                          NULL,70.00,  NULL,NOW(),NOW(),false),
      (42,31,15,80,'DAILY_HOURS_EXCEEDED',                 'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'Senior Associate L. Dupont billed 10.0 hours on 19 Feb 2026, exceeding the 8-hour daily cap in the engagement terms. The excess 2.0 hours (2 × €480 = €960) are not recoverable without prior client authorisation.',                                                                                                           NULL,960.00, NULL,NOW(),NOW(),false),
      (43,31,15,81,'INCONSISTENT_RATE_FOR_SAME_TIMEKEEPER','heuristic','warning','heuristic','rejected_by_legal_ops','legal_ops',      'C. Garnier (Senior Associate) appears at two different hourly rates on this invoice: €680/h on line 3 and €630/h on line 5. The panel engagement letter specifies a single rate per grade. Applying the lower confirmed rate of €630/h to line 3 yields an exposure of €50/h × 3h = €150.',                                    NULL,150.00, NULL,NOW(),NOW(),false),
      (44,31,15,81,'RATE_EXCESS',                          'heuristic','error',  'heuristic','rejected_by_legal_ops','legal_ops',      'C. Garnier (Senior Associate) billed at €680/h on line 3. The agreed panel rate for Senior Associate grade under the Beaumont engagement letter is €630/h. Excess: €50/h × 3.0 hours = €150.',                                                                                                                                NULL,150.00, NULL,NOW(),NOW(),false),
      (45,31,15,87,'SENIORITY_OVERKILL',                   'gray',     'warning','heuristic','rejected_by_legal_ops','legal_ops',      'Line 9: Maître É. Beaumont (Managing Partner, €850/h) billed 0.5 hours for printing and filing 50 pages of data-mapping documents. This is a routine administrative task that should be delegated to support staff at a significantly lower cost.',                                                                              'Accept | Reject | Delegate to Internal Lawyer',0.00,NULL,NOW(),NOW(),false),
      (46,31,15,88,'INTERNAL_COORDINATION',                'ai',       'error',  'ai',       'rejected_by_legal_ops','legal_ops',      'Line 10: Maître É. Beaumont (Managing Partner, €850/h) billed 2.0 hours for an internal GDPR project team coordination meeting (€1,700). Internal firm coordination meetings are expressly non-billable under the engagement terms. This item is rejected in full.',                                                             NULL,1700.00,NULL,NOW(),NOW(),false)
    `);
    await tx.execute(sql`SELECT setval('issues_id_seq', (SELECT MAX(id) FROM issues))`);

    /* ── 10. Reset sequences ─────────────────────────────────────────── */
    await tx.execute(sql`SELECT setval('invoice_number_seq', 28)`);
  });

  logger.info("Seed complete.");
}
