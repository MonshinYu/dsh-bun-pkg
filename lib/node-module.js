// @bun
// src/node-module.ts
import { fileURLToPath } from "url";
function stripTypeScriptTypes(code, options = {}) {
  if (typeof code !== "string")
    throw new TypeError("code \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
  const helper = fileURLToPath(new URL("./strip-types.js", import.meta.url));
  const encodedOptions = Buffer.from(JSON.stringify(options)).toString("base64");
  const result = Bun.spawnSync(["node", helper, encodedOptions], {
    stdin: Buffer.from(code),
    stdout: "pipe",
    stderr: "pipe"
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    const error = new SyntaxError(detail || "stripTypeScriptTypes \u6267\u884C\u5931\u8D25");
    Object.assign(error, { code: "ERR_INVALID_TYPESCRIPT_SYNTAX" });
    throw error;
  }
  return result.stdout.toString();
}
export {
  stripTypeScriptTypes
};

//# debugId=FBAED9F9DEF316B364756E2164756E21
