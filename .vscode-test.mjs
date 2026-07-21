import path from "node:path";
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  launchArgs: [`--user-data-dir=${path.resolve("./.vscode-test/user-data")}`],
});
