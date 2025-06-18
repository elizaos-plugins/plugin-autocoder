import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynamicLoaderManager } from '../managers/dynamic-loader-manager';
import { ComponentType } from '../managers/component-creation-manager';
import type { IAgentRuntime, Action, Provider, Plugin } from '@elizaos/core';
import path from 'path';
import fs from 'fs-extra';

// Mock the logger
vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  Service: class Service {
    constructor(runtime?: any) {}
    async stop() {}
  },
}));

describe.skip('DynamicLoaderManager', () => {
  let service: DynamicLoaderManager;
  let mockRuntime: IAgentRuntime;
  const testComponentsDir = path.join(__dirname, 'test-components');
  const tempDir = path.join(__dirname, 'temp-loader');

  beforeEach(async () => {
    mockRuntime = {
      agentId: 'test-agent',
      getSetting: vi.fn(),
      composeState: vi.fn().mockResolvedValue({}),
      processActions: vi.fn(),
    } as any;

    service = new DynamicLoaderManager(mockRuntime);

    // Ensure temp directory exists
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.remove(tempDir);
  });

  describe('loadComponent', () => {
    it('should load an action component from a real file', async () => {
      const actionPath = path.join(testComponentsDir, 'test-action.ts');

      const result = await service.loadComponent({
        filePath: actionPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect(result.type).toBe(ComponentType.ACTION);
      expect(result.name).toBe('test-action');
      expect(result.exports).toContain('TEST_ACTION');
      expect(result.exports).toContain('default');
      expect(result.component).toBeDefined();
      expect((result.component as Action).name).toBe('test-action');
      expect((result.component as Action).handler).toBeDefined();
    });

    it('should load a provider component from a real file', async () => {
      const providerPath = path.join(testComponentsDir, 'test-provider.ts');

      const result = await service.loadComponent({
        filePath: providerPath,
        componentType: ComponentType.PROVIDER,
        runtime: mockRuntime,
      });

      expect(result.type).toBe(ComponentType.PROVIDER);
      expect(result.name).toBe('test-provider');
      expect(result.exports).toContain('testProvider');
      expect(result.exports).toContain('default');
      expect(result.component).toBeDefined();
      expect((result.component as Provider).name).toBe('test-provider');
      expect((result.component as Provider).get).toBeDefined();
    });

    it('should load a plugin component from a real file', async () => {
      const pluginPath = path.join(testComponentsDir, 'test-plugin.ts');

      const result = await service.loadComponent({
        filePath: pluginPath,
        componentType: ComponentType.PLUGIN,
        runtime: mockRuntime,
      });

      expect(result.type).toBe(ComponentType.PLUGIN);
      expect(result.name).toBe('test-plugin');
      expect(result.exports).toContain('testPlugin');
      expect(result.exports).toContain('default');
      expect(result.component).toBeDefined();
      expect((result.component as Plugin).name).toBe('test-plugin');
      expect((result.component as Plugin).actions).toHaveLength(1);
      expect((result.component as Plugin).providers).toHaveLength(1);
    });

    it('should throw error for non-existent file', async () => {
      const nonExistentPath = path.join(testComponentsDir, 'non-existent.ts');

      await expect(
        service.loadComponent({
          filePath: nonExistentPath,
          componentType: ComponentType.ACTION,
          runtime: mockRuntime,
        })
      ).rejects.toThrow('Component file not found');
    });

    it('should handle component with no default export', async () => {
      // Create a test file with no default export
      const testFilePath = path.join(tempDir, 'no-default.ts');
      const testContent = `
export const myAction = {
  name: 'my-action',
  description: 'Test action without default export',
  handler: async () => ({ text: 'test' })
};
`;
      await fs.writeFile(testFilePath, testContent);

      const result = await service.loadComponent({
        filePath: testFilePath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect(result.exports).toContain('myAction');
      expect(result.exports).not.toContain('default');
      expect(result.component).toBeDefined();
      expect(result.component.name).toBe('my-action');
    });
  });

  describe('testComponent', () => {
    it('should test an action component', async () => {
      const actionPath = path.join(testComponentsDir, 'test-action.ts');

      // First load the component
      const loadResult = await service.loadComponent({
        filePath: actionPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      // Then test it
      const testResult = await service.testComponent({
        component: loadResult.component,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect(testResult.passed).toBe(true);
      expect(testResult.tests).toHaveLength(2);
      expect(testResult.tests[0].name).toBe('Validation');
      expect(testResult.tests[0].passed).toBe(true);
      expect(testResult.tests[1].name).toBe('Handler execution');
      expect(testResult.tests[1].passed).toBe(true);
    });

    it('should test a provider component', async () => {
      const providerPath = path.join(testComponentsDir, 'test-provider.ts');

      // First load the component
      const loadResult = await service.loadComponent({
        filePath: providerPath,
        componentType: ComponentType.PROVIDER,
        runtime: mockRuntime,
      });

      // Then test it
      const testResult = await service.testComponent({
        component: loadResult.component,
        componentType: ComponentType.PROVIDER,
        runtime: mockRuntime,
      });

      expect(testResult.passed).toBe(true);
      expect(testResult.tests).toHaveLength(1);
      expect(testResult.tests[0].name).toBe('Provider get method');
      expect(testResult.tests[0].passed).toBe(true);
    });

    it('should handle test failures', async () => {
      // Create a faulty action
      const faultyActionPath = path.join(tempDir, 'faulty-action.ts');
      const faultyContent = `
export default {
  name: 'faulty-action',
  description: 'Action that throws error',
  validate: async () => true,
  handler: async () => {
    throw new Error('Test error');
  }
};
`;
      await fs.writeFile(faultyActionPath, faultyContent);

      const loadResult = await service.loadComponent({
        filePath: faultyActionPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      const testResult = await service.testComponent({
        component: loadResult.component,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect(testResult.passed).toBe(false);
      expect(testResult.tests[1].passed).toBe(false);
      expect(testResult.tests[1].error).toContain('Test error');
    });
  });

  describe('reloadComponent', () => {
    it('should reload a modified component', async () => {
      // Create initial component
      const componentPath = path.join(tempDir, 'reload-test.ts');
      const initialContent = `
export default {
  name: 'reload-test',
  description: 'Initial version',
  handler: async () => ({ text: 'version 1' })
};
`;
      await fs.writeFile(componentPath, initialContent);

      // Load initial version
      const initialResult = await service.loadComponent({
        filePath: componentPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect((initialResult.component as any).description).toBe('Initial version');

      // Modify the component
      const updatedContent = `
export default {
  name: 'reload-test',
  description: 'Updated version',
  handler: async () => ({ text: 'version 2' })
};
`;
      await fs.writeFile(componentPath, updatedContent);

      // Reload the component
      const reloadedResult = await service.reloadComponent({
        filePath: componentPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect((reloadedResult.component as any).description).toBe('Updated version');
    });
  });

  describe('sandboxComponent', () => {
    it('should execute component in sandbox mode', async () => {
      const actionPath = path.join(testComponentsDir, 'test-action.ts');

      const result = await service.sandboxComponent({
        filePath: actionPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
        testData: {
          message: {
            content: { text: 'test message' },
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.sandboxed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle sandbox errors safely', async () => {
      // Create a malicious component
      const maliciousPath = path.join(tempDir, 'malicious.ts');
      const maliciousContent = `
export default {
  name: 'malicious',
  handler: async () => {
    process.exit(1); // This should be caught by sandbox
  }
};
`;
      await fs.writeFile(maliciousPath, maliciousContent);

      const result = await service.sandboxComponent({
        filePath: maliciousPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect(result.success).toBe(false);
      expect(result.sandboxed).toBe(true);
      expect(result.error).toBeDefined();
    });
  });

  describe('unloadComponent', () => {
    it('should unload a component and cleanup', async () => {
      const actionPath = path.join(testComponentsDir, 'test-action.ts');

      // Load component
      await service.loadComponent({
        filePath: actionPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      // Unload component
      await service.unloadComponent(actionPath);

      // Try to reload - should work without cache issues
      const reloadResult = await service.loadComponent({
        filePath: actionPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect(reloadResult.component).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle TypeScript syntax in loaded files', async () => {
      const tsPath = path.join(tempDir, 'typescript-test.ts');
      const tsContent = `
import { type Action, type IAgentRuntime, type Memory } from '@elizaos/core';

interface CustomData {
  value: string;
  timestamp: number;
}

const processData = (data: CustomData): string => {
  return \`Processed: \${data.value} at \${data.timestamp}\`;
};

export const typescriptAction: Action = {
  name: 'typescript-action',
  description: 'Action with TypeScript features',
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const data: CustomData = {
      value: message.content.text || '',
      timestamp: Date.now()
    };
    return {
      text: processData(data)
    };
  }
};

export default typescriptAction;
`;
      await fs.writeFile(tsPath, tsContent);

      const result = await service.loadComponent({
        filePath: tsPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect(result.component).toBeDefined();
      expect(result.component.name).toBe('typescript-action');
    });

    it('should handle ES modules with multiple exports', async () => {
      const multiExportPath = path.join(tempDir, 'multi-export.ts');
      const content = `
export const action1 = {
  name: 'action-1',
  handler: async () => ({ text: 'action 1' })
};

export const action2 = {
  name: 'action-2',
  handler: async () => ({ text: 'action 2' })
};

export const utils = {
  helper: () => 'helper function'
};

export default action1;
`;
      await fs.writeFile(multiExportPath, content);

      const result = await service.loadComponent({
        filePath: multiExportPath,
        componentType: ComponentType.ACTION,
        runtime: mockRuntime,
      });

      expect(result.exports).toContain('action1');
      expect(result.exports).toContain('action2');
      expect(result.exports).toContain('utils');
      expect(result.exports).toContain('default');
      expect(result.component.name).toBe('action-1');
    });
  });
});
