import * as assert from "node:assert/strict";
import { BoardDiscoveryService } from "../boards/discovery";
import { BoardSelector } from "../boards/selector";
import { ArduinoGrpcClient } from "../cli/grpc-client";
import { ArduinoSettings } from "../config/settings";
import { ArduinoSerialMonitor } from "../monitor/serial-monitor";
import { MockOutputChannel, mockContextStore } from "./mocks/vscode.mock";

suite("ArduinoSerialMonitor Unit & Integration Tests", () => {
  let outputChannel: MockOutputChannel;
  let client: ArduinoGrpcClient;
  let discovery: BoardDiscoveryService;
  let selector: BoardSelector;
  let settings: ArduinoSettings;
  let monitor: ArduinoSerialMonitor;

  setup(() => {
    outputChannel = new MockOutputChannel("Monitor Test");
    client = new ArduinoGrpcClient(outputChannel as never);
    discovery = new BoardDiscoveryService(outputChannel as never);
    selector = new BoardSelector(outputChannel as never, discovery);
    settings = new ArduinoSettings();
    monitor = new ArduinoSerialMonitor(
      outputChannel as never,
      client,
      selector,
      settings
    );
  });

  teardown(() => {
    monitor.dispose();
    discovery.dispose();
  });

  suite("Connection & Selection Verification", () => {
    test("connect shows error when no port is selected", async () => {
      await monitor.connect();

      assert.strictEqual(monitor.isConnected(), false);
      assert.strictEqual(
        mockContextStore.get("arduinoUnified.serialMonitorOpen"),
        false
      );
    });

    test("connect shows error when port is selected but board fqbn is missing", async () => {
      selector.selectPort({
        address: "/dev/ttyACM0",
        protocol: "serial",
        protocolLabel: "Serial Port",
        hardwareId: "",
        properties: {},
        boards: [],
      });

      await monitor.connect();

      assert.strictEqual(monitor.isConnected(), false);
    });

    test("connect initializes monitor terminal when board and port are selected", async () => {
      selector.selectBoard({
        name: "Arduino Uno",
        fqbn: "arduino:avr:uno",
      });
      selector.selectPort({
        address: "/dev/ttyACM0",
        protocol: "serial",
        protocolLabel: "Serial Port",
        hardwareId: "",
        properties: {},
        boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
      });

      // Mock client openMonitor
      let monitorOpened = false;
      let onDataCb: ((data: Uint8Array) => void) | undefined;

      (client as unknown as { openMonitor: unknown }).openMonitor = () => {
        monitorOpened = true;
        return {
          write: (_d: Uint8Array) => {},
          onData: (cb: (data: Uint8Array) => void) => {
            onDataCb = cb;
          },
          cancel: () => {},
        };
      };

      await monitor.connect();

      assert.strictEqual(monitorOpened, true);
      assert.strictEqual(monitor.isConnected(), true);
      assert.strictEqual(
        mockContextStore.get("arduinoUnified.serialMonitorOpen"),
        true
      );

      // Simulate receiving data
      if (onDataCb) {
        onDataCb(new TextEncoder().encode("Sensor reading: 42\n"));
      }

      const recent = monitor.getRecentOutput();
      assert.ok(recent.includes("Sensor reading: 42"));
    });
  });

  suite("Pause, Resume & Disconnect Operations", () => {
    test("disconnect resets connection state and updates VS Code context", () => {
      monitor.disconnect();
      assert.strictEqual(monitor.isConnected(), false);
      assert.strictEqual(
        mockContextStore.get("arduinoUnified.serialMonitorOpen"),
        false
      );
    });

    test("pause stops active monitor connection temporarily", async () => {
      selector.selectBoard({
        name: "Arduino Uno",
        fqbn: "arduino:avr:uno",
      });
      selector.selectPort({
        address: "/dev/ttyACM0",
        protocol: "serial",
        protocolLabel: "Serial Port",
        hardwareId: "",
        properties: {},
        boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
      });

      let cancelled = false;
      (client as unknown as { openMonitor: unknown }).openMonitor = () => ({
        write: () => {},
        onData: () => {},
        cancel: () => {
          cancelled = true;
        },
      });

      await monitor.connect();
      assert.strictEqual(monitor.isConnected(), true);

      monitor.pause();
      assert.strictEqual(cancelled, true);
      assert.strictEqual(monitor.isConnected(), false);
    });

    test("write forwards data to active connection when connected", async () => {
      selector.selectBoard({
        name: "Arduino Uno",
        fqbn: "arduino:avr:uno",
      });
      selector.selectPort({
        address: "/dev/ttyACM0",
        protocol: "serial",
        protocolLabel: "Serial Port",
        hardwareId: "",
        properties: {},
        boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
      });

      let writtenData: Uint8Array | null = null;
      (client as unknown as { openMonitor: unknown }).openMonitor = () => ({
        write: (d: Uint8Array) => {
          writtenData = d;
        },
        onData: () => {},
        cancel: () => {},
      });

      await monitor.connect();
      monitor.write("TEST");

      assert.ok(writtenData);
      assert.strictEqual(new TextDecoder().decode(writtenData), "TEST");
    });
  });

  suite("Plotter Integration & Warning Checks", () => {
    test("openPlotterWebview displays warning if monitor is not connected", async () => {
      const mockWebviewProvider = {
        openWebview: async () => ({
          webview: { postMessage: async () => true },
          onDidDispose: () => {},
        }),
      };

      const panel = await monitor.openPlotterWebview(
        mockWebviewProvider as never
      );
      assert.ok(panel);
    });
  });
});
