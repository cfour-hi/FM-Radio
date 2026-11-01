#!/usr/bin/env node
/*
 * 把当前快照发布到 GitHub Release，并更新 data/manifest.json。
 *
 * tag 由生成日期 + 内容哈希组成（例如 data-2026-11-01-a1b2c3d4），
 * 同样内容重复发布会落到同一个 tag，不同内容不会覆盖旧版本——构建按
 * manifest 固定到某一个 tag，旧提交不会被新数据影响。
 *
 * 发布优先用 gh CLI；没有 gh 时设置 GITHUB_TOKEN / GH_TOKEN 会改走 REST API
 *（token 需要 contents: read/write）。两种方式都会先更新 data/manifest.json。
 *
 * 用法：
 *   node scripts/build-stations.mjs   # 先重新生成快照
 *   pnpm data:publish                 # 创建 release + 更新 manifest
 *   pnpm data:publish -- --dry-run    # 只生成 manifest，不碰 GitHub
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
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
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function hasGh() {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 当前仓库的 owner/repo；CI 里读 GITHUB_REPOSITORY，本地从 origin 解析。 */
function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return match ? `${match[1]}/${match[2]}` : "";
  } catch {
    return "";
  }
}

async function api(repo, path, init = {}) {
  return fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
}

/** 没有 gh 时走 REST：创建 release 再逐个上传资产；同名资产先删后传。 */
async function publishWithApi({ repo, tag, title, notes, assets }) {
  let response = await api(repo, "/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name: title, body: notes, draft: false, prerelease: false }),
  });

  if (response.status === 422) {
    response = await api(repo, `/releases/tags/${encodeURIComponent(tag)}`);
  }
  if (!response.ok) {
    throw new Error(`创建 release 失败（HTTP ${response.status}）：${await response.text()}`);
  }

  const release = await response.json();
  const existing = await api(repo, `/releases/${release.id}/assets?per_page=100`);
  const current = existing.ok ? await existing.json() : [];

  for (const asset of assets) {
    const name = basename(asset);
    for (const old of current.filter((item) => item.name === name)) {
      await api(repo, `/releases/assets/${old.id}`, { method: "DELETE" });
    }

    const upload = await fetch(
      `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: await readFile(asset),
      },
    );
    if (!upload.ok) {
      throw new Error(`上传失败（HTTP ${upload.status}）：${name} · ${await upload.text()}`);
    }
    console.log(`  ✓ ${name}`);
  }
}

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

  const assets = FILES.map((file) => resolve(DATA_DIR, file.name));
  const title = `电台数据 ${generatedAt}`;
  const notes = `core ${counts.core} · rest ${counts.rest} · catalog ${counts.catalog}`;

  if (hasGh()) {
    try {
      execFileSync(
        "gh",
        ["release", "create", tag, ...assets, "--title", title, "--notes", notes],
        { stdio: "inherit" },
      );
    } catch (error) {
      // 只有确认 release 已存在才走覆盖上传，避免把权限问题误判成「已存在」
      try {
        execFileSync("gh", ["release", "view", tag], { stdio: "ignore" });
      } catch {
        throw error;
      }
      console.log("release 已存在，改为上传覆盖…");
      execFileSync("gh", ["release", "upload", tag, ...assets, "--clobber"], { stdio: "inherit" });
    }
  } else if (token) {
    const repo = repoSlug();
    if (!repo) throw new Error("找不到仓库地址，无法通过 GitHub API 发布");
    console.log(`未找到 gh，改用 GitHub API 发布到 ${repo}…`);
    await publishWithApi({ repo, tag, title, notes, assets });
  } else {
    throw new Error(
      "未找到 gh CLI，也没有 GITHUB_TOKEN/GH_TOKEN；请安装 gh、提供 token，或加 --dry-run 只生成 manifest",
    );
  }

  console.log("");
  console.log("下一步：pnpm data:check，然后提交 data/manifest.json");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
