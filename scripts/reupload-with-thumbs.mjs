#!/usr/bin/env node
/**
 * Deletes existing Supabase publications and re-uploads local PDFs
 * with first-page thumbnails generated via pdftoppm.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, extname, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pubsDir = join(root, "publicaciones");
const BUCKET = "publications";
const today = new Date().toISOString();

function loadEnvFile() {
  const path = join(root, ".dev.vars");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const DESCRIPTIONS = {
  "IFRS 18 - Decisión de Agenda del Comité de Interpretaciones (marzo 2026) FINAL.pdf":
    "Informe IFIS sobre la decisión de agenda emitida por el Comité de Interpretaciones, marzo 2026.",
  "IFRS 18 - Medidas del Rendimiento Definidas por la Gerencia FINAL IFIS (Sexta Entrega).pdf":
    "Guía IFIS sobre la presentación de medidas de rendimiento definidas por la gerencia.",
  "IFRS 18 - Experiencias en su Aplicación (Octava Entrega).pdf":
    "Experiencias prácticas de IFIS en la aplicación de IFRS 18 (octava entrega).",
  "IFRS 18 - Experiencias en su Aplicación (Novena Entrega).pdf":
    "Experiencias prácticas de IFIS en la aplicación de IFRS 18 (novena entrega).",
  "Comunicado CMF - Ampliación de Plazo  NIIF S1 y S2.pdf":
    "Comunicado sobre ampliación de plazo relacionada con NIIF S1 y S2.",
  "NCG_572_2026 Ampliación de Plazo.pdf":
    "Norma de carácter general NCG 572-2026 sobre ampliación de plazo.",
};

function normalizeName(name) {
  return name.normalize("NFC");
}

function titleFromFilename(name) {
  return name.replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim();
}

function storageSafeName(name) {
  const ext = extname(name) || ".pdf";
  const base = name
    .normalize("NFC")
    .replace(ext, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${base || "document"}${ext.toLowerCase()}`;
}

async function supabase(path, { method = "GET", headers = {}, body, rawBody } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...headers,
    },
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function uploadObject(path, filePathOrBuffer, contentType) {
  const bytes = Buffer.isBuffer(filePathOrBuffer)
    ? filePathOrBuffer
    : readFileSync(filePathOrBuffer);
  await supabase(`/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-upsert": "true",
    },
    rawBody: bytes,
  });
}

async function removeStoragePaths(paths) {
  const clean = paths.filter(Boolean);
  if (!clean.length) return;
  try {
    await supabase(`/storage/v1/object/remove/${BUCKET}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { prefixes: clean },
    });
  } catch {
    await supabase(`/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: clean,
    }).catch(() => {});
  }
}

function renderFirstPagePng(pdfPath) {
  const dir = mkdtempSync(join(tmpdir(), "ifis-thumb-"));
  const outBase = join(dir, "page");
  const result = spawnSync(
    "pdftoppm",
    ["-png", "-f", "1", "-singlefile", "-r", "144", pdfPath, outBase],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(result.stderr || "pdftoppm failed");
  }
  const pngPath = `${outBase}.png`;
  if (!existsSync(pngPath)) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error("Thumbnail PNG was not created");
  }
  const bytes = readFileSync(pngPath);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

async function main() {
  const files = readdirSync(pubsDir)
    .filter((f) => extname(f).toLowerCase() === ".pdf")
    .map((f) => normalizeName(f));

  if (!files.length) {
    console.log("No PDFs found.");
    return;
  }

  console.log("Fetching existing publications…");
  const existing = await supabase(
    "/rest/v1/publications?select=id,pdf_path,thumb_path"
  );
  console.log(`Deleting ${existing.length} existing rows + storage objects…`);
  const paths = existing.flatMap((row) => [row.pdf_path, row.thumb_path].filter(Boolean));
  await removeStoragePaths(paths);
  await supabase("/rest/v1/publications?id=neq.00000000-0000-0000-0000-000000000000", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  console.log(`Re-uploading ${files.length} PDFs with first-page thumbnails…`);
  for (const file of files) {
    const actual = readdirSync(pubsDir).find((f) => normalizeName(f) === file) || file;
    const absActual = join(pubsDir, actual);
    const id = randomUUID();
    const title = titleFromFilename(actual);
    const description =
      DESCRIPTIONS[actual] ||
      DESCRIPTIONS[file] ||
      "Publicación técnica de IFIS Consultores Auditores.";
    const pdfPath = `pdfs/${id}/${storageSafeName(actual)}`;
    const thumbPath = `thumbs/${id}/preview.png`;

    console.log(`- ${actual}`);
    const thumbBytes = renderFirstPagePng(absActual);
    await uploadObject(pdfPath, absActual, "application/pdf");
    await uploadObject(thumbPath, thumbBytes, "image/png");

    await supabase("/rest/v1/publications", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: {
        id,
        title,
        description,
        created_at: today,
        updated_at: today,
        pdf_path: pdfPath,
        thumb_path: thumbPath,
        pdf_filename: actual,
      },
    });
  }

  console.log("Done. All publications re-uploaded with first-page thumbnails.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
