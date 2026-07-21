import * as assert from "node:assert/strict";
import { ArduinoGrpcClient } from "../cli/grpc-client";
import { MockOutputChannel } from "./mocks/vscode.mock";

suite("ArduinoGrpcClient Unit & Integration Tests", () => {
  let outputChannel: MockOutputChannel;
  let client: ArduinoGrpcClient;

  setup(() => {
    outputChannel = new MockOutputChannel("gRPC Test");
    client = new ArduinoGrpcClient(outputChannel as never);
  });

  teardown(() => {
    client.disconnect();
  });

  suite("Uninitialized Instance Guards", () => {
    test("getInstance returns null prior to createInstance", () => {
      assert.strictEqual(client.getInstance(), null);
    });

    test("all RPC calls requiring instance throw when createInstance not called", async () => {
      const instanceRequiredFns: Array<() => Promise<unknown>> = [
        () => client.initInstance(),
        () => client.updateIndex(),
        () => client.updateLibrariesIndex(),
        () =>
          client.compile({
            sketchPath: "/tmp/sketch",
            fqbn: "arduino:avr:uno",
          }),
        () =>
          client.upload({
            sketchPath: "/tmp/sketch",
            fqbn: "arduino:avr:uno",
            port: { address: "/dev/ttyACM0", protocol: "serial" },
          }),
        () =>
          client.uploadUsingProgrammer({
            sketchPath: "/tmp/sketch",
            fqbn: "arduino:avr:uno",
            port: { address: "/dev/ttyACM0", protocol: "serial" },
            programmer: "usbasp",
          }),
        () =>
          client.burnBootloader({
            fqbn: "arduino:avr:uno",
            port: { address: "/dev/ttyACM0", protocol: "serial" },
            programmer: "usbasp",
          }),
        () => client.boardList(),
        () => client.boardDetails("arduino:avr:uno"),
        () => client.boardListAll(),
        () => client.boardSearch("uno"),
        () => client.platformSearch("avr"),
        () => client.platformInstall("arduino", "avr"),
        () => client.platformUninstall("arduino", "avr"),
        () => client.librarySearch("Servo"),
        () => client.libraryList(),
        () => client.libraryInstall("Servo"),
        () => client.libraryUninstall("Servo", "1.0.0"),
        () => client.libraryResolveDependencies("Servo"),
        () =>
          client.enumerateMonitorPortSettings(
            { address: "/dev/ttyACM0", protocol: "serial" },
            "arduino:avr:uno"
          ),
        () => client.isDebugSupported("arduino:avr:uno"),
        () =>
          client.getDebugConfig("/tmp/sketch", "arduino:avr:uno", {
            address: "/dev/ttyACM0",
            protocol: "serial",
          }),
        () => client.listProgrammers("arduino:avr:uno"),
      ];

      for (const fn of instanceRequiredFns) {
        await assert.rejects(fn, (err: Error) => {
          assert.strictEqual(
            err.message,
            "No instance created. Call createInstance() first."
          );
          return true;
        });
      }
    });
  });

  suite("Disconnected Client Guards", () => {
    test("getVersion rejects when client is not connected", async () => {
      await assert.rejects(
        async () => client.getVersion(),
        (err: Error) => {
          assert.strictEqual(err.message, "gRPC client not connected");
          return true;
        }
      );
    });

    test("configurationGet rejects when client is not connected", async () => {
      await assert.rejects(
        async () => client.configurationGet(),
        (err: Error) => {
          assert.strictEqual(err.message, "gRPC client not connected");
          return true;
        }
      );
    });

    test("settingsGetValue and settingsSetValue reject when client is not connected", async () => {
      await assert.rejects(
        async () => client.settingsGetValue("board_manager.additional_urls"),
        (err: Error) => {
          assert.strictEqual(err.message, "gRPC client not connected");
          return true;
        }
      );

      await assert.rejects(
        async () => client.settingsSetValue("directories.user", '"/tmp"'),
        (err: Error) => {
          assert.strictEqual(err.message, "gRPC client not connected");
          return true;
        }
      );
    });

    test("boardListWatch throws error when client is not connected", () => {
      assert.throws(
        () => client.boardListWatch(() => {}),
        /Client not connected/
      );
    });

    test("openMonitor throws error when client is not connected", () => {
      assert.throws(
        () =>
          client.openMonitor(
            { address: "/dev/ttyACM0", protocol: "serial" },
            "arduino:avr:uno"
          ),
        /Client not connected/
      );
    });
  });

  suite("Lifecycle & Disconnect Operations", () => {
    test("disconnect resets internal state and can be called safely when already disconnected", () => {
      assert.strictEqual(client.getInstance(), null);
      client.disconnect();
      assert.strictEqual(client.getInstance(), null);
      client.disconnect();
      assert.strictEqual(client.getInstance(), null);
    });
  });
});
