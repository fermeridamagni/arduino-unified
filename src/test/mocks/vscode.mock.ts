/**
 * Comprehensive VS Code module mock for running tests under Bun or Node.
 */

const g = globalThis as Record<string, unknown>;
const proc = process as unknown as { versions?: { bun?: string } };

if (typeof g.suite === "undefined") {
  if (
    typeof g.describe === "undefined" &&
    typeof process !== "undefined" &&
    proc.versions?.bun
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bunTest = require("bun:test");
      g.describe = bunTest.describe;
      g.it = bunTest.it;
      g.beforeEach = bunTest.beforeEach;
      g.afterEach = bunTest.afterEach;
    } catch {}
  }
  g.suite = g.describe;
  g.test = g.it;
  g.setup = g.beforeEach;
  g.teardown = g.afterEach;
}

export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly fsPath: string;

  private constructor(
    scheme: string,
    authority: string,
    filePath: string,
    query = "",
    fragment = ""
  ) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = filePath;
    this.query = query;
    this.fragment = fragment;
    this.fsPath = filePath;
  }

  static file(filePath: string): Uri {
    return new Uri("file", "", filePath);
  }

  static parse(uri: string): Uri {
    const parts = uri.split("://");
    if (parts.length > 1) {
      return new Uri(parts[0], "", parts[1]);
    }
    return new Uri("file", "", uri);
  }

  toString(): string {
    return `${this.scheme}://${this.path}`;
  }

  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }
}

export class Disposable {
  private readonly callOnDispose?: () => void;

  constructor(callOnDispose?: () => void) {
    this.callOnDispose = callOnDispose;
  }

  dispose(): void {
    if (this.callOnDispose) {
      this.callOnDispose();
    }
  }

  static from(...disposables: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => {
      for (const d of disposables) {
        d.dispose();
      }
    });
  }
}

export class EventEmitter<T> {
  private listeners: ((e: T) => unknown)[] = [];

  event = (listener: (e: T) => unknown): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    });
  };

  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class Position {
  readonly line: number;
  readonly character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  compareTo(other: Position): number {
    if (this.line !== other.line) {
      return this.line - other.line;
    }
    return this.character - other.character;
  }
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number
  );
  constructor(
    startLineOrPos: number | Position,
    startCharOrPos?: number | Position,
    endLine?: number,
    endChar?: number
  ) {
    if (typeof startLineOrPos === "number") {
      this.start = new Position(
        startLineOrPos,
        (startCharOrPos as number) ?? 0
      );
      this.end = new Position(endLine ?? startLineOrPos, endChar ?? 0);
    } else {
      this.start = startLineOrPos;
      this.end = (startCharOrPos as Position) ?? startLineOrPos;
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;

  constructor(anchor: Position, active: Position);
  constructor(
    anchorLine: number,
    anchorCharacter: number,
    activeLine: number,
    activeCharacter: number
  );
  constructor(
    anchorLineOrPos: number | Position,
    anchorCharOrPos?: number | Position,
    activeLine?: number,
    activeChar?: number
  ) {
    if (typeof anchorLineOrPos === "number") {
      const anchor = new Position(
        anchorLineOrPos,
        (anchorCharOrPos as number) ?? 0
      );
      const active = new Position(
        activeLine ?? anchorLineOrPos,
        activeChar ?? 0
      );
      super(anchor, active);
      this.anchor = anchor;
      this.active = active;
    } else {
      const anchor = anchorLineOrPos;
      const active = (anchorCharOrPos as Position) ?? anchorLineOrPos;
      super(anchor, active);
      this.anchor = anchor;
      this.active = active;
    }
  }
}

export class TextEdit {
  range: Range;
  newText: string;

  constructor(range: Range, newText: string) {
    this.range = range;
    this.newText = newText;
  }

  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }

  static insert(position: Position, newText: string): TextEdit {
    return new TextEdit(new Range(position, position), newText);
  }

  static delete(range: Range): TextEdit {
    return new TextEdit(range, "");
  }
}

export class WorkspaceEdit {
  private edits: Map<string, TextEdit[]> = new Map();

  replace(uri: Uri, range: Range, newText: string): void {
    const list = this.edits.get(uri.toString()) ?? [];
    list.push(TextEdit.replace(range, newText));
    this.edits.set(uri.toString(), list);
  }

