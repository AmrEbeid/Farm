import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const modulePath = fileURLToPath(import.meta.url);

const scriptDirectory = dirname(modulePath);
const repositoryRoot = resolve(scriptDirectory, "../../..");
const manifestPath = join(scriptDirectory, "accounting release manifest.json");
const releaseControlPaths = [
  relative(repositoryRoot, manifestPath),
  relative(repositoryRoot, modulePath),
  relative(repositoryRoot, join(scriptDirectory, "accounting release preflight.mjs")),
  relative(repositoryRoot, join(scriptDirectory, "accounting release working tree preflight.mjs")),
];
const releaseControlMode = "100644";

function fail(message) {
  throw new Error(`Accounting release preflight failed: ${message}`);
}

if (sep !== "/") fail("accounting release preflight supports POSIX worktrees only");

const repositoryControlEnvironment = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];
for (const name of repositoryControlEnvironment) {
  if (process.env[name]) fail(`repository-controlling environment variable is not allowed: ${name}`);
}
const gitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
gitEnvironment.GIT_OPTIONAL_LOCKS = "0";

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: gitEnvironment,
  });
  if (result.error) fail(`git ${args[0]} could not start: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    fail(`git ${args[0]} exited ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function nulFields(result, label) {
  if (!result.stdout) return [];
  if (!result.stdout.endsWith("\0")) fail(`${label} did not return NUL-terminated output`);
  return result.stdout.slice(0, -1).split("\0");
}

function regularRepositoryFile(path) {
  if (typeof path !== "string") fail("release paths must be strings");
  const resolvedPath = resolve(repositoryRoot, path);
  if (resolvedPath === repositoryRoot || !resolvedPath.startsWith(`${repositoryRoot}${sep}`)) {
    fail(`release path escapes the repository: ${path}`);
  }
  if (relative(repositoryRoot, resolvedPath) !== path) {
    fail(`release path is not canonical: ${path}`);
  }
  let cursor = repositoryRoot;
  let stats;
  for (const component of path.split(sep)) {
    cursor = join(cursor, component);
    try {
      stats = lstatSync(cursor);
    } catch {
      fail(`release path does not exist: ${path}`);
    }
    if (stats.isSymbolicLink()) fail(`release path must not contain a symbolic link: ${path}`);
  }
  if (!stats?.isFile()) fail(`release path is not a regular file: ${path}`);
  const realPath = realpathSync(resolvedPath);
  if (realPath !== resolvedPath) fail(`release path resolves unexpectedly: ${path}`);
  return resolvedPath;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(regularRepositoryFile(path))).digest("hex");
}

function fileMode(path) {
  const mode = lstatSync(regularRepositoryFile(path)).mode;
  return (mode & 0o111) === 0 ? "100644" : "100755";
}

function candidateDigest(paths) {
  const digest = createHash("sha256");
  for (const path of paths) {
    digest.update(path, "utf8");
    digest.update("\0");
    digest.update(fileMode(path), "ascii");
    digest.update("\0");
    digest.update(sha256(path), "ascii");
    digest.update("\n");
  }
  return digest.digest("hex");
}

function modesDigest(paths) {
  const digest = createHash("sha256");
  for (const path of paths) {
    digest.update(path, "utf8");
    digest.update("\0");
    digest.update(fileMode(path), "ascii");
    digest.update("\n");
  }
  return digest.digest("hex");
}

function gitFileAtHead(path) {
  const result = spawnSync("git", ["show", `HEAD:${path}`], {
    cwd: repositoryRoot,
    encoding: null,
    env: gitEnvironment,
  });
  if (result.error) fail(`git show could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`committed release file is missing from HEAD: ${path}`);
  return result.stdout;
}

function gitModeAtHead(path) {
  const fields = nulFields(git(["ls-tree", "-z", "HEAD", "--", path]), `git mode for ${path}`);
  if (fields.length !== 1) fail(`committed release mode is missing or ambiguous for ${path}`);
  const match = /^(100644|100755) blob [0-9a-f]+\t/.exec(fields[0]);
  if (!match) fail(`unsupported committed file mode for ${path}: ${fields[0]}`);
  return match[1];
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertEqualSets(actual, expected, label) {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${label} mismatch\nexpected: ${expectedSorted.join(", ")}\nactual: ${actualSorted.join(", ")}`);
  }
}

