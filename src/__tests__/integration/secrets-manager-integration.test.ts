import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UUID } from '@elizaos/core';
import { OrchestrationManager } from '../../managers/orchestration-manager';
import { PluginCreationService } from '../../services/plugin-creation-service';
import { EnhancedSecretManager } from '@elizaos/plugin-secrets-manager';

describe('Secrets Manager Integration', () => {
  let mockRuntime: any;
  let mockSecretsManager: any;

  beforeEach(() => {
    // Mock secrets manager
    mockSecretsManager = {
      get: vi.fn(),
      set: vi.fn(),
    };

    // Mock runtime with secrets manager
    mockRuntime = {
      agentId: 'test-agent',
      getSetting: vi.fn(),
      getService: vi.fn((serviceName: string) => {
        if (serviceName === 'SECRETS') {
          return mockSecretsManager;
        }
        return null;
      }),
      character: {
        name: 'TestAgent',
        bio: ['Test bio'],
        knowledge: [],
        messageExamples: [],
        postExamples: [],
        topics: [],
        adjectives: [],
        clients: [],
        plugins: []
      }
    };
  });

  describe('OrchestrationManager', () => {
    it('should use secrets manager for API key access', async () => {
      const testApiKey = 'test-anthropic-key';
      mockSecretsManager.get.mockResolvedValue(testApiKey);

      const manager = new OrchestrationManager(mockRuntime);
      await manager.initialize();

      expect(mockSecretsManager.get).toHaveBeenCalledWith(
        'ANTHROPIC_API_KEY',
        expect.objectContaining({
          level: 'global',
          agentId: 'test-agent',
          requesterId: 'test-agent'
        })
      );
    });

    it('should fallback to runtime.getSetting when secrets manager unavailable', async () => {
      const testApiKey = 'fallback-api-key';
      mockRuntime.getService.mockReturnValue(null); // No secrets manager
      mockRuntime.getSetting.mockReturnValue(testApiKey);

      const manager = new OrchestrationManager(mockRuntime);
      await manager.initialize();

      expect(mockRuntime.getSetting).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
    });

    it('should securely store secrets when provided', async () => {
      mockSecretsManager.set.mockResolvedValue(true);

      const manager = new OrchestrationManager(mockRuntime);
      await manager.initialize();

      // Create a test project
      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as UUID
      );

      // Manually set required secrets for testing
      project.requiredSecrets = ['ANTHROPIC_API_KEY'];

      // Simulate providing secrets
      await manager.provideSecrets(project.id, {
        'ANTHROPIC_API_KEY': 'secret-key-value'
      });

      expect(mockSecretsManager.set).toHaveBeenCalledWith(
        'ANTHROPIC_API_KEY',
        'secret-key-value',
        expect.objectContaining({
          level: 'global',
          agentId: 'test-agent',
          requesterId: 'test-agent'
        }),
        expect.objectContaining({
          type: 'api_key',
          encrypted: true,
          plugin: '@elizaos/plugin-autocoder'
        })
      );
    });

    it('should validate secrets before storing', async () => {
      const manager = new OrchestrationManager(mockRuntime);
      await manager.initialize();

      const project = await manager.createPluginProject(
        'test-plugin',
        'A test plugin',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as UUID
      );

      // Manually set required secrets for testing
      project.requiredSecrets = ['ANTHROPIC_API_KEY'];

      // Try to provide an invalid API key (too short)
      await manager.provideSecrets(project.id, {
        'ANTHROPIC_API_KEY': 'short'
      });

      // Should not call set for invalid secrets
      expect(mockSecretsManager.set).not.toHaveBeenCalled();
    });
  });

  describe('PluginCreationService', () => {
    it('should use secrets manager for API key access', async () => {
      const testApiKey = 'test-anthropic-key';
      mockSecretsManager.get.mockResolvedValue(testApiKey);

      const service = new PluginCreationService(mockRuntime);
      await service.initialize(mockRuntime);

      expect(mockSecretsManager.get).toHaveBeenCalledWith(
        'ANTHROPIC_API_KEY',
        expect.objectContaining({
          level: 'global',
          agentId: 'test-agent',
          requesterId: 'test-agent'
        })
      );
    });

    it('should fallback to runtime.getSetting when secrets manager fails', async () => {
      const testApiKey = 'fallback-api-key';
      mockSecretsManager.get.mockRejectedValue(new Error('Secrets manager error'));
      mockRuntime.getSetting.mockReturnValue(testApiKey);

      const service = new PluginCreationService(mockRuntime);
      await service.initialize(mockRuntime);

      expect(mockRuntime.getSetting).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
    });
  });
});