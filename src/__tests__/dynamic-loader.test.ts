import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import { DynamicLoaderManager, type DynamicLoadOptions, type DynamicLoadResult } from '../managers/dynamic-loader-manager';
import { ComponentType } from '../managers/component-creation-manager';
import type { Action, Provider, Plugin } from '@elizaos/core';

// Mock runtime for testing
const mockRuntime: any = {
  getSetting: () => 'mock-setting',
  agentId: 'test-agent',
  composeState: async () => ({}),
};

describe('DynamicLoaderManager', () => {
  let loader: DynamicLoaderManager;
  const tempDir = path.join(__dirname, 'temp-loader-tests');

  beforeAll(async () => {
    await fs.ensureDir(tempDir);
  });

  afterAll(async () => {
    await fs.remove(tempDir);
  });

  beforeEach(() => {
    loader = new DynamicLoaderManager();
  });

  it('should load an action component', async () => {
    const actionPath = path.join(tempDir, 'test-action.ts');
    await fs.writeFile(actionPath, `
      import type { Action } from '@elizaos/core';
      export const myAction: Action = { name: 'test-action', description: 'A test action', handler: async () => {} };
      export default myAction;
    `);

    const result = await loader.loadComponent({ filePath: actionPath, componentType: ComponentType.ACTION } as any);
    
    expect(result.success).toBe(true);
    expect(result.exports).toBeDefined();
    const component = result.exports.default || result.exports.myAction;
    expect(component).toBeDefined();
    expect(component.name).toBe('test-action');
    expect(typeof component.handler).toBe('function');
  });

  it('should load a provider component', async () => {
    const providerPath = path.join(tempDir, 'test-provider.ts');
    await fs.writeFile(providerPath, `
      import type { Provider } from '@elizaos/core';
      export const testProvider: Provider = { name: 'test-provider', description: 'A test provider', get: async () => ({ text: 'data' }) };
    `);
    
    const result = await loader.loadComponent({ filePath: providerPath, componentType: ComponentType.PROVIDER } as any);
    
    expect(result.success).toBe(true);
    expect(result.exports).toBeDefined();
    const component = result.exports.testProvider;
    expect(component).toBeDefined();
    expect(component.name).toBe('test-provider');
    expect(typeof component.get).toBe('function');
  });
  
  it('should load a plugin component', async () => {
    const pluginPath = path.join(tempDir, 'test-plugin.ts');
    await fs.writeFile(pluginPath, `
      import type { Plugin, Action } from '@elizaos/core';
      const sampleAction: Action = { name: 'sample', handler: async () => {} };
      export const testPlugin: Plugin = { name: 'test-plugin', description: 'A test plugin', actions: [sampleAction] };
    `);

    const result = await loader.loadComponent({ filePath: pluginPath, componentType: ComponentType.PLUGIN } as any);
    
    expect(result.success).toBe(true);
    expect(result.exports).toBeDefined();
    const component = result.exports.testPlugin;
    expect(component).toBeDefined();
    expect(component.name).toBe('test-plugin');
    expect(component.actions).toHaveLength(1);
  });

  it('should return an error for a non-existent file', async () => {
    const nonExistentPath = path.join(tempDir, 'non-existent.ts');
    const result = await loader.loadComponent({ filePath: nonExistentPath, componentType: ComponentType.ACTION } as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Component file not found');
  });
  
  // Note: The sandboxing, testing, and reloading tests are more complex
  // and would require more intricate setup. For now, focusing on the core load functionality.
});
