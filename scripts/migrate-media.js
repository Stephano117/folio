#!/usr/bin/env node
// Transfère les médias stockés localement (backend/uploads) vers Cloudinary et
// réécrit les URLs du portfolio. Nécessaire avant d'héberger l'API : le disque
// d'un service gratuit est éphémère, les fichiers uploadés y disparaîtraient.
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { v2 as cloudinary } from "cloudinary";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

const required = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
const absent = required.filter((key) => !process.env[key]);
if (absent.length) {
  console.error(`Variables manquantes dans .env : ${absent.join(", ")}`);
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const dataPath = join(root, "frontend", "public", "portfolio.json");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const mediaDir = join(root, "backend", "uploads");

const uploaded = new Map();

async function upload(localUrl) {
  if (uploaded.has(localUrl)) return uploaded.get(localUrl);
  const name = localUrl.replace("/uploads/", "");
  const file = join(mediaDir, name);
  if (!existsSync(file)) throw new Error(`Fichier introuvable : ${file}`);

  const isPdf = name.toLowerCase().endsWith(".pdf");
  const result = await cloudinary.uploader.upload(file, {
    folder: "folio",
    resource_type: isPdf ? "raw" : "image",
    public_id: name.replace(/\.[^.]+$/, ""),
    overwrite: true,
  });
  const entry = { url: result.secure_url, publicId: result.public_id };
  uploaded.set(localUrl, entry);
  console.log(`  ${name} -> ${result.public_id}`);
  return entry;
}

// chaque média est décrit par une URL et, sauf pour le CV, un identifiant public
const pairs = [
  ["avatarUrl", "avatarPublicId"],
  ["imageUrl", "imagePublicId"],
  ["cvUrl", null],
];

async function convert(node) {
  if (Array.isArray(node)) {
    for (const item of node) await convert(item);
    return;
  }
  if (!node || typeof node !== "object") return;

  for (const [urlKey, idKey] of pairs) {
    const value = node[urlKey];
    if (typeof value !== "string" || !value.startsWith("/uploads/")) continue;
    const { url, publicId } = await upload(value);
    node[urlKey] = url;
    if (idKey) node[idKey] = publicId;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") await convert(value);
  }
}

console.log("Transfert vers Cloudinary…");
await convert(data);
writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`${uploaded.size} média(s) transféré(s). ${dataPath} mis à jour.`);
