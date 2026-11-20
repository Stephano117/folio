#!/usr/bin/env node
// Récupère le contenu depuis l'API au moment du build, pour que le site publié
// reste entièrement statique : les visiteurs ne touchent jamais l'API et
// n'attendent donc jamais son réveil.
//
// Sans PORTFOLIO_API_URL, ou si l'API ne répond pas, le fichier déjà présent
// dans public/ est conservé : un build ne doit jamais échouer à cause de ça.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "public", "portfolio.json");
const base = process.env.PORTFOLIO_API_URL?.replace(/\/+$/, "");

if (!base) {
  console.log("PORTFOLIO_API_URL absente : contenu local conservé.");
  process.exit(0);
}

// l'API dort sur son offre gratuite : son réveil peut demander une minute
const attempts = 6;
const delay = 15_000;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(`${base}/api/portfolio`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data?.profile?.name) throw new Error("réponse sans profil exploitable");

    writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`Contenu récupéré depuis l'API (tentative ${attempt}).`);
    process.exit(0);
  } catch (error) {
    console.warn(`Tentative ${attempt}/${attempts} échouée : ${error.message}`);
    if (attempt < attempts) await new Promise((r) => setTimeout(r, delay));
  }
}

console.warn("API injoignable : le contenu déjà publié est conservé.");
