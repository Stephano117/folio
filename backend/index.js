import { config } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { v2 as cloudinary } from "cloudinary";
import cors from "cors";
import express from "express";
import { createLocalStore } from "./local-store.js";
import { rateLimit } from "express-rate-limit";
import { SignJWT, jwtVerify } from "jose";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "./generated/prisma/client.ts";
import { z } from "zod";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
config({ path: envPath });

async function configureLocalAdmin() {
  if (process.env.NODE_ENV === "production") return;

  const generatedPassword = !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH;
  const email = process.env.ADMIN_EMAIL || "admin@folio.local";
  const password = generatedPassword ? randomBytes(18).toString("base64url") : "";
  const passwordHash = generatedPassword
    ? await bcrypt.hash(password, 12)
    : process.env.ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.SESSION_SECRET?.length >= 32
    ? process.env.SESSION_SECRET
    : randomBytes(32).toString("hex");

  if (generatedPassword || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    let envContents = "";
    try {
      envContents = await readFile(envPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const values = {
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: sessionSecret,
    };
    for (const [key, value] of Object.entries(values)) {
      const line = `${key}="${value}"`;
      const matcher = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
      envContents = matcher.test(envContents)
        ? envContents.replace(matcher, line)
        : `${envContents.trimEnd()}${envContents.trim() ? "\n" : ""}${line}\n`;
      process.env[key] = value;
    }
    await mkdir(dirname(envPath), { recursive: true });
    await writeFile(envPath, envContents, { encoding: "utf8", mode: 0o600 });
  }

  if (generatedPassword) {
    console.info(`Compte admin local créé : ${email} / ${password}`);
  }
}

await configureLocalAdmin();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const sessionCookie = "folio_admin";
const sessionAgeSeconds = 60 * 60 * 24 * 7;
// L'hébergeur attribue plusieurs domaines au même déploiement : FRONTEND_URL
// accepte donc une liste séparée par des virgules, sans quoi l'administration
// ne fonctionnerait que depuis l'un d'eux.
const allowedOrigins = new Set([
  ...(process.env.FRONTEND_URL ?? "").split(",").map((origin) => origin.trim().replace(/\/+$/, "")),
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean));
const localDevPorts = new Set(["3000", "3001", "4173"]);

function isAllowedOrigin(origin) {
  if (allowedOrigins.has(origin)) return true;
  if (process.env.NODE_ENV === "production") return false;

  try {
    const url = new URL(origin);
    const port = Number(url.port);
    const isLocalDevPort = localDevPorts.has(url.port) || (port >= 5173 && port <= 5199);
    if (url.protocol !== "http:" || !isLocalDevPort) return false;

    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
    const address = url.hostname.split(".").map(Number);
    if (address.length !== 4 || address.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }

    return address[0] === 10
      || (address[0] === 172 && address[1] >= 16 && address[1] <= 31)
      || (address[0] === 192 && address[1] === 168);
  } catch {
    return false;
  }
}

const prisma = process.env.DATABASE_URL
  ? new PrismaClient({
      adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
    })
  : null;
const localStore = !prisma && process.env.NODE_ENV !== "production"
  ? createLocalStore()
  : null;
const store = prisma ?? localStore;
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origine non autorisée."));
  },
}));
app.use(express.json({ limit: "16mb" }));
if (localStore) {
  app.use("/uploads", express.static(localStore.uploadDirectory, {
    fallthrough: false,
    immutable: true,
    maxAge: "1y",
  }));
}

function usesProtocol(value, protocols) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const secureUrl = z.string().trim().url().refine(
  (value) => usesProtocol(value, ["https:"]),
  "Une adresse HTTPS est requise.",
);
const githubProfileUrl = secureUrl.refine((value) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (hostname === "github.com" || hostname === "www.github.com")
      && url.pathname.split("/").filter(Boolean).length > 0;
  } catch {
    return false;
  }
}, "Une adresse de profil github.com est requise.");
const webUrl = z.string().trim().url().refine(
  (value) => usesProtocol(value, ["http:", "https:"]),
  "Une adresse HTTP ou HTTPS est requise.",
);
const localPhotoUrl = z.string().regex(/^\/uploads\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/i);
const optionalPhotoUrl = z.union([secureUrl, localPhotoUrl, z.literal("")]);
const localCvUrl = z.string().regex(/^\/uploads\/[0-9a-f-]{36}\.pdf$/i);
const optionalCvUrl = z.union([secureUrl, localCvUrl, z.literal("")]);
const cvFileName = z.string().trim().max(124).regex(/^[\p{L}\p{N}._ -]+\.pdf$/iu).or(z.literal(""));
const optionalWebUrl = z.union([webUrl, z.literal("")]);
const optionalPhone = z.union([
  z.string().trim().regex(/^[+0-9().\-\s]{6,30}$/),
  z.literal(""),
]);

