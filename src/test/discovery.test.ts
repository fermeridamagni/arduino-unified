import * as assert from "node:assert/strict";
import { BoardDiscoveryService } from "../boards/discovery";
import { ArduinoGrpcClient } from "../cli/grpc-client";
import { MockOutputChannel } from "./mocks/vscode.mock";

suite("BoardDiscoveryService Unit Tests", () => {
  let outputChannel: MockOutputChannel;
  let client: ArduinoGrpcClient;
  let discovery: BoardDiscoveryService;

  setup(() => {
    outputChannel = new MockOutputChannel("Discovery Test");
    client = new ArduinoGrpcClient(outputChannel as never);
    discovery = new BoardDiscoveryService(outputChannel as never);
  });

  teardown(() => {
    discovery.dispose();
  });

  suite("Board Event Processing & Port Tracking", () => {
    test("handles board add and remove watch events correctly", () => {
      let watchCallback: ((event: Record<string, unknown>) => void) | undefined;
      let cancelCalled = false;

      (client as unknown as { boardListWatch: unknown }).boardListWatch = (
        onEvent: (event: Record<string, unknown>) => void
      ) => {
        watchCallback = onEvent;
        return () => {
          cancelCalled = true;
        };
      };

      discovery.startWatching(client);
      assert.ok(watchCallback);

      const eventsLogged: string[] = [];
      discovery.on("boardConnected", (port) => {
        eventsLogged.push(`connected:${port.address}`);
      });
      discovery.on("boardDisconnected", (port) => {
        eventsLogged.push(`disconnected:${port.address}`);
      });

      // Simulate board connect event (add)
      watchCallback({
        eventType: "add",
        port: {
          address: "/dev/ttyACM0",
          protocol: "serial",
          protocolLabel: "Serial Port",
          matchingBoards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
        },
      });

      assert.strictEqual(discovery.getDetectedPorts().length, 1);
      assert.strictEqual(discovery.getDetectedBoards().length, 1);

      const foundPort = discovery.findPortByAddress("/dev/ttyACM0");
      assert.ok(foundPort);
      assert.strictEqual(foundPort?.boards[0].name, "Arduino Uno");
      assert.strictEqual(foundPort?.boards[0].fqbn, "arduino:avr:uno");
      assert.strictEqual(eventsLogged.includes("connected:/dev/ttyACM0"), true);

      const summary = discovery.getSummary();
      assert.ok(summary.includes("/dev/ttyACM0 (Arduino Uno)"));

      // Simulate board disconnect event (remove)
      watchCallback({
        eventType: "remove",
        port: {
          address: "/dev/ttyACM0",
          protocol: "serial",
        },
      });

      assert.strictEqual(discovery.getDetectedPorts().length, 0);
      assert.strictEqual(discovery.getDetectedBoards().length, 0);
      assert.strictEqual(
        eventsLogged.includes("disconnected:/dev/ttyACM0"),
        true
      );
      assert.strictEqual(discovery.getSummary(), "No boards detected");

      discovery.stopWatching();
      assert.strictEqual(cancelCalled, true);
    });

    test("startWatching is idempotent when called while already watching", () => {
      let watchCalls = 0;
      (client as unknown as { boardListWatch: unknown }).boardListWatch =
        () => {
          watchCalls++;
          return () => {};
        };

      discovery.startWatching(client);
      discovery.startWatching(client);

      assert.strictEqual(watchCalls, 1);
    });

    test("pause and resume temporarily stop and restart board watching", () => {
      let watchCalls = 0;
      let cancelCalls = 0;

      (client as unknown as { boardListWatch: unknown }).boardListWatch =
        () => {
          watchCalls++;
          return () => {
            cancelCalls++;
          };
        };

      discovery.startWatching(client);
      assert.strictEqual(watchCalls, 1);

      discovery.pause();
      assert.strictEqual(cancelCalls, 1);

      discovery.resume(client);
      assert.strictEqual(watchCalls, 2);
    });

    test("handles watch stream errors by clearing active watcher and scheduling restart", () => {
      let onErrorCallback: ((error: Error) => void) | undefined;
      (client as unknown as { boardListWatch: unknown }).boardListWatch = (
        _onEvent: unknown,
        onError?: (error: Error) => void
      ) => {
        onErrorCallback = onError;
        return () => {};
      };

      discovery.startWatching(client);
      assert.ok(onErrorCallback);

      // Trigger stream error
      onErrorCallback(new Error("Stream disconnected"));
      assert.ok(
        outputChannel.lines.some((line) => line.includes("Watch error:"))
      );
    });
  });
});
