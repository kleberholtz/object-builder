#!/usr/bin/env node
/**
 * Points git at the tracked `.githooks/` directory.
 *
 * Runs from the npm `prepare` script, which also fires on a bare `npm install`.
 * A checkout without git (a tarball, a CI cache restore) is not an error here —
 * there is simply nothing to configure.
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
} catch {
  process.exit(0);
}

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
  console.log("git hooks: core.hooksPath -> .githooks");
} catch {
  console.warn("git hooks: could not set core.hooksPath");
}
