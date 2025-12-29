import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import path from "path";
import os from "os";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));


const PORT = 3000;

// ✅ Engine klasörün: Desktop/pexify_engine (senin önceki mesajına göre)
const ENGINE_DIR = path.join(process.cwd(), "engine");

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

app.listen(PORT, () => {
  console.log(`Backend çalışıyor: http://localhost:${PORT}`);
  console.log(`Engine dir: ${ENGINE_DIR}`);
});
