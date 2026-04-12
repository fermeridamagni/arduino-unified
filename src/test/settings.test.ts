import * as assert from "node:assert/strict";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ArduinoSettings } from "../config/settings";

suite("ArduinoSettings Suite", () => {
  let settings: ArduinoSettings;
  let getConfigurationStub: sinon.SinonStub;

  setup(() => {
    settings = new ArduinoSettings();
    getConfigurationStub = sinon.stub(vscode.workspace, "getConfiguration");
  });

  teardown(() => {
    sinon.restore();
  });

  test("Default values are retrieved correctly when configuration is missing", () => {
    // Mock the get method of WorkspaceConfiguration to always return the default value
    const mockConfig = {
      get: sinon
        .stub()
        .callsFake((key: string, defaultValue: any) => defaultValue),
      has: sinon.stub().returns(false),
      inspect: sinon.stub().returns(undefined),
      update: sinon.stub().resolves(),
    };

    getConfigurationStub.returns(mockConfig);

    // Verify all default values match what's in settings.ts
    assert.strictEqual(settings.cliPath, "");
    assert.strictEqual(settings.cliVersion, "1.4.1");

    assert.strictEqual(settings.compileVerbose, false);
    assert.strictEqual(settings.compileWarnings, "none");
    assert.strictEqual(settings.compileOptimizeForDebug, false);

    assert.strictEqual(settings.uploadVerbose, false);
    assert.strictEqual(settings.uploadVerify, false);
    assert.strictEqual(settings.uploadAutoVerify, true);

    assert.strictEqual(settings.sketchbookPath, "");
    assert.deepEqual(settings.additionalUrls, []);

    assert.strictEqual(settings.monitorBaudRate, 9600);
    assert.strictEqual(settings.monitorLineEnding, "nl");
    assert.strictEqual(settings.monitorAutoScroll, true);
    assert.strictEqual(settings.monitorTimestamp, false);

    assert.strictEqual(settings.formatterPath, "");
    assert.strictEqual(settings.languageServerPath, "");
    assert.strictEqual(settings.clangdPath, "");

    assert.strictEqual(
      settings.sketchTemplate,
      "void setup() {\n  // put your setup code here, to run once:\n}\n\nvoid loop() {\n  // put your main code here, to run repeatedly:\n}\n"
    );

    // Verify it called getConfiguration with the right namespace
    assert.ok(getConfigurationStub.calledWith("arduinoUnified"));
  });

  test("Configured values are retrieved correctly", () => {
    const mockConfig = {
      get: sinon.stub().callsFake((key: string, defaultValue: any) => {
        if (key === "cli.version") {
          return "1.5.0";
        }
        if (key === "monitor.baudRate") {
          return 115_200;
        }
        if (key === "compile.warnings") {
          return "all";
        }
        return defaultValue;
      }),
      has: sinon.stub().returns(true),
      inspect: sinon.stub().returns(undefined),
      update: sinon.stub().resolves(),
    };

    getConfigurationStub.returns(mockConfig);

    assert.strictEqual(settings.cliVersion, "1.5.0");
    assert.strictEqual(settings.monitorBaudRate, 115_200);
    assert.strictEqual(settings.compileWarnings, "all");
  });

  test("Settings can be updated via update method", async () => {
    const updateStub = sinon.stub().resolves();
    const mockConfig = {
      get: sinon.stub(),
      has: sinon.stub(),
      inspect: sinon.stub(),
      update: updateStub,
    };

    getConfigurationStub.returns(mockConfig);

    // Test global update (default)
    await settings.update("monitor.baudRate", 115_200);
    assert.ok(
      updateStub.calledWith(
        "monitor.baudRate",
        115_200,
        vscode.ConfigurationTarget.Global
      )
    );

    // Test workspace update
    await settings.update("monitor.baudRate", 115_200, false);
    assert.ok(
      updateStub.calledWith(
        "monitor.baudRate",
        115_200,
        vscode.ConfigurationTarget.Workspace
      )
    );
  });

  test("onDidChange emits when settings change", () => {
    const onDidChangeConfigurationStub = sinon.stub(
      vscode.workspace,
      "onDidChangeConfiguration"
    );

    // We'll capture the callback so we can simulate the event
    let registeredCallback:
      | ((e: vscode.ConfigurationChangeEvent) => void)
      | undefined;
    onDidChangeConfigurationStub.callsFake((callback) => {
      registeredCallback = callback;
      return { dispose: sinon.stub() };
    });

    let eventFired = false;
    settings.onDidChange((e) => {
      eventFired = true;
    });

    // The callback should have been registered
    assert.ok(registeredCallback);

    // Simulate an event that does not affect our namespace
    registeredCallback?.({
      affectsConfiguration: (section) => section !== "arduinoUnified",
    });
    assert.strictEqual(eventFired, false);

    // Simulate an event that DOES affect our namespace
    registeredCallback?.({
      affectsConfiguration: (section) => section === "arduinoUnified",
    });
    assert.strictEqual(eventFired, true);
  });
});
