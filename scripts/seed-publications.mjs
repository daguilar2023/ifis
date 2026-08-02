#!/usr/bin/env node
/**
 * Seeds existing PDFs from /publicaciones into D1 + R2.
 * Usage:
 *   node scripts/seed-publications.mjs --local
 *   node scripts/seed-publications.mjs --remote
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, existsSync } from "node:fs";
import { basename, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pubsDir = join(root, "publicaciones");
const thumbsDir = join(root, "media", "thumbs");
const remote = process.argv.includes("--remote");
const flag = remote ? "--remote" : "--local";
const today = new Date().toISOString();

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

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
  return result.stdout;
}

function titleFromFilename(name) {
  return name.replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim();
}

function normalizeName(name) {
  // Handle NFC/NFD differences in filenames
  return name.normalize("NFC");
}

function findPdfFiles() {
  return readdirSync(pubsDir)
    .filter((f) => extname(f).toLowerCase() === ".pdf")
    .map((f) => normalizeName(f));
}

function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}

function main() {
  const files = findPdfFiles();
  if (!files.length) {
    console.log("No PDFs found in publicaciones/");
    return;
  }

  console.log(`Seeding ${files.length} publications (${remote ? "remote" : "local"})...`);

  // Clear existing rows for a clean seed of known local catalog
  run("npx", ["wrangler", "d1", "execute", "ifis-publications", flag, "--command", "DELETE FROM publications;"]);

  for (const file of files) {
    const id = randomUUID();
    const abs = join(pubsDir, file);
    // Resolve actual filesystem name if normalization differs
    const actual = readdirSync(pubsDir).find((f) => normalizeName(f) === file) || file;
    const absActual = join(pubsDir, actual);
    const title = titleFromFilename(actual);
    const description =
      DESCRIPTIONS[actual] ||
      DESCRIPTIONS[file] ||
      "Publicación técnica de IFIS Consultores Auditores.";
    const pdfKey = `pdfs/${id}/${actual}`;
    const thumbFile = THUMB_MAP[actual] || THUMB_MAP[file];
    let thumbKey = null;

    console.log(`- Uploading PDF: ${actual}`);
    run("npx", ["wrangler", "r2", "object", "put", `ifis-docs/${pdfKey}`, `--file=${absActual}`, `--content-type=application/pdf`, flag]);

    if (thumbFile) {
      const thumbPath = join(thumbsDir, thumbFile);
      if (existsSync(thumbPath)) {
        thumbKey = `thumbs/${id}/${thumbFile}`;
        console.log(`  + thumb: ${thumbFile}`);
        run("npx", [
          "wrangler",
          "r2",
          "object",
          "put",
          `ifis-docs/${thumbKey}`,
          `--file=${thumbPath}`,
          `--content-type=image/png`,
          flag,
        ]);
      }
    }

    const sql = `INSERT INTO publications (id, title, description, created_at, updated_at, pdf_key, thumb_key, pdf_filename)
      VALUES ('${sqlEscape(id)}', '${sqlEscape(title)}', '${sqlEscape(description)}', '${sqlEscape(today)}', '${sqlEscape(today)}', '${sqlEscape(pdfKey)}', ${
        thumbKey ? `'${sqlEscape(thumbKey)}'` : "NULL"
      }, '${sqlEscape(actual)}');`;

    run("npx", ["wrangler", "d1", "execute", "ifis-publications", flag, "--command", sql]);
  }

  console.log("Seed complete.");
  console.log(`created_at set to ${today} for all seeded documents.`);
}

main();
