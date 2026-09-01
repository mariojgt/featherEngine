import type {
  FeatherCommandDefinition,
  FeatherPanelDefinition,
  FeatherPluginDefinition,
  FeatherPluginTool,
} from './types';

export interface RegisteredFeatherCommand extends FeatherCommandDefinition {
  pluginId: string;
}

export interface RegisteredFeatherPanel extends FeatherPanelDefinition {
  pluginId: string;
}

export interface RegisteredFeatherTool extends FeatherPluginTool {
  pluginId: string;
  /** Namespaced id (`pluginId.toolId`) that the AI assistant / MCP sees. */
  qualifiedId: string;
}

export interface RegisteredFeatherPlugin {
  id: string;
  name: string;
  version: string;
}

export interface ExtensionRegistrySnapshot {
  version: number;
  commands: readonly RegisteredFeatherCommand[];
  panels: readonly RegisteredFeatherPanel[];
  tools: readonly RegisteredFeatherTool[];
  plugins: readonly RegisteredFeatherPlugin[];
}

type PluginRecord = RegisteredFeatherPlugin & { deactivate: () => void };

const EMPTY_SNAPSHOT: ExtensionRegistrySnapshot = Object.freeze({
  version: 0,
  commands: Object.freeze([]),
  panels: Object.freeze([]),
  tools: Object.freeze([]),
  plugins: Object.freeze([]),
});

/** Runtime registry kept independent from React so it is usable in tests and non-UI hosts. */
export class ExtensionRegistry {
  private readonly commands = new Map<string, RegisteredFeatherCommand>();
  private readonly panels = new Map<string, RegisteredFeatherPanel>();
  private readonly tools = new Map<string, RegisteredFeatherTool>();
  private readonly plugins = new Map<string, PluginRecord>();
  private readonly listeners = new Set<() => void>();
  private snapshot: ExtensionRegistrySnapshot = EMPTY_SNAPSHOT;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ExtensionRegistrySnapshot => this.snapshot;

  getCommand(id: string): RegisteredFeatherCommand | undefined {
    return this.commands.get(id);
  }

  getPanel(id: string): RegisteredFeatherPanel | undefined {
    return this.panels.get(id);
  }

  getTool(id: string): RegisteredFeatherTool | undefined {
    return this.tools.get(id);
  }

  hasTool(id: string): boolean {
    return this.tools.has(id);
  }

  hasPlugin(id: string): boolean {
    return this.plugins.has(id);
  }

  registerCommand(pluginId: string, definition: FeatherCommandDefinition): () => void {
    if (!definition.id.trim() || !definition.title.trim() || typeof definition.run !== 'function') {
      throw new Error('Extension commands require a non-empty id, title, and run function.');
    }
    if (this.commands.has(definition.id)) throw new Error(`Extension command id already registered: ${definition.id}`);
    const record: RegisteredFeatherCommand = Object.freeze({ ...definition, pluginId });
    this.commands.set(definition.id, record);
    this.publish();
    return this.makeDisposer(this.commands, definition.id, record);
  }

  registerPanel(pluginId: string, definition: FeatherPanelDefinition): () => void {
    if (!definition.id.trim() || !definition.title.trim() || typeof definition.render !== 'function') {
      throw new Error('Extension panels require a non-empty id, title, and render function.');
    }
    if (this.panels.has(definition.id)) throw new Error(`Extension panel id already registered: ${definition.id}`);
    const record: RegisteredFeatherPanel = Object.freeze({
      ...definition,
      placement: definition.placement ? Object.freeze({ ...definition.placement }) : undefined,
      pluginId,
    });
    this.panels.set(definition.id, record);
    this.publish();
    return this.makeDisposer(this.panels, definition.id, record);
  }

  registerTool(pluginId: string, definition: FeatherPluginTool): () => void {
    if (!definition.id.trim() || definition.id.includes('.') || /\s/.test(definition.id)) {
      throw new Error('Extension tool ids must be a non-empty bare tool-name with no spaces or dots (the engine namespaces it with the plugin id).');
    }
    if (!definition.description?.trim() || typeof definition.execute !== 'function') {
      throw new Error('Extension tools require a non-empty description and an execute function.');
    }
    const qualifiedId = `${pluginId}.${definition.id}`;
    if (this.tools.has(qualifiedId)) throw new Error(`Extension tool id already registered: ${qualifiedId}`);
    const record: RegisteredFeatherTool = Object.freeze({
      ...definition,
      pluginId,
      qualifiedId,
    });
    this.tools.set(qualifiedId, record);
    this.publish();
    return this.makeDisposer(this.tools, qualifiedId, record);
  }

  registerPlugin(definition: FeatherPluginDefinition, deactivate: () => void): void {
    if (this.plugins.has(definition.id)) throw new Error(`Extension plugin id already active: ${definition.id}`);
    this.plugins.set(definition.id, {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      deactivate,
    });
    this.publish();
  }

  deactivatePlugin(id: string): boolean {
    const record = this.plugins.get(id);
    if (!record) return false;
    this.plugins.delete(id);
    try {
      record.deactivate();
    } finally {
      this.publish();
    }
    return true;
  }

  deactivateAll(): void {
    for (const id of [...this.plugins.keys()].reverse()) this.deactivatePlugin(id);
  }

  private makeDisposer<T>(map: Map<string, T>, id: string, record: T): () => void {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (map.get(id) !== record) return;
      map.delete(id);
      this.publish();
    };
  }

  private publish(): void {
    this.snapshot = Object.freeze({
      version: this.snapshot.version + 1,
      commands: Object.freeze([...this.commands.values()]),
      panels: Object.freeze([...this.panels.values()]),
      tools: Object.freeze([...this.tools.values()]),
      plugins: Object.freeze(
        [...this.plugins.values()].map(({ deactivate: _deactivate, ...plugin }) => Object.freeze(plugin)),
      ),
    });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[Feather extensions] Registry subscriber failed', error);
      }
    }
  }
}
