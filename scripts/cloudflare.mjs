import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { parse } from "jsonc-parser";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kits } from "../src/catalog.js";

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
if (!["provision", "deploy", "storage-status", "upload-pdfs"].includes(mode))
  throw Error("Use provision, deploy, storage-status, or upload-pdfs.");
const local = process.argv.includes("--local");
if (local && mode !== "upload-pdfs")
  throw Error("--local is only supported for upload-pdfs.");
const configErrors = [];
const config = parse(await readFile("wrangler.jsonc", "utf8"), configErrors, {
  allowTrailingComma: true,
});
if (configErrors.length) throw Error("Invalid wrangler.jsonc configuration.");
const account = process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id;
if (!account) throw Error("Set CLOUDFLARE_ACCOUNT_ID.");
const token = local ? "" : await readToken();
if (!local && !token) throw Error("Token is required.");
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
if (mode === "upload-pdfs") {
  const bucket = config.r2_buckets.find(
    (binding) => binding.binding === "PDFS",
  )?.bucket_name;
  if (!bucket) throw Error("Configure the PDFS R2 binding first.");
  const sampleOnly = process.argv.includes("--sample-only");
  if (sampleOnly && !local)
    throw Error("--sample-only is for local previews only.");
  const ids = sampleOnly
    ? ["fundamentals"]
    : [...kits.map((kit) => kit.id), "fundamentals"];
  const files = [];
  for (const id of ids) {
    const path = `output/pdf/${id}.pdf`;
    const bytes = await readFile(path);
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      throw Error(`Invalid PDF: ${id}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    files.push({
      id,
      path,
      size: bytes.length,
      sha256,
      key: `kits/${id}/${sha256}.pdf`,
    });
  }
  if (!local) {
    const result = await cf("/r2/buckets");
    if (!result.buckets.some((item) => item.name === bucket)) {
      await cf("/r2/buckets", "POST", { name: bucket });
      console.log(`Created private R2 bucket: ${bucket}`);
    }
    const managed = await cf(`/r2/buckets/${bucket}/domains/managed`);
    const custom = await cf(`/r2/buckets/${bucket}/domains/custom`);
    if (managed.enabled || custom.domains?.length) {
      throw Error(
        "The PDF bucket has public access configured. Disable public access before uploading paid kits.",
      );
    }
  }
  const location = local ? "--local" : "--remote";
  await run(["d1", "migrations", "apply", "DB", location]);
  const scratch = await mkdtemp(join(tmpdir(), "preptrick-pdfs-"));
  try {
    for (const file of files) {
      await run([
        "r2",
        "object",
        "put",
        `${bucket}/${file.key}`,
        "--file",
        file.path,
        "--content-type",
        "application/pdf",
        location,
      ]);
      const download = join(scratch, `${file.id}.pdf`);
      await run([
        "r2",
        "object",
        "get",
        `${bucket}/${file.key}`,
        "--file",
        download,
        location,
      ]);
      const actual = createHash("sha256")
        .update(await readFile(download))
        .digest("hex");
      if (actual !== file.sha256)
        throw Error(`Upload verification failed: ${file.id}`);
      console.log(`Verified ${file.id}: ${file.size} bytes`);
    }
    // Switch every file record only after all content-addressed objects are verified.
    const updated = Math.floor(Date.now() / 1000);
    const values = files.map((file) => [
      file.id,
      file.key,
      file.size,
      file.sha256,
      updated,
    ]);
    const prefix =
      "INSERT INTO kit_files (kit_id, object_key, byte_size, sha256, updated_at) VALUES ";
    const suffix =
      " ON CONFLICT(kit_id) DO UPDATE SET object_key = excluded.object_key, byte_size = excluded.byte_size, sha256 = excluded.sha256, updated_at = excluded.updated_at";
    if (local) {
      const sqlFile = join(scratch, "files.sql");
      const literal = (value) =>
        typeof value === "number"
          ? String(value)
          : `'${value.replaceAll("'", "''")}'`;
      await writeFile(
        sqlFile,
        prefix +
          values.map((row) => `(${row.map(literal).join(",")})`).join(",") +
          suffix +
          ";\n",
      );
      await run(["d1", "execute", "DB", "--local", "--file", sqlFile]);
    } else {
      const result = await cf(
        `/d1/database/${config.d1_databases[0].database_id}/query`,
        "POST",
        {
          sql: prefix + files.map(() => "(?, ?, ?, ?, ?)").join(",") + suffix,
          params: values.flat(),
        },
      );
      if (result.some((statement) => !statement.success))
        throw Error("D1 file metadata could not be saved.");
    }
    console.log(
      `Stored and verified ${files.length} PDFs in ${bucket}; file metadata saved in D1 (${local ? "local" : "remote"}).`,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
} else if (mode === "storage-status") {
  const result = await cf("/r2/buckets");
  console.log(
    JSON.stringify({
      r2Available: true,
      buckets: result.buckets?.map((bucket) => bucket.name) || [],
    }),
  );
} else if (mode === "provision") {
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
