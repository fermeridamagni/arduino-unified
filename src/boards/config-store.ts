import type * as vscode from "vscode";

/**
 * Persisted board configuration (programmer, config options per FQBN).
 */
interface BoardConfig {
  /** Board-specific config options (e.g., cpu speed, flash size) */
  configOptions: Record<string, string>;
  /** Last used port address */
  lastPort?: string;
  /** Selected programmer for this board */
  programmer?: string;
}

/**
 * Storage key for the board config store.
 */
const STORAGE_KEY = "arduinoUnified.boardConfigs";

/**
 * BoardConfigStore persists per-board configuration in VSCode globalState.
 * This includes selected programmer, board-specific config options
 * (like CPU speed, flash size), and last used port.
 */
export class BoardConfigStore {
  private readonly globalState: vscode.Memento;
  private configs: Map<string, BoardConfig>;

  constructor(globalState: vscode.Memento) {
    this.globalState = globalState;
    this.configs = new Map(
      Object.entries(
        globalState.get<Record<string, BoardConfig>>(STORAGE_KEY, {})
      )
    );
  }

  /**
   * Gets the configuration for a board by FQBN.
   */
  getConfig(fqbn: string): BoardConfig {
    return this.configs.get(fqbn) ?? { configOptions: {} };
  }

  /**
   * Sets the programmer for a board.
   */
  async setProgrammer(fqbn: string, programmer: string): Promise<void> {
    const config = this.getConfig(fqbn);
    config.programmer = programmer;
    await this.save(fqbn, config);
  }

  /**
   * Gets the selected programmer for a board.
   */
  getProgrammer(fqbn: string): string | undefined {
    return this.getConfig(fqbn).programmer;
  }

  /**
   * Sets a board config option (e.g., `cpu=atmega328p`).
   */
  async setConfigOption(
    fqbn: string,
    optionId: string,
    value: string
  ): Promise<void> {
    const config = this.getConfig(fqbn);
    config.configOptions[optionId] = value;
    await this.save(fqbn, config);
  }

  /**
   * Gets all config options for a board.
   */
  getConfigOptions(fqbn: string): Record<string, string> {
    return { ...this.getConfig(fqbn).configOptions };
  }

  /**
   * Returns the FQBN with config options appended.
   * e.g., `arduino:avr:mega:cpu=atmega2560`
   */
  getFqbnWithOptions(fqbn: string): string {
    const options = this.getConfigOptions(fqbn);
    const entries = Object.entries(options);
    if (entries.length === 0) {
      return fqbn;
    }
    const optionString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    return `${fqbn}:${optionString}`;
  }

  /**
   * Sets the last used port for a board.
   */
  async setLastPort(fqbn: string, portAddress: string): Promise<void> {
    const config = this.getConfig(fqbn);
    config.lastPort = portAddress;
    await this.save(fqbn, config);
  }

  /**
   * Gets the last used port for a board.
   */
  getLastPort(fqbn: string): string | undefined {
    return this.getConfig(fqbn).lastPort;
  }

  /**
   * Clears configuration for a specific board.
   */
  async clearConfig(fqbn: string): Promise<void> {
    this.configs.delete(fqbn);
    await this.persist();
  }

  /**
   * Clears all stored board configurations.
   */
  async clearAll(): Promise<void> {
    this.configs.clear();
    await this.persist();
  }

  /**
   * Returns all stored FQBNs.
   */
  getStoredFqbns(): string[] {
    return [...this.configs.keys()];
  }

  /**
   * Saves a board config and persists to globalState.
   */
  private async save(fqbn: string, config: BoardConfig): Promise<void> {
    this.configs.set(fqbn, config);
    await this.persist();
  }

  /**
   * Persists the entire config map to globalState.
   */
  private async persist(): Promise<void> {
    const obj = Object.fromEntries(this.configs);
    await this.globalState.update(STORAGE_KEY, obj);
  }
}