export function runPreflight({ requireCommitted }) {
if (typeof requireCommitted !== "boolean") fail("release mode must be a boolean");

const gitTopLevel = realpathSync(git(["rev-parse", "--show-toplevel"]).stdout.trim());
if (gitTopLevel !== repositoryRoot) fail(`Git top-level mismatch: ${gitTopLevel}`);
for (const [flag, label] of [["-v", "assume-unchanged"], ["-f", "fsmonitor-clean"]]) {
  const hiddenIndexEntries = nulFields(git(["ls-files", flag, "-z"]), `git ${label} flags`)
    .filter((entry) => entry.length < 3 || entry[1] !== " " || entry[0] !== "H");
  if (hiddenIndexEntries.length > 0) {
    fail(`tracked paths carry hidden or unsupported ${label} flags: ${hiddenIndexEntries.join(", ")}`);
  }
}

for (const path of releaseControlPaths) {
  regularRepositoryFile(path);
  if (fileMode(path) !== releaseControlMode) {
    fail(`release control must use mode ${releaseControlMode}: ${path}`);
  }
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== 2) fail("unsupported manifest schema");
if (manifest.scope !== "full-accounting-release-candidate") {
  fail("manifest scope must be full-accounting-release-candidate");
}
if (!/^[0-9a-f]{40}$/.test(manifest.baseCommit)) fail("baseCommit must be a full SHA-1");
if (!Array.isArray(manifest.releasePrograms) || manifest.releasePrograms.length === 0) {
  fail("releasePrograms must be a non-empty array");
}
const releaseProgramPaths = manifest.releasePrograms.map(({ path }) => path);
assertEqualSets(releaseProgramPaths, releaseControlPaths.slice(1), "release program set");
for (const program of manifest.releasePrograms) {
  if (!/^[0-9a-f]{64}$/.test(program.sha256)) fail(`invalid release program hash: ${program.path}`);
  if (program.mode !== releaseControlMode) fail(`invalid release program mode: ${program.path}`);
  if (sha256(program.path) !== program.sha256) fail(`release program hash mismatch: ${program.path}`);
  if (fileMode(program.path) !== program.mode) fail(`release program mode mismatch: ${program.path}`);
}
if (!Array.isArray(manifest.candidatePaths) || manifest.candidatePaths.length === 0) {
  fail("candidatePaths must be a non-empty array");
}
if (new Set(manifest.candidatePaths).size !== manifest.candidatePaths.length) {
  fail("candidatePaths must be unique");
}
if (JSON.stringify(manifest.candidatePaths) !== JSON.stringify([...manifest.candidatePaths].sort())) {
  fail("candidatePaths must be listed in canonical sort order");
}
for (const path of manifest.candidatePaths) {
  if (
    typeof path !== "string" ||
    !(
      path.startsWith("apps/farm-os/") ||
      path.startsWith("docs/") ||
      path === "package.json" ||
      path === "package-lock.json"
    )
  ) {
    fail(`candidate path is outside the accounting release scope: ${path}`);
  }
  regularRepositoryFile(path);
}
if (!/^[0-9a-f]{64}$/.test(manifest.candidateDigest)) fail("candidateDigest must be a SHA-256");
if (candidateDigest(manifest.candidatePaths) !== manifest.candidateDigest) {
  fail("full candidate digest mismatch");
}

const groups = [manifest.migrations, manifest.databaseTests, manifest.supportFiles];
if (groups.some((group) => !Array.isArray(group) || group.length === 0)) {
  fail("manifest artifact groups must be non-empty arrays");
}
const artifacts = groups.flat();
const artifactPaths = artifacts.map((artifact) => artifact.path);
if (new Set(artifactPaths).size !== artifactPaths.length) fail("manifest artifact paths must be unique");
if (!/^[0-9a-f]{64}$/.test(manifest.artifactModesDigest)) fail("artifactModesDigest must be a SHA-256");
if (modesDigest(artifactPaths) !== manifest.artifactModesDigest) {
  fail("artifact mode digest mismatch");
}
const allPinnedPaths = [...artifactPaths, ...manifest.candidatePaths, ...releaseControlPaths];
if (new Set(allPinnedPaths).size !== allPinnedPaths.length) {
  fail("candidate, artifact, and release-control paths must not overlap");
}

for (const artifact of artifacts) {
  if (typeof artifact.path !== "string" || !artifact.path.startsWith("apps/farm-os/")) {
    fail("every artifact must use a repository-relative Farm OS path");
  }
  if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) fail(`invalid SHA-256 for ${artifact.path}`);
  const actualHash = sha256(artifact.path);
  if (actualHash !== artifact.sha256) fail(`hash mismatch for ${artifact.path}`);
}

for (const artifact of manifest.migrations) {
  if (!artifact.path.startsWith("apps/farm-os/supabase/migrations/")) {
    fail(`migration artifact is outside the migration directory: ${artifact.path}`);
  }
}
for (const artifact of manifest.databaseTests) {
  if (!artifact.path.startsWith("apps/farm-os/supabase/tests/")) {
    fail(`database test artifact is outside the test directory: ${artifact.path}`);
  }
}

