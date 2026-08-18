// @bun
// src/shadow.ts
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
function findWorkspaceRoot(start) {
  let current = resolve(start);
  for (;; ) {
    if (existsSync(join(current, "node_modules/@deepseek-ai/dsh/package.json")))
      return current;
    const parent = dirname(current);
    if (parent === current)
      throw new Error("\u627E\u4E0D\u5230\u5305\u542B @deepseek-ai/dsh \u7684\u9879\u76EE\u6839\u76EE\u5F55");
    current = parent;
  }
}
function prepareShadow(root, compatLib) {
  const cache = mkdtempSync(join(tmpdir(), "dsh-bun-compat-patch-"));
  try {
    mkdirSync(join(cache, "node_modules/@deepseek-ai"), { recursive: true });
    const nodeModules = join(root, "node_modules");
    for (const name of readdirSync(nodeModules)) {
      if (name !== "@deepseek-ai")
        link(join(nodeModules, name), join(cache, "node_modules", name));
    }
    const copied = new Set(["dsh", "dsh-app-boot", "cordis-plugin-loader", "dsh-code-runtime-worker-thread"]);
    for (const name of readdirSync(join(nodeModules, "@deepseek-ai"))) {
      if (!copied.has(name))
        link(join(nodeModules, "@deepseek-ai", name), join(cache, "node_modules/@deepseek-ai", name));
    }
    for (const name of copied) {
      cpSync(join(nodeModules, "@deepseek-ai", name), join(cache, "node_modules/@deepseek-ai", name), {
        recursive: true,
        dereference: true
      });
    }
    const runtime = join(cache, "node_modules/@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js");
    const nodeModuleUrl = pathToFileURL(join(compatLib, "node-module.js")).href;
    const workerThreadsUrl = pathToFileURL(join(compatLib, "node-worker-threads.js")).href;
    const runtimeSource = readFileSync(runtime, "utf8").replaceAll('from "node:module"', `from ${JSON.stringify(nodeModuleUrl)}`).replaceAll('from "node:worker_threads"', `from ${JSON.stringify(workerThreadsUrl)}`);
    writeFileSync(runtime, runtimeSource);
    const dshLib = join(cache, "node_modules/@deepseek-ai/dsh/lib");
    for (const name of readdirSync(dshLib)) {
      if (!name.startsWith("profile-boot-") || !name.endsWith(".js"))
        continue;
      const path = join(dshLib, name);
      const source = readFileSync(path, "utf8");
      if (!source.includes("const ctx = await boot("))
        continue;
      const patched = source.replace(`
	});
	app.current = ctx;`, `
	}, INSTALL_ANCHOR);
	app.current = ctx;`).replace('if (!signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) try {', 'if (!process.env.DSH_BUN_COMPAT_DISABLE_HMR && !signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) try {');
      if (patched === source)
        throw new Error(`\u542F\u52A8\u951A\u70B9\u8F6C\u6362\u6CA1\u6709\u5339\u914D\u6587\u4EF6\uFF1A${name}`);
      writeFileSync(path, patched);
    }
    return cache;
  } catch (error) {
    rmSync(cache, { recursive: true, force: true });
    throw error;
  }
}
function link(target, path) {
  try {
    symlinkSync(target, path, "junction");
  } catch {}
}
export {
  prepareShadow,
  findWorkspaceRoot
};

//# debugId=95D5891904EF108864756E2164756E21
