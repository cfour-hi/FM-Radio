#!/usr/bin/env node
/*
 * 把当前快照发布到 GitHub Release，并更新 data/manifest.json。
 *
 * tag 由生成日期 + 内容哈希组成（例如 data-2026-11-01-a1b2c3d4），
 * 同样内容重复发布会落到同一个 tag，不同内容不会覆盖旧版本——构建按
 * manifest 固定到某一个 tag，旧提交不会被新数据影响。
 *
 * 用法：
 *   node scripts/build-stations.mjs   # 先重新生成快照
 *   pnpm data:publish                 # 创建 release + 更新 manifest
 *   pnpm data:publish -- --dry-run    # 只生成 manifest，不碰 GitHub
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const MANIFEST_DIR = resolve(ROOT, "data");
const MANIFEST_PATH = resolve(MANIFEST_DIR, "manifest.json");

const FILES = [
  { name: "stations-core.json", key: "core" },
  { name: "stations-rest.json", key: "rest" },
  { name: "stations-catalog.json", key: "catalog" },
];

const dryRun = process.argv.includes("--dry-run");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  const files = [];
  const counts = {};
  let generatedAt = "";

  for (const { name, key } of FILES) {
    const buffer = await readFile(resolve(DATA_DIR, name));
    const snapshot = JSON.parse(buffer.toString("utf8"));
    generatedAt ||= typeof snapshot.generatedAt === "string" ? snapshot.generatedAt : "";
    counts[key] = Array.isArray(snapshot.stations) ? snapshot.stations.length : 0;
    files.push({ name, bytes: buffer.length, sha256: sha256(buffer) });
  }

  if (!generatedAt) generatedAt = new Date().toISOString().slice(0, 10);

  const contentHash = sha256(Buffer.from(files.map((file) => file.sha256).join(""))).slice(0, 8);
  const tag = process.env.FM_DATA_TAG || `data-${generatedAt}-${contentHash}`;

  const manifest = { v: 1, tag, generatedAt, counts, files };
  await mkdir(MANIFEST_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`manifest 已更新：${tag}`);
  console.log(`  core ${counts.core} · rest ${counts.rest} · catalog ${counts.catalog}`);

  if (dryRun) {
    console.log("--dry-run：未创建 release");
    return;
  }

  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("未找到 gh CLI：请先安装并登录，或加 --dry-run 只生成 manifest");
  }

  const assets = FILES.map((file) => resolve(DATA_DIR, file.name));
  try {
    execFileSync(
      "gh",
      [
        "release", "create", tag,
        ...assets,
        "--title", `电台数据 ${generatedAt}`,
        "--notes", `core ${counts.core} · rest ${counts.rest} · catalog ${counts.catalog}`,
      ],
      { stdio: "inherit" },
    );
  } catch {
    console.log("release 已存在，改为上传覆盖…");
    execFileSync("gh", ["release", "upload", tag, ...assets, "--clobber"], { stdio: "inherit" });
  }

  console.log("");
  console.log("下一步：pnpm data:check，然后提交 data/manifest.json");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
