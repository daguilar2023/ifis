#!/usr/bin/env node
/**
 * Seeds existing PDFs from /publicaciones into Supabase Storage + Postgres.
 *
 * Requires env vars (or .dev.vars):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/seed-publications.mjs
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pubsDir = join(root, "publicaciones");
const thumbsDir = join(root, "media", "thumbs");
const BUCKET = "publications";
const today = new Date().toISOString();

function loadEnvFile() {
  const path = join(root, ".dev.vars");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
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
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env/.dev.vars");
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

const THUMB_MAP = {
  "IFRS 18 - Decisión de Agenda del Comité de Interpretaciones (marzo 2026) FINAL.pdf":
    "ifrs18-agenda-thumb.png",
  "IFRS 18 - Medidas del Rendimiento Definidas por la Gerencia FINAL IFIS (Sexta Entrega).pdf":
    "ifrs18-rendimiento-thumb.png",
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

async function uploadObject(path, filePath, contentType) {
  const bytes = readFileSync(filePath);
  await supabase(`/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-upsert": "true",
    },
    rawBody: bytes,
  });
}

async function main() {
  const files = readdirSync(pubsDir)
    .filter((f) => extname(f).toLowerCase() === ".pdf")
    .map((f) => normalizeName(f));

  if (!files.length) {
    console.log("No PDFs found.");
    return;
  }

  console.log(`Seeding ${files.length} publications into Supabase...`);

  // Clear previous catalog rows (keeps auth helper tables)
  await supabase("/rest/v1/publications?id=neq.00000000-0000-0000-0000-000000000000", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

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

    console.log(`- ${actual}`);
    await uploadObject(pdfPath, absActual, "application/pdf");

    let thumbPath = null;
    const thumbFile = THUMB_MAP[actual] || THUMB_MAP[file];
    if (thumbFile) {
      const thumbAbs = join(thumbsDir, thumbFile);
      if (existsSync(thumbAbs)) {
        thumbPath = `thumbs/${id}/${storageSafeName(thumbFile)}`;
        await uploadObject(thumbPath, thumbAbs, "image/png");
      }
    }

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

  console.log("Seed complete.");
  console.log(`created_at set to ${today}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
