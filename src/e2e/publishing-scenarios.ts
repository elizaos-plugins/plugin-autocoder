import { logger, type IAgentRuntime, type TestSuite, type UUID } from '@elizaos/core';
import type { AutoCodeService } from '../services/autocode-service';

/**
 * E2E tests for plugin publishing workflow
 * These tests require GITHUB_TOKEN and GITHUB_USERNAME to be set
 */
const publishingScenarios: TestSuite = {
  name: 'plugin-publishing-scenarios',
  tests: [
    {
      name: 'simple-plugin-full-publish',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Testing full plugin creation and publishing workflow');

        // Check for required credentials
        const githubToken = runtime.getSetting('GITHUB_TOKEN');
        const githubUsername = runtime.getSetting('GITHUB_USERNAME');

        if (!githubToken || !githubUsername) {
          logger.warn('Skipping publishing test - GITHUB_TOKEN and GITHUB_USERNAME required');
          logger.info('Set these environment variables to run publishing tests');
          return;
        }

        const orchestrationService = runtime.getService(
          'autocoder'
        ) as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-publish-test' as UUID;

        // Create a simple hello-world plugin
        const project = await orchestrationService.createPluginProject(
          'hello-world',
          'A simple hello world plugin that greets users',
          userId
        );

        logger.info(`Created project ${project.id} for hello-world plugin`);

        // Wait for the full workflow to complete (including publishing)
        let currentProject = await orchestrationService.getProject(project.id);
        let attempts = 0;
        const maxAttempts = 60; // 10 minutes max

        while (
          currentProject &&
          currentProject.status !== 'completed' &&
          currentProject.status !== 'failed' &&
          attempts < maxAttempts
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
          currentProject = await orchestrationService.getProject(project.id);
          attempts++;

          if (currentProject) {
            logger.info(
              `Project status: ${currentProject.status}, phase: ${currentProject.phase}/${currentProject.totalPhases}`
            );

            // Check if awaiting secrets
            if (currentProject.status === 'awaiting-secrets') {
              logger.info(`Project requires secrets: ${currentProject.requiredSecrets.join(', ')}`);

              // Provide GitHub credentials
              if (currentProject.requiredSecrets.includes('GITHUB_TOKEN')) {
                await orchestrationService.provideSecrets(project.id, {
                  GITHUB_TOKEN: githubToken,
                  GITHUB_USERNAME: githubUsername,
                });
                logger.info('Provided GitHub credentials');
              }
            }
          }
        }

        if (!currentProject) {
          throw new Error('Project disappeared during execution');
        }

        if (currentProject.status === 'failed') {
          throw new Error(`Plugin creation failed: ${currentProject.error}`);
        }

        if (currentProject.status !== 'completed') {
          throw new Error(`Plugin creation timed out in status: ${currentProject.status}`);
        }

        // Verify publishing results
        if (!currentProject.githubRepo) {
          throw new Error('GitHub repository URL not found in completed project');
        }

        if (!currentProject.pullRequestUrl) {
          throw new Error('Registry pull request URL not found in completed project');
        }

        logger.info('Plugin successfully published!');
        logger.info(`GitHub Repository: ${currentProject.githubRepo}`);
        logger.info(`Registry PR: ${currentProject.pullRequestUrl}`);
      },
    },

    {
      name: 'complex-plugin-with-dependencies',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Testing complex plugin creation with dependencies');

        const githubToken = runtime.getSetting('GITHUB_TOKEN');
        const githubUsername = runtime.getSetting('GITHUB_USERNAME');

        if (!githubToken || !githubUsername) {
          logger.warn('Skipping complex plugin test - GitHub credentials required');
          return;
        }

        const orchestrationService = runtime.getService(
          'autocoder'
        ) as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-complex-test' as UUID;

        // Create a complex plugin with external API integration
        const project = await orchestrationService.createPluginProject(
          'crypto-prices',
          'A plugin that fetches real-time cryptocurrency prices from CoinGecko API and provides market analysis',
          userId
        );

        logger.info(`Created project ${project.id} for crypto-prices plugin`);

        // Monitor progress
        let currentProject = await orchestrationService.getProject(project.id);
        let lastPhase = 0;

        while (
          currentProject &&
          currentProject.status !== 'completed' &&
          currentProject.status !== 'failed'
        ) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          currentProject = await orchestrationService.getProject(project.id);

          if (currentProject && currentProject.phase !== lastPhase) {
            lastPhase = currentProject.phase;
            logger.info(
              `Progress: Phase ${currentProject.phase}/${currentProject.totalPhases} - ${currentProject.status}`
            );
          }

          // Handle secret requirements
          if (currentProject && currentProject.status === 'awaiting-secrets') {
            const secrets: Record<string, string> = {};

            if (currentProject.requiredSecrets.includes('GITHUB_TOKEN')) {
              secrets.GITHUB_TOKEN = githubToken;
              secrets.GITHUB_USERNAME = githubUsername;
            }

            if (currentProject.requiredSecrets.includes('ANTHROPIC_API_KEY')) {
              const anthropicKey = runtime.getSetting('ANTHROPIC_API_KEY');
              if (anthropicKey) {
                secrets.ANTHROPIC_API_KEY = anthropicKey;
              }
            }

            if (Object.keys(secrets).length > 0) {
              await orchestrationService.provideSecrets(project.id, secrets);
              logger.info(`Provided secrets: ${Object.keys(secrets).join(', ')}`);
            }
          }
        }

        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(
            `Complex plugin creation failed or timed out: ${currentProject?.error || 'Unknown error'}`
          );
        }

        // Verify the plugin was properly created with all components
        logger.info('Complex plugin successfully created and published!');
        logger.info(`Repository: ${currentProject.githubRepo}`);
        logger.info(`Registry PR: ${currentProject.pullRequestUrl}`);
        logger.info(`Test results: ${JSON.stringify(currentProject.testResults)}`);
      },
    },

    {
      name: 'plugin-update-workflow',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Testing plugin update workflow');

        const githubToken = runtime.getSetting('GITHUB_TOKEN');
        const githubUsername = runtime.getSetting('GITHUB_USERNAME');

        if (!githubToken || !githubUsername) {
          logger.warn('Skipping update test - GitHub credentials required');
          return;
        }

        const orchestrationService = runtime.getService(
          'autocoder'
        ) as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-update-test' as UUID;

        // Update an existing plugin (using a known ElizaOS plugin)
        const project = await orchestrationService.updatePluginProject(
          'https://github.com/elizaos/plugin-example',
          'Add new features: support for batch operations and improved error handling',
          userId
        );

        logger.info(`Created update project ${project.id}`);

        // Monitor the update process
        let currentProject = await orchestrationService.getProject(project.id);

        while (
          currentProject &&
          currentProject.status !== 'completed' &&
          currentProject.status !== 'failed'
        ) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          currentProject = await orchestrationService.getProject(project.id);

          if (currentProject) {
            logger.info(
              `Update status: ${currentProject.status}, phase: ${currentProject.phase}/${currentProject.totalPhases}`
            );

            // Provide credentials when needed
            if (
              currentProject.status === 'awaiting-secrets' &&
              currentProject.requiredSecrets.includes('GITHUB_TOKEN')
            ) {
              await orchestrationService.provideSecrets(project.id, {
                GITHUB_TOKEN: githubToken,
                GITHUB_USERNAME: githubUsername,
                ANTHROPIC_API_KEY: runtime.getSetting('ANTHROPIC_API_KEY') || '',
              });
            }
          }
        }

        if (!currentProject || currentProject.status !== 'completed') {
          throw new Error(`Plugin update failed: ${currentProject?.error || 'Unknown error'}`);
        }

        // Verify PR was created
        if (!currentProject.pullRequestUrl) {
          throw new Error('Pull request URL not found for plugin update');
        }

        logger.info('Plugin update completed successfully!');
        logger.info(`Pull Request: ${currentProject.pullRequestUrl}`);
      },
    },

    {
      name: 'publishing-failure-recovery',
      fn: async (runtime: IAgentRuntime) => {
        logger.info('Testing publishing failure recovery');

        const orchestrationService = runtime.getService(
          'autocoder'
        ) as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not available');
        }

        const userId = 'user-failure-test' as UUID;

        // Create a plugin but don't provide GitHub credentials initially
        const project = await orchestrationService.createPluginProject(
          'test-recovery',
          'A plugin to test failure recovery mechanisms',
          userId
        );

        // Wait for it to reach awaiting-secrets state
        let currentProject = await orchestrationService.getProject(project.id);
        let attempts = 0;

        while (currentProject && currentProject.status !== 'awaiting-secrets' && attempts < 30) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          currentProject = await orchestrationService.getProject(project.id);
          attempts++;
        }

        if (!currentProject || currentProject.status !== 'awaiting-secrets') {
          throw new Error('Project did not reach awaiting-secrets state as expected');
        }

        logger.info('Project is awaiting secrets as expected');

        // Cancel the project
        await orchestrationService.cancelProject(project.id);

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject || currentProject.status !== 'failed') {
          throw new Error('Project was not properly cancelled');
        }

        logger.info('Publishing failure recovery test passed');
      },
    },
  ],
};

export default publishingScenarios;
