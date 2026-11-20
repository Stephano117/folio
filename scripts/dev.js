import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteCli = resolve(projectDirectory, "node_modules", "vite", "bin", "vite.js");
const services = [
  {
    name: "API",
    args: ["--import", "tsx", "backend/index.js"],
    cwd: projectDirectory,
  },
  {
    name: "Front",
    args: [viteCli, "--host", "0.0.0.0"],
    cwd: resolve(projectDirectory, "frontend"),
  },
];

const children = [];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

async function apiAlreadyRunning() {
  const port = Number(process.env.PORT ?? 4000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health.status === "ok";
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED" || error.name === "TimeoutError") return false;
    throw error;
  }
}

async function start() {
  const reuseApi = await apiAlreadyRunning();
  if (reuseApi) {
    console.info(`API déjà active sur le port ${process.env.PORT ?? 4000} : instance réutilisée.`);
  }

  for (const service of services) {
    if (service.name === "API" && reuseApi) continue;

    const child = spawn(process.execPath, service.args, {
      cwd: service.cwd,
      env: process.env,
      stdio: "inherit",
    });
    children.push(child);
    child.on("error", (error) => {
      console.error(`${service.name} n’a pas pu démarrer : ${error.message}`);
      stop(1);
    });
    child.on("exit", (code) => {
      if (!stopping) {
        console.error(`${service.name} s’est arrêté${code ? ` (code ${code})` : ""}.`);
        stop(code ?? 1);
      }
    });
  }
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await start();
}
