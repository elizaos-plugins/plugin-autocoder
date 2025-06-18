import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import { AutoCodeService } from '../services/autocode-service';

export const pluginRegistryProvider: Provider = {
  name: 'plugin_registry',
  description: 'Provides information about all created plugins in the current session',
  get: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> => {
    const service = runtime.getService('autocoder') as AutoCodeService;

    if (!service) {
      return {
        text: 'Plugin creation service not available',
        data: { error: 'Service not found' },
      };
    }

    const allProjects = await service.getAllProjects();
    const activeProjects = await service.getActiveProjects();

    // Group projects by name to get unique plugins
    const pluginMap = new Map<string, any>();

    for (const project of allProjects) {
      if (
        !pluginMap.has(project.name) ||
        project.updatedAt > pluginMap.get(project.name).updatedAt
      ) {
        pluginMap.set(project.name, {
          name: project.name,
          id: project.id,
          status: project.status,
          phase: project.phase,
          totalPhases: project.totalPhases,
          type: project.type,
          createdAt: project.createdAt,
          completedAt: project.completedAt,
          githubRepo: project.githubRepo,
          pullRequestUrl: project.pullRequestUrl,
        });
      }
    }

    const registryData = {
      totalCreated: pluginMap.size,
      plugins: Array.from(pluginMap.values()),
      activeProjects: activeProjects.length,
    };

    return {
      text: `Plugin Registry: ${pluginMap.size} unique plugins, ${activeProjects.length} active projects`,
      data: registryData,
    };
  },
};

export const pluginExistsProvider: Provider = {
  name: 'plugin_exists_check',
  description: 'Checks if a specific plugin has already been created',
  get: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> => {
    const service = runtime.getService('autocoder') as AutoCodeService;

    if (!service) {
      return {
        text: 'Plugin creation service not available',
        data: { error: 'Service not found' },
      };
    }

    // Extract plugin name from message - look for various patterns
    const patterns = [
      /@[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+/, // @scope/plugin-name
      /plugin-[a-zA-Z0-9-_]+/, // plugin-name
      /[a-zA-Z0-9-_]+-plugin/, // name-plugin
    ];

    let pluginName: string | null = null;
    for (const pattern of patterns) {
      const match = (message.content.text || '').match(pattern);
      if (match) {
        pluginName = match[0];
        break;
      }
    }

    if (!pluginName) {
      return {
        text: 'No plugin name found in message',
        data: { exists: false },
      };
    }

    // Check if plugin exists by searching through all projects
    const allProjects = await service.getAllProjects();
    const exists = allProjects.some(
      (project) =>
        project.name === pluginName ||
        project.name === pluginName.replace(/^plugin-/, '') ||
        project.name === pluginName.replace(/-plugin$/, '')
    );

    const createdPlugins = [...new Set(allProjects.map((p) => p.name))];

    return {
      text: exists
        ? `Plugin ${pluginName} has already been created in this session`
        : `Plugin ${pluginName} has not been created yet`,
      data: {
        pluginName,
        exists,
        createdPlugins,
      },
    };
  },
};
