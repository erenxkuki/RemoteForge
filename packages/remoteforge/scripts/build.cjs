const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const outDir = path.resolve(__dirname, "..", "lib");
const skillsSrc = path.join(root, "skills");
const skillsDst = path.join(__dirname, "..", "skills");

fs.mkdirSync(outDir, { recursive: true });

// Bundle CLI (includes shared inlined)
esbuild.buildSync({
  entryPoints: [path.join(root, "packages", "cli", "src", "index.ts")],
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node20",
  outfile: path.join(outDir, "cli.js"),
  format: "esm",
  external: [],
  resolveExtensions: [".ts", ".js"],
  tsconfig: path.join(root, "packages", "cli", "tsconfig.json"),
  banner: { js: "#!/usr/bin/env node" },
  // allow importing from monorepo
  nodePaths: [path.join(root, "node_modules")],
});
console.log("Bundled cli.js");

// Bundle MCP server
esbuild.buildSync({
  entryPoints: [path.join(root, "packages", "mcp-server", "src", "index.ts")],
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node20",
  outfile: path.join(outDir, "mcp.js"),
  format: "esm",
  external: [],
  resolveExtensions: [".ts", ".js"],
  tsconfig: path.join(root, "packages", "mcp-server", "tsconfig.json"),
  banner: { js: "#!/usr/bin/env node" },
  nodePaths: [path.join(root, "node_modules")],
});
console.log("Bundled mcp.js");

// Copy skills
if (fs.existsSync(skillsDst)) fs.rmSync(skillsDst, { recursive: true, force: true });
fs.cpSync(skillsSrc, skillsDst, { recursive: true });
console.log("Copied skills");

// Copy build (chmod)
try { fs.chmodSync(path.join(outDir, "cli.js"), 0o755); fs.chmodSync(path.join(outDir, "mcp.js"), 0o755); } catch {}
console.log("Done");