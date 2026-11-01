#!/usr/bin/env node
/*
 * 从 GitHub Release 拉取电台快照。
 *
 * 快照每周更新，单个版本约 6MB（gzip 后约 2.4MB），长期放在 git 里会把
 * 仓库撑大。现在数据挂在 release 上，仓库只保留 data/manifest.json：
 * 版本、文件名、大小与 sha256 都在清单里，下载后逐个校验。
 *
 * 用法：
 *   pnpm data:pull        校验本地快照，缺失或损坏时重新下载
 *   pnpm dev / build      自动带 --if-missing，只在文件不存在时下载
 *
 * 私有仓库可以把 GITHUB_TOKEN 或 GH_TOKEN 放进环境变量；下载失败时脚本
 * 会打印 gh release download 的兜底命令。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const MANIFEST_PATH = resolve(ROOT, "data/manifest.json");

const args = new Set(process.argv.slice(2));
const ifMissing = args.has("--if-missing");
const force = args.has("--force");

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function readManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (typeof manifest.tag !== "string" || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("data/manifest.json 缺少 tag 或 files");
  }
  return manifest;
}

/** 当前仓库的 owner/repo；CI 里直接读 GITHUB_REPOSITORY，本地从 origin 解析。 */
function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return match ? `${match[1]}/${match[2]}` : "";
  } catch {
    return "";
  }
}

async function exists(name) {
  try {
    await stat(resolve(DATA_DIR, name));
    return true;
  } catch {
    return false;
  }
}

async function matches(file) {
  try {
    const buffer = await readFile(resolve(DATA_DIR, file.name));
    return buffer.length === file.bytes && sha256(buffer) === file.sha256;
  } catch {
    return false;
  }
}

async function download(repo, tag, file) {
  const url = `https://github.com/${repo}/releases/download/${tag}/${file.name}`;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  const response = await fetch(url, {
    redirect: "follow",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length !== file.bytes || sha256(buffer) !== file.sha256) {
    throw new Error(`校验失败：${file.name} 与 manifest 不一致`);
  }

  const target = resolve(DATA_DIR, file.name);
  const temp = `${target}.download`;
  try {
    await writeFile(temp, buffer);
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}

async function main() {
  const manifest = await readManifest();
  await mkdir(DATA_DIR, { recursive: true });

  const missing = [];
  for (const file of manifest.files) {
    if (force) {
      missing.push(file);
      continue;
    }
    const ready = ifMissing ? await exists(file.name) : await matches(file);
    if (!ready) missing.push(file);
  }

  if (missing.length === 0) {
    console.log(`快照已就绪（${manifest.tag}）`);
    return;
  }

  const repo = repoSlug();
  if (!repo) {
    throw new Error("找不到仓库地址：请在 GitHub Actions 中运行，或先配置 origin remote");
  }

  console.log(`从 ${manifest.tag} 拉取 ${missing.length} 个文件…`);
  for (const file of missing) {
    try {
      await download(repo, manifest.tag, file);
      console.log(`  ✓ ${file.name}`);
    } catch (error) {
      console.error(`  ✗ ${file.name}：${error.message}`);
      console.error(
        `  手动兜底：gh release download ${manifest.tag} -R ${repo} -p ${file.name} -D src/data --clobber`,
      );
      throw error;
    }
  }

  const { core = 0, rest = 0, catalog = 0 } = manifest.counts ?? {};
  console.log(`完成：core ${core} · rest ${rest} · catalog ${catalog}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