  insert(uri: Uri, position: Position, newText: string): void {
    const list = this.edits.get(uri.toString()) ?? [];
    list.push(TextEdit.insert(position, newText));
    this.edits.set(uri.toString(), list);
  }

  get(uri: Uri): TextEdit[] {
    return this.edits.get(uri.toString()) ?? [];
  }

  has(uri: Uri): boolean {
    return this.edits.has(uri.toString());
  }

  entries(): [Uri, TextEdit[]][] {
    return Array.from(this.edits.entries()).map(([u, edits]) => [
      Uri.parse(u),
      edits,
    ]);
  }
}

export class CompletionItem {
  label: string;
  kind?: number;
  tags?: number[];
  detail?: string;
  documentation?: string | unknown;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  insertText?: string | unknown;
  range?: Range | { inserting: Range; replacing: Range };
  commitCharacters?: string[];
  keepWhitespace?: boolean;
  command?: unknown;
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];

  constructor(label: string, kind?: number) {
    this.label = label;
    this.kind = kind;
  }
}

export const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
} as const;
export type CompletionItemKind =
  (typeof CompletionItemKind)[keyof typeof CompletionItemKind];

export class Location {
  uri: Uri;
  range: Range;

  constructor(uri: Uri, rangeOrPosition: Range | Position) {
    this.uri = uri;
    this.range =
      rangeOrPosition instanceof Range
        ? rangeOrPosition
        : new Range(rangeOrPosition, rangeOrPosition);
  }
}

export class SnippetString {
  value: string;

  constructor(value = "") {
    this.value = value;
  }

  appendText(string: string): SnippetString {
    this.value += string;
    return this;
  }

  appendTabstop(number = 0): SnippetString {
    this.value += `$${number}`;
    return this;
  }

  appendPlaceholder(
    value: string | ((snippet: SnippetString) => void),
    number = 0
  ): SnippetString {
    this.value += `\${${number}:${value}}`;
    return this;
  }
}

export class MarkdownString {
  value: string;
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;

  constructor(value = "", supportThemeIcons = false) {
    this.value = value;
    this.supportThemeIcons = supportThemeIcons;
  }

  appendText(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendCodeblock(value: string, language = ""): MarkdownString {
    this.value += `\n\`\`\`${language}\n${value}\n\`\`\`\n`;
    return this;
  }
}

export class Hover {
  contents: unknown[];
  range?: Range;

  constructor(contents: unknown | unknown[], range?: Range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
}

export class DocumentSymbol {
  name: string;
  detail: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children: DocumentSymbol[] = [];

  constructor(
    name: string,
    detail: string,
    kind: number,
    range: Range,
    selectionRange: Range
  ) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
  }
}

export const SymbolKind = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
  Constant: 13,
  String: 14,
  Number: 15,
  Boolean: 16,
  Array: 17,
  Object: 18,
  Key: 19,
  Null: 20,
  EnumMember: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;
export type SymbolKind = (typeof SymbolKind)[keyof typeof SymbolKind];

export const SymbolTag = {
  Deprecated: 1,
} as const;
export type SymbolTag = (typeof SymbolTag)[keyof typeof SymbolTag];

export class CallHierarchyItem {
  name: string;
  kind: SymbolKind;
  detail?: string;
  uri: Uri;
  range: Range;
  selectionRange: Range;

  constructor(
    kind: SymbolKind,
    name: string,
    detail: string,
    uri: Uri,
    range: Range,
    selectionRange: Range
  ) {
    this.kind = kind;
    this.name = name;
    this.detail = detail;
    this.uri = uri;
    this.range = range;
    this.selectionRange = selectionRange;
  }
}

export class TypeHierarchyItem {
  name: string;
  kind: SymbolKind;
  detail?: string;
  uri: Uri;
  range: Range;
  selectionRange: Range;

  constructor(
    kind: SymbolKind,
    name: string,
    detail: string,
    uri: Uri,
    range: Range,
    selectionRange: Range
  ) {
    this.kind = kind;
    this.name = name;
    this.detail = detail;
    this.uri = uri;
    this.range = range;
    this.selectionRange = selectionRange;
  }
}

export class InlayHint {
  position: Position;
  label: string;
  kind?: number;

  constructor(position: Position, label: string, kind?: number) {
    this.position = position;
    this.label = label;
    this.kind = kind;
  }
}

export const InlayHintKind = {
  Type: 1,
  Parameter: 2,
} as const;
export type InlayHintKind = (typeof InlayHintKind)[keyof typeof InlayHintKind];

export class SemanticTokens {
  data: Uint32Array;
  resultId?: string;

