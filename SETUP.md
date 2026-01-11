# Pexify Backend - Upload Feature Setup Guide

This guide will walk you through setting up the document upload feature with Supabase integration.

## Prerequisites

- Node.js 16+ installed
- A Supabase account (sign up at https://supabase.com)
- Python 3.8+ (for validation engine)

## Step 1: Install Dependencies

```bash
npm install
```

This installs:
- `express` - Web server
- `@supabase/supabase-js` - Supabase client
- `multer` - File upload handling
- `dotenv` - Environment variable loading
- `cors` - CORS support

## Step 2: Create Supabase Project

1. Go to https://app.supabase.com
2. Click "New Project"
3. Fill in:
   - Project name: `pexify` (or your choice)
   - Database password: (save this, you'll need it)
   - Region: Choose closest to you
4. Wait ~2 minutes for project to provision

## Step 3: Get Supabase Credentials

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key (⚠️ keep this secret, only use server-side)

## Step 4: Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in your Supabase credentials:
   ```env
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

## Step 5: Run Database Setup SQL

1. In Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy the contents of `SUPABASE_SETUP.sql` and paste it
4. Click **Run** to execute

This creates:
- `public.documents` table
- Row Level Security (RLS) policies
- Indexes for performance

**Verify it worked:**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'documents';
```
You should see the `documents` table.

## Step 6: Create Storage Bucket

1. In Supabase dashboard, go to **Storage**
2. Click **New Bucket**
3. Fill in:
   - Name: `documents`
   - Public: **❌ Uncheck this** (keep private)
   - File size limit: 10 MB (optional)
4. Click **Create bucket**

### Add Storage Policies

After creating the bucket:

1. Click on the `documents` bucket
2. Click **Policies** tab
3. Click **New Policy**

**Policy 1: Users can upload their own documents**
- Policy name: `Users can upload to own folder`
- Allowed operation: `INSERT`
- Target roles: `authenticated`
- WITH CHECK expression:
  ```sql
  bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text
  ```

**Policy 2: Users can read their own documents**
- Policy name: `Users can read own documents`
- Allowed operation: `SELECT`
- Target roles: `authenticated`
- USING expression:
  ```sql
  bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text
  ```

## Step 7: Configure Frontend

1. Open `public/index.html`
2. Find lines 318-319:
   ```javascript
   const SUPABASE_URL = 'YOUR_SUPABASE_URL';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
   ```
3. Replace with your actual values:
   ```javascript
   const SUPABASE_URL = 'https://xxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
   ```

**⚠️ Note:** Only use the `anon` key in frontend, NEVER the `service_role` key!

## Step 8: Start the Server

```bash
npm start
```

You should see:
```
Backend çalışıyor: http://localhost:3000
Engine dir: /path/to/pexify-backend/engine
✅ Supabase client initialized
✅ Supabase admin client initialized
```

## Step 9: Create a Test User

1. Open http://localhost:3000 in your browser
2. In the **Authentication** section:
   - Email: `test@example.com`
   - Password: `password123` (at least 6 characters)
   - Click **Sign Up**
3. Check your email for confirmation link (if email confirmation is enabled)
   - OR disable email confirmation in Supabase: **Authentication** → **Providers** → **Email** → Uncheck "Confirm email"

## Step 10: Test Upload Flow

Now test the complete upload workflow:

### Test 1: Upload a Document

1. **Login** with your test user credentials
2. You should see:
   - ✅ "Logged in as: test@example.com" (green alert)
   - Upload section appears
   - Dashboard section appears
3. **Click "Choose File"**
4. Select a test PDF or image (max 10MB)
5. You should see: `✓ filename.pdf (XX KB)`
6. **Click "Upload to Supabase"**
7. Button shows spinner: "Uploading..."

**Expected Network Request:**
- Method: `POST`
- URL: `http://localhost:3000/api/upload`
- Headers: `Authorization: Bearer <token>`
- Status: `200 OK`

**Expected Response:**
```json
{
  "success": true,
  "document": {
    "id": "uuid-here",
    "user_id": "user-uuid",
    "filename": "test.pdf",
    "file_path": "user-uuid/timestamp-test.pdf",
    "file_size": 12345,
    "mime_type": "application/pdf",
    "uploaded_at": "2026-01-11T10:30:00Z"
  },
  "message": "File uploaded successfully"
}
```

**Expected UI Changes:**
- ✅ Green success message: "✓ File uploaded successfully"
- File input resets to "No file selected"
- Dashboard list refreshes automatically

### Test 2: Verify Database Insert

In Supabase dashboard → **Table Editor** → `documents`:

**Expected Row:**
| id | user_id | filename | file_path | file_size | mime_type | uploaded_at |
|----|---------|----------|-----------|-----------|-----------|-------------|
| uuid | user-uuid | test.pdf | user-uuid/123-test.pdf | 12345 | application/pdf | 2026-01-11... |

**Verify `user_id` is auto-filled:**
- Should match your authenticated user's ID
- NOT null
- NOT manually provided (filled by RLS policy using `auth.uid()`)

### Test 3: Verify Storage Upload

In Supabase dashboard → **Storage** → `documents` bucket:

**Expected File Path:**
```
documents/
  └── <user-uuid>/
      └── <timestamp>-test.pdf
```

**File Properties:**
- Size: Matches uploaded file
- Type: Matches mime_type
- Metadata: Contains original filename

### Test 4: Dashboard List Refresh

1. After upload completes, dashboard should **automatically refresh**
2. New document appears at top of list (newest first)
3. Document card shows:
   - Filename: `test.pdf`
   - Upload time: `Uploaded: 1/11/2026, 10:30:00 AM`
   - File size: `12.05 KB`
   - Preview button

**Expected Network Request:**
- Method: `GET`
- URL: `http://localhost:3000/api/documents`
- Headers: `Authorization: Bearer <token>`
- Status: `200 OK`

**Expected Response:**
```json
{
  "documents": [
    {
      "id": "uuid",
      "user_id": "user-uuid",
      "filename": "test.pdf",
      "file_path": "user-uuid/123-test.pdf",
      "file_size": 12345,
      "mime_type": "application/pdf",
      "uploaded_at": "2026-01-11T10:30:00Z"
    }
  ]
}
```

### Test 5: Signed URL Preview

1. Click **Preview** button on a document
2. Expected behavior:
   - New tab opens
   - Shows the uploaded PDF/image
   - URL is a signed Supabase URL (valid for 1 hour)

**Expected Network Request:**
- Method: `GET`
- URL: `http://localhost:3000/api/documents/<uuid>/url`
- Headers: `Authorization: Bearer <token>`
- Status: `200 OK`

**Expected Response:**
```json
{
  "document": { ... },
  "signedUrl": "https://xxxxx.supabase.co/storage/v1/object/sign/documents/user-uuid/123-test.pdf?token=..."
}
```

**Expected Signed URL Behavior:**
- Opens in new tab
- Shows file content (PDF viewer or image)
- URL contains `?token=...` parameter
- URL expires after 1 hour

---

## Troubleshooting

### Error: "Supabase not configured"

**Cause:** `.env` file missing or invalid

**Fix:**
1. Verify `.env` exists in project root
2. Check all three variables are set:
   ```bash
   cat .env
   ```
3. Restart server: `npm start`

### Error: "No authorization header"

**Cause:** Frontend not sending auth token

**Fix:**
1. Check you're logged in (green "Logged in as..." message)
2. Open browser DevTools → Network
3. Find `/api/upload` request
4. Check Headers → `Authorization: Bearer <token>` exists

### Error: "Storage upload failed: Bucket not found"

**Cause:** Storage bucket `documents` doesn't exist

**Fix:**
1. Go to Supabase → Storage
2. Create bucket named exactly `documents` (lowercase, no spaces)
3. Make it **private** (not public)

### Error: "Database insert failed: new row violates row-level security"

**Cause:** RLS policies not set up correctly

**Fix:**
1. Re-run `SUPABASE_SETUP.sql` in SQL Editor
2. Verify policies exist:
   ```sql
   SELECT policyname FROM pg_policies WHERE tablename = 'documents';
   ```
3. Should show 3 policies (insert, select, delete)

### Error: "Invalid file type"

**Cause:** Uploading unsupported file format

**Fix:**
Allowed types:
- PDFs: `.pdf`
- Images: `.jpg`, `.jpeg`, `.png`
- Excel: `.xls`, `.xlsx`

### Upload succeeds but dashboard shows "No documents"

**Cause:** RLS policy blocking SELECT or frontend not logged in

**Fix:**
1. Verify you're logged in
2. Check browser console for errors
3. In Supabase → Table Editor, manually check if row exists
4. If row exists but not showing, check RLS SELECT policy

### Preview button doesn't work

**Cause:** Signed URL generation failing

**Fix:**
1. Check backend logs for errors
2. Verify `SUPABASE_SERVICE_ROLE_KEY` is set in `.env`
3. Check Storage policies allow SELECT for user's folder

---

## Next Steps

Once upload is working:
1. ✅ Upload documents reliably
2. ✅ View documents in dashboard
3. ✅ Preview files with signed URLs
4. 🔄 Connect uploads to validation engine
5. 🔄 Extract document data (OCR or manual entry)
6. 🔄 Run validation rules against uploaded documents

## Security Notes

- ✅ All uploads require authentication
- ✅ Users can only see/upload their own documents (RLS enforced)
- ✅ File size limited to 10MB (configurable in server.js:50)
- ✅ File types restricted (PDF, images, Excel only)
- ✅ Signed URLs expire after 1 hour
- ⚠️ Never expose `service_role` key in frontend
- ⚠️ Never commit `.env` to git (already in `.gitignore`)

## API Reference

### POST /api/upload
Upload document to Supabase Storage and insert metadata.

**Headers:**
```
Authorization: Bearer <supabase_access_token>
Content-Type: multipart/form-data
```

**Body:**
- `file`: File (PDF, image, or Excel)

**Response 200:**
```json
{
  "success": true,
  "document": { ... },
  "message": "File uploaded successfully"
}
```

### GET /api/documents
List current user's documents (RLS filtered).

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Response 200:**
```json
{
  "documents": [ ... ]
}
```

### GET /api/documents/:id/url
Get signed URL for document preview.

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Response 200:**
```json
{
  "document": { ... },
  "signedUrl": "https://..."
}
```
