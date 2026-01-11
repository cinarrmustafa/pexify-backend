# Pexify Backend - Validation API Proposal

## 1. Current Engine Implementation

### Architecture Overview
```
User Request (HTTP) → Express.js Server → Python Subprocess → Validation Engine → JSON Response
```

### Current Implementation Location

**Routes & Controller:**
- File: `server.js:23-71`
- Route: `POST /run`
- Method: Spawns Python subprocess with hardcoded path `/usr/bin/python3`
- Engine Directory: `engine/` (contains Python validation engine)

**Engine Components:**
- `engine/run_engine.py` - Core validation engine (Python 3)
- `engine/bs_rules.yaml` - Business rules definitions (2 rules: BR-001, BR-002)
- `engine/payload.yaml` - Sample shipment data (hardcoded test data)
- `engine/rule_map.yaml` - Rule configuration mapping

### How It's Currently Invoked

1. Client sends `POST /run` (no body required currently)
2. Server spawns Python subprocess: `python3 run_engine.py`
3. Python loads `payload.yaml` (hardcoded shipment data)
4. Python loads `bs_rules.yaml` (validation rules)
5. Engine executes rules against payload
6. Returns JSON: `{ status: "PASS|FAIL", errors: [...] }`

### Current Limitations

❌ **No dynamic input** - Always validates same hardcoded payload.yaml
❌ **No shipment_id parameter** - Cannot validate specific shipments
❌ **No document upload support** - No way to submit actual documents
❌ **No persistence** - No database, everything is in-memory YAML files
❌ **No document storage** - No file storage for uploaded PDFs/images

---

## 2. Proposed API Contract

### Option A: Minimal MVP (Recommended First Step)

**Endpoint:** `POST /api/validate`

**Request Body:**
```json
{
  "shipment_id": "SHP-001",
  "documents": {
    "invoice": {
      "invoice_number": "INV-1001",
      "currency": "USD",
      "total_amount": 12500,
      "gross_weight": 1000
    },
    "packing_list": {
      "package_count": 10,
      "gross_weight": 1000
    },
    "bill_of_lading": {
      "bl_number": "BL-555",
      "gross_weight": 1000
    }
  }
}
```

**Response (Success - PASS):**
```json
{
  "status": "PASS",
  "shipment_id": "SHP-001",
  "validated_at": "2026-01-11T10:30:00Z",
  "rules_checked": 2,
  "errors": []
}
```

**Response (Success - FAIL with violations):**
```json
{
  "status": "FAIL",
  "shipment_id": "SHP-001",
  "validated_at": "2026-01-11T10:30:00Z",
  "rules_checked": 2,
  "errors": [
    {
      "rule_id": "BR-001",
      "message": "Gross weight mismatch between Invoice and Packing List",
      "severity": "error",
      "left_path": "documents.invoice.gross_weight",
      "right_path": "documents.packing_list.gross_weight",
      "left_value": 1000,
      "right_value": 1200
    }
  ]
}
```

**Response (Error):**
```json
{
  "status": "ERROR",
  "message": "Validation engine failed",
  "errors": [
    {
      "message": "spawn error: python not found"
    }
  ]
}
```

### Option B: Document-Reference Based (Future Enhancement)

**Endpoint:** `POST /api/validate`

**Request Body:**
```json
{
  "shipment_id": "SHP-001",
  "document_ids": [
    "doc_inv_abc123",
    "doc_pl_def456",
    "doc_bol_ghi789"
  ]
}
```

This would require:
- Document upload endpoint (`POST /api/documents`)
- Document storage (Supabase Storage or S3)
- OCR/extraction service to parse PDFs into structured data
- Document metadata table in database

---

## 3. Local Run Instructions

### Prerequisites
```bash
# 1. Install Node.js dependencies
npm install

# 2. Verify Python 3 is installed
python3 --version
# Expected: Python 3.8+

# 3. Install Python dependencies (if any added later)
pip3 install pyyaml
```

### Start Server
```bash
npm start
# Server runs on http://localhost:3000
```

### Health Check
```bash
curl http://localhost:3000/health
```

**Expected Output:**
```json
{
  "ok": true,
  "message": "Backend ayakta"
}
```

### Run Validation (Current Implementation)
```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json"
```

**Expected Output (with current payload.yaml - all weights match):**
```json
{
  "status": "PASS",
  "errors": []
}
```

