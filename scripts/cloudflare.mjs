import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { parse } from "jsonc-parser";

// Read a token without echoing or persisting it; child processes receive it only in their environment.
async function readToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  process.stdout.write("Cloudflare token (hidden): ");
  const input = process.stdin;
  if (input.isTTY) input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    function data(chunk) {
      for (const char of chunk) {
        if (char === "\u0003") {
          finish();
          reject(Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value.trim());
          return;
        }
        if (char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    }
    function finish() {
      input.off("data", data);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    }
    input.on("data", data);
  });
}
const mode = process.argv[2];
if (!["provision", "deploy"].includes(mode))
  throw Error("Use provision or deploy.");
const configErrors = [];
const config = parse(await readFile("wrangler.jsonc", "utf8"), configErrors, { allowTrailingComma: true });
if (configErrors.length) throw Error("Invalid wrangler.jsonc configuration.");
const account = process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id;
if (!account) throw Error("Set CLOUDFLARE_ACCOUNT_ID.");
const token = await readToken();
if (!token) throw Error("Token is required.");
async function cf(path, method = "GET", body) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.success)
    throw Error(
      `Cloudflare request failed (${response.status}): ${(result.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ")}`,
    );
  return result.result;
}
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: token,
        CLOUDFLARE_ACCOUNT_ID: account,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: "/tmp/preptrick-wrangler",
      },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`Wrangler exited with ${code}.`)),
    );
  });
}
if (mode === "provision") {
  const scripts = await cf("/workers/scripts");
  if (scripts.some((s) => s.id === config.name))
    throw Error(
      `A Worker named ${config.name} already exists. Choose a new project name before provisioning.`,
    );
  const databases = await cf("/d1/database?per_page=100");
  if (databases.some((d) => d.name === config.d1_databases[0].database_name))
    throw Error(
      "A database with this name already exists. Inspect it before choosing a new project name.",
    );
  const database = await cf("/d1/database", "POST", {
    name: config.d1_databases[0].database_name,
  });
  config.d1_databases[0].database_id = database.uuid;
  await writeFile("wrangler.jsonc", `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Created D1 database ${database.name}: ${database.uuid}`);
  await run(["d1", "migrations", "apply", "DB", "--remote"]);
} else {
  if (config.d1_databases[0].database_id.startsWith("00000000"))
    throw Error("Provision the D1 database first.");
  await run(["deploy"]);
}
