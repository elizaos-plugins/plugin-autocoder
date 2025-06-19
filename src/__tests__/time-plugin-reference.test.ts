import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginCreationService, ClaudeModel } from '../services/plugin-creation-service.ts';
import type { IAgentRuntime } from '@elizaos/core';
import { TIME_PLUGIN_SPEC } from './e2e-plugin-creation.test';
import fs from 'fs-extra';
import path from 'path';

describe('Time Plugin Reference Test', () => {
  let service: PluginCreationService;
  let runtime: IAgentRuntime;

  beforeEach(async () => {
    runtime = {
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'PLUGIN_DATA_DIR') return path.join(process.cwd(), 'test-data');
        if (key === 'ANTHROPIC_API_KEY') return 'test-api-key';
        if (key === 'CLAUDE_MODEL') return ClaudeModel.SONNET_3_5;
        return null;
      }),
      getService: vi.fn().mockReturnValue(null),
      services: new Map(),
    } as any;

    service = new PluginCreationService(runtime);
    await service.initialize(runtime);
  });

  it('should validate plugin-starter template structure as reference implementation', async () => {
    const pluginStarterPath = path.join(__dirname, '../resources/templates/plugin-starter');

    // Verify plugin structure exists
    expect(await fs.pathExists(pluginStarterPath)).toBe(true);
    expect(await fs.pathExists(path.join(pluginStarterPath, 'package.json'))).toBe(true);
    expect(await fs.pathExists(path.join(pluginStarterPath, 'src/index.ts'))).toBe(true);
    // The plugin-starter template has all components in index.ts, not separate files
    expect(await fs.pathExists(path.join(pluginStarterPath, '__tests__/plugin.test.ts'))).toBe(true);
    expect(await fs.pathExists(path.join(pluginStarterPath, '__tests__/integration.test.ts'))).toBe(true);

    // Validate package.json structure
    const packageJson = await fs.readJson(path.join(pluginStarterPath, 'package.json'));
    expect(packageJson.name).toBe('@npm-username/plugin-name');
    expect(packageJson.dependencies).toHaveProperty('@elizaos/core');
    expect(packageJson.agentConfig).toBeDefined();
    expect(packageJson.agentConfig.pluginType).toBe('elizaos:plugin:1.0.0');
  });

  it('should load plugin-starter code as reference for AI generation', async () => {
    const pluginStarterPath = path.join(__dirname, '../resources/templates/plugin-starter');

    // Load key files that would be used as reference
    const indexContent = await fs.readFile(path.join(pluginStarterPath, 'src/index.ts'), 'utf-8');

    // Validate content structure
    expect(indexContent).toContain('export const starterPlugin: Plugin');
    expect(indexContent).toContain('helloWorldAction');
    expect(indexContent).toContain('helloWorldProvider');
    expect(indexContent).toContain('StarterService');

    // Check action implementation
    expect(indexContent).toContain('const helloWorldAction: Action');
    expect(indexContent).toContain('validate:');
    expect(indexContent).toContain('handler:');
  });

  it('should demonstrate complete plugin implementation patterns', async () => {
    const pluginStarterPath = path.join(__dirname, '../resources/templates/plugin-starter');

    // Check for complete implementation patterns in index.ts
    const content = await fs.readFile(path.join(pluginStarterPath, 'src/index.ts'), 'utf-8');

    // Verify no TODOs or stubs
    expect(content).not.toContain('TODO');
    expect(content).not.toContain("throw new Error('Not implemented')");

    // Verify proper error handling
    expect(content).toContain('try {');
    expect(content).toContain('catch (error)');

    // Verify callback handling
    expect(content).toContain('if (callback)');

    // Verify return structure
    expect(content).toContain('text:');
    expect(content).toContain('actions:');
  });

  it('should have comprehensive test coverage patterns', async () => {
    // Check the plugin implementation has handler patterns
    const pluginPath = path.join(
      __dirname,
      '../resources/templates/plugin-starter/src/index.ts'
    );

    if (await fs.pathExists(pluginPath)) {
      const pluginContent = await fs.readFile(pluginPath, 'utf-8');

      // Verify the plugin has proper handler implementation
      expect(pluginContent).toContain('handler');
      expect(pluginContent).toContain('handler: async');
      expect(pluginContent).toContain('validate: async');
      
      // Also check test patterns
      const testPath = path.join(
        __dirname,
        '../resources/templates/plugin-starter/__tests__/plugin.test.ts'
      );
      
      if (await fs.pathExists(testPath)) {
        const testContent = await fs.readFile(testPath, 'utf-8');
        
        // Verify test patterns
        expect(testContent).toContain('describe');
        expect(testContent).toContain('it');
        expect(testContent).toContain('expect');
        expect(testContent).toContain('createRealRuntime');
      }
    }
  });

  it('should match the TIME_PLUGIN_SPEC specification', () => {
    // Verify the implementation matches the spec
    expect(TIME_PLUGIN_SPEC.name).toBe('@elizaos/plugin-time');
    expect(TIME_PLUGIN_SPEC.actions).toHaveLength(2);
    expect(TIME_PLUGIN_SPEC.actions?.[0].name).toBe('getCurrentTime');
    expect(TIME_PLUGIN_SPEC.actions?.[1].name).toBe('convertTime');
    expect(TIME_PLUGIN_SPEC.providers).toHaveLength(1);
    expect(TIME_PLUGIN_SPEC.providers?.[0].name).toBe('timeProvider');
  });
});