const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  role: z.string().trim().min(1).max(140),
  location: z.string().trim().max(120),
  email: z.union([z.email(), z.literal("")]),
  phone: optionalPhone,
  githubUrl: z.union([githubProfileUrl, z.literal("")]),
  bio: z.string().trim().max(1200),
  cvUrl: optionalCvUrl,
  cvFileName,
  avatarUrl: optionalPhotoUrl,
  avatarPublicId: z.string().trim().max(200),
  contactMessage: z.string().trim().max(240),
  footerEyebrow: z.string().trim().max(100),
  footerTitle: z.string().trim().max(140),
  footerText: z.string().trim().max(400),
  footerNote: z.string().trim().max(160),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const skillSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(60),
  level: z.number().int().min(1).max(5),
  imageUrl: optionalPhotoUrl,
  imagePublicId: z.string().trim().max(200),
});

const experienceSchema = z.object({
  role: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120),
  startDate: z.string().trim().min(4).max(20),
  endDate: z.string().trim().max(20),
  description: z.string().trim().max(1200),
  imageUrl: optionalPhotoUrl,
  imagePublicId: z.string().trim().max(200),
});

const educationSchema = z.object({
  degree: z.string().trim().min(1).max(140),
  institution: z.string().trim().min(1).max(140),
  location: z.string().trim().max(120),
  startDate: z.string().trim().min(4).max(20),
  endDate: z.string().trim().max(20),
  description: z.string().trim().max(1200),
  imageUrl: optionalPhotoUrl,
  imagePublicId: z.string().trim().max(200),
});

const projectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1200),
  imageUrl: optionalPhotoUrl,
  imagePublicId: z.string().trim().max(200),
  link: optionalWebUrl,
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
});

const hobbySchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(600),
  imageUrl: optionalPhotoUrl,
  imagePublicId: z.string().trim().max(200),
});

function getCookie(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const item = cookies.find((part) => part.trim().startsWith(`${name}=`));
  return item ? decodeURIComponent(item.trim().slice(name.length + 1)) : "";
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production";
  response.cookie(sessionCookie, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api",
    maxAge: sessionAgeSeconds * 1000,
  });
}

async function requireAdmin(request, response, next) {
  if (!process.env.SESSION_SECRET || secret.length < 32) {
    response.status(503).json({ error: "Configure SESSION_SECRET avec au moins 32 caractères." });
    return;
  }

  const token = getCookie(request, sessionCookie);
  if (!token) {
    response.status(401).json({ error: "Connexion administrateur requise." });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.role !== "admin" || payload.email !== process.env.ADMIN_EMAIL) {
      response.status(401).json({ error: "Session administrateur invalide." });
      return;
    }
    next();
  } catch {
    response.status(401).json({ error: "Session expirée. Reconnecte-toi." });
  }
}

function validate(schema, body, response) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    response.status(400).json({ error: "Certains champs sont invalides." });
    return null;
  }
  return parsed.data;
}

function requireDataStore(_request, response, next) {
  if (!store) {
    response.status(503).json({
      error: "Le mode local est disponible en développement. En production, configure DATABASE_URL.",
    });
    return;
  }
  next();
}

