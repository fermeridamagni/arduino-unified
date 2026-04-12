import * as assert from "node:assert/strict";
import {
  checkVersionCompatibility,
  formatVersionDisplay,
  getSupportedVersionRange,
} from "../../cli/version";

suite("CLI Version Tests", () => {
  suite("checkVersionCompatibility", () => {
    test("Compatible versions", () => {
      const versions = ["1.0.0", "1.4.1", "1.99.99", "v1.4.1"];
      for (const v of versions) {
        const info = checkVersionCompatibility(v);
        assert.ok(info.compatible, `Expected ${v} to be compatible`);
        assert.strictEqual(info.major, 1);
        assert.ok(info.message.includes("is compatible"));
      }
    });

    test("Unsupported major versions", () => {
      const versions = ["2.0.0", "0.9.9", "v3.1.2"];
      for (const v of versions) {
        const info = checkVersionCompatibility(v);
        assert.strictEqual(
          info.compatible,
          false,
          `Expected ${v} to be incompatible`
        );
        assert.ok(info.message.includes("not supported"));
      }
    });

    test("Invalid/Unparseable versions", () => {
      const versions = ["invalid", "a.b.c", "v1", "", "1.0"];
      for (const v of versions) {
        const info = checkVersionCompatibility(v);
        assert.strictEqual(
          info.compatible,
          false,
          `Expected ${v} to be unparseable`
        );
        assert.strictEqual(info.major, 0);
        assert.strictEqual(info.minor, 0);
        assert.strictEqual(info.patch, 0);
        assert.ok(info.message.includes("Could not parse"));
      }
    });
  });

  suite("getSupportedVersionRange", () => {
    test("Returns correct format", () => {
      const range = getSupportedVersionRange();
      assert.strictEqual(range, "1.x (>= 1.0.0)");
    });
  });

  suite("formatVersionDisplay", () => {
    test("Formats compatible version", () => {
      const info = checkVersionCompatibility("1.4.1");
      assert.strictEqual(formatVersionDisplay(info), "Arduino CLI v1.4.1");
    });

    test("Formats incompatible version", () => {
      const info = checkVersionCompatibility("2.0.0");
      assert.strictEqual(formatVersionDisplay(info), "Arduino CLI v2.0.0 ⚠️");
    });
  });
});
