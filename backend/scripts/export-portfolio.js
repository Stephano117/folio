import { config } from "dotenv";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.ts";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL est requise pour générer le portfolio statique.");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

try {
  const [profile, skills, projects, experiences, education, hobbies] = await prisma.$transaction([
    prisma.profile.findUnique({ where: { id: "main" } }),
    prisma.skill.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.project.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.experience.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.education.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.hobby.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  ]);

  if (!profile) {
    throw new Error("Le profil principal est absent de la base de données.");
  }

  const output = fileURLToPath(new URL("../../frontend/public/portfolio.json", import.meta.url));
  await writeFile(output, `${JSON.stringify({ profile, skills, projects, experiences, education, hobbies }, null, 2)}\n`, "utf8");
  console.log("Snapshot statique du portfolio généré.");
} finally {
  await prisma.$disconnect();
}