  constructor(data: Uint32Array, resultId?: string) {
    this.data = data;
    this.resultId = resultId;
  }
}

export class FoldingRange {
  start: number;
  end: number;
  kind?: number;

  constructor(start: number, end: number, kind?: number) {
    this.start = start;
    this.end = end;
    this.kind = kind;
  }
}

export class CodeLens {
  range: Range;
  command?: unknown;
  isResolved: boolean;

  constructor(range: Range, command?: unknown) {
    this.range = range;
    this.command = command;
    this.isResolved = command !== undefined;
  }
}

export class DocumentLink {
  range: Range;
  target?: Uri;
  tooltip?: string;

  constructor(range: Range, target?: Uri) {
    this.range = range;
    this.target = target;
  }
}

export class SymbolInformation {
  name: string;
  kind: SymbolKind;
  containerName: string;
  location: Location;

  constructor(
    name: string,
    kind: SymbolKind,
    containerName: string,
    location: Location
  ) {
    this.name = name;
    this.kind = kind;
    this.containerName = containerName;
    this.location = location;
  }
}

export class CancellationError extends Error {
  constructor() {
    super("Canceled");
    this.name = "CancellationError";
  }
}

export class RelativePattern {
  base: string;
  pattern: string;

  constructor(base: string | { fsPath: string }, pattern: string) {
    this.base = typeof base === "string" ? base : base.fsPath;
    this.pattern = pattern;
  }
}

export const FileChangeType = {
  Changed: 1,
  Created: 2,
  Deleted: 3,
} as const;
export type FileChangeType =
  (typeof FileChangeType)[keyof typeof FileChangeType];

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;
export type ConfigurationTarget =
  (typeof ConfigurationTarget)[keyof typeof ConfigurationTarget];

export class SelectionRange {
  range: Range;
  parent?: SelectionRange;

  constructor(range: Range, parent?: SelectionRange) {
    this.range = range;
    this.parent = parent;
  }
}

export const CodeActionKind = {
  Empty: "",
  QuickFix: "quickfix",
  Refactor: "refactor",
  RefactorExtract: "refactor.extract",
  RefactorInline: "refactor.inline",
  RefactorRewrite: "refactor.rewrite",
  Source: "source",
  SourceOrganizeImports: "source.organizeImports",
} as const;
export type CodeActionKind =
  (typeof CodeActionKind)[keyof typeof CodeActionKind];

export class CodeAction {
  title: string;
  kind?: CodeActionKind;
  edit?: WorkspaceEdit;
  command?: unknown;
  isPreferred?: boolean;

  constructor(title: string, kind?: CodeActionKind) {
    this.title = title;
    this.kind = kind;
  }
}

export class ThemeIcon {
  id: string;
  color?: unknown;

  constructor(id: string, color?: unknown) {
    this.id = id;
    this.color = color;
  }
}

export class ThemeColor {
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;
export type TreeItemCollapsibleState =
  (typeof TreeItemCollapsibleState)[keyof typeof TreeItemCollapsibleState];

export class TreeItem {
  label?: string;
  collapsibleState?: TreeItemCollapsibleState;
  iconPath?: unknown;
  command?: unknown;
  contextValue?: string;

