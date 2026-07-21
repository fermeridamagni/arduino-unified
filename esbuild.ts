import * as fs from "node:fs";
import * as path from "node:path";
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * Problem matcher plugin for esbuild error reporting.
 */
const esbuildProblemMatcherPlugin: esbuild.Plugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(
            `    ${location.file}:${location.line}:${location.column}:`
          );
        }
      }
      console.log("[watch] build finished");
    });
  },
};

/**
 * Plugin to copy proto files asynchronously to the dist directory.
 */
const copyProtoPlugin: esbuild.Plugin = {
  name: "copy-proto-files",

  setup(build) {
    build.onEnd(async () => {
      const srcProto = path.join(__dirname, "src", "cli", "proto");
      const distProto = path.join(__dirname, "dist", "proto");

      await copyDirAsync(srcProto, distProto);
      console.log("[proto] Copied proto files to dist/proto");
    });
  },
};

/**
 * Recursively copies a directory asynchronously.
 */
async function copyDirAsync(src: string, dest: string): Promise<void> {
  try {
    await fs.promises.access(src, fs.constants.F_OK);
  } catch {
    return;
  }

  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirAsync(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function main(): Promise<void> {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [copyProtoPlugin, esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