const migrationTimestamps = manifest.migrations.map(({ path }) => {
  const match = /\/([0-9]{14})[^/]*\.sql$/.exec(path);
  if (!match) fail(`migration lacks a 14-digit timestamp: ${path}`);
  return match[1];
});
if (new Set(migrationTimestamps).size !== migrationTimestamps.length) {
  fail("candidate migration timestamps must be unique");
}
if (JSON.stringify(migrationTimestamps) !== JSON.stringify(sorted(migrationTimestamps))) {
  fail("candidate migrations are not listed in timestamp order");
}

const migrationDirectory = resolve(repositoryRoot, "apps/farm-os/supabase/migrations");
const currentMigrationPaths = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => relative(repositoryRoot, join(migrationDirectory, name)));
const allTimestamps = currentMigrationPaths.map((path) => {
  const match = /^([0-9]{14})(?:_| ).+\.sql$/.exec(basename(path));
  if (!match) fail(`repository migration lacks a valid timestamped filename: ${path}`);
  return match[1];
});
if (new Set(allTimestamps).size !== allTimestamps.length) fail("repository contains duplicate migration timestamps");

const baseMigrationPaths = nulFields(git([
  "ls-tree", "-r", "-z", "--name-only", manifest.baseCommit, "--", "apps/farm-os/supabase/migrations",
]), "base migration paths");
const baseSet = new Set(baseMigrationPaths);
const baseTimestamps = baseMigrationPaths.map((path) => {
  const match = /^([0-9]{14})(?:_| ).+\.sql$/.exec(basename(path));
  if (!match) fail(`base migration lacks a valid timestamped filename: ${path}`);
  return match[1];
});
const latestBaseTimestamp = sorted(baseTimestamps).at(-1);
if (migrationTimestamps.some((timestamp) => timestamp <= latestBaseTimestamp)) {
  fail(`candidate migrations must sort after pinned base timestamp ${latestBaseTimestamp}`);
}
const newMigrationPaths = currentMigrationPaths.filter((path) => !baseSet.has(path));
assertEqualSets(newMigrationPaths, manifest.migrations.map(({ path }) => path), "new migration set");

const changedMigrationPaths = nulFields(git([
  "diff", "-z", "--name-only", manifest.baseCommit, "--", "apps/farm-os/supabase/migrations",
]), "changed migration paths");
const modifiedExistingMigrations = changedMigrationPaths.filter((path) => baseSet.has(path));
if (modifiedExistingMigrations.length > 0) {
  fail(`existing migrations were modified: ${modifiedExistingMigrations.join(", ")}`);
}

const unsupportedTrackedChanges = git([
  "diff", "-z", "--name-status", "--diff-filter=DRCTUXB", manifest.baseCommit,
]).stdout;
if (unsupportedTrackedChanges) {
  fail(`candidate contains deleted, renamed, copied, or unsupported tracked paths:\n${unsupportedTrackedChanges}`);
}
const trackedCandidatePaths = nulFields(git([
  "diff", "-z", "--name-only", "--diff-filter=AM", manifest.baseCommit,
]), "tracked candidate paths");
const untrackedCandidatePaths = nulFields(git([
  "ls-files", "-z", "--others", "--exclude-standard",
]), "untracked candidate paths");
const changedCandidatePaths = [...new Set([...trackedCandidatePaths, ...untrackedCandidatePaths])];
const pinnedPathSet = new Set(allPinnedPaths);
const unpinnedChangedPaths = changedCandidatePaths.filter((path) => !pinnedPathSet.has(path));
if (unpinnedChangedPaths.length > 0) {
  fail(`full candidate path set mismatch\nunpinned changed paths: ${sorted(unpinnedChangedPaths).join(", ")}`);
}

const head = git(["rev-parse", "HEAD"]).stdout.trim();
const originMain = git(["rev-parse", "origin/main"]).stdout.trim();
if (originMain !== manifest.baseCommit) fail(`origin/main moved from pinned base to ${originMain}`);
const ancestry = git(["merge-base", "--is-ancestor", manifest.baseCommit, head], { allowFailure: true });
if (ancestry.status !== 0) fail("pinned base is not an ancestor of HEAD");

if (requireCommitted) {
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout;
  if (status) fail("committed release preflight requires a clean worktree; use the separate working-tree check only for local bundle checks");
  for (const path of allPinnedPaths) {
    const workingBytes = readFileSync(regularRepositoryFile(path));
    if (!workingBytes.equals(gitFileAtHead(path))) {
      fail(`release file differs from committed HEAD bytes: ${path}`);
    }
    if (fileMode(path) !== gitModeAtHead(path)) {
      fail(`release file mode differs from committed HEAD: ${path}`);
    }
  }
}

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  candidate: manifest.candidate,
  baseCommit: manifest.baseCommit,
  head,
  originMain,
  migrations: manifest.migrations.length,
  pinnedArtifacts: artifacts.length,
  candidateFiles: manifest.candidatePaths.length,
  boundFiles: allPinnedPaths.length,
  requireCommitted,
  originMainRef: "local-cache",
}, null, 2)}\n`);
}
