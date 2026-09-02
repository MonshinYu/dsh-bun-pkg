// @bun
// src/diagnostic.ts
if (process.env.DSH_BUN_COMPAT_DEBUG) {
  const printError = (value, depth, seen) => {
    if (!value || typeof value !== "object" || seen.has(value))
      return;
    seen.add(value);
    const error = value;
    console.error(`${"  ".repeat(depth)}${error.name || value.constructor.name}: ${error.message || String(value)}`);
    if (Array.isArray(error.errors))
      for (const child of error.errors)
        printError(child, depth + 1, seen);
    if (error.cause)
      printError(error.cause, depth + 1, seen);
  };
  process.on("uncaughtExceptionMonitor", (error) => {
    console.error(`
[dsh-bun-compat-patch] uncaught error tree:`);
    printError(error, 0, new Set);
  });
}

// src/preload.ts
import { existsSync as existsSync2 } from "fs";
import { dirname as dirname2, resolve as resolve2 } from "path";

// src/shadow.ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
var PATCH_MARKER = "// @dsh-bun-compat-patch";
var PATCH_MARKER_END = "// @dsh-bun-compat-patch end";
function findWorkspaceRoot(start) {
  let current = resolve(start);
  for (;; ) {
    if (existsSync(join(current, "node_modules/@deepseek-ai/dsh/package.json")))
      return current;
    const parent = dirname(current);
    if (parent === current)
      throw new Error("could not locate a workspace containing @deepseek-ai/dsh");
    current = parent;
  }
}
function prepareInPlacePatch(root, compatLib) {
  const targetFile = join(root, "node_modules/@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js");
  const source = readFileSync(targetFile, "utf8");
  if (source.includes(PATCH_MARKER)) {
    return { patchedFile: targetFile, backupFile: "" };
  }
  const backupDir = mkdtempSync(join(tmpdir(), "dsh-bun-compat-patch-backup-"));
  const backupFile = join(backupDir, "index.js.bak");
  writeFileSync(backupFile, source);
  const nodeModuleUrl = pathToFileURL(join(compatLib, "node-module.js")).href;
  const patched = source.replaceAll('from "node:module"', `from ${JSON.stringify(nodeModuleUrl)}`);
  if (patched === source) {
    rmSync(backupDir, { recursive: true, force: true });
    throw new Error(`dsh-code-runtime-worker-thread/lib/index.js does not import from "node:module"; ` + `the DSH version may have changed and this compat layer needs updating.`);
  }
  writeFileSync(targetFile, `${PATCH_MARKER}
${patched}
${PATCH_MARKER_END}`);
  return { patchedFile: targetFile, backupFile };
}
function restorePatch(meta) {
  if (!meta.backupFile || !existsSync(meta.backupFile))
    return;
  try {
    writeFileSync(meta.patchedFile, readFileSync(meta.backupFile, "utf8"));
  } finally {
    rmSync(dirname(meta.backupFile), { recursive: true, force: true });
  }
}
function patchHmrGuards(root) {
  const dshLib = join(root, "node_modules/@deepseek-ai/dsh/lib");
  if (!existsSync(dshLib))
    return [];
  const patches = [];
  for (const name of readdirSync(dshLib)) {
    if (!name.startsWith("profile-boot-") || !name.endsWith(".js"))
      continue;
    const filePath = join(dshLib, name);
    const source = readFileSync(filePath, "utf8");
    if (source.includes(PATCH_MARKER))
      continue;
    if (!source.includes("const ctx = await boot("))
      continue;
    const patched = source.replace('if (!signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) try {', 'if (!process.env.DSH_BUN_COMPAT_DISABLE_HMR && !signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) try {');
    if (patched === source)
      throw new Error(`HMR guard transform did not match: ${name}`);
    const backupDir = mkdtempSync(join(tmpdir(), "dsh-bun-compat-patch-backup-"));
    const backupFile = join(backupDir, `${name}.bak`);
    writeFileSync(backupFile, source);
    writeFileSync(filePath, `${PATCH_MARKER}
${patched}
${PATCH_MARKER_END}`);
    patches.push({ patchedFile: filePath, backupFile });
  }
  return patches;
}

// src/preload.ts
if (!process.env.DSH_BUN_COMPAT_CHILD) {
  const entry = process.argv[1];
  if (entry && entry.endsWith("@deepseek-ai/dsh/lib/bin.js")) {
    let compatLib = process.env.DSH_BUN_COMPAT_LIB;
    if (!compatLib) {
      let current = import.meta.dir;
      for (;; ) {
        const candidate = resolve2(current, "lib", "node-module.js");
        if (existsSync2(candidate)) {
          compatLib = resolve2(current, "lib");
          break;
        }
        const parent = dirname2(current);
        if (parent === current)
          throw new Error("could not locate lib/node-module.js");
        current = parent;
      }
    }
    const root = findWorkspaceRoot(compatLib);
    const patches = [prepareInPlacePatch(root, compatLib)];
    patches.push(...patchHmrGuards(root));
    const childArgs = process.argv.slice(2);
    let exitCode = 1;
    let child;
    try {
      child = Bun.spawn([process.execPath, entry, ...childArgs], {
        cwd: root,
        env: {
          ...process.env,
          DSH_BUN_COMPAT_CHILD: "1",
          DSH_BUN_COMPAT_DISABLE_HMR: "1",
          DSH_BUN_COMPAT_LIB: compatLib
        },
        stdout: "inherit",
        stderr: "inherit"
      });
      for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
          try {
            child?.kill();
          } catch (_e) {}
        });
      }
      exitCode = await child.exited;
    } finally {
      for (const p of patches)
        if (p.backupFile)
          restorePatch(p);
    }
    process.exit(exitCode);
  }
}

//# debugId=D1FE518753277F5F64756E2164756E21
