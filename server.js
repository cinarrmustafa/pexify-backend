import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));


const PORT = 3000;

// ✅ Engine klasörün: Desktop/pexify_engine (senin önceki mesajına göre)
const ENGINE_DIR = path.join(process.cwd(), "engine");

// ============================================
// Supabase Setup
// ============================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let supabaseAdmin = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase client initialized");
} else {
  console.warn("⚠️  Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env");
}

if (supabaseUrl && supabaseServiceKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  console.log("✅ Supabase admin client initialized");
}

// ============================================
// Multer Setup (for file uploads)
// ============================================
const upload = multer({
  storage: multer.memoryStorage(), // Store in memory, then upload to Supabase
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow PDFs, images, and common document types
    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF, images, and Excel files allowed."));
    }
  },
});

// Sağlam test endpoint
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend ayakta" });
});

app.post("/run", (req, res) => {
  // ✅ python3 PATH sorun çıkardığı için direkt absolute path
  const pythonPath = "/usr/bin/python3";

  const py = spawn(pythonPath, ["run_engine.py"], {
    cwd: ENGINE_DIR,
  });

  let out = "";
  let err = "";

  py.stdout.on("data", (d) => (out += d.toString()));
  py.stderr.on("data", (d) => (err += d.toString()));

  py.on("error", (e) => {
    // Spawn edemedi, python yok vb.
    return res.status(500).json({
      status: "ERROR",
      errors: [{ message: `spawn error: ${e.message}` }],
    });
  });

  py.on("close", (code) => {
    if (code !== 0) {
      return res.status(400).json({
        status: "ERROR",
        errors: [{ message: `python exit code ${code}`, detail: err || out }],
      });
    }

    // Python sadece JSON basmalı; biz parse edeceğiz
    try {
      const data = JSON.parse(out.trim());
      return res.json(data);
    } catch (e) {
      return res.status(400).json({
        status: "ERROR",
        errors: [
          {
            message: "Python JSON üretmedi / bozuk JSON",
            parse_error: e.message,
            raw_stdout: out.slice(0, 500),
            raw_stderr: err.slice(0, 500),
          },
        ],
      });
    }
  });
});

// ============================================
// Document Upload Endpoints
// ============================================

// POST /api/upload - Upload document to Supabase Storage + insert metadata
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!supabase || !supabaseAdmin) {
      return res.status(503).json({
        error: "Supabase not configured. Check .env file.",
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Get auth token from header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify user with token
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = userData.user.id;
    const file = req.file;
    const filename = file.originalname;
    const timestamp = Date.now();

    // Storage path: userId/timestamp-filename
    const filePath = `${userId}/${timestamp}-${filename}`;

    // 1. Upload to Supabase Storage (documents bucket)
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("documents")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return res.status(500).json({
        error: "Storage upload failed",
        details: uploadError.message,
      });
    }

    // 2. Insert metadata into public.documents table
    const { data: docData, error: dbError } = await supabaseAdmin
      .from("documents")
      .insert({
        user_id: userId,
        filename: filename,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.mimetype,
      })
      .select()
      .single();

    if (dbError) {
      // Rollback: delete uploaded file if DB insert fails
      await supabaseAdmin.storage.from("documents").remove([filePath]);
      console.error("Database insert error:", dbError);
      return res.status(500).json({
        error: "Database insert failed",
        details: dbError.message,
      });
    }

    res.status(200).json({
      success: true,
      document: docData,
      message: "File uploaded successfully",
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents - List user's documents
app.get("/api/documents", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);

    if (authError || !userData.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Fetch documents (RLS will filter by user_id automatically)
    const { data: documents, error: dbError } = await supabase
      .from("documents")
      .select("*")
      .order("uploaded_at", { ascending: false });

    if (dbError) {
      return res.status(500).json({ error: dbError.message });
    }

    res.json({ documents });
  } catch (err) {
    console.error("List documents error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id/url - Get signed URL for document preview
app.get("/api/documents/:id/url", async (req, res) => {
  try {
    if (!supabase || !supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);

    if (authError || !userData.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const docId = req.params.id;

    // Fetch document metadata (RLS ensures user owns it)
    const { data: doc, error: dbError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", docId)
      .single();

    if (dbError || !doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Generate signed URL (valid for 1 hour)
    const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
      .from("documents")
      .createSignedUrl(doc.file_path, 3600); // 1 hour

    if (urlError) {
      return res.status(500).json({ error: urlError.message });
    }

    res.json({
      document: doc,
      signedUrl: signedUrlData.signedUrl,
    });
  } catch (err) {
    console.error("Get signed URL error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend çalışıyor: http://localhost:${PORT}`);
  console.log(`Engine dir: ${ENGINE_DIR}`);
});
