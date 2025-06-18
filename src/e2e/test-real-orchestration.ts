import type { IAgentRuntime, TestSuite } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { AutoCodeService } from '../services/autocode-service';

/**
 * Real-world test suite for the orchestration service
 * This test verifies that the orchestration service can coordinate
 * with real services to create a simple plugin
 */
export class RealOrchestrationTestSuite implements TestSuite {
  name = 'real-orchestration-tests';
  description = 'Real-world tests for orchestration with actual services';

  tests = [
    {
      name: 'test-real-orchestration',
      async fn(runtime: IAgentRuntime): Promise<void> {
        logger.info('Starting real orchestration test');

        const orchestrationService = runtime.getService(
          'autocoder'
        ) as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not found');
        }

        // Test 1: Verify service dependencies
        logger.info('Test 1: Checking service dependencies');

        const requiredServices = [
          'research',
          'knowledge',
          'env-manager',
          'plugin-manager',
          'plugin-creation',
        ];

        const missingServices: string[] = [];
        for (const serviceName of requiredServices) {
          const service = runtime.getService(serviceName);
          if (!service) {
            missingServices.push(serviceName);
          } else {
            logger.info(`✓ ${serviceName} service available`);
          }
        }

        if (missingServices.length > 0) {
          logger.warn(`Missing services: ${missingServices.join(', ')}`);
          logger.warn('Some features may not work without these services');
        }

        // Test 2: Create a simple test project
        logger.info('Test 2: Creating a test project');

        const testUserId = '00000000-0000-0000-0000-000000000000' as any;
        const project = await orchestrationService.createPluginProject(
          'test-json-formatter',
          'A simple plugin that formats JSON strings',
          testUserId
        );

        logger.info(`Created project: ${project.id}`);
        logger.info(`Project status: ${project.status}`);
        logger.info(`Project phase: ${project.phase}/${project.totalPhases}`);

        // Test 3: Check project status after a short delay
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const updatedProject = await orchestrationService.getProject(project.id);
        if (updatedProject) {
          logger.info(`Updated status: ${updatedProject.status}`);
          logger.info(`Updated phase: ${updatedProject.phase}/${updatedProject.totalPhases}`);

          if (updatedProject.status === 'awaiting-secrets') {
            logger.info(`Required secrets: ${updatedProject.requiredSecrets.join(', ')}`);

            // In a real scenario, we would provide secrets here
            // For testing, we'll just cancel the project
            await orchestrationService.cancelProject(project.id);
            logger.info('Project cancelled due to missing secrets');
          }
        }

        // Test 4: Verify active projects tracking
        logger.info('Test 4: Checking active projects');

        const activeProjects = await orchestrationService.getActiveProjects();
        logger.info(`Active projects: ${activeProjects.length}`);

        // Test 5: Test user feedback
        if (updatedProject) {
          await orchestrationService.addUserFeedback(
            project.id,
            'Please make sure the formatter handles nested objects correctly'
          );
          logger.info('Added user feedback');
        }

        logger.info('Real orchestration test completed');
      },
    },
  ];
}

export default new RealOrchestrationTestSuite();