### Test Failure Scenario
To test validation failures, modify `engine/payload.yaml`:

```yaml
# Change gross_weight in invoice to trigger BR-001 failure
documents:
  invoice:
    gross_weight: 1200  # Changed from 1000
  packing_list:
    gross_weight: 1000
```

Then run:
```bash
curl -X POST http://localhost:3000/run
```

**Expected Output:**
```json
{
  "status": "FAIL",
  "errors": [
    {
      "rule_id": "BR-001",
      "message": "Gross weight mismatch between Invoice and Packing List",
      "left_path": "documents.invoice.gross_weight",
      "right_path": "documents.packing_list.gross_weight",
      "left_value": 1200,
      "right_value": 1000
    }
  ]
}
```

### Future API (After Implementation)
```bash
curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{
    "shipment_id": "SHP-001",
    "documents": {
      "invoice": {
        "invoice_number": "INV-1001",
        "currency": "USD",
        "total_amount": 12500,
        "gross_weight": 1000
      },
      "packing_list": {
        "package_count": 10,
        "gross_weight": 1000
      },
      "bill_of_lading": {
        "bl_number": "BL-555",
        "gross_weight": 1000
      }
    }
  }'
```

---

## 4. Data Storage Strategy (Supabase vs Backend)

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      SUPABASE                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📊 PostgreSQL Database                                     │
│  ├── shipments (persistent records)                         │
│  ├── documents (metadata only)                              │
│  ├── validation_runs (history)                              │
│  └── discrepancies (flagged issues)                         │
│                                                             │
│  📁 Storage Buckets                                         │
│  └── document-files (PDFs, images, scanned docs)            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ REST API
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                   BACKEND SERVER                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ⚙️  Validation Engine (Python subprocess)                  │
│  ├── bs_rules.yaml (business rules - in code/env)           │
│  ├── Temporary payload processing                           │
│  └── In-memory validation execution                         │
│                                                             │
│  🔌 API Layer (Express.js)                                  │
│  ├── POST /api/validate                                     │
│  ├── POST /api/documents/upload                             │
│  └── GET  /api/shipments/:id/discrepancies                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Storage Breakdown

#### SUPABASE (Persistent Storage)

**1. Shipments Table**
```sql
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id TEXT UNIQUE NOT NULL,
  target_country TEXT,
  status TEXT, -- 'pending', 'validated', 'approved', 'rejected'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Purpose:** Core shipment records that persist across sessions

**2. Documents Table (Metadata)**
```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL, -- 'invoice', 'packing_list', 'bill_of_lading'
  file_url TEXT, -- Supabase Storage URL
  extracted_data JSONB, -- Structured data from OCR/manual entry
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Purpose:** Document metadata + extracted structured data

**Why JSONB for extracted_data?**
- Flexible schema (different docs have different fields)
- PostgreSQL supports JSON queries/indexes
- Easy to pass to validation engine

**Example extracted_data:**
```json
{
  "invoice_number": "INV-1001",
  "currency": "USD",
  "total_amount": 12500,
  "gross_weight": 1000
}
```

**3. Validation Runs Table**
```sql
CREATE TABLE validation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- 'PASS', 'FAIL', 'ERROR'
  rules_checked INTEGER,
  error_count INTEGER,
  validated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Purpose:** Audit trail of all validation attempts

**4. Discrepancies Table**
```sql
CREATE TABLE discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_run_id UUID REFERENCES validation_runs(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  severity TEXT, -- 'error', 'warning'
  message TEXT,
  left_path TEXT,
  right_path TEXT,
  left_value JSONB,
  right_value JSONB,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Purpose:** Individual rule violations that need human review

**5. Supabase Storage Bucket**
```
Bucket: document-files
├── shipment-SHP-001/
│   ├── invoice_INV-1001.pdf
│   ├── packing_list_001.pdf
│   └── bol_BL-555.pdf
└── shipment-SHP-002/
    └── ...
```

**Purpose:** Store actual uploaded files (PDFs, scans, images)

#### BACKEND (Ephemeral/Runtime Only)

**1. Business Rules (bs_rules.yaml)**
- **Storage:** Git repository (version controlled)
- **Deployment:** Deployed with backend code
- **Rationale:** Rules are business logic, not user data
- **Updates:** Code deployment, not database updates

**2. Validation Payload (temporary)**
- **Storage:** In-memory during validation request
- **Lifecycle:**
  1. Fetch from Supabase (shipment + documents)
  2. Build payload.yaml structure
  3. Pass to Python engine
  4. Discard after validation
- **Rationale:** No need to persist, can be reconstructed

**3. Engine State**
- **Storage:** Python subprocess memory
- **Lifecycle:** Created per request, destroyed after response
- **Rationale:** Stateless validation, no persistence needed

### Why This Split?

| Data Type | Storage | Reason |
|-----------|---------|--------|
| Shipment records | Supabase | Need to query, filter, show history |
| Document files | Supabase Storage | Large binary files, need CDN/signed URLs |
| Document metadata | Supabase | Need to join with shipments |
| Validation history | Supabase | Audit trail, analytics, compliance |
| Discrepancies | Supabase | User needs to review/resolve flagged issues |
| Business rules | Backend (Git) | Code-level logic, version controlled |
| Validation runtime | Backend (memory) | Temporary, stateless computation |

### Alternative: Keep Everything in Supabase?

**Could we store rules in Supabase?**

Yes, but **NOT recommended** for MVP:
- Rules are business logic (code), not data
- Changing rules requires testing, not just DB update
- Version control (Git) better for rules than DB
- Rules should deploy with code

**Future:** Build a "Rule Builder UI" that stores custom rules in DB, but core rules stay in code.

### Migration Path

**Phase 1 (MVP):**
- Backend validates in-memory payloads
- No database (current state)

**Phase 2 (Add Supabase):**
- Add shipments table
- Store validation_runs + discrepancies
- Keep rules in backend code

**Phase 3 (Document Management):**
- Add documents table
- Add Supabase Storage for files
- Build upload endpoint

**Phase 4 (Advanced):**
- OCR integration
- Custom rule builder
- Real-time validation status

---

## 5. Immediate Next Steps (Recommended)

### Step 1: Accept Dynamic Payload
Modify `POST /run` to accept request body:
```javascript
app.post("/run", (req, res) => {
  const payload = req.body; // Expect { shipment_id, documents: {...} }
  // Write payload to temp file or pass via stdin to Python
  // ...
});
```

### Step 2: Rename Route
```javascript
app.post("/api/validate", (req, res) => {
  // New standard route
});
```

### Step 3: Add Response Metadata
```javascript
{
  "status": "PASS|FAIL",
  "shipment_id": req.body.shipment_id,
  "validated_at": new Date().toISOString(),
  "rules_checked": rules.length,
  "errors": [...]
}
```

### Step 4: Setup Supabase (Parallel Work)
- Create Supabase project
- Create tables (shipments, documents, validation_runs, discrepancies)
- Install `@supabase/supabase-js`
- Add connection in `server.js`

### Step 5: Store Validation Results
After validation, insert into Supabase:
```javascript
const { data, error } = await supabase
  .from('validation_runs')
  .insert({
    shipment_id: req.body.shipment_id,
    status: result.status,
    rules_checked: 2,
    error_count: result.errors.length
  });
```

---

## 6. Open Questions

1. **OCR/Data Entry:** How will document data be extracted?
   - Manual entry form?
   - OCR service (Textract, Google Vision)?
   - Hybrid (OCR + manual review)?

2. **Authentication:** Who can call the API?
   - Public (no auth)?
   - Supabase Auth (user accounts)?
   - API keys?

3. **File Upload:** Which format?
   - PDF only?
   - Images (PNG, JPG)?
   - Excel/CSV?

4. **Rule Updates:** How often do rules change?
   - Weekly (code deployment acceptable)?
   - Daily (might need DB-based rules)?

---

## Summary

### Current State ✅
- Working validation engine (Python)
- Express.js API with `/run` endpoint
- Hardcoded YAML payload
- 2 business rules (weight matching)

### Immediate Gaps 🔴
- No dynamic input (can't validate custom payloads)
- No persistence (no DB)
- No document storage
- No audit trail

### Proposed Solution 🎯
- **API:** `POST /api/validate` with JSON body
- **Storage:** Supabase for shipments/documents/discrepancies
- **Backend:** Python engine stays ephemeral/stateless
- **Rules:** Keep in code (Git version control)

### First Implementation (MVP+)
1. Accept dynamic JSON payload
2. Return enhanced response with metadata
3. Connect to Supabase
4. Store validation runs + discrepancies
5. Keep engine logic unchanged
