import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import { BoardConfigStore } from "../boards/config-store";
import { ArduinoSettings } from "../config/settings";
import { DEFAULT_ALS_VERSION } from "../language/binaries";
import { registerLanguageSupport } from "../language/language-client";
import {
  ArduinoLanguageServer,
  buildAlsArgs,
  buildDocumentSelector,
  DidCompleteBuildNotification,
  type ILanguageClient,
} from "../language/server";
import { ManagedBinary } from "../toolchain/managed-binary";
import {
  detectPlatform,
  getAlsDownloadUrl,
  getBinaryName,
  getClangdDownloadUrl,
} from "../toolchain/platform";
import { MockOutputChannel } from "./mocks/vscode.mock";

function createMockMemento(): vscode.Memento {
  return {
    get: (<T>(_key: string, defaultValue?: T): T | undefined =>
      defaultValue) as vscode.Memento["get"],
    keys: () => [],
    update: async () => {},
  };
}

/**
 * Language client double that records lifecycle calls and notifications.
 */
class RecordingLanguageClient implements ILanguageClient {
  readonly notifications: Array<{ method: string; params: unknown }> = [];

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  sendNotification(type: unknown, params?: unknown): void {
    const method = (type as { method?: string }).method ?? String(type);
    this.notifications.push({ method, params });
  }
}

interface CapturedStart {
  client: RecordingLanguageClient;
  clientOptions: LanguageClientOptions;
  serverOptions: ServerOptions;
}

const UNO_SELECTION = {
  board: { name: "Uno", fqbn: "arduino:avr:uno" },
  fqbn: "arduino:avr:uno",
  port: null,
  portAddress: "",
} as const;

/**
 * Creates a sketch folder that satisfies Arduino's folder-name rule.
 */
function createSketchDir(root: string, name: string): string {
  const sketchDir = path.join(root, name);
  fs.mkdirSync(sketchDir, { recursive: true });
  fs.writeFileSync(
    path.join(sketchDir, `${name}.ino`),
    "void setup() {}\nvoid loop() {}\n"
  );
  return sketchDir;
}

/**
 * Builds a server wired with the recording client factory.
 */
function createRecordingServer(options: {
  debounceMs?: number;
  getLibraryDirs?: (fqbn: string) => Promise<string[]>;
  outputChannel: MockOutputChannel;
  tmpDir: string;
}): { captured: CapturedStart[]; server: ArduinoLanguageServer } {
  const captured: CapturedStart[] = [];
  const configStore = new BoardConfigStore(createMockMemento());
  const settings = new ArduinoSettings();

  const server = new ArduinoLanguageServer({
    binariesManager: undefined,
    clientFactory: (serverOpts, clientOpts) => {
      const client = new RecordingLanguageClient();
      captured.push({
        client,
        clientOptions: clientOpts,
        serverOptions: serverOpts as ServerOptions,
      });
      return client;
    },
    configStore,
    debounceMs: options.debounceMs ?? 20,
    getDaemonInfo: () => ({ port: 50_051, instanceId: 1 }),
    getLibraryDirs: options.getLibraryDirs,
    outputChannel: options.outputChannel as never,
    settings,
    storagePath: options.tmpDir,
  });

  server.setBinaries("/bin/als", "/bin/clangd");
  return { captured, server };
}

async function waitForApply(ms = 120): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

