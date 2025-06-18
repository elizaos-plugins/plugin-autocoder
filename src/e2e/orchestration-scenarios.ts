import type { IAgentRuntime, TestSuite, UUID } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { AutoCodeService, type PluginProject } from '../services/autocode-service';

/**
 * E2E Test Suite for Plugin Orchestration Scenarios
 * Tests real-world interaction patterns between users and the self-improving agent
 */
export const orchestrationScenarioTests: TestSuite = {
  name: 'plugin-orchestration-scenarios',
  tests: [
    {
      name: 'weather-plugin-creation-with-api-integration',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Starting weather plugin creation scenario test');

        const orchestrationService = runtime.getService(
          'autocoder'
        ) as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-weather-test' as UUID;

        const project = await orchestrationService.createPluginProject(
          'weather-tracker',
          'A plugin that fetches weather data and provides forecasts for different cities',
          userId
        );

        let currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject) {
          throw new Error('Project not created');
        }

        logger.info('Project created:', {
          id: currentProject.id,
          name: currentProject.name,
          status: currentProject.status,
        });
        await waitForStatus(orchestrationService, project.id, 'awaiting-secrets', 60000);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || !currentProject.requiredSecrets.includes('ANTHROPIC_API_KEY')) {
          throw new Error('Required secrets not properly identified');
        }

        logger.info('Plugin requires secrets:', currentProject.requiredSecrets);
        await orchestrationService.provideSecrets(project.id, {
          ANTHROPIC_API_KEY: 'test-api-key-for-autocoder',
        });

        await waitForStatus(orchestrationService, project.id, 'completed', 120000);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`Project failed with status: ${currentProject?.status}`);
        }

        logger.success('Weather plugin creation scenario completed successfully');
      },
    },
  ],
};

/**
 * Helper function to wait for a specific project status
 */
async function waitForStatus(
  service: AutoCodeService,
  projectId: string,
  status: string,
  timeout: number
): Promise<PluginProject> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const project = await service.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found during wait`);

    if (project.status === status) {
      return project;
    }

    if (project.status === 'failed') {
      throw new Error(`Project failed unexpectedly: ${project.error || 'Unknown error'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const project = await service.getProject(projectId);
  throw new Error(
    `Timeout waiting for status: ${status}. Current status: ${project?.status || 'unknown'}`
  );
}

export default orchestrationScenarioTests;
