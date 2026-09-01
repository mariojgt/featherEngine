import { describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { FeatherEventBus } from '../events';
import { activateExtensionPlugin } from '../host';
import { ExtensionRegistry } from '../registry';
import type { FeatherPluginAPI } from '../types';

describe('ExtensionRegistry', () => {
  it('publishes stable snapshots and removes disposed contributions', () => {
    const registry = new ExtensionRegistry();
    const initial = registry.getSnapshot();
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => {
      notifications += 1;
    });

    const dispose = registry.registerCommand('test.tools', {
      id: 'test.tools.hello',
      title: 'Hello',
      run: () => undefined,
    });

    expect(registry.getSnapshot()).not.toBe(initial);
    expect(registry.getSnapshot()).toBe(registry.getSnapshot());
    expect(registry.getSnapshot().commands).toHaveLength(1);
    expect(notifications).toBe(1);

    dispose();
    dispose();
    expect(registry.getSnapshot().commands).toHaveLength(0);
    expect(notifications).toBe(2);
    unsubscribe();
  });

  it('rejects duplicate contribution ids', () => {
    const registry = new ExtensionRegistry();
    registry.registerPanel('test.one', { id: 'test.shared.panel', title: 'One', render: () => null });
    expect(() =>
      registry.registerPanel('test.two', { id: 'test.shared.panel', title: 'Two', render: () => null }),
    ).toThrow(/already registered/);
  });
});

