#!/usr/bin/env node
/**
 * Bumps the project version across every file that carries it.
 *
 * The scheme is base-10 on both patch and minor: 0.1.1 -> 0.1.9 -> 0.2.0,
 * 0.9.9 -> 1.0.0, and so on. Major has no ceiling.
 *
 * Usage:
 *   node scripts/bump-version.mjs            bump and write
 *   node scripts/bump-version.mjs --dry-run  print the next version only
 *   node scripts/bump-version.mjs --set X.Y.Z
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGE_JSON = join(root, "package.json");
const PACKAGE_LOCK = join(root, "package-lock.json");
const CARGO_TOML = join(root, "src-tauri", "Cargo.toml");
const CARGO_LOCK = join(root, "src-tauri", "Cargo.lock");
const TAURI_CONF = join(root, "src-tauri", "tauri.conf.json");

const CRATE_NAME = "object-builder";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid version: ${version}`);
  return match.slice(1, 4).map(Number);
}

/** 0.1.1 -> 0.1.2, 0.1.9 -> 0.2.0, 0.9.9 -> 1.0.0 */
function nextVersion(version) {
  let [major, minor, patch] = parseVersion(version);
  patch += 1;
  if (patch > 9) {
    patch = 0;
    minor += 1;
  }
  if (minor > 9) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function read(path) {
  return readFileSync(path, "utf8");
}

/** Rewrites without reserializing: keeps formatting, key order and trailing newline. */
function replace(path, pattern, replacement) {
  const before = read(path);
  const after = before.replace(pattern, replacement);
  if (before === after) throw new Error(`No version match in ${path}`);
  writeFileSync(path, after);
}

function currentVersion() {
  return JSON.parse(read(PACKAGE_JSON)).version;
}

function write(version) {
  // package.json: the top-level "version", which is the first one in the file.
  replace(PACKAGE_JSON, /("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`);

  // package-lock.json: both the root object and the "" package entry.
  const lock = JSON.parse(read(PACKAGE_LOCK));
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  writeFileSync(PACKAGE_LOCK, `${JSON.stringify(lock, null, 2)}\n`);

  // Cargo.toml: the [package] version, before any dependency table.
  replace(CARGO_TOML, /(\[package\][\s\S]*?\nversion\s*=\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`);

  // Cargo.lock: only this crate's entry.
  replace(
    CARGO_LOCK,
    new RegExp(`(name = "${CRATE_NAME}"\\nversion = ")\\d+\\.\\d+\\.\\d+(")`),
    `$1${version}$2`,
  );

  // tauri.conf.json: what the bundle and the updater report.
  replace(TAURI_CONF, /("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`);
}

const args = process.argv.slice(2);
const setIndex = args.indexOf("--set");
const target = setIndex === -1 ? nextVersion(currentVersion()) : args[setIndex + 1];

parseVersion(target);

if (args.includes("--dry-run")) {
  console.log(target);
} else {
  write(target);
  console.log(target);
}
