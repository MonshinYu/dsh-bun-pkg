// @bun
// src/diagnostic.ts
if (process.env.DSH_BUN_COMPAT_DEBUG) {
  process.on("uncaughtExceptionMonitor", (error) => {
    console.error(`
[dsh-bun-compat-patch] \u672A\u6355\u83B7\u9519\u8BEF\u6811`);
    printError(error, 0, new Set);
  });
}
function printError(value, depth, seen) {
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
}

//# debugId=90DF41E2505E41AC64756E2164756E21
