-- Pexify Supabase Setup
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/_/sql

-- ============================================
-- 1. Create documents table
-- ============================================
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Enable Row Level Security
-- ============================================
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. RLS Policies
-- ============================================

-- Users can insert their own documents
CREATE POLICY "Users can insert their own documents"
  ON public.documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can view their own documents
CREATE POLICY "Users can view their own documents"
  ON public.documents FOR SELECT
  USING (auth.uid() = user_id);

-- Users can delete their own documents
CREATE POLICY "Users can delete their own documents"
  ON public.documents FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 4. Storage Bucket Setup
-- ============================================
-- Go to Storage in Supabase Dashboard
-- Create a new bucket named: documents
-- Set as PRIVATE (not public)
-- Enable RLS policies:

-- Policy: Users can upload their own documents
-- INSERT policy on storage.objects for bucket 'documents'
-- WITH CHECK: bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]

-- Policy: Users can read their own documents
-- SELECT policy on storage.objects for bucket 'documents'
-- USING: bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]

-- ============================================
-- 5. Verify Setup
-- ============================================
-- Run these queries to check everything is set up correctly:

-- Check table exists
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'documents';

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'documents';

-- Check policies exist
SELECT policyname, tablename FROM pg_policies
WHERE tablename = 'documents';
