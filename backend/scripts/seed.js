import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.ts";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL est requise pour initialiser le portfolio.");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

try {
  const seedPath = fileURLToPath(new URL("../../frontend/public/portfolio.json", import.meta.url));
  const seed = JSON.parse(await readFile(seedPath, "utf8"));
  const profile = await prisma.profile.findUnique({ where: { id: "main" } });

  if (!profile) {
    await prisma.profile.create({ data: { id: "main", ...seed.profile } });
  }
  if (await prisma.skill.count() === 0) {
    await prisma.skill.createMany({
      data: seed.skills.map(({ id: _id, ...skill }) => ({ imageUrl: "", imagePublicId: "", ...skill })),
    });
  }
  if (await prisma.project.count() === 0) {
    await prisma.project.createMany({
      data: seed.projects.map(({ id: _id, ...project }) => project),
    });
  }
  if (await prisma.experience.count() === 0 && seed.experiences.length) {
    await prisma.experience.createMany({
      data: seed.experiences.map(({ id: _id, ...experience }) => experience),
    });
  }
  if (await prisma.education.count() === 0 && seed.education?.length) {
    await prisma.education.createMany({
      data: seed.education.map(({ id: _id, ...education }) => education),
    });
  }
  if (await prisma.hobby.count() === 0 && seed.hobbies.length) {
    await prisma.hobby.createMany({
      data: seed.hobbies.map(({ id: _id, ...hobby }) => hobby),
    });
  }

  console.log("Le contenu initial est prêt.");
} finally {
  await prisma.$disconnect();
}
