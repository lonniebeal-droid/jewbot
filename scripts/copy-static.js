// Copy the renderer static files into dist/renderer.
// Cross-platform by design: plain Node fs calls, no shell builtins.
// The previous `mkdir -p ... && cp ...` form fails on Windows, where npm
// runs scripts through cmd.exe (see Codex P1 on PR #10).
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist", "renderer");
const files = ["index.html", "renderer.js"];

fs.mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const src = path.join(root, "src", "renderer", file);
  const dest = path.join(outDir, file);
  fs.copyFileSync(src, dest);
  console.log(`copied ${file} -> ${path.relative(root, dest)}`);
}