  constructor(label: string, collapsibleState = TreeItemCollapsibleState.None) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9,
} as const;
export type ViewColumn = (typeof ViewColumn)[keyof typeof ViewColumn];

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;
export type StatusBarAlignment =
  (typeof StatusBarAlignment)[keyof typeof StatusBarAlignment];

export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
} as const;
export type ProgressLocation =
  (typeof ProgressLocation)[keyof typeof ProgressLocation];

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;
export type DiagnosticSeverity =
  (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

export class Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;

  constructor(
    range: Range,
    message: string,
    severity: DiagnosticSeverity = DiagnosticSeverity.Error
  ) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

export class CancellationTokenSource {
  token = {
    isCancellationRequested: false,
    onCancellationRequested: new EventEmitter<unknown>().event,
  };

  cancel(): void {
    this.token.isCancellationRequested = true;
  }

  dispose(): void {}
}

export class MockOutputChannel {
  name: string;
  lines: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  append(value: string): void {
    this.lines.push(value);
  }

  appendLine(value: string): void {
    this.lines.push(value);
  }

  replace(value: string): void {
    this.lines = [value];
  }

  clear(): void {
    this.lines = [];
  }

  logLevel = 1;
  onDidChangeLogLevel = new EventEmitter<number>().event;

  trace(value: string): void {
    this.lines.push(`[TRACE] ${value}`);
  }

  debug(value: string): void {
    this.lines.push(`[DEBUG] ${value}`);
  }

  info(value: string): void {
    this.lines.push(`[INFO] ${value}`);
  }

  warn(value: string): void {
    this.lines.push(`[WARN] ${value}`);
  }

  error(value: string | Error): void {
    this.lines.push(`[ERROR] ${value}`);
  }

  show(): void {}
  hide(): void {}
  dispose(): void {}
}

export class MockWorkspaceConfiguration {
  private config: Map<string, unknown>;

  constructor(initialConfig: Record<string, unknown> = {}) {
    this.config = new Map(Object.entries(initialConfig));
  }

  get<T>(section: string, defaultValue?: T): T {
    if (this.config.has(section)) {
      return this.config.get(section) as T;
    }
    return defaultValue as T;
  }

  has(section: string): boolean {
    return this.config.has(section);
  }

  async update(
    section: string,
    value: unknown,
    _target?: unknown
  ): Promise<void> {
    if (value === undefined) {
      this.config.delete(section);
    } else {
      this.config.set(section, value);
    }
  }

  inspect(_section: string): unknown {
    return undefined;
  }
}

export class MockMemento {
  private storage = new Map<string, unknown>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.storage.has(key) ? (this.storage.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.storage.delete(key);
    } else {
      this.storage.set(key, value);
    }
  }

  keys(): readonly string[] {
    return Array.from(this.storage.keys());
  }
}

export class MockExtensionContext {
  subscriptions: Disposable[] = [];
  extensionPath = "/mock/extension/path";
  storagePath: string | undefined = "/mock/storage/path";
  globalStoragePath = "/mock/global/storage/path";
  logPath = "/mock/log/path";
  extensionUri = Uri.file("/mock/extension/path");
  globalStorageUri = Uri.file("/mock/global/storage/path");
  logUri = Uri.file("/mock/log/path");
  workspaceState = new MockMemento();
  globalState = new MockMemento();

  asAbsolutePath(relativePath: string): string {
    return `${this.extensionPath}/${relativePath}`;
  }
}

export class MockTerminal {
  name: string;
  pty:
    | {
        open?: () => void;
        close?: () => void;
        handleInput?: (data: string) => void;
      }
    | undefined;
  showCount = 0;
  disposed = false;

  constructor(options: {
    name: string;
    pty?: {
      open?: () => void;
      close?: () => void;
      handleInput?: (data: string) => void;
    };
  }) {
    this.name = options.name;
    this.pty = options.pty;
    if (this.pty?.open) {
      this.pty.open();
    }
  }

  show(): void {
    this.showCount++;
  }

  hide(): void {}

  sendText(text: string): void {
    if (this.pty?.handleInput) {
      this.pty.handleInput(text);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.pty?.close) {
      this.pty.close();
    }
  }
}

export const registeredCommands = new Map<
  string,
  (...args: unknown[]) => unknown
>();
export const mockContextStore = new Map<string, unknown>();

export const commands = {
  registerCommand(
    command: string,
    callback: (...args: unknown[]) => unknown
  ): Disposable {
    if (registeredCommands.has(command)) {
      throw new Error(`command '${command}' already exists`);
    }
    registeredCommands.set(command, callback);
    return new Disposable(() => {
      registeredCommands.delete(command);
    });
  },
  async executeCommand<T>(command: string, ...rest: unknown[]): Promise<T> {
    if (command === "setContext") {
      const [key, val] = rest;
      mockContextStore.set(key as string, val);
      return undefined as unknown as T;
    }
    const handler = registeredCommands.get(command);
    if (handler) {
      return (await handler(...rest)) as T;
    }
    return undefined as unknown as T;
  },
  async getCommands(_filterInternal?: boolean): Promise<string[]> {
    return Array.from(registeredCommands.keys());
  },
};

export const window = {
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [] as unknown[],
  outputChannels: new Map<string, MockOutputChannel>(),

  onDidChangeActiveTextEditor: new EventEmitter<unknown>().event,

  createOutputChannel(name: string, _options?: unknown): MockOutputChannel {
    const channel = new MockOutputChannel(name);
    window.outputChannels.set(name, channel);
    return channel;
  },

  async showInformationMessage(
    _message: string,
    ..._items: unknown[]
  ): Promise<unknown> {
    return undefined;
  },

  async showWarningMessage(
    _message: string,
    ..._items: unknown[]
  ): Promise<unknown> {
    return undefined;
  },

  async showErrorMessage(
    _message: string,
    ..._items: unknown[]
  ): Promise<unknown> {
    return undefined;
  },

  async showQuickPick(
    items: unknown[] | Promise<unknown[]>,
    _options?: unknown
  ): Promise<unknown> {
    const resolved = await items;
    return resolved && resolved.length > 0 ? resolved[0] : undefined;
  },

  async showInputBox(_options?: unknown): Promise<string | undefined> {
    return undefined;
  },

  async withProgress<T>(
    _options: unknown,
    task: (progress: unknown, token: unknown) => Promise<T>
  ): Promise<T> {
    const progress = {
      report: (_value: unknown) => {},
    };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: new EventEmitter<unknown>().event,
    };
    return task(progress, token);
  },

