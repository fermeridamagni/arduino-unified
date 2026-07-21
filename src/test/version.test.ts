import * as assert from "node:assert/strict";
import {
  checkVersionCompatibility,
  formatVersionDisplay,
  getSupportedVersionRange,
} from "../cli/version";

suite("Version Compatibility Unit Tests", () => {
  suite("checkVersionCompatibility", () => {
    test("validates compatible 1.x version strings (with or without 'v' prefix)", () => {
      const v1 = checkVersionCompatibility("1.4.1");
      assert.strictEqual(v1.compatible, true);
      assert.strictEqual(v1.major, 1);
      assert.strictEqual(v1.minor, 4);
      assert.strictEqual(v1.patch, 1);
      assert.ok(v1.message.includes("is compatible"));

      const v2 = checkVersionCompatibility("v1.0.0");
      assert.strictEqual(v2.compatible, true);
      assert.strictEqual(v2.major, 1);
      assert.strictEqual(v2.minor, 0);
      assert.strictEqual(v2.patch, 0);

      const v3 = checkVersionCompatibility("1.12.3");
      assert.strictEqual(v3.compatible, true);
      assert.strictEqual(v3.major, 1);
      assert.strictEqual(v3.minor, 12);
      assert.strictEqual(v3.patch, 3);
    });

    test("flags unparseable version strings as incompatible", () => {
      const invalidStrings = ["abc", "invalid.version", "", "vX.Y.Z"];

      for (const ver of invalidStrings) {
        const res = checkVersionCompatibility(ver);
        assert.strictEqual(res.compatible, false);
        assert.strictEqual(res.major, 0);
        assert.ok(res.message.includes("Could not parse"));
      }
    });

    test("flags versions below 1.0.0 as too old", () => {
      const res = checkVersionCompatibility("0.19.2");
      assert.strictEqual(res.compatible, false);
      assert.strictEqual(res.major, 0);
      assert.strictEqual(res.minor, 19);
      assert.strictEqual(res.patch, 2);
      assert.ok(res.message.includes("too old"));
    });

    test("flags major versions higher than 1 as unsupported", () => {
      const res = checkVersionCompatibility("2.0.0");
      assert.strictEqual(res.compatible, false);
      assert.strictEqual(res.major, 2);
      assert.ok(res.message.includes("is not supported"));
    });
  });

  suite("getSupportedVersionRange", () => {
    test("returns correct supported version range string", () => {
      const range = getSupportedVersionRange();
      assert.strictEqual(range, "1.x (>= 1.0.0)");
    });
  });

  suite("formatVersionDisplay", () => {
    test("formats display text cleanly for compatible versions", () => {
      const info = checkVersionCompatibility("1.4.1");
      const display = formatVersionDisplay(info);
      assert.strictEqual(display, "Arduino CLI v1.4.1");
    });

    test("appends warning icon for incompatible versions", () => {
      const info = checkVersionCompatibility("2.0.0");
      const display = formatVersionDisplay(info);
      assert.strictEqual(display, "Arduino CLI v2.0.0 ⚠️");
    });
  });
});