async function requestStaticPublish() {
  const hook = process.env.VERCEL_DEPLOY_HOOK;
  if (!hook) {
    return false;
  }

  try {
    const response = await fetch(hook, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Vercel a répondu ${response.status}.`);
    }
    return true;
  } catch (error) {
    console.error("La publication du portfolio n’a pas pu être lancée.", error);
    return false;
  }
}

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/health", async (_request, response) => {
  const missing = [];
  if (!store) missing.push("DATABASE_URL (obligatoire en production)");
  if (!process.env.ADMIN_EMAIL) missing.push("ADMIN_EMAIL");
  if (!process.env.ADMIN_PASSWORD_HASH) missing.push("ADMIN_PASSWORD_HASH");
  if (!process.env.SESSION_SECRET || secret.length < 32) missing.push("SESSION_SECRET (32 caractères minimum)");

  if (missing.length) {
    response.status(503).json({
      status: "not_ready",
      error: `Configuration manquante : ${missing.join(", ")}.`,
    });
    return;
  }

  try {
    if (prisma) {
      await prisma.$queryRaw`SELECT 1`;
      response.json({ status: "ok", storage: "postgresql" });
    } else {
      await localStore.health();
      response.json({ status: "ok", storage: "local-file" });
    }
  } catch (error) {
    console.error("La vérification de la base PostgreSQL a échoué.", error);
    response.status(503).json({
      status: "not_ready",
      error: prisma
        ? "Connexion à PostgreSQL impossible. Vérifie DATABASE_URL et l’accès réseau à Neon."
        : "Le stockage local ne peut pas être initialisé. Vérifie les droits d’écriture du projet.",
    });
  }
});

app.use("/api", requireDataStore);

app.get("/api/portfolio", async (_request, response) => {
  const [profile, skills, projects, experiences, education, hobbies] = await store.$transaction([
    store.profile.findUnique({ where: { id: "main" } }),
    store.skill.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    store.project.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    store.experience.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    store.education.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    store.hobby.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  ]);
  response.setHeader("Cache-Control", "no-store");
  response.json({ profile, skills, projects, experiences, education, hobbies });
});

app.post(
  "/api/admin/login",
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false }),
  async (request, response) => {
    const email = z.email().safeParse(request.body?.email);
    const password = z.string().min(1).max(200).safeParse(request.body?.password);
    const configuredEmail = process.env.ADMIN_EMAIL?.toLowerCase();
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;

    if (!email.success || !password.success) {
      response.status(400).json({ error: "Adresse e-mail ou mot de passe manquant." });
      return;
    }
    if (!configuredEmail || !passwordHash || !process.env.SESSION_SECRET || secret.length < 32) {
      response.status(503).json({
        error: "Configure ADMIN_EMAIL, ADMIN_PASSWORD_HASH et SESSION_SECRET dans le fichier .env.",
      });
      return;
    }
    if (
      email.data.toLowerCase() !== configuredEmail ||
      !(await bcrypt.compare(password.data, passwordHash))
    ) {
      response.status(401).json({ error: "Adresse e-mail ou mot de passe incorrect." });
      return;
    }

    const token = await new SignJWT({ email: configuredEmail, role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${sessionAgeSeconds}s`)
      .sign(secret);
    setSessionCookie(response, token);
    response.json({ success: true });
  },
);

app.get("/api/admin/me", requireAdmin, (_request, response) => {
  response.json({ authenticated: true });
});

app.post("/api/admin/logout", requireAdmin, (_request, response) => {
  response.clearCookie(sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
  });
  response.json({ success: true });
});

app.put("/api/admin/profile", requireAdmin, async (request, response) => {
  const data = validate(profileSchema, request.body, response);
  if (!data) return;

  const profile = await store.profile.upsert({
    where: { id: "main" },
    create: { id: "main", ...data },
    update: data,
  });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ profile, publishTriggered });
});

app.post("/api/admin/skills", requireAdmin, async (request, response) => {
  const data = validate(skillSchema, request.body, response);
  if (!data) return;

  const { _max } = await store.skill.aggregate({ _max: { position: true } });
  const position = (_max.position ?? -1) + 1;
  const skill = await store.skill.create({ data: { ...data, position } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.status(201).json({ skill, publishTriggered });
});

app.put("/api/admin/skills/:id", requireAdmin, async (request, response) => {
  const data = validate(skillSchema, request.body, response);
  if (!data) return;

  const skill = await store.skill.update({ where: { id: request.params.id }, data });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ skill, publishTriggered });
});

app.delete("/api/admin/skills/:id", requireAdmin, async (request, response) => {
  await store.skill.delete({ where: { id: request.params.id } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ success: true, publishTriggered });
});

app.post("/api/admin/projects", requireAdmin, async (request, response) => {
  const data = validate(projectSchema, request.body, response);
  if (!data) return;

  const { _max } = await store.project.aggregate({ _max: { position: true } });
  const position = (_max.position ?? -1) + 1;
  const project = await store.project.create({ data: { ...data, position } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.status(201).json({ project, publishTriggered });
});

app.put("/api/admin/projects/:id", requireAdmin, async (request, response) => {
  const data = validate(projectSchema, request.body, response);
  if (!data) return;

  const project = await store.project.update({ where: { id: request.params.id }, data });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ project, publishTriggered });
});

app.delete("/api/admin/projects/:id", requireAdmin, async (request, response) => {
  await store.project.delete({ where: { id: request.params.id } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ success: true, publishTriggered });
});

app.post("/api/admin/experiences", requireAdmin, async (request, response) => {
  const data = validate(experienceSchema, request.body, response);
  if (!data) return;

  const { _max } = await store.experience.aggregate({ _max: { position: true } });
  const position = (_max.position ?? -1) + 1;
  const experience = await store.experience.create({ data: { ...data, position } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.status(201).json({ experience, publishTriggered });
});

app.put("/api/admin/experiences/:id", requireAdmin, async (request, response) => {
  const data = validate(experienceSchema, request.body, response);
  if (!data) return;

  const experience = await store.experience.update({ where: { id: request.params.id }, data });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ experience, publishTriggered });
});

