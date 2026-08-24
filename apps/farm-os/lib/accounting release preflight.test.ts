import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");
const sourceScripts = resolve(appRoot, "scripts");
const temporaryRepositories: string[] = [];

const paths = {
  candidate: "apps/farm-os/package.json",
  migration: "apps/farm-os/supabase/migrations/20260809000000_fixture.sql",
  databaseTest: "apps/farm-os/supabase/tests/fixture.sql",
  support: "apps/farm-os/lib/reconciliation/pinned hashes.mts",
  core: "apps/farm-os/scripts/accounting release preflight core.mjs",
  strict: "apps/farm-os/scripts/accounting release preflight.mjs",
  working: "apps/farm-os/scripts/accounting release working tree preflight.mjs",
  manifest: "apps/farm-os/scripts/accounting release manifest.json",
} as const;

function sha256(bytes: string | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function write(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  chmodSync(absolutePath, 0o644);
}

function childEnvironment(environment: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && name !== "NODE_OPTIONS"),
    ),
    NODE_ENV: process.env.NODE_ENV ?? "test",
    ...environment,
  };
}

function git(root: string, args: string[]) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: childEnvironment(),
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function digest(root: string, digestPaths: string[], includeHash: boolean) {
  const hash = createHash("sha256");
  for (const path of digestPaths) {
    hash.update(path);
    hash.update("\0");
    hash.update("100644");
    if (includeHash) {
      hash.update("\0");
      hash.update(sha256(readFileSync(join(root, path))));
    }
    hash.update("\n");
  }
  return hash.digest("hex");
}

function createFixture({ releaseProgramsInBase = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "farm-accounting-preflight-"));
  temporaryRepositories.push(root);

  write(root, paths.candidate, '{"fixture":"base"}\n');
  write(root, "apps/farm-os/supabase/migrations/20260808000000_base.sql", "select 1;\n");
  if (releaseProgramsInBase) {
    for (const path of [paths.core, paths.strict, paths.working]) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(sourceScripts, basename(path)), target);
      chmodSync(target, 0o644);
    }
  }
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  const baseCommit = git(root, ["rev-parse", "HEAD"]);
  git(root, ["update-ref", "refs/remotes/origin/main", baseCommit]);

  write(root, paths.candidate, '{"fixture":"candidate"}\n');
  write(root, paths.migration, "select 2;\n");
  write(root, paths.databaseTest, "select 3;\n");
  write(root, paths.support, "export const fixture = true;\n");
  if (!releaseProgramsInBase) {
    for (const path of [paths.core, paths.strict, paths.working]) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(sourceScripts, basename(path)), target);
      chmodSync(target, 0o644);
    }
  }

  const releasePrograms = [paths.core, paths.strict, paths.working].map((path) => ({
    path,
    sha256: sha256(readFileSync(join(root, path))),
    mode: "100644",
  }));
  const artifacts = [paths.migration, paths.databaseTest, paths.support];
  const manifest = {
    schemaVersion: 2,
    candidate: "fixture",
    scope: "full-accounting-release-candidate",
    baseCommit,
    releasePrograms,
    candidatePaths: [paths.candidate],
    candidateDigest: digest(root, [paths.candidate], true),
    artifactModesDigest: digest(root, artifacts, false),
    migrations: [{ path: paths.migration, sha256: sha256(readFileSync(join(root, paths.migration))) }],
    databaseTests: [{
      path: paths.databaseTest,
      sha256: sha256(readFileSync(join(root, paths.databaseTest))),
    }],
    supportFiles: [{ path: paths.support, sha256: sha256(readFileSync(join(root, paths.support))) }],
  };
  write(root, paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

function runPreflight(
  root: string,
  launcher: string,
  execArgs: string[] = [],
  environment: Record<string, string> = {},
) {
  return spawnSync(process.execPath, [...execArgs, "--preserve-symlinks-main", join(root, launcher)], {
    cwd: root,
    encoding: "utf8",
    env: childEnvironment(environment),
  });
}

function fsmonitorGitEnvironment() {
  const bin = mkdtempSync(join(tmpdir(), "farm-accounting-preflight-bin-"));
  temporaryRepositories.push(bin);
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  const shellPath = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;
  writeFileSync(join(bin, "git"), [
    "#!/bin/sh",
    "is_ls_files=0",
    "is_fsmonitor=0",
    "for arg in \"$@\"; do",
    "  [ \"$arg\" = \"ls-files\" ] && is_ls_files=1",
    "  [ \"$arg\" = \"-f\" ] && is_fsmonitor=1",
    "done",
    "if [ \"$is_ls_files\" = 1 ] && [ \"$is_fsmonitor\" = 1 ]; then",
    "  printf 'h apps/farm-os/package.json\\0'",
    "  exit 0",
    "fi",
    `exec ${shellPath(realGit)} "$@"`,
    "",
  ].join("\n"));
  chmodSync(join(bin, "git"), 0o755);
  return { PATH: `${bin}:${process.env.PATH ?? ""}` };
}

afterEach(() => {
  for (const root of temporaryRepositories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("accounting release preflight", () => {
  it("passes a complete dedicated working-tree fixture", () => {
    const result = runPreflight(createFixture(), paths.working);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "PASS",
      candidateFiles: 1,
      pinnedArtifacts: 3,
      boundFiles: 8,
      requireCommitted: false,
    });
  });

  it("passes a rebased candidate when the pinned release programs are unchanged from the base", () => {
    const result = runPreflight(createFixture({ releaseProgramsInBase: true }), paths.working);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "PASS", requireCommitted: false });
  });

  it("does not let a concealed preload switch the strict launcher to working-tree mode", () => {
    const preload = [
      "process.execArgv.splice(0,process.execArgv.length,'--preserve-symlinks-main')",
      "delete process.env.NODE_OPTIONS",
      "process.argv.push('--allow-dirty')",
    ].join(";");
    const result = runPreflight(createFixture(), paths.strict, [
      `--import=data:text/javascript,${encodeURIComponent(preload)}`,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no NODE_OPTIONS, and no arguments");
    expect(result.stdout).not.toContain('"requireCommitted": false');
  });

  it("rejects an unexpected candidate path", () => {
    const root = createFixture();
    write(root, "apps/farm-os/unexpected.txt", "unexpected\n");
    const result = runPreflight(root, paths.working);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("full candidate path set mismatch");
  });

  it("rejects release-program byte and mode drift", () => {
    const byteRoot = createFixture();
    write(byteRoot, paths.strict, `${readFileSync(join(byteRoot, paths.strict), "utf8")}\n`);
    const byteResult = runPreflight(byteRoot, paths.working);
    expect(byteResult.status).not.toBe(0);
    expect(byteResult.stderr).toContain("release program hash mismatch");

    const modeRoot = createFixture();
    chmodSync(join(modeRoot, paths.strict), 0o755);
    const modeResult = runPreflight(modeRoot, paths.working);
    expect(modeResult.status).not.toBe(0);
    expect(modeResult.stderr).toContain("release control must use mode 100644");
  });

  it("rejects the assume-unchanged Git index flag", () => {
    const root = createFixture();
    git(root, ["update-index", "--assume-unchanged", paths.candidate]);
    const result = runPreflight(root, paths.working);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("hidden or unsupported assume-unchanged flags");
  });

  it("rejects an fsmonitor-clean Git index result", () => {
    const result = runPreflight(
      createFixture(),
      paths.working,
      [],
      fsmonitorGitEnvironment(),
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("hidden or unsupported fsmonitor-clean flags");
  });
});
