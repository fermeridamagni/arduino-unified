import * as assert from "node:assert/strict";
import { formatVersionDisplay, type VersionInfo } from "../cli/version";

suite("Version CLI Utils Test Suite", () => {
  suite("formatVersionDisplay", () => {
    test("returns correct string when version is compatible", () => {
      const info: VersionInfo = {
        version: "1.4.1",
        compatible: true,
        message: "Compatible",
        major: 1,
        minor: 4,
        patch: 1,
      };

      const result = formatVersionDisplay(info);
      assert.strictEqual(result, "1.4.1");
    });

    test("returns correct string with warning when version is incompatible", () => {
      const info: VersionInfo = {
        version: "0.9.0",
        compatible: false,
        message: "Incompatible",
        major: 0,
        minor: 9,
        patch: 0,
      };

      const result = formatVersionDisplay(info);
      assert.strictEqual(result, "0.9.0 (⚠️ Unsupported)");
    });
  });
});