suite("Arduino Language Server & Toolchain Unit Tests", () => {
  let tmpDir: string;
  let mockOutputChannel: MockOutputChannel;

  setup(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "als-test-"));
    mockOutputChannel = new MockOutputChannel("ALS Test");
  });

  teardown(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { force: true, recursive: true });
    }
  });

  // ── 1. URL and Platform Mapping ──────────────────────────────────
  suite("URL/platform mapping for ALS + clangd", () => {
    test("maps ALS release URLs correctly for macOS architectures", () => {
      const macArm = detectPlatform("darwin", "arm64");
      const urlArm = getAlsDownloadUrl("0.7.7", macArm);
      assert.strictEqual(
        urlArm,
        "https://github.com/arduino/arduino-language-server/releases/download/0.7.7/arduino-language-server_0.7.7_macOS_ARM64.tar.gz"
      );

      const macX64 = detectPlatform("darwin", "x64");
      const urlX64 = getAlsDownloadUrl("0.7.7", macX64);
      assert.strictEqual(
        urlX64,
        "https://github.com/arduino/arduino-language-server/releases/download/0.7.7/arduino-language-server_0.7.7_macOS_64bit.tar.gz"
      );
    });

    test("maps ALS release URLs correctly for Linux architectures", () => {
      const linuxX64 = detectPlatform("linux", "x64");
      assert.strictEqual(
        getAlsDownloadUrl("0.7.7", linuxX64),
        "https://github.com/arduino/arduino-language-server/releases/download/0.7.7/arduino-language-server_0.7.7_Linux_64bit.tar.gz"
      );

      const linuxArm64 = detectPlatform("linux", "arm64");
      assert.strictEqual(
        getAlsDownloadUrl("0.7.7", linuxArm64),
        "https://github.com/arduino/arduino-language-server/releases/download/0.7.7/arduino-language-server_0.7.7_Linux_ARM64.tar.gz"
      );

      const linux32 = detectPlatform("linux", "ia32");
      assert.strictEqual(
        getAlsDownloadUrl("0.7.7", linux32),
        "https://github.com/arduino/arduino-language-server/releases/download/0.7.7/arduino-language-server_0.7.7_Linux_32bit.tar.gz"
      );
    });

    test("maps ALS release URLs correctly for Windows", () => {
      const winX64 = detectPlatform("win32", "x64");
      assert.strictEqual(
        getAlsDownloadUrl("0.7.7", winX64),
        "https://github.com/arduino/arduino-language-server/releases/download/0.7.7/arduino-language-server_0.7.7_Windows_64bit.zip"
      );

      const win32 = detectPlatform("win32", "ia32");
      assert.strictEqual(
        getAlsDownloadUrl("0.7.7", win32),
        "https://github.com/arduino/arduino-language-server/releases/download/0.7.7/arduino-language-server_0.7.7_Windows_32bit.zip"
      );
    });

    test("maps Clangd release URLs to GitHub zip releases for all platforms", () => {
      assert.strictEqual(
        getClangdDownloadUrl("14.0.0", "darwin"),
        "https://github.com/clangd/clangd/releases/download/14.0.0/clangd-mac-14.0.0.zip"
      );
      assert.strictEqual(
        getClangdDownloadUrl("14.0.0", "linux"),
        "https://github.com/clangd/clangd/releases/download/14.0.0/clangd-linux-14.0.0.zip"
      );
      assert.strictEqual(
        getClangdDownloadUrl("14.0.0", "win32"),
        "https://github.com/clangd/clangd/releases/download/14.0.0/clangd-windows-14.0.0.zip"
      );
    });

    test("getBinaryName appends .exe on Windows and plain name on Unix", () => {
      assert.strictEqual(getBinaryName("clangd", "darwin"), "clangd");
      assert.strictEqual(getBinaryName("clangd", "linux"), "clangd");
      assert.strictEqual(getBinaryName("clangd", "win32"), "clangd.exe");
      assert.strictEqual(
        getBinaryName("arduino-language-server", "win32"),
        "arduino-language-server.exe"
      );
    });
  });

  // ── 2. Managed Binary Resolution Order ───────────────────────────
  suite(
    "managed-binary resolve order (custom path → installed → missing)",
    () => {
      test("prefers custom path when configured and file exists on disk", async () => {
        const customFile = path.join(tmpDir, "custom-als");
        await fs.promises.writeFile(customFile, "custom-bin", "utf8");

        const managed = new ManagedBinary({
          binaryName: "arduino-language-server",
          customPath: () => customFile,
          defaultVersion: DEFAULT_ALS_VERSION,
          displayName: "ALS",
          getDownloadUrl: (v, p) => getAlsDownloadUrl(v, p),
          storagePath: tmpDir,
        });

        const resolution = await managed.resolve();
        assert.strictEqual(resolution.source, "custom");
        assert.strictEqual(resolution.path, customFile);
      });

      test("falls back to installed binary when custom path does not exist", async () => {
        const nonExistentCustom = path.join(tmpDir, "does-not-exist");
        const installedFile = path.join(
          tmpDir,
          "bin",
          getBinaryName("arduino-language-server")
        );
        await fs.promises.mkdir(path.dirname(installedFile), {
          recursive: true,
        });
        await fs.promises.writeFile(installedFile, "installed-bin", "utf8");

        const managed = new ManagedBinary({
          binaryName: "arduino-language-server",
          customPath: () => nonExistentCustom,
          defaultVersion: DEFAULT_ALS_VERSION,
          displayName: "ALS",
          getDownloadUrl: (v, p) => getAlsDownloadUrl(v, p),
          storagePath: tmpDir,
        });

        const resolution = await managed.resolve();
        assert.strictEqual(resolution.source, "installed");
        assert.strictEqual(resolution.path, installedFile);
      });

      test("resolves to installed binary when no custom path is configured", async () => {
        const installedFile = path.join(
          tmpDir,
          "bin",
          getBinaryName("arduino-language-server")
        );
        await fs.promises.mkdir(path.dirname(installedFile), {
          recursive: true,
        });
        await fs.promises.writeFile(installedFile, "installed-bin", "utf8");

        const managed = new ManagedBinary({
          binaryName: "arduino-language-server",
          customPath: () => "",
          defaultVersion: DEFAULT_ALS_VERSION,
          displayName: "ALS",
          getDownloadUrl: (v, p) => getAlsDownloadUrl(v, p),
          storagePath: tmpDir,
        });

        const resolution = await managed.resolve();
        assert.strictEqual(resolution.source, "installed");
        assert.strictEqual(resolution.path, installedFile);
      });

      test("returns missing source with null path when neither exists", async () => {
        const managed = new ManagedBinary({
          binaryName: "arduino-language-server",
          customPath: () => "",
          defaultVersion: DEFAULT_ALS_VERSION,
          displayName: "ALS",
          getDownloadUrl: (v, p) => getAlsDownloadUrl(v, p),
          storagePath: tmpDir,
        });

        const resolution = await managed.resolve();
        assert.strictEqual(resolution.source, "missing");
        assert.strictEqual(resolution.path, null);
      });
    }
  );

  // ── 3. Restart Coalescing ─────────────────────────────────────────
  suite("Restart coalescing: 3 FQBN changes → 1 start", () => {
    test("coalesces 3 rapid FQBN changes into a single server start", async () => {
      const sketchDir = createSketchDir(tmpDir, "MySketch");
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      // The sketch must be known before the first board-driven start
      server.handleSketchChange(sketchDir);

      // Fire 3 FQBN changes rapidly within the debounce window
      server.handleSelectionChange({
        board: { name: "Uno", fqbn: "arduino:avr:uno" },
        fqbn: "arduino:avr:uno",
        port: null,
        portAddress: "",
      });

      server.handleSelectionChange({
        board: { name: "Nano", fqbn: "arduino:avr:nano" },
        fqbn: "arduino:avr:nano",
        port: null,
        portAddress: "",
      });

      server.handleSelectionChange({
        board: { name: "Mega", fqbn: "arduino:avr:mega" },
        fqbn: "arduino:avr:mega",
        port: null,
        portAddress: "",
      });

      await waitForApply();

      assert.strictEqual(
        captured.length,
        1,
        `Expected exactly 1 start call, got ${captured.length}`
      );
      const lastArgs =
        (captured[0].serverOptions as { args?: string[] }).args ?? [];
      assert.ok(
        lastArgs.includes("arduino:avr:mega"),
        "Expected started args to contain the final selection 'arduino:avr:mega'"
      );
      // Regression guard: vscode-languageclient appends `--stdio` when the
      // stdio transport is declared explicitly, which makes ALS (a Go
      // binary) exit instantly with "flag provided but not defined".
      assert.strictEqual(
        lastArgs.includes("--stdio"),
        false,
        "Spawn args must not contain --stdio (injected only for explicit stdio transport)"
      );

      server.dispose();
    });

    test("does not restart when the same selection is re-applied", async () => {
      const sketchDir = createSketchDir(tmpDir, "MySketch");
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSketchChange(sketchDir);
      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();
      assert.strictEqual(captured.length, 1);

      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();
      assert.strictEqual(
        captured.length,
        1,
        "Identical configuration must not restart the server"
      );

      server.dispose();
    });
  });

  // ── 4. Do Not Start Without FQBN ──────────────────────────────────
  suite("Do not start without FQBN", () => {
    test("does not start language server when FQBN is empty or board is null", async () => {
      const sketchDir = createSketchDir(tmpDir, "MySketch");
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSketchChange(sketchDir);

      server.handleSelectionChange({
        board: null,
        fqbn: "",
        port: null,
        portAddress: "",
      });

      await waitForApply();

      assert.strictEqual(
        captured.length,
        0,
        "Server should not start without FQBN"
      );
      assert.strictEqual(server.isRunning(), false);

      server.dispose();
    });

    test("stops running language server if board is deselected (empty FQBN)", async () => {
      const sketchDir = createSketchDir(tmpDir, "MySketch");
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      // Start with board
      server.handleSketchChange(sketchDir);
      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();
      assert.strictEqual(server.isRunning(), true);
      assert.strictEqual(captured.length, 1);

      // Deselect board
      server.handleSelectionChange({
        board: null,
        fqbn: "",
        port: null,
        portAddress: "",
      });

      await waitForApply();
      assert.strictEqual(server.isRunning(), false);
      assert.ok(captured[0].client !== undefined);

      server.dispose();
    });
  });

  // ── 5. Sketch Root Resolution ─────────────────────────────────────
  suite("Sketch root drives ALS workspace folder", () => {
    test("does not start when no sketch is open, starts once sketch appears", async () => {
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();
      assert.strictEqual(
        captured.length,
        0,
        "Server must not start without a sketch folder"
      );
      assert.strictEqual(server.isRunning(), false);

      const sketchDir = createSketchDir(tmpDir, "MySketch");
      server.handleSketchChange(sketchDir);
      await waitForApply();
      assert.strictEqual(captured.length, 1);
      assert.strictEqual(server.isRunning(), true);

      server.dispose();
    });

    test("sends the sketch folder (not workspace root) as workspace folder", async () => {
      const sketchDir = createSketchDir(tmpDir, "MySketch");
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSketchChange(sketchDir);
      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();

      assert.strictEqual(captured.length, 1);
      const workspaceFolder = captured[0].clientOptions.workspaceFolder;
      assert.ok(workspaceFolder, "workspaceFolder must be set for ALS");
      assert.strictEqual(
        workspaceFolder.uri.fsPath.toLowerCase(),
        sketchDir.toLowerCase()
      );

      server.dispose();
    });

    test("restarts when the active sketch folder changes", async () => {
      const sketchA = createSketchDir(tmpDir, "SketchA");
      const sketchB = createSketchDir(tmpDir, "SketchB");
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSketchChange(sketchA);
      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();
      assert.strictEqual(captured.length, 1);

      server.handleSketchChange(sketchB);
      await waitForApply();
      assert.strictEqual(captured.length, 2);
      const workspaceFolder = captured[1].clientOptions.workspaceFolder;
      assert.ok(workspaceFolder);
      assert.strictEqual(
        workspaceFolder.uri.fsPath.toLowerCase(),
        sketchB.toLowerCase()
      );

      server.dispose();
    });

    test("does not start when sketch folder does not match its .ino file", async () => {
      const invalidSketch = path.join(tmpDir, "Mismatched");
      fs.mkdirSync(invalidSketch, { recursive: true });
      fs.writeFileSync(path.join(invalidSketch, "OtherName.ino"), "");

      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSketchChange(invalidSketch);
      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();

      assert.strictEqual(
        captured.length,
        0,
        "ALS bootstrap build fails without folder-matching .ino; must not start"
      );

      server.dispose();
    });
  });

  // ── 6. Document Selector Scoping ──────────────────────────────────
  suite("Document selector scopes C/C++ to sketch and libraries", () => {
    test("buildDocumentSelector attaches ino always and cpp/c per directory", () => {
      const sketchPath = path.resolve("/sketch");
      const libPath = path.resolve("/libs/A");
      const selector = buildDocumentSelector(sketchPath, [libPath, libPath]);

      const inoFilters = selector.filter((f) => f.language === "ino");
      assert.strictEqual(inoFilters.length, 2);
      assert.ok(inoFilters.some((f) => f.scheme === "untitled"));

      const cppFilters = selector.filter((f) => f.language === "cpp");
      assert.strictEqual(cppFilters.length, 2, "duplicate dirs are deduped");
      const bases = cppFilters.map((f) => (f.pattern as { base: string }).base);
      const expectedSketchBase = vscode.Uri.file(sketchPath).fsPath;
      const expectedLibBase = vscode.Uri.file(libPath).fsPath;
      assert.ok(
        bases.some((b) => b.toLowerCase() === expectedSketchBase.toLowerCase()),
        "sketch base must be included"
      );
      assert.ok(
        bases.some((b) => b.toLowerCase() === expectedLibBase.toLowerCase()),
        "lib base must be included"
      );
    });

    test("started client selector includes sketch and library directories", async () => {
      const sketchDir = createSketchDir(tmpDir, "MySketch");
      const libDir = path.join(tmpDir, "libraries", "WiFiS3");
      fs.mkdirSync(libDir, { recursive: true });

      const { captured, server } = createRecordingServer({
        getLibraryDirs: async () => [libDir],
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSketchChange(sketchDir);
      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();

      assert.strictEqual(captured.length, 1);
      const selector = captured[0].clientOptions
        .documentSelector as unknown as Array<{
        language?: string;
        pattern?: { base: string };
      }>;
      const cppBases = selector
        .filter((f) => f.language === "cpp")
        .map((f) => f.pattern?.base);
      const expectedSketchBase = vscode.Uri.file(sketchDir).fsPath;
      const expectedLibBase = vscode.Uri.file(libDir).fsPath;
      assert.ok(
        cppBases.some(
          (b) => b?.toLowerCase() === expectedSketchBase.toLowerCase()
        ),
        "cpp files in the sketch folder must be attached"
      );
      assert.ok(
        cppBases.some(
          (b) => b?.toLowerCase() === expectedLibBase.toLowerCase()
        ),
        "cpp files in installed library folders must be attached"
      );

      server.dispose();
    });
  });

  // ── 7. didCompleteBuild Notification ──────────────────────────────
  suite("ino/didCompleteBuild after full builds", () => {
    test("forwards build output path to ALS when running", async () => {
      const sketchDir = createSketchDir(tmpDir, "MySketch");
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSketchChange(sketchDir);
      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();
      assert.strictEqual(captured.length, 1);

      const buildPath = path.join(tmpDir, "build");
      server.notifyBuildCompleted(buildPath);

      const notifications = captured[0].client.notifications;
      assert.strictEqual(notifications.length, 1);
      assert.strictEqual(
        notifications[0].method,
        DidCompleteBuildNotification.method
      );
      const params = notifications[0].params as { buildOutputUri: string };
      assert.strictEqual(
        params.buildOutputUri,
        vscode.Uri.file(buildPath).toString()
      );

      server.dispose();
    });

    test("ignores build notifications when the server is not running", () => {
      const { server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      // Must not throw when there is no client
      server.notifyBuildCompleted(path.join(tmpDir, "build"));
      assert.strictEqual(server.isRunning(), false);
      server.dispose();
    });
  });

  // ── 8. Library Change Forces Restart ──────────────────────────────
  suite("Library install/uninstall forces IntelliSense restart", () => {
    test("restarts the server when libraries change with same board", async () => {
      const sketchDir = createSketchDir(tmpDir, "MySketch");
      const { captured, server } = createRecordingServer({
        outputChannel: mockOutputChannel,
        tmpDir,
      });

      server.handleSketchChange(sketchDir);
      server.handleSelectionChange({ ...UNO_SELECTION });
      await waitForApply();
      assert.strictEqual(captured.length, 1);

      server.handleLibraryChange();
      await waitForApply();
      assert.strictEqual(
        captured.length,
        2,
        "Library change must restart even with identical board/port/sketch"
      );

      server.dispose();
    });
  });

  // ── 9. Daemon CLI Arguments ───────────────────────────────────────
  suite("Daemon args: both addr + instance, never mixed with -cli", () => {
    test("buildAlsArgs passes daemon address and instance, never -cli or -cli-config", () => {
      const args = buildAlsArgs({
        daemonPort: 61_234,
        instanceId: 7,
        clangdPath: "/custom/path/clangd",
        fqbnWithOptions: "arduino:avr:uno:cpu=atmega328",
        jobs: 1,
        log: true,
        logPath: "/logs/dir",
      });

      // Assert daemon arguments
      const addrIndex = args.indexOf("-cli-daemon-addr");
      assert.ok(addrIndex !== -1, "-cli-daemon-addr flag must be present");
      assert.strictEqual(args[addrIndex + 1], "localhost:61234");

      const instIndex = args.indexOf("-cli-daemon-instance");
      assert.ok(instIndex !== -1, "-cli-daemon-instance flag must be present");
      assert.strictEqual(args[instIndex + 1], "7");

      // Assert clangd, fqbn, jobs, log
      const clangdIndex = args.indexOf("-clangd");
      assert.ok(clangdIndex !== -1, "-clangd flag must be present");
      assert.strictEqual(args[clangdIndex + 1], "/custom/path/clangd");

      const fqbnIndex = args.indexOf("-fqbn");
      assert.ok(fqbnIndex !== -1, "-fqbn flag must be present");
      assert.strictEqual(args[fqbnIndex + 1], "arduino:avr:uno:cpu=atmega328");

      const jobsIndex = args.indexOf("-jobs");
      assert.ok(jobsIndex !== -1, "-jobs flag must be present");
      assert.strictEqual(args[jobsIndex + 1], "1");

      assert.ok(
        args.includes("-log"),
        "-log flag must be present when log is true"
      );
      // ALS fatals when -log is passed without -logpath
      const logPathIndex = args.indexOf("-logpath");
      assert.ok(logPathIndex !== -1, "-logpath must accompany -log");
      assert.strictEqual(args[logPathIndex + 1], "/logs/dir");

      // Critical requirement: NEVER pass -cli or -cli-config when daemon flags are set
      assert.strictEqual(
        args.includes("-cli"),
        false,
        "Must NOT pass -cli flag when daemon flags are set"
      );
      assert.strictEqual(
        args.includes("-cli-config"),
        false,
        "Must NOT pass -cli-config flag when daemon flags are set"
      );
    });

    test("buildAlsArgs omits -log flag when log option is false or omitted", () => {
      const args = buildAlsArgs({
        daemonPort: 50_051,
        instanceId: 1,
        clangdPath: "/clangd",
        fqbnWithOptions: "arduino:avr:uno",
        log: false,
      });

      assert.strictEqual(args.includes("-log"), false);
      assert.strictEqual(args.includes("-logpath"), false);
      assert.strictEqual(args.includes("-cli"), false);
      assert.strictEqual(args.includes("-cli-config"), false);
    });
  });

  // ── 10. Ino Document Language Integrity ───────────────────────────
  suite(
    ".ino stays language ino (regression vs setTextDocumentLanguage(..., 'cpp'))",
    () => {
      test(".ino document retains language 'ino' without remapping to 'cpp'", () => {
        // Mock TextDocument
        const doc = {
          fileName: "/workspace/MySketch/MySketch.ino",
          languageId: "ino",
          uri: vscode.Uri.file("/workspace/MySketch/MySketch.ino"),
        };

        let remappedLanguage = "";
        const origSetTextDocumentLanguage =
          vscode.languages.setTextDocumentLanguage;
        (
          vscode.languages as unknown as { setTextDocumentLanguage: unknown }
        ).setTextDocumentLanguage = (_d: unknown, languageId: string) => {
          remappedLanguage = languageId;
          return Promise.resolve();
        };

        try {
          const mockContext = {
            subscriptions: [],
          } as unknown as vscode.ExtensionContext;
          registerLanguageSupport(mockContext);

          // Verify that setTextDocumentLanguage was NOT called with "cpp"
          assert.strictEqual(
            remappedLanguage,
            "",
            "setTextDocumentLanguage should not be called to remap .ino files to 'cpp'"
          );
          assert.strictEqual(doc.languageId, "ino");
        } finally {
          (
            vscode.languages as unknown as { setTextDocumentLanguage: unknown }
          ).setTextDocumentLanguage = origSetTextDocumentLanguage;
        }
      });

      test("package.json contributes language 'ino' with grammar source.ino and does not attach to cpp/c/h", () => {
        const pkgPath = path.join(__dirname, "..", "..", "package.json");
        const content = fs.readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(content);

        // Check language contribution
        const languages = pkg.contributes?.languages as {
          id: string;
          extensions: string[];
        }[];
        assert.ok(languages, "contributes.languages must exist");
        const inoLang = languages.find((l) => l.id === "ino");
        assert.ok(inoLang, "Language 'ino' must be contributed");
        assert.ok(inoLang.extensions.includes(".ino"));
        assert.ok(inoLang.extensions.includes(".pde"));

        // Check grammars contribution
        const grammars = pkg.contributes?.grammars as {
          language: string;
          scopeName: string;
          path: string;
        }[];
        assert.ok(grammars, "contributes.grammars must exist");
        const inoGrammar = grammars.find((g) => g.language === "ino");
        assert.ok(inoGrammar, "Grammar for 'ino' must be contributed");
        assert.strictEqual(inoGrammar.scopeName, "source.ino");

        // Verify syntaxes/ino.tmLanguage.json exists and includes source.cpp
        const grammarFilePath = path.join(
          __dirname,
          "..",
          "..",
          inoGrammar.path
        );
        assert.ok(
          fs.existsSync(grammarFilePath),
          "syntaxes/ino.tmLanguage.json must exist"
        );
        const grammarContent = JSON.parse(
          fs.readFileSync(grammarFilePath, "utf8")
        );
        assert.strictEqual(grammarContent.scopeName, "source.ino");
        assert.deepStrictEqual(grammarContent.patterns, [
          { include: "source.cpp" },
        ]);
      });
    }
  );
});