app.delete("/api/admin/experiences/:id", requireAdmin, async (request, response) => {
  await store.experience.delete({ where: { id: request.params.id } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ success: true, publishTriggered });
});

app.post("/api/admin/education", requireAdmin, async (request, response) => {
  const data = validate(educationSchema, request.body, response);
  if (!data) return;

  const { _max } = await store.education.aggregate({ _max: { position: true } });
  const position = (_max.position ?? -1) + 1;
  const education = await store.education.create({ data: { ...data, position } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.status(201).json({ education, publishTriggered });
});

app.put("/api/admin/education/:id", requireAdmin, async (request, response) => {
  const data = validate(educationSchema, request.body, response);
  if (!data) return;

  const education = await store.education.update({ where: { id: request.params.id }, data });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ education, publishTriggered });
});

app.delete("/api/admin/education/:id", requireAdmin, async (request, response) => {
  await store.education.delete({ where: { id: request.params.id } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ success: true, publishTriggered });
});

app.post("/api/admin/hobbies", requireAdmin, async (request, response) => {
  const data = validate(hobbySchema, request.body, response);
  if (!data) return;

  const { _max } = await store.hobby.aggregate({ _max: { position: true } });
  const position = (_max.position ?? -1) + 1;
  const hobby = await store.hobby.create({ data: { ...data, position } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.status(201).json({ hobby, publishTriggered });
});

app.put("/api/admin/hobbies/:id", requireAdmin, async (request, response) => {
  const data = validate(hobbySchema, request.body, response);
  if (!data) return;

  const hobby = await store.hobby.update({ where: { id: request.params.id }, data });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ hobby, publishTriggered });
});

app.delete("/api/admin/hobbies/:id", requireAdmin, async (request, response) => {
  await store.hobby.delete({ where: { id: request.params.id } });
  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ success: true, publishTriggered });
});

app.post("/api/admin/:collection/:id/move", requireAdmin, async (request, response) => {
  const moveSchema = z.object({
    direction: z.enum(["up", "down"]).optional(),
    targetId: z.string().min(1).optional(),
    placement: z.enum(["before", "after"]).optional(),
  }).refine((value) => {
    const hasDirection = Boolean(value.direction);
    const hasTarget = Boolean(value.targetId);
    return hasDirection !== hasTarget && (hasTarget ? Boolean(value.placement) : value.placement === undefined);
  });
  const parsed = z.object({
    collection: z.enum(["skills", "experiences", "education", "projects", "hobbies"]),
    move: moveSchema,
  }).safeParse({
    collection: request.params.collection,
    move: {
      direction: request.body?.direction,
      targetId: request.body?.targetId,
      placement: request.body?.placement,
    },
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Section ou position de déplacement invalide." });
    return;
  }

  const repository = {
    skills: store.skill,
    experiences: store.experience,
    education: store.education,
    projects: store.project,
    hobbies: store.hobby,
  }[parsed.data.collection];
  const items = await repository.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const index = items.findIndex((item) => item.id === request.params.id);
  if (index < 0) {
    response.status(404).json({ error: "Cet élément n’existe plus." });
    return;
  }

  if (!parsed.data.move.direction && parsed.data.move.targetId === request.params.id) {
    response.json({ success: true, moved: false, publishTriggered: false });
    return;
  }

  const reorderedItems = [...items];
  const [current] = reorderedItems.splice(index, 1);
  let destination;
  if (parsed.data.move.direction) {
    destination = index + (parsed.data.move.direction === "up" ? -1 : 1);
  } else {
    const targetIndex = reorderedItems.findIndex((item) => item.id === parsed.data.move.targetId);
    if (targetIndex < 0) {
      response.status(404).json({ error: "La destination n’existe plus." });
      return;
    }
    destination = targetIndex + (parsed.data.move.placement === "after" ? 1 : 0);
  }
  if (destination < 0 || destination > reorderedItems.length) {
    response.json({ success: true, moved: false, publishTriggered: false });
    return;
  }

  reorderedItems.splice(destination, 0, current);
  if (reorderedItems.every((item, position) => item.id === items[position].id)) {
    response.json({ success: true, moved: false, publishTriggered: false });
    return;
  }

  if (localStore) {
    await repository.reorderPositions({ orderedIds: reorderedItems.map((item) => item.id) });
  } else {
    await prisma.$transaction([
      ...reorderedItems.map((item, position) => (
        repository.update({ where: { id: item.id }, data: { position } })
      )),
    ]);
  }

  const publishTriggered = localStore ? true : await requestStaticPublish();
  response.json({ success: true, moved: true, publishTriggered });
});

app.post("/api/admin/upload-local", requireAdmin, async (request, response) => {
  if (!localStore) {
    response.status(404).json({ error: "Le téléversement local est réservé au mode développement." });
    return;
  }

  const parsed = z.string()
    .max(7_000_000)
    .regex(/^data:image\/(jpeg|png|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/)
    .safeParse(request.body?.dataUrl);
  if (!parsed.success) {
    response.status(400).json({ error: "Choisis une image JPEG, PNG, WebP ou AVIF valide de moins de 5 Mo." });
    return;
  }

  const [, mimeType, encodedImage] = parsed.data.match(/^data:(image\/(?:jpeg|png|webp|avif));base64,(.+)$/);
  const image = Buffer.from(encodedImage, "base64");
  if (!image.length || image.length > 5_000_000) {
    response.status(400).json({ error: "L’image ne doit pas dépasser 5 Mo." });
    return;
  }

  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" }[mimeType];
  const fileName = `${randomUUID()}.${extension}`;
  await mkdir(localStore.uploadDirectory, { recursive: true });
  await writeFile(join(localStore.uploadDirectory, fileName), image, { flag: "wx" });
  response.status(201).json({ url: `/uploads/${fileName}`, publicId: `local:${fileName}` });
});

app.post("/api/admin/upload-cv-local", requireAdmin, async (request, response) => {
  if (!localStore) {
    response.status(404).json({ error: "Le téléversement local est réservé au mode développement." });
    return;
  }

  const parsed = z.object({
    dataUrl: z.string()
      .max(14_000_000)
      .regex(/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/),
    fileName: z.string().trim().min(1).max(255),
  }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Choisis un fichier PDF valide de moins de 10 Mo." });
    return;
  }

  const [, encodedPdf] = parsed.data.dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
  const pdf = Buffer.from(encodedPdf, "base64");
  if (pdf.length > 10_000_000 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    response.status(400).json({ error: "Le fichier n’est pas un PDF valide ou dépasse 10 Mo." });
    return;
  }

  const safeName = `${parsed.data.fileName
    .replace(/[\\/]/g, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\.pdf$/i, "")
    .trim()
    .slice(0, 115) || "CV"}.pdf`;
  const storageName = `${randomUUID()}.pdf`;
  await mkdir(localStore.uploadDirectory, { recursive: true });
  await writeFile(join(localStore.uploadDirectory, storageName), pdf, { flag: "wx" });
  response.status(201).json({ url: `/uploads/${storageName}`, fileName: safeName });
});

app.post("/api/admin/upload-signature", requireAdmin, (request, response) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    response.status(503).json({ error: "Configure les identifiants Cloudinary." });
    return;
  }

  const assetType = z.enum(["image", "cv"]).default("image").safeParse(request.body?.assetType);
  if (!assetType.success) {
    response.status(400).json({ error: "Type de fichier à téléverser invalide." });
    return;
  }

  const params = {
    allowed_formats: assetType.data === "cv" ? "pdf" : "jpg,png,webp,avif",
    folder: assetType.data === "cv" ? "folio/cv" : "folio",
    timestamp: Math.floor(Date.now() / 1000),
  };
  const signature = cloudinary.utils.api_sign_request(params, apiSecret);
  response.json({
    ...params,
    resourceType: assetType.data === "cv" ? "raw" : "image",
    signature,
    apiKey,
    cloudName,
  });
});

app.use((error, _request, response, _next) => {
  if (error?.message === "Origine non autorisée.") {
    response.status(403).json({ error: "Origine non autorisée." });
    return;
  }
  if (error?.type === "entity.too.large") {
    response.status(413).json({ error: "La requête est trop volumineuse." });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    response.status(400).json({ error: "Le contenu JSON de la requête est invalide." });
    return;
  }
  if (error?.code === "P2025") {
    response.status(404).json({ error: "Cet élément n’existe plus." });
    return;
  }
  console.error("Erreur API inattendue.", error);
  response.status(500).json({ error: "Une erreur serveur est survenue." });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`API portfolio prête sur le port ${port}.`);
  if (!process.env.DATABASE_URL) {
    console.info(localStore
      ? "Aucune base Neon configurée : le stockage JSON local est actif."
      : "DATABASE_URL absent : configure PostgreSQL pour activer l’API en production.");
  }
});

async function shutdown() {
  server.close(async () => {
    if (prisma) await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
