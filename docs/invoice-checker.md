# Invoice Checker — Documentación Técnica y Funcional

> Plataforma B2B SaaS para que departamentos legales corporativos revisen facturas de despachos de abogados, detecten errores de facturación y verifiquen el cumplimiento de términos comerciales pactados.

---

## Tabla de contenidos

1. [Visión general](#visión-general)
2. [Roles y permisos](#roles-y-permisos)
3. [Acceso y autenticación](#acceso-y-autenticación)
4. [Módulos y páginas](#módulos-y-páginas)
   - [Dashboard](#dashboard)
   - [Facturas (Invoices)](#facturas-invoices)
   - [Detalle de factura](#detalle-de-factura)
   - [Informe PDF](#informe-pdf)
   - [Despachos de abogados (Law Firms)](#despachos-de-abogados-law-firms)
   - [Tarifas (Rates)](#tarifas-rates)
   - [Reglas (Rules)](#reglas-rules)
   - [Usuarios (Users)](#usuarios-users)
5. [Motor de reglas](#motor-de-reglas)
   - [Reglas determinísticas (objetivas)](#reglas-determinísticas-objetivas)
   - [Reglas con IA (grises)](#reglas-con-ia-grises)
6. [Pipeline de análisis de una factura](#pipeline-de-análisis-de-una-factura)
7. [Funcionalidades de IA](#funcionalidades-de-ia)
8. [Gestión de estados de una factura](#gestión-de-estados-de-una-factura)
9. [Esquema de base de datos](#esquema-de-base-de-datos)
10. [API REST](#api-rest)
11. [Configuración y despliegue](#configuración-y-despliegue)
12. [Cuentas de demo](#cuentas-de-demo)
13. [Archivos de demo](#archivos-de-demo)

---

## Visión general

Invoice Checker permite a un departamento de Legal Ops (operaciones legales) corporativo:

- Subir facturas de despachos de abogados en PDF y documentos asociados (Engagement Letters, presupuestos).
- Extraer automáticamente líneas de facturación mediante IA.
- Ejecutar un motor de reglas híbrido (código + IA) con 27 reglas que detecta errores de tarifas, gastos no autorizados, errores aritméticos, incumplimientos de políticas, etc.
- Gestionar un flujo de revisión/escalado con trazabilidad completa (audit log).
- Generar informes PDF y borradores de correo electrónico dirigidos al despacho.

**Stack técnico:**

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + Tailwind CSS + shadcn/ui |
| Backend | Node.js + Express + TypeScript |
| Base de datos | PostgreSQL (Drizzle ORM) |
| Almacenamiento | Object Storage (S3-compatible) |
| IA | OpenAI GPT (extracción + reglas grises + borradores) |
| Branding | Corporate red `#EC0000` |

---

## Roles y permisos

El sistema implementa tres roles con control de acceso granular:

| Permiso | `super_admin` | `legal_ops` | `internal_lawyer` |
|---|:---:|:---:|:---:|
| Gestionar usuarios | ✅ | ❌ | ❌ |
| Crear/editar/eliminar despachos | ✅ | ❌ | ❌ |
| Ver despachos y tarifas | ✅ | ✅ | ✅ |
| Subir facturas y documentos | ✅ | ✅ | ❌ |
| Ejecutar extracción y análisis | ✅ | ✅ | ❌ |
| Ver facturas e incidencias | ✅ | ✅ | ✅ |
| Decidir incidencias (aceptar/rechazar) | ✅ | ✅ | ✅ |
| Generar informe PDF | ✅ | ✅ | ✅ |
| Configurar reglas globales | ✅ | ❌ | ❌ |

---

## Acceso y autenticación

- Autenticación por **email + contraseña** (sesión con cookie HTTP-only).
- Endpoint: `POST /api/auth/login`
- Cierre de sesión: `POST /api/auth/logout`
- Perfil del usuario activo: `GET /api/auth/me`

---

## Módulos y páginas

### Dashboard

**Ruta:** `/`

Vista de resumen operativo que muestra:

- Número de facturas por estado (pendiente, en revisión, escalada, aceptada, disputada).
- Ahorro total identificado y recuperado.
- Incidencias abiertas por severidad.
- Actividad reciente del sistema.

---

### Facturas (Invoices)

**Ruta:** `/invoices`

Cola principal de trabajo para Legal Ops. Muestra todas las facturas con sus estados y permite:

- Filtrar por estado, despacho, rango de fechas.
- Crear una nueva factura (seleccionar despacho, jurisdicción, materia y moneda).
- Acceder al detalle de cualquier factura.

**Estados posibles de una factura:**

```
pending → extracting → pending_analysis → in_review → escalated → accepted / disputed
```

---

### Detalle de factura

**Ruta:** `/invoices/:id`

Pantalla central de trabajo. Incluye las siguientes secciones:

#### Documentos
- Subida de PDF/DOCX (Engagement Letter, presupuesto, la factura misma).
- Cada documento puede ser procesado individualmente (extracción de texto + metadata).
- Indicador de completitud: el sistema advierte si faltan documentos clave (p. ej., EL para factura a precio fijo).

#### Líneas de facturación
- Tabla con todas las líneas extraídas: fecha, abogado, rol, horas, tarifa, importe.
- Las líneas con incidencias se resaltan visualmente con badge de severidad.

#### Incidencias (Issues)
- Lista de todas las incidencias detectadas por el motor de reglas.
- Cada incidencia muestra: regla activada, severidad (`error` / `warning`), descripción, evidencia, línea afectada.
- Acciones por incidencia:
  - **Accept** — Se confirma el error (suma al ahorro recuperado).
  - **Reject** — Se descarta como falso positivo.
  - **Escalate** — Se eleva a un Internal Lawyer para revisión cualitativa.
- Las decisiones quedan registradas en el audit log con timestamp y usuario.

#### Comentarios
- Hilo de comentarios internos visibles para todos los roles.

#### Audit Log
- Registro inmutable de todos los eventos: cambios de estado, decisiones, subidas de documentos, ejecuciones del motor.

#### Acciones
- **Ejecutar análisis** — Lanza el motor de reglas completo.
- **Re-ejecutar análisis** — Vuelve a analizar con los datos y documentos actuales.
- **Generar borrador de correo** — IA redacta un email dirigido al despacho detallando las incidencias.
- **Ver informe** — Navega al informe PDF generado.

---

### Informe PDF

**Ruta:** `/invoices/:id/report`

Informe generado automáticamente que incluye:

- Datos de cabecera: despacho, número de factura, materia, jurisdicción, fechas.
- Resumen ejecutivo con importe facturado, importe cuestionado y ahorro potencial.
- Tabla de incidencias con descripción detallada y referencia a la cláusula incumplida.
- Generado y descargable como PDF desde el navegador.

---

### Despachos de abogados (Law Firms)

**Ruta:** `/law-firms`

Registro maestro de todos los despachos. Permite:

- Crear y editar despachos (nombre, tipo: panel / no-panel, jurisdicción, estado activo/inactivo).
- Gestionar Términos Comerciales (Commercial Terms):
  - Subir el documento T&C en PDF/DOCX.
  - Extracción automática con IA de hasta 12 campos estándar.
  - Verificación manual campo a campo o masiva ("Verify All").
  - Visualización de la política de viajes (párrafo completo) y política de gastos (dos columnas: permitido / no permitido).
  - Los términos se presentan en este orden: Tipo de facturación, Plazos de pago, Horas máximas diarias, Servicios de terceros, Fechas de contrato, Facturación de onboarding, Política de gastos, Política de viajes.
- **Eliminar despacho** (solo `super_admin`): incluye confirmación en pantalla con advertencia de acción irreversible.

**Campos de Términos Comerciales extraídos:**

| Campo | Descripción |
|---|---|
| `billing_type_default` | Tipo de facturación (hourly, fixed, etc.) |
| `payment_terms_days` | Días de plazo de pago |
| `max_daily_hours_per_timekeeper` | Horas máximas por abogado por día |
| `third_party_services_require_approval` | ¿Servicios de terceros requieren aprobación? |
| `contract_start_date` / `contract_end_date` | Vigencia del contrato |
| `getting_up_to_speed_billable` | ¿El tiempo de puesta al día es facturable? |
| `expense_policy_json` | Política de gastos (listas permitido / no permitido) |
| `travel_policy` | Política de viajes (texto libre) |
| `discount_type` / `discount_thresholds_json` | Descuentos por volumen |

---

### Tarifas (Rates)

**Ruta:** `/rates`

Gestión del **rate card** (tarifario aprobado) por despacho:

- Tabla de tarifas por rol y jurisdicción con moneda y fecha de vigencia.
- Panel de detalle de cada despacho incluye pestaña "Terms & Conditions" con los términos verificados.
- Base para la regla `RATE_EXCESS`.

---

### Reglas (Rules)

**Ruta:** `/rules`

Página de administración del motor de reglas (solo `super_admin`):

- Lista de las 27 reglas con nombre, categoría, severidad y descripción.
- Toggle global para activar/desactivar cada regla individualmente.
- Leyenda de badges explicando las categorías y severidades:
  - **Categorías:** Rate, Compliance, Arithmetic, Scope, Policy, Expense
  - **Severidades:** Error (bloquea pago), Warning (requiere revisión)

---

### Usuarios (Users)

**Ruta:** `/users`

Gestión de usuarios del sistema (solo `super_admin`):

- Listado de todos los usuarios con su rol y estado.
- Creación de nuevos usuarios con asignación de rol.
- Edición de rol y desactivación de cuentas.

---

## Motor de reglas

El motor evalúa **27 reglas** organizadas en dos tipos.

### Reglas determinísticas (objetivas)

Evaluadas por código con lógica precisa. Se ejecutan siempre que haya datos suficientes.

| ID | Nombre | Descripción |
|---|---|---|
| `RATE_EXCESS` | Rate Exceeds Schedule | Tarifa cobrada supera la tarifa aprobada para el rol y jurisdicción |
| `UNKNOWN_ROLE` | Unknown Timekeeper Role | El rol del abogado no puede mapearse al catálogo de roles aprobados |
| `MISSING_RATE_ENTRY` | Missing Rate Entry | No existe tarifa activa para esa combinación firma/jurisdicción/rol |
| `WRONG_CURRENCY` | Wrong Currency | La moneda de la factura no coincide con la pactada en los T&C |
| `VOLUME_DISCOUNT_NOT_APPLIED` | Volume Discount Not Applied | Se ha alcanzado el umbral de descuento por volumen pero no se aplicó |
| `EXPENSE_CAP_EXCEEDED` | Expense Cap Exceeded | Un gasto supera el límite máximo reembolsable por tipo de gasto |
| `FIXED_FEE_EXCEEDED` | Fixed Fee Exceeded | Una factura a precio fijo supera el importe fijo acordado |
| `DUPLICATE_LINE` | Duplicate Line | Línea aparentemente duplicada (misma fecha, abogado, horas y tarifa) |
| `ARITHMETIC_ERROR` | Arithmetic Error | El importe de la línea no coincide con horas × tarifa |
| `OUTSIDE_ENGAGEMENT_DATES` | Outside Engagement Dates | Líneas fuera del período del Engagement Letter |
| `MISSING_ENGAGEMENT_LETTER` | Missing Engagement Letter | Factura a precio fijo sin EL que especifique el importe |
| `FIXED_FEE_HAS_HOURLY_LINES` | Fixed Fee Has Hourly Lines | EL de precio fijo contiene líneas por horas |
| `UNAUTHORIZED_EXPENSE_TYPE` | Unauthorized Expense Type | Tipo de gasto no está en la lista de gastos autorizados |
| `TAX_OR_VAT_MISMATCH` | Tax / VAT Mismatch | Error en el cálculo o tipo de IVA/impuesto |
| `RATE_INCONSISTENCY` | Rate Inconsistency | El mismo abogado aparece con tarifas distintas en la misma factura |
| `DAILY_HOURS_EXCEEDED` | Daily Hours Exceeded | Abogado supera el máximo de horas diarias permitido (defecto: 8h) |
| `ENGAGEMENT_CONFLICTS_WITH_PANEL` | EL Conflicts with Panel T&C | El EL contiene cláusulas que contradicen las condiciones del panel |

### Reglas con IA (grises)

Evaluadas por un LLM (OpenAI). Analizan el contexto cualitativo de las líneas.

| ID | Nombre | Descripción |
|---|---|---|
| `HOURS_DISPROPORTIONATE` | Hours Disproportionate | Horas excesivas para el rol o tarea descrita |
| `DUPLICATE_EFFORT` | Duplicate Effort | Varios abogados facturan tareas similares el mismo día |
| `SCOPE_CREEP` | Scope Creep | Trabajo fuera del alcance definido en el EL |
| `SENIORITY_OVERKILL` | Seniority Overkill | Tarea rutinaria asignada a un abogado muy senior |
| `BUDGET_EXCEEDED` | Budget Exceeded | Acumulado supera el presupuesto sin nueva estimación justificada |
| `INTERNAL_COORDINATION` | Internal Coordination | Reuniones internas del despacho facturadas al cliente |
| `UNAPPROVED_TIMEKEEPER` | Unapproved Timekeeper | Abogado no incluido en el plan de staffing del EL |
| `EXCESSIVE_MEETING_ATTENDANCE` | Excessive Meeting Attendance | Reunión con demasiados abogados presentes |
| `NO_LINE_DETAIL` | No Line Detail | Factura sin desglose por línea (solo resumen) |
| `UNRESOLVED_JURISDICTION` | Unresolved Jurisdiction | No se puede determinar la jurisdicción aplicable |

---

## Pipeline de análisis de una factura

```
1. UPLOAD         Subida de PDF de la factura + documentos de soporte
        ↓
2. EXTRACT        IA extrae líneas, abogados, tarifas, importes
        ↓
3. COMPLETENESS   Verifica que haya datos mínimos (despacho, moneda, EL si aplica)
        ↓
4. ANALYSE        Motor determinístico + reglas IA evaluadas en paralelo
        ↓
5. REVIEW         Legal Ops revisa incidencias objetivo (errores)
        ↓
6. ESCALATE       Incidencias cualitativas → Internal Lawyer
        ↓
7. DECIDE         Accept / Reject / Escalate por incidencia
        ↓
8. CLOSE          Factura → Accepted (con/sin disputas) o Disputed
        ↓
9. REPORT         PDF generado + borrador de email al despacho
```

---

## Funcionalidades de IA

| Función | Descripción |
|---|---|
| **Extracción de factura** | Parsea líneas de texto del PDF: fecha, abogado, rol, horas, tarifa, descripción, IVA, totales |
| **Extracción de Engagement Letter** | Extrae: alcance, honorarios fijos, fechas, staffing, jurisdicción |
| **Normalización de roles** | Mapea títulos ad-hoc del despacho (ej. "Senior Associate Level 4") a roles canónicos del catálogo |
| **Extracción de T&C** | Extrae términos comerciales estructurados del PDF del contrato marco |
| **Extracción de tarifas** | Extrae la tabla de tarifas de un documento de rate card |
| **Reglas grises** | Evalúa cualitativamente líneas de facturación enviando contexto al LLM |
| **Borrador de email** | Genera un email en tono formal dirigido al socio director del despacho detallando las incidencias encontradas |

Modelo utilizado: **GPT-5.2** (OpenAI). Los prompts están internamente ajustados a terminología legal-financiera en inglés.

---

## Gestión de estados de una factura

```
pending
  └─ [upload + extract] ──→ extracting
                               └─ [extraction complete] ──→ pending_analysis
                                                               └─ [run analysis] ──→ in_review
                                                                                       ├─ [all issues decided] ──→ accepted
                                                                                       ├─ [dispute raised] ──→ disputed
                                                                                       └─ [escalate issue] ──→ escalated
                                                                                                                └─ [lawyer decides] ──→ in_review
```

---

## Esquema de base de datos

| Tabla | Descripción |
|---|---|
| `users` | Usuarios del sistema con rol (`super_admin`, `legal_ops`, `internal_lawyer`) |
| `invoices` | Cabecera de la factura: estado, importes, despacho, jurisdicción, materia |
| `invoice_documents` | Documentos vinculados a una factura (path en object storage, tipo, estado de extracción) |
| `invoice_items` | Líneas de facturación extraídas de la factura |
| `law_firms` | Despachos: nombre, tipo de panel, jurisdicción, estado activo |
| `firm_terms` | Términos comerciales de un despacho (`term_key` + `term_value_json`) |
| `panel_baseline_documents` | Documento fuente de T&C vinculado a un despacho |
| `panel_rates` | Tarifas aprobadas: despacho, rol, jurisdicción, tarifa, moneda, vigencia |
| `analysis_runs` | Historial de ejecuciones del motor por factura |
| `issues` | Incidencias detectadas: regla, severidad, evidencia, estado de decisión |
| `issue_comments` | Comentarios vinculados a una incidencia |
| `audit_events` | Log inmutable de todos los eventos del sistema |

---

## API REST

Base URL: `/api`

### Autenticación
| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/auth/login` | Iniciar sesión |
| `POST` | `/auth/logout` | Cerrar sesión |
| `GET` | `/auth/me` | Perfil del usuario activo |

### Facturas
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/invoices` | Todos | Listar facturas |
| `POST` | `/invoices` | Admin, Legal Ops | Crear factura |
| `GET` | `/invoices/:id` | Todos | Detalle de factura |
| `PATCH` | `/invoices/:id` | Admin, Legal Ops | Actualizar metadatos |
| `GET` | `/invoices/:id/documents` | Todos | Listar documentos |
| `POST` | `/invoices/:id/documents` | Admin, Legal Ops | Subir documento |
| `GET` | `/invoices/:id/items` | Todos | Líneas de facturación |
| `GET` | `/invoices/:id/completeness` | Todos | Estado de completitud |
| `POST` | `/invoices/:id/extract` | Admin, Legal Ops | Ejecutar extracción IA |
| `POST` | `/invoices/:id/analyse` | Admin, Legal Ops | Ejecutar motor de reglas |
| `POST` | `/invoices/:id/rerun` | Admin, Legal Ops | Re-ejecutar análisis |
| `GET` | `/invoices/:id/analysis-runs` | Todos | Historial de ejecuciones |
| `GET` | `/invoices/:id/issues` | Todos | Incidencias detectadas |
| `POST` | `/invoices/:id/issues/:issueId/decide` | Todos | Tomar decisión sobre incidencia |
| `GET` | `/invoices/:id/comments` | Todos | Comentarios internos |
| `POST` | `/invoices/:id/comments` | Todos | Añadir comentario |
| `GET` | `/invoices/:id/audit-events` | Todos | Audit log |
| `POST` | `/invoices/:id/report` | Todos | Generar informe |
| `GET` | `/invoices/:id/report/pdf` | Todos | Descargar informe PDF |
| `POST` | `/invoices/:id/email-draft` | Todos | Generar borrador de email |

### Despachos de abogados
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/law-firms` | Todos | Listar despachos |
| `POST` | `/law-firms` | Admin | Crear despacho |
| `GET` | `/law-firms/:id` | Todos | Detalle de despacho |
| `PUT` | `/law-firms/:id` | Admin | Actualizar despacho |
| `DELETE` | `/law-firms/:id` | Admin | Eliminar despacho (cascada en T&C) |

### Tarifas
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/rates` | Todos | Listar tarifas |
| `POST` | `/rates` | Admin | Crear tarifa |
| `PUT` | `/rates/:id` | Admin | Actualizar tarifa |
| `DELETE` | `/rates/:id` | Admin | Eliminar tarifa |

### Reglas
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/rules` | Todos | Listar reglas y configuración |
| `PUT` | `/rules/:id` | Admin | Activar/desactivar regla |

### Usuarios
| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/users` | Admin | Listar usuarios |
| `POST` | `/users` | Admin | Crear usuario |
| `PUT` | `/users/:id` | Admin | Actualizar usuario |

---

## Configuración y despliegue

### Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | URL de conexión a PostgreSQL |
| `SESSION_SECRET` | Secreto para firmar las cookies de sesión |
| `OPENAI_API_KEY` | Clave de la API de OpenAI (extracción + IA) |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | ID del bucket de object storage |
| `PRIVATE_OBJECT_DIR` | Directorio privado en el bucket |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Rutas públicas en el bucket |

### Estructura del proyecto

```
workspace/
├── artifacts/
│   ├── api-server/          # Backend Express + TypeScript
│   │   └── src/
│   │       ├── routes/      # Endpoints REST
│   │       ├── lib/         # Motor de reglas, extracción IA, utilidades
│   │       └── db/          # Esquema Drizzle ORM y migraciones
│   └── invoice-checker/     # Frontend React + Vite
│       └── src/
│           ├── pages/       # Páginas de la aplicación
│           ├── components/  # Componentes reutilizables (UI)
│           └── hooks/       # Custom hooks
├── lib/
│   ├── api-spec/            # OpenAPI spec + codegen
│   └── api-client-react/    # Cliente tipado generado automáticamente
└── demo/                    # Generadores de PDFs de demo
```

---

## Cuentas de demo

| Email | Contraseña | Rol |
|---|---|---|
| `admin@company.com` | `company2026` | `super_admin` |
| `legalops@company.com` | `company2026` | `legal_ops` |
| `lawyer@company.com` | `company2026` | `internal_lawyer` |

---

## Archivos de demo

En el directorio `demo/` se incluyen generadores de facturas y T&C para pruebas:

| Archivo | Descripción |
|---|---|
| `generate-invoice-clean.mjs` | Genera `Mercer_Voss_INV-2026-0031.pdf` — factura limpia sin errores |
| `generate-invoice-hs.mjs` | Genera `Hargreaves_Sutton_LLP_INV-2026-0094.pdf` — 4 errores deliberados: `RATE_EXCESS`, `DAILY_HOURS_EXCEEDED`, `ARITHMETIC_ERROR`, `UNAUTHORIZED_EXPENSE_TYPE` |
| `generate-tc-hs.mjs` | Genera `Hargreaves_Sutton_LLP_Engagement_Letter_2026.pdf` — T&C para prueba de extracción |

**Errores deliberados en la factura de Hargreaves & Sutton:**

1. **M. Fletcher (Partner)** — GBP 820/h facturado vs. cap GBP 680/h → `RATE_EXCESS`
2. **P. Okonkwo** — 10.5 horas el 11 Feb → `DAILY_HOURS_EXCEEDED`
3. **R. Shah** — 3.5h × 440 = 1,540 facturado como 1,750 → `ARITHMETIC_ERROR`
4. **"Business class airfare" vuelo doméstico** — gasto no autorizado → `UNAUTHORIZED_EXPENSE_TYPE`
