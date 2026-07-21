import * as assert from "node:assert/strict";
import { BoardConfigStore } from "../boards/config-store";
import { BoardDiscoveryService } from "../boards/discovery";
import { BoardSelector } from "../boards/selector";
import { ArduinoGrpcClient } from "../cli/grpc-client";
import { ArduinoDebugProvider } from "../debug/debug-provider";
import {
  MockMemento,
  MockOutputChannel,
  registeredCommands,
} from "./mocks/vscode.mock";

suite("ArduinoDebugProvider Unit & Integration Tests", () => {
  let outputChannel: MockOutputChannel;
  let client: ArduinoGrpcClient;
  let discovery: BoardDiscoveryService;
  let selector: BoardSelector;
  let configStore: BoardConfigStore;
  let debugProvider: ArduinoDebugProvider;

  setup(() => {
    outputChannel = new MockOutputChannel("Debug Test");
    client = new ArduinoGrpcClient(outputChannel as never);
    discovery = new BoardDiscoveryService(outputChannel as never);
    selector = new BoardSelector(outputChannel as never, discovery);
    configStore = new BoardConfigStore(new MockMemento() as never);
    debugProvider = new ArduinoDebugProvider(
      outputChannel as never,
      client,
      selector,
      configStore
    );
  });

  teardown(() => {
    debugProvider.dispose();
    discovery.dispose();
  });

  suite("isDebugSupported", () => {
    test("returns false when no board (fqbn) is selected", async () => {
      const supported = await debugProvider.isDebugSupported();
      assert.strictEqual(supported, false);
    });

    test("queries client and returns true when debugging is supported", async () => {
      selector.selectBoard({
        name: "Arduino MKR1000",
        fqbn: "arduino:samd:mkr1000",
      });

      (client as unknown as { isDebugSupported: unknown }).isDebugSupported =
        async (fqbn: string) => {
          assert.strictEqual(fqbn, "arduino:samd:mkr1000");
          return { debuggingSupported: true };
        };

      const supported = await debugProvider.isDebugSupported();
      assert.strictEqual(supported, true);
    });

    test("catches gRPC errors gracefully and returns false", async () => {
      selector.selectBoard({
        name: "Arduino MKR1000",
        fqbn: "arduino:samd:mkr1000",
      });

      (client as unknown as { isDebugSupported: unknown }).isDebugSupported =
        async () => {
          throw new Error("gRPC failure");
        };

      const supported = await debugProvider.isDebugSupported();
      assert.strictEqual(supported, false);
    });
  });

  suite("generateDebugConfig", () => {
    test("returns null when board or port selection is incomplete", async () => {
      selector.selectBoard({
        name: "Arduino MKR1000",
        fqbn: "arduino:samd:mkr1000",
      });
      const config1 = await debugProvider.generateDebugConfig("/tmp/sketch");
      assert.strictEqual(config1, null);

      selector.selectPort({
        address: "/dev/ttyACM0",
        protocol: "serial",
        protocolLabel: "Serial Port",
        hardwareId: "",
        properties: {},
        boards: [],
      });
      const config2 = await debugProvider.generateDebugConfig("/tmp/sketch");
      assert.strictEqual(config2, null);
    });

    test("generates cortex-debug compatible launch config for SAMD architecture", async () => {
      selector.selectBoard({
        name: "Arduino MKR1000",
        fqbn: "arduino:samd:mkr1000",
      });
      selector.selectPort({
        address: "/dev/ttyACM0",
        protocol: "serial",
        protocolLabel: "Serial Port",
        hardwareId: "",
        properties: {},
        boards: [{ name: "Arduino MKR1000", fqbn: "arduino:samd:mkr1000" }],
      });

      (client as unknown as { getDebugConfig: unknown }).getDebugConfig =
        async () => ({
          toolchain: "arm-none-eabi",
          executable: "/tmp/sketch.elf",
          server: "/usr/bin/openocd",
          serverConfiguration: { additionalArgs: ["-f", "interface.cfg"] },
          device: "ATSAMD21G18A",
          toolchainPath: "/usr/bin/arm-none-eabi-gdb",
          svdFile: "/tmp/samd21.svd",
        });

      const config = await debugProvider.generateDebugConfig("/tmp/sketch");
      assert.ok(config);
      assert.strictEqual(config?.type, "cortex-debug");
      assert.strictEqual(config?.request, "launch");
      assert.strictEqual(config?.name, "Arduino Debug (Arduino MKR1000)");
      assert.strictEqual(config?.executable, "/tmp/sketch.elf");
      assert.strictEqual(config?.servertype, "openocd");
      assert.strictEqual(config?.toolchainPrefix, "arm-none-eabi");
      assert.strictEqual(config?.device, "ATSAMD21G18A");
      assert.deepStrictEqual(config?.serverArgs, ["-f", "interface.cfg"]);
    });

    test("maps jlink and stutil server types correctly", async () => {
      selector.selectBoard({
        name: "STM32 Nucleo",
        fqbn: "arduino:stm32:nucleo",
      });
      selector.selectPort({
        address: "COM3",
        protocol: "serial",
        protocolLabel: "Serial Port",
        hardwareId: "",
        properties: {},
        boards: [{ name: "STM32 Nucleo", fqbn: "arduino:stm32:nucleo" }],
      });

      (client as unknown as { getDebugConfig: unknown }).getDebugConfig =
        async () => ({
          toolchain: "arm-none-eabi",
          server: "C:\\JLink\\JLinkGDBServer.exe",
        });

      const config = await debugProvider.generateDebugConfig("/tmp/sketch");
      assert.strictEqual(config?.servertype, "jlink");
    });
  });

  suite("Registered Commands", () => {
    test("registers arduinoUnified.startDebug and arduinoUnified.checkDebugSupport commands", () => {
      assert.ok(registeredCommands.has("arduinoUnified.startDebug"));
      assert.ok(registeredCommands.has("arduinoUnified.checkDebugSupport"));
    });
  });
});
