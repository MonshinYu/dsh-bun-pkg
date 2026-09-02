// @bun
// src/node-module.ts
var {Transpiler } = globalThis.Bun;
var transpiler = new Transpiler({ loader: "ts" });
function stripTypeScriptTypes(code, options = {}) {
  if (typeof code !== "string")
    throw new TypeError("code must be a string");
  const stripped = (() => {
    try {
      return transpiler.transformSync(code);
    } catch (error) {
      throw new SyntaxError(error instanceof Error ? error.message : String(error));
    }
  })();
  return options.sourceUrl ? `${stripped}
//# sourceURL=${options.sourceUrl}` : stripped;
}
export {
  stripTypeScriptTypes
};

//# debugId=9139DAF1F3EED3B064756E2164756E21