  createTerminal(options: {
    name: string;
    pty?: {
      open?: () => void;
      close?: () => void;
      handleInput?: (data: string) => void;
    };
  }): MockTerminal {
    return new MockTerminal(options);
  },

  createStatusBarItem(_alignment?: unknown, _priority?: number): unknown {
    return {
      text: "",
      tooltip: "",
      show: () => {},
      hide: () => {},
      dispose: () => {},
    };
  },

  registerTreeDataProvider(_viewId: string, _provider: unknown): Disposable {
    return new Disposable();
  },

  createWebviewPanel(
    _viewType: string,
    _title: string,
    _showOptions: unknown,
    _options?: unknown
  ): unknown {
    const onDidDisposeEmitter = new EventEmitter<void>();
    const onDidReceiveMessageEmitter = new EventEmitter<unknown>();
    return {
      title: _title,
      viewType: _viewType,
      webview: {
        html: "",
        postMessage: async (_message: unknown) => true,
        onDidReceiveMessage: onDidReceiveMessageEmitter.event,
      },
      onDidDispose: onDidDisposeEmitter.event,
      reveal: () => {},
      dispose: () => {
        onDidDisposeEmitter.fire();
      },
    };
  },
};

export const workspaceConfigValues: Record<string, unknown> = {};

export const workspace = {
  workspaceFolders: undefined as unknown[] | undefined,
  onDidChangeConfigurationEmitter: new EventEmitter<unknown>(),
  get onDidChangeConfiguration() {
    return this.onDidChangeConfigurationEmitter.event;
  },
  onDidOpenTextDocumentEmitter: new EventEmitter<unknown>(),
  get onDidOpenTextDocument() {
    return this.onDidOpenTextDocumentEmitter.event;
  },

  getConfiguration(section?: string): MockWorkspaceConfiguration {
    const filteredConfig: Record<string, unknown> = {};
    if (section) {
      const prefix = `${section}.`;
      for (const [k, v] of Object.entries(workspaceConfigValues)) {
        if (k.startsWith(prefix)) {
          filteredConfig[k.slice(prefix.length)] = v;
        } else if (k === section) {
          filteredConfig[""] = v;
        }
      }
    } else {
      Object.assign(filteredConfig, workspaceConfigValues);
    }
    return new MockWorkspaceConfiguration(filteredConfig);
  },

  async openTextDocument(_pathOrUri: unknown): Promise<unknown> {
    const docPath =
      typeof _pathOrUri === "string"
        ? _pathOrUri
        : ((_pathOrUri as Uri)?.fsPath ?? "");
    return {
      fileName: docPath,
      uri: typeof _pathOrUri === "string" ? Uri.file(_pathOrUri) : _pathOrUri,
      getText: () => "",
      positionAt: (offset: number) => new Position(0, offset),
    };
  },

  async applyEdit(_edit: WorkspaceEdit): Promise<boolean> {
    return true;
  },

  async findFiles(
    _include: unknown,
    _exclude?: unknown,
    _maxResults?: number
  ): Promise<Uri[]> {
    return [];
  },

  createFileSystemWatcher(): unknown {
    return {
      onDidChange: new EventEmitter<unknown>().event,
      onDidCreate: new EventEmitter<unknown>().event,
      onDidDelete: new EventEmitter<unknown>().event,
      dispose: () => {},
    };
  },
};

