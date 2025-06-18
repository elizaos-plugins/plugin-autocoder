import type { IAgentRuntime, TestSuite, UUID } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { AutoCodeService } from '../services/autocode-service.ts';

/**
 * Comprehensive E2E Test Suite for Plugin Orchestration
 * Tests all major plugin creation scenarios mentioned in the self-improving agent plan
 */
export const comprehensivePluginScenarios: TestSuite = {
  name: 'comprehensive-plugin-scenarios',
  tests: [
    {
      name: 'time-plugin-creation',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Starting time plugin creation test');

        const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-time-test' as UUID;

        // Create a simple time plugin
        const project = await orchestrationService.createPluginProject(
          'time-helper',
          'A plugin that provides current time in different timezones, time calculations, and scheduling features',
          userId
        );

        // Wait for research phase
        await waitForPhase(orchestrationService, project.id, 4, 500);

        let currentProject = await orchestrationService.getProject(project.id);
        logger.info('Time plugin research complete:', {
          id: currentProject?.id,
          phase: currentProject?.phase,
          knowledgeIds: currentProject?.knowledgeIds.length,
        });

        // Time plugin shouldn't need external API keys for basic functionality
        // Wait for development to complete
        await waitForStatus(orchestrationService, project.id, 'completed', 500);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`Time plugin creation failed: ${currentProject?.error}`);
        }

        // Verify the plugin has expected components
        if (!currentProject.localPath) {
          throw new Error('Time plugin was not created locally');
        }

        logger.success('Time plugin created successfully');
      },
    },

    {
      name: 'weather-plugin-creation-with-api',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Starting weather plugin creation test');

        const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-weather-test' as UUID;

        const project = await orchestrationService.createPluginProject(
          'weather-tracker',
          'A plugin that fetches weather data from OpenWeatherMap API and provides forecasts, alerts, and weather conditions for cities worldwide',
          userId
        );

        // Wait for the plugin to need secrets
        await waitForStatus(orchestrationService, project.id, 'awaiting-secrets', 500);

        let currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || !currentProject.requiredSecrets.includes('ANTHROPIC_API_KEY')) {
          throw new Error('Required secrets not properly identified');
        }

        // Provide necessary secrets
        await orchestrationService.provideSecrets(project.id, {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
          OPENWEATHER_API_KEY: 'test-weather-api-key',
        });

        // Wait for completion
        await waitForStatus(orchestrationService, project.id, 'completed', 500);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`Weather plugin creation failed: ${currentProject?.error}`);
        }

        logger.success('Weather plugin created successfully with API integration');
      },
    },

    {
      name: 'news-plugin-creation',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Starting news plugin creation test');

        const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-news-test' as UUID;

        const project = await orchestrationService.createPluginProject(
          'news-aggregator',
          'A plugin that fetches latest news from multiple sources, categorizes by topic, and provides summaries. Should support RSS feeds, news APIs, and web scraping.',
          userId
        );

        // Wait for research to complete
        await waitForPhase(orchestrationService, project.id, 4, 500);

        // News plugin might need API keys for premium sources
        let currentProject = await orchestrationService.getProject(project.id);
        if (currentProject?.status === 'awaiting-secrets') {
          await orchestrationService.provideSecrets(project.id, {
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
            NEWS_API_KEY: 'test-news-api-key',
          });
        }

        await waitForStatus(orchestrationService, project.id, 'completed', 500);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`News plugin creation failed: ${currentProject?.error}`);
        }

        logger.success('News plugin created successfully');
      },
    },

    {
      name: 'shell-plugin-creation',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Starting shell plugin creation test');

        const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-shell-test' as UUID;

        const project = await orchestrationService.createPluginProject(
          'shell-executor',
          'A secure plugin that can execute shell commands with proper sandboxing, permission controls, and output capture. Should support common operations like file management, process control, and system information.',
          userId
        );

        // Shell plugin is complex due to security considerations
        await waitForPhase(orchestrationService, project.id, 4, 500);

        // Provide API key if needed
        let currentProject = await orchestrationService.getProject(project.id);
        if (currentProject?.status === 'awaiting-secrets') {
          await orchestrationService.provideSecrets(project.id, {
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
          });
        }

        await waitForStatus(orchestrationService, project.id, 'completed', 500); // Shorter timeout for mock

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`Shell plugin creation failed: ${currentProject?.error}`);
        }

        logger.success('Shell plugin created with security features');
      },
    },

    {
      name: 'time-on-mars-plugin-creation',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Starting Time on Mars plugin creation test');

        const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-mars-test' as UUID;

        const project = await orchestrationService.createPluginProject(
          'mars-time',
          'A plugin that calculates and displays Mars Sol time, Earth-Mars time conversion, and tracks Mars missions schedules. Should include Mars calendar and season tracking.',
          userId
        );

        // This is a calculation-based plugin, shouldn't need external APIs
        await waitForPhase(orchestrationService, project.id, 8, 1000); // MVP phase

        // Provide API key if needed for development
        let currentProject = await orchestrationService.getProject(project.id);
        if (currentProject?.status === 'awaiting-secrets') {
          await orchestrationService.provideSecrets(project.id, {
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
          });
        }

        await waitForStatus(orchestrationService, project.id, 'completed', 500);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`Mars time plugin creation failed: ${currentProject?.error}`);
        }

        logger.success('Mars time plugin created successfully');
      },
    },

    {
      name: 'astrology-plugin-creation',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Starting astrology plugin creation test');

        const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-astrology-test' as UUID;

        const project = await orchestrationService.createPluginProject(
          'astrology-guide',
          'A plugin that provides horoscopes, zodiac compatibility, birth chart calculations, and astrological insights. Should support multiple astrology systems and personalized readings.',
          userId
        );

        // Wait for research on astrology APIs and calculations
        await waitForPhase(orchestrationService, project.id, 4, 500);

        // Might need API keys for premium astrology data
        let currentProject = await orchestrationService.getProject(project.id);
        if (currentProject?.status === 'awaiting-secrets') {
          await orchestrationService.provideSecrets(project.id, {
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
            ASTROLOGY_API_KEY: 'test-astrology-key',
          });
        }

        await waitForStatus(orchestrationService, project.id, 'completed', 500);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`Astrology plugin creation failed: ${currentProject?.error}`);
        }

        logger.success('Astrology plugin created successfully');
      },
    },

    {
      name: 'parallel-plugin-creation',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Testing parallel plugin creation capability');

        const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-parallel-test' as UUID;

        // Start three plugins simultaneously
        const projects = await Promise.all([
          orchestrationService.createPluginProject(
            'calculator',
            'A simple calculator plugin for basic math operations',
            userId
          ),
          orchestrationService.createPluginProject(
            'unit-converter',
            'Convert between different units of measurement',
            userId
          ),
          orchestrationService.createPluginProject(
            'color-picker',
            'A plugin to work with colors, conversions, and palettes',
            userId
          ),
        ]);

        logger.info(`Started ${projects.length} parallel projects`);

        // Monitor all projects
        const projectMonitoring = projects.map(async (project) => {
          try {
            // Handle potential secret requirements
            const checkSecrets = setInterval(async () => {
              const current = await orchestrationService.getProject(project.id);
              if (current?.status === 'awaiting-secrets') {
                await orchestrationService.provideSecrets(project.id, {
                  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
                });
                clearInterval(checkSecrets);
              }
              if (current?.status === 'completed' || current?.status === 'failed') {
                clearInterval(checkSecrets);
              }
            }, 5000);

            await waitForStatus(orchestrationService, project.id, 'completed', 1000);
            return { success: true, projectId: project.id };
          } catch (error) {
            return { success: false, projectId: project.id, error: error.message };
          }
        });

        const results = await Promise.all(projectMonitoring);
        const successful = results.filter((r) => r.success).length;

        if (successful < 2) {
          throw new Error(
            `Only ${successful}/3 parallel projects completed successfully: ${JSON.stringify(
              results
            )}`
          );
        }

        logger.success(`${successful}/3 parallel projects completed successfully`);
      },
    },

    {
      name: 'plugin-update-scenario',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Testing plugin update capability');

        const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-update-test' as UUID;

        // Simulate updating an existing plugin
        const project = await orchestrationService.updatePluginProject(
          'https://github.com/elizaos/plugin-example',
          'Add support for webhooks and improve error handling',
          userId
        );

        // Wait for research on the existing codebase
        await waitForPhase(orchestrationService, project.id, 2, 500);

        // Provide secrets if needed
        let currentProject = await orchestrationService.getProject(project.id);
        if (currentProject?.status === 'awaiting-secrets') {
          await orchestrationService.provideSecrets(project.id, {
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
            GITHUB_TOKEN: 'test-github-token',
          });
        }

        await waitForStatus(orchestrationService, project.id, 'completed', 500);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`Plugin update failed: ${currentProject?.error}`);
        }

        // Verify PR was created
        if (!currentProject.pullRequestUrl) {
          throw new Error('No pull request URL generated for update');
        }

        logger.success('Plugin update completed with PR created');
      },
    },
  ],
};

/**
 * Helper function to wait for a specific status
 */
async function waitForStatus(
  service: any,
  projectId: string,
  expectedStatus: string,
  timeoutMs: number = 5000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const project = await service.getProject(projectId);
    if (project?.status === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const finalProject = await service.getProject(projectId);
  throw new Error(
    `Timeout waiting for status: ${expectedStatus}. Current status: ${finalProject?.status}`
  );
}

/**
 * Helper function to wait for a specific phase
 */
async function waitForPhase(
  service: any,
  projectId: string,
  expectedPhase: number,
  timeoutMs: number = 5000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const project = await service.getProject(projectId);
    if (project && project.phase >= expectedPhase) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const finalProject = await service.getProject(projectId);
  throw new Error(
    `Timeout waiting for phase ${expectedPhase}. Current phase: ${finalProject?.phase}`
  );
}

export default comprehensivePluginScenarios;
