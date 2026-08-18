// src/strip-types.ts
import { stripTypeScriptTypes } from "node:module";
var options = JSON.parse(Buffer.from(process.argv[2], "base64").toString());
var code = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  code += chunk;
});
process.stdin.on("end", () => {
  try {
    process.stdout.write(stripTypeScriptTypes(code, options));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
});

//# debugId=B43495C8629AE4A764756E2164756E21
