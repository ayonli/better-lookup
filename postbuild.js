const fs = require("fs");

fs.writeFileSync("cjs/package.json", JSON.stringify({ type: "commonjs" }), "utf8");
fs.writeFileSync("esm/package.json", JSON.stringify({ type: "module" }), "utf8");
