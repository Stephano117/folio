#!/usr/bin/env node
// Recopie les données et les médias de l'admin local vers le dossier statique
// du frontend, puis publie. Le site en ligne n'a pas de backend : c'est ce
// transfert qui fait exister les modifications faites dans /admin.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "backend", "data", "portfolio.json");
const sourceMedia = join(root, "backend", "uploads");
const targetData = join(root, "frontend", "public", "portfolio.json");
const targetMedia = join(root, "frontend", "public", "uploads");

if (!existsSync(source)) {
  console.error(`Introuvable : ${source}`);
  console.error("Lance d'abord `npm run dev` et enregistre tes données dans /admin.");
  process.exit(1);
}

const raw = readFileSync(source, "utf8");
const referenced = new Set(
  [...raw.matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g)].map((match) => match[1]),
);

mkdirSync(targetMedia, { recursive: true });

const missing = [];
for (const name of referenced) {
  const from = join(sourceMedia, name);
  if (!existsSync(from)) {
    missing.push(name);
    continue;
  }
  copyFileSync(from, join(targetMedia, name));
}

// retire les médias qui ne sont plus référencés, sinon ils s'accumulent
let removed = 0;
for (const name of readdirSync(targetMedia)) {
  if (!referenced.has(name)) {
    rmSync(join(targetMedia, name));
    removed += 1;
  }
}

writeFileSync(targetData, raw, "utf8");

console.log(`${referenced.size - missing.length} média(s) copié(s), ${removed} obsolète(s) retiré(s).`);
if (missing.length) {
  console.warn(`Fichiers référencés mais absents de backend/uploads : ${missing.join(", ")}`);
}

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

git("add", "frontend/public");
if (!git("status", "--porcelain", "frontend/public").trim()) {
  console.log("Aucun changement à publier.");
  process.exit(0);
}

git("commit", "-m", "Met à jour le contenu du portfolio");
git("push");
console.log("Publié. Vercel redéploie automatiquement.");