describe('Feather extension lifecycle', () => {
  it('cleans commands, panels, event handlers, and plugin cleanup on deactivate', () => {
    const registry = new ExtensionRegistry();
    const eventBus = new FeatherEventBus();
    let eventCount = 0;
    let cleanupCount = 0;

    const deactivate = activateExtensionPlugin(
      {
        id: 'test.lifecycle',
        name: 'Lifecycle Test',
        version: '1.0.0',
        apiVersion: '0.2.0',
        activate(api) {
          api.commands.register({ id: 'test.lifecycle.command', title: 'Test', run: () => undefined });
          api.panels.register({ id: 'test.lifecycle.panel', title: 'Test', render: () => null });
          api.tools.register({
            id: 'sculpt',
            title: 'Sculpt',
            description: 'Sculpt a part.',
            inputSchema: { type: 'object' },
            execute: () => 'sculpted',
          });
          api.events.on('selection:changed', () => {
            eventCount += 1;
          });
          return () => {
            cleanupCount += 1;
          };
        },
      },
      { registry, eventBus },
    );

    expect(registry.getSnapshot().plugins).toHaveLength(1);
    expect(registry.getSnapshot().commands).toHaveLength(1);
    expect(registry.getSnapshot().panels).toHaveLength(1);
    expect(registry.getSnapshot().tools).toHaveLength(1);
    expect(registry.getSnapshot().tools[0].qualifiedId).toBe('test.lifecycle.sculpt');
    eventBus.emit('selection:changed', { objectId: 'before' });
    expect(eventCount).toBe(1);

    deactivate();
    deactivate();
    eventBus.emit('selection:changed', { objectId: 'after' });
    expect(cleanupCount).toBe(1);
    expect(eventCount).toBe(1);
    expect(registry.getSnapshot().plugins).toHaveLength(0);
    expect(registry.getSnapshot().commands).toHaveLength(0);
    expect(registry.getSnapshot().panels).toHaveLength(0);
    expect(registry.getSnapshot().tools).toHaveLength(0);
  });

  it('rolls back registrations when activation throws', () => {
    const registry = new ExtensionRegistry();
    const eventBus = new FeatherEventBus();

    expect(() =>
      activateExtensionPlugin(
        {
          id: 'test.broken',
          name: 'Broken Test',
          version: '1.0.0',
          activate(api) {
            api.commands.register({ id: 'test.broken.command', title: 'Broken', run: () => undefined });
            throw new Error('activation exploded');
          },
        },
        { registry, eventBus },
      ),
    ).toThrow('activation exploded');

    expect(registry.getSnapshot().commands).toHaveLength(0);
    expect(registry.getSnapshot().plugins).toHaveLength(0);
  });

  it('enforces plugin-owned namespaces', () => {
    const registry = new ExtensionRegistry();
    const eventBus = new FeatherEventBus();
    expect(() =>
      activateExtensionPlugin(
        {
          id: 'test.namespaced',
          name: 'Namespace Test',
          version: '1.0.0',
          activate(api) {
            api.commands.register({ id: 'someone.else.command', title: 'Wrong owner', run: () => undefined });
          },
        },
        { registry, eventBus },
      ),
    ).toThrow(/must start with the plugin namespace/);
  });

  it('requires bare tool-names and validates tool definitions', () => {
    const registry = new ExtensionRegistry();
    const eventBus = new FeatherEventBus();
    const register = (registerTool: (api: FeatherPluginAPI) => void) =>
      activateExtensionPlugin(
        {
          id: 'test.tools2',
          name: 'Tool Validation',
          version: '1.0.0',
          activate: (api) => registerTool(api),
        },
        { registry, eventBus },
      );

    expect(() =>
      register((api) =>
        api.tools.register({
          id: 'with.dot',
          title: 'Nope',
          description: 'dots are forbidden — the engine namespaces',
          inputSchema: {},
          execute: () => 'x',
        }),
      ),
    ).toThrow(/bare tool-name/);

    expect(() =>
      register((api) =>
        api.tools.register({ id: 'noexecute', title: 'Nope', description: 'missing execute', inputSchema: {} } as never),
      ),
    ).toThrow(/description and an execute/);

    const namespaced: FeatherPluginAPI = (() => {
      let captured!: FeatherPluginAPI;
      register((api) => {
        captured = api;
      });
      return captured;
    })();
    const dispose = namespaced.tools.register({
      id: 'scrape',
      title: 'Scrape',
      description: 'Scrape a surface.',
      inputSchema: { type: 'object' },
      execute: () => 'scraped',
    });
    expect(registry.getSnapshot().tools[0].qualifiedId).toBe('test.tools2.scrape');
    dispose();
    expect(registry.getSnapshot().tools).toHaveLength(0);
  });

  it('exposes detached reads and explicit object mutations', () => {
    const registry = new ExtensionRegistry();
    const eventBus = new FeatherEventBus();
    let capturedApi: FeatherPluginAPI | undefined;
    const previousProject = useProjectStore.getState();
    const previousSelection = useEditorStore.getState().selectedObjectId;
    useProjectStore.setState({ hasProject: true, projectName: 'Plugin Test Project' });
    useEditorStore.setState({ isPlaying: false });

    const deactivate = activateExtensionPlugin(
      {
        id: 'test.objects',
        name: 'Object API Test',
        version: '1.0.0',
        activate(api) {
          capturedApi = api;
        },
      },
      { registry, eventBus },
    );

    try {
      const api = capturedApi as FeatherPluginAPI;
      expect(() => api.objects.create({ kind: 'dragon' } as never)).toThrow(/Unsupported scene object kind/);
      const id = api.project.transaction('Create test cube', () =>
        api.objects.create({ kind: 'cube', name: 'SDK Cube', scale: [2, 3, 4] }),
      );
      expect(api.objects.get(id)?.transform.scale).toEqual([2, 3, 4]);
      expect(api.project.read().name).toBe('Plugin Test Project');

      const detached = api.objects.get(id) as { name: string };
      detached.name = 'Changed only in snapshot';
      expect(api.objects.get(id)?.name).toBe('SDK Cube');
      expect(api.objects.remove(id)).toBe(true);
      expect(api.objects.get(id)).toBeUndefined();
    } finally {
      deactivate();
      useEditorStore.getState().selectObject(previousSelection);
      useProjectStore.setState({
        hasProject: previousProject.hasProject,
        projectName: previousProject.projectName,
      });
    }
  });
});

describe('FeatherEventBus', () => {
  it('coalesces repeated event types inside a batch', () => {
    const eventBus = new FeatherEventBus();
    const received: string[] = [];
    eventBus.on('selection:changed', ({ objectId }) => received.push(objectId));

    eventBus.batch(() => {
      eventBus.emit('selection:changed', { objectId: 'first' });
      eventBus.emit('selection:changed', { objectId: 'last' });
    });

    expect(received).toEqual(['last']);
  });

  it('isolates a failing plugin listener from other plugins and the editor', () => {
    const eventBus = new FeatherEventBus();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let healthyListenerCalls = 0;
    eventBus.on('project:changed', () => {
      throw new Error('plugin listener crashed');
    });
    eventBus.on('project:changed', () => {
      healthyListenerCalls += 1;
    });

    expect(() => eventBus.emit('project:changed', { hasProject: true, name: 'Test' })).not.toThrow();
    expect(healthyListenerCalls).toBe(1);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