export const debug = {
  async startDebugging(
    _folder: unknown,
    _nameOrConfiguration: unknown
  ): Promise<boolean> {
    return true;
  },
  registerDebugConfigurationProvider(
    _debugType: string,
    _provider: unknown
  ): Disposable {
    return new Disposable();
  },
};

export const languages = {
  createDiagnosticCollection(_name?: string): unknown {
    return {
      set: () => {},
      delete: () => {},
      clear: () => {},
      dispose: () => {},
    };
  },
  setTextDocumentLanguage(_doc: unknown, _languageId: string): unknown {
    return _doc;
  },
  registerDocumentFormattingEditProvider(
    _selector: unknown,
    _provider: unknown
  ): Disposable {
    return new Disposable();
  },
  registerCodeActionsProvider(
    _selector: unknown,
    _provider: unknown
  ): Disposable {
    return new Disposable();
  },
};

export const lm = {
  registerTool(_name: string, _tool: unknown): Disposable {
    return new Disposable();
  },
  selectChatModels: async () => [],
};

export const chat = {
  createChatParticipant: (_id: string, _handler: unknown) => ({
    iconPath: undefined,
    dispose: () => {},
  }),
};

export const extensions = {
  getExtension(_id: string): unknown {
    let active = false;
    return {
      id: _id,
      get isActive() {
        return active;
      },
      activate: async () => {
        if (!active) {
          active = true;
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const extensionModule = require("../../extension");
            if (typeof extensionModule.activate === "function") {
              const context = new MockExtensionContext();
              await extensionModule.activate(context);
            }
          } catch {
            // Ignore if extension module cannot be loaded
          }
        }
      },
      exports: {},
    };
  },
};

export const mockVscode = {
  Uri,
  Disposable,
  EventEmitter,
  Position,
  Range,
  Selection,
  TextEdit,
  WorkspaceEdit,
  CompletionItem,
  CompletionItemKind,
  CodeLens,
  DocumentLink,
  SymbolInformation,
  Location,
  SnippetString,
  MarkdownString,
  Hover,
  DocumentSymbol,
  SymbolKind,
  SymbolTag,
  CallHierarchyItem,
  TypeHierarchyItem,
  InlayHint,
  InlayHintKind,
  SemanticTokens,
  FoldingRange,
  SelectionRange,
  CancellationError,
  RelativePattern,
  FileChangeType,
  ConfigurationTarget,
  CodeActionKind,
  CodeAction,
  ThemeIcon,
  ThemeColor,
  TreeItemCollapsibleState,
  TreeItem,
  ViewColumn,
  StatusBarAlignment,
  ProgressLocation,
  DiagnosticSeverity,
  Diagnostic,
  CancellationTokenSource,
  commands,
  window,
  workspace,
  debug,
  languages,
  lm,
  chat,
  extensions,
};

export function setupVscodeMock(): void {
  if (
    typeof process !== "undefined" &&
    process.versions &&
    (process.versions as unknown as Record<string, string>).bun
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bunTest = require("bun:test");
      bunTest.mock.module("vscode", () => mockVscode);
    } catch {
      // Ignore if bun:test is not available
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const realVscode = require("vscode");
    if (
      realVscode?.commands &&
      realVscode.commands.registerCommand !==
        mockVscode.commands.registerCommand
    ) {
      const origRegisterCommand = realVscode.commands.registerCommand;
      realVscode.commands.registerCommand = (
        command: string,
        callback: (...args: unknown[]) => unknown,
        ...rest: unknown[]
      ) => {
        registeredCommands.set(command, callback);
        const disp = origRegisterCommand.call(
          realVscode.commands,
          command,
          callback,
          ...rest
        );
        return new Disposable(() => {
          registeredCommands.delete(command);
          if (disp && typeof disp.dispose === "function") {
            disp.dispose();
          }
        });
      };

      const origExecuteCommand = realVscode.commands.executeCommand;
      realVscode.commands.executeCommand = async (
        command: string,
        ...rest: unknown[]
      ) => {
        if (command === "setContext") {
          const [key, val] = rest;
          mockContextStore.set(key as string, val);
        }
        return origExecuteCommand.call(realVscode.commands, command, ...rest);
      };
    }
  } catch {
    // Ignore if real vscode module cannot be loaded
  }
}

setupVscodeMock();
