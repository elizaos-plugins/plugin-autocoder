import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UUID } from '@elizaos/core';
import { ServiceDiscoveryManager } from '../../managers/service-discovery-manager';
import { OrchestrationManager } from '../../managers/orchestration-manager';

describe('Plugin Manager Integration', () => {
  let mockRuntime: any;
  let mockPluginManager: any;

  beforeEach(() => {
    // Mock plugin manager with sample plugins
    mockPluginManager = {
      getAllPlugins: vi.fn(),
      searchPlugins: vi.fn(),
    };

    // Mock runtime with plugin manager
    mockRuntime = {
      agentId: 'test-agent',
      getSetting: vi.fn(),
      getService: vi.fn((serviceName: string) => {
        if (serviceName === 'PLUGIN_MANAGER') {
          return mockPluginManager;
        }
        if (serviceName === 'SECRETS') {
          return {
            get: vi.fn().mockResolvedValue('test-api-key'),
            set: vi.fn().mockResolvedValue(true)
          };
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

  describe('ServiceDiscoveryManager', () => {
    it('should discover services from loaded plugins via Plugin Manager', async () => {
      const mockPlugins = [
        {
          status: 'loaded',
          path: '/path/to/plugin1',
          packageJson: { name: '@elizaos/plugin-test1', description: 'Test plugin 1' },
          plugin: {
            name: '@elizaos/plugin-test1',
            description: 'Test plugin for discovery',
            services: [
              {
                serviceName: 'test-service-1',
                serviceType: 'test',
                capabilityDescription: 'A test service'
              }
            ],
            actions: [
              {
                name: 'TEST_ACTION',
                description: 'A test action'
              }
            ],
            providers: [
              {
                name: 'TEST_PROVIDER',
                description: 'A test provider'
              }
            ],
            dependencies: ['@elizaos/core']
          }
        }
      ];

      mockPluginManager.getAllPlugins.mockResolvedValue(mockPlugins);

      const serviceDiscovery = new ServiceDiscoveryManager(mockRuntime);
      const result = await serviceDiscovery.discoverServices(['test', 'discovery']);

      expect(mockPluginManager.getAllPlugins).toHaveBeenCalled();
      expect(result.plugins).toHaveLength(1);
      expect(result.services).toHaveLength(1);
      expect(result.actions).toHaveLength(1);
      expect(result.providers).toHaveLength(1);

      expect(result.plugins[0]).toMatchObject({
        name: '@elizaos/plugin-test1',
        description: 'Test plugin for discovery',
        path: '/path/to/plugin1'
      });
    });

    it('should fallback to filesystem discovery when Plugin Manager unavailable', async () => {
      mockRuntime.getService.mockReturnValue(null); // No plugin manager

      const serviceDiscovery = new ServiceDiscoveryManager(mockRuntime);
      
      // Mock filesystem operations to avoid real plugin analysis
      vi.spyOn(serviceDiscovery as any, 'discoverFromFilesystem').mockResolvedValue({
        plugins: [],
        services: [],
        actions: [],
        providers: []
      });

      const result = await serviceDiscovery.discoverServices(['test']);

      // Should still return a result (though empty due to no plugins in test)
      expect(result).toHaveProperty('plugins');
      expect(result).toHaveProperty('services');
      expect(result).toHaveProperty('actions');
      expect(result).toHaveProperty('providers');
      expect(result.plugins).toEqual([]);
    });

    it('should filter plugins based on search terms', async () => {
      const mockPlugins = [
        {
          status: 'loaded',
          plugin: {
            name: '@elizaos/plugin-database',
            description: 'Database operations plugin',
            services: [],
            actions: [],
            providers: []
          }
        },
        {
          status: 'loaded',
          plugin: {
            name: '@elizaos/plugin-weather',
            description: 'Weather information plugin',
            services: [],
            actions: [],
            providers: []
          }
        }
      ];

      mockPluginManager.getAllPlugins.mockResolvedValue(mockPlugins);

      const serviceDiscovery = new ServiceDiscoveryManager(mockRuntime);
      const result = await serviceDiscovery.discoverServices(['database']);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0].name).toBe('@elizaos/plugin-database');
    });
  });

  describe('OrchestrationManager Plugin Discovery', () => {
    it('should integrate with Plugin Manager for plugin search', async () => {
      const mockSearchResults = [
        {
          plugin: {
            name: '@elizaos/plugin-search-result',
            description: 'Found via search',
            repository: 'https://github.com/example/plugin'
          },
          score: 0.8
        }
      ];

      const mockLoadedPlugins = [
        {
          name: '@elizaos/plugin-loaded',
          description: 'Already loaded plugin',
          status: 'loaded',
          packageJson: { description: 'Loaded plugin description' }
        }
      ];

      mockPluginManager.searchPlugins.mockResolvedValue(mockSearchResults);
      mockPluginManager.getAllPlugins.mockResolvedValue(mockLoadedPlugins);

      const orchestrationManager = new OrchestrationManager(mockRuntime);
      await orchestrationManager.initialize();

      const project = await orchestrationManager.createPluginProject(
        'test-plugin',
        'A test plugin requiring search functionality',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as UUID
      );

      // Mock the service discovery to avoid real filesystem operations
      const mockServiceDiscovery = {
        discoverServices: vi.fn().mockResolvedValue({
          plugins: [],
          services: [],
          actions: [],
          providers: []
        })
      };
      (orchestrationManager as any).serviceDiscovery = mockServiceDiscovery;

      // Manually trigger discovery since research phase might not complete in tests
      await (orchestrationManager as any).discoverExistingServices(project.id);

      // The plugin discovery should have been called during service discovery
      expect(mockPluginManager.searchPlugins).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(String),
          limit: 10,
          includeMetadata: true,
          sources: ['registry', 'github']
        })
      );

      expect(mockPluginManager.getAllPlugins).toHaveBeenCalled();

      // Check that discovered plugins were stored
      const retrievedProject = await orchestrationManager.getProject(project.id);
      expect(retrievedProject.discoveredPlugins).toBeDefined();
      expect(retrievedProject.discoveredPlugins.length).toBeGreaterThan(0);
    });

    it('should handle Plugin Manager errors gracefully', async () => {
      // Don't set up the error mocks immediately
      mockPluginManager.searchPlugins.mockResolvedValue([]);
      mockPluginManager.getAllPlugins.mockResolvedValue([]);

      const orchestrationManager = new OrchestrationManager(mockRuntime);
      await orchestrationManager.initialize();

      // Should not throw error
      const project = await orchestrationManager.createPluginProject(
        'test-plugin',
        'A test plugin',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as UUID
      );

      // Now set up the error mocks after project creation
      mockPluginManager.searchPlugins.mockImplementation(() => Promise.reject(new Error('Plugin Manager error')));
      mockPluginManager.getAllPlugins.mockImplementation(() => Promise.reject(new Error('Plugin Manager error')));

      // Mock the service discovery to avoid real filesystem operations
      const mockServiceDiscovery = {
        discoverServices: vi.fn().mockResolvedValue({
          plugins: [],
          services: [],
          actions: [],
          providers: []
        })
      };
      (orchestrationManager as any).serviceDiscovery = mockServiceDiscovery;

      // Manually trigger discovery to test error handling
      await (orchestrationManager as any).discoverExistingServices(project.id);

      const retrievedProject = await orchestrationManager.getProject(project.id);
      expect(retrievedProject.discoveredPlugins).toEqual([]);
    });
  });
});