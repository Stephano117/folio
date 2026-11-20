import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(backendDirectory);
const dataPath = join(backendDirectory, "data", "portfolio.json");
const seedPath = join(projectDirectory, "frontend", "public", "portfolio.json");
const uploadDirectory = join(backendDirectory, "uploads");
const profileDefaults = {
  phone: "",
  githubUrl: "",
  cvUrl: "",
  cvFileName: "",
  contactMessage: "Disponible pour échanger sur vos projets et opportunités.",
  footerEyebrow: "UN PROJET EN TÊTE ?",
  footerTitle: "Parlons-en",
  footerText: "Une question ou une opportunité ? Écrivez-moi, je vous répondrai avec plaisir.",
  footerNote: "Conçu avec intention.",
};

function missingRecord() {
  const error = new Error("Cet élément n’existe plus.");
  error.code = "P2025";
  return error;
}

function ordered(items) {
  return [...items].sort((a, b) => a.position - b.position
    || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function createLocalStore() {
  let initialization;
  let pendingWrite = Promise.resolve();

  async function save(filePath, data) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  }

  async function ensureInitialized() {
    if (!initialization) {
      initialization = (async () => {
        await mkdir(dirname(dataPath), { recursive: true });
        try {
          const current = JSON.parse(await readFile(dataPath, "utf8"));
          current.profile = { ...profileDefaults, ...current.profile };
          current.skills = current.skills.map((skill) => ({
            imageUrl: "",
            imagePublicId: "",
            ...skill,
            level: skill.level > 5 ? Math.max(1, Math.min(5, Math.round(skill.level / 20))) : skill.level,
          }));
          current.experiences ??= [];
          current.education ??= [];
          current.hobbies ??= [];
          await save(dataPath, current);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          const seed = JSON.parse(await readFile(seedPath, "utf8"));
          seed.profile = { ...profileDefaults, ...seed.profile };
          seed.experiences ??= [];
          seed.education ??= [];
          seed.hobbies ??= [];
          await save(dataPath, seed);
        }
        await mkdir(uploadDirectory, { recursive: true });
      })();
    }
    return initialization;
  }

  async function read() {
    await ensureInitialized();
    await pendingWrite;
    return JSON.parse(await readFile(dataPath, "utf8"));
  }

  function update(action) {
    const result = pendingWrite.then(async () => {
      await ensureInitialized();
      const state = JSON.parse(await readFile(dataPath, "utf8"));
      const value = action(state);
      await save(dataPath, state);
      return value;
    });
    pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  function createRepository(key) {
    return {
      async findMany() {
        const state = await read();
        return ordered(state[key]);
      },
      async aggregate() {
        const state = await read();
        return { _max: { position: state[key].reduce((max, item) => Math.max(max, item.position), -1) } };
      },
      async count() {
        const state = await read();
        return state[key].length;
      },
      async create({ data }) {
        return update((state) => {
          const timestamp = new Date().toISOString();
          const item = { id: randomUUID(), ...data, createdAt: timestamp, updatedAt: timestamp };
          state[key].push(item);
          return item;
        });
      },
      async update({ where, data }) {
        return update((state) => {
          const item = state[key].find((entry) => entry.id === where.id);
          if (!item) throw missingRecord();
          Object.assign(item, data, { updatedAt: new Date().toISOString() });
          return item;
        });
      },
      async delete({ where }) {
        return update((state) => {
          const index = state[key].findIndex((entry) => entry.id === where.id);
          if (index < 0) throw missingRecord();
          return state[key].splice(index, 1)[0];
        });
      },
      async reorderPositions({ orderedIds }) {
        return update((state) => {
          const items = orderedIds.map((id) => state[key].find((item) => item.id === id));
          if (
            items.some((item) => !item)
            || items.length !== state[key].length
            || new Set(orderedIds).size !== state[key].length
          ) {
            throw missingRecord();
          }
          const timestamp = new Date().toISOString();
          items.forEach((item, position) => {
            item.position = position;
            item.updatedAt = timestamp;
          });
        });
      },
    };
  }

  return {
    uploadDirectory,
    async health() {
      await ensureInitialized();
      await read();
    },
    $transaction(operations) {
      return Promise.all(operations);
    },
    profile: {
      async findUnique({ where }) {
        const state = await read();
        return state.profile.id === where.id ? state.profile : null;
      },
      async upsert({ create, update: changes }) {
        return update((state) => {
          if (!state.profile) state.profile = { ...create, createdAt: new Date().toISOString() };
          Object.assign(state.profile, changes, { updatedAt: new Date().toISOString() });
          return state.profile;
        });
      },
    },
    skill: createRepository("skills"),
    project: createRepository("projects"),
    experience: createRepository("experiences"),
    education: createRepository("education"),
    hobby: createRepository("hobbies"),
  };
}
