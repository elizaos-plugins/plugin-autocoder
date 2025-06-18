import type { IAgentRuntime, TestSuite } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { AutoCodeService } from '../services/autocode-service';

/**
 * Weather Plugin Creation Scenario
 * Tests the complete workflow of creating a weather plugin with API integration
 */
export class WeatherPluginScenarioTestSuite implements TestSuite {
  name = 'weather-plugin-scenario';
  description = 'End-to-end test for creating a weather plugin with real services';

  tests = [
    {
      name: 'create-weather-plugin-with-api',
      async fn(runtime: IAgentRuntime): Promise<void> {
        logger.info('=== Weather Plugin Creation Scenario ===');

        const orchestrationService = runtime.getService(
          'autocoder'
        ) as AutoCodeService;
        if (!orchestrationService) {
          throw new Error('Orchestration service not found');
        }

        // Simulate user request
        const userId = '00000000-0000-0000-0000-000000000001' as any;
        const conversationId = 'conv-weather-001' as any;

        logger.info('User: I need a weather plugin that can get current weather and forecasts');

        // Create the project
        const project = await orchestrationService.createPluginProject(
          'weather-info',
          'A plugin that provides current weather conditions and forecasts for any location using weather APIs',
          userId,
          conversationId
        );

        logger.info(
          `Agent: I'll create a weather plugin for you. Let me start by researching weather APIs and best practices.`
        );
        logger.info(`Project created: ${project.id}`);

        // Wait for research phase
        await new Promise((resolve) => setTimeout(resolve, 10000));

        let currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject) {
          throw new Error('Project not found');
        }

        logger.info(
          `Current phase: ${currentProject.phase}/${currentProject.totalPhases} - ${currentProject.status}`
        );

        // Simulate the agent's research findings
        if (currentProject.phase >= 4) {
          logger.info("Agent: I've completed my research. Here's what I found:");
          logger.info('- OpenWeatherMap is the most popular free weather API');
          logger.info('- WeatherAPI.com offers a generous free tier');
          logger.info('- Both require API keys for authentication');
          logger.info('');
          logger.info("I'll create a plugin that supports both providers.");
        }

        // Check if we're waiting for secrets
        if (currentProject.status === 'awaiting-secrets') {
          logger.info('');
          logger.info('Agent: I need some API keys to continue development:');
          logger.info(`Required secrets: ${currentProject.requiredSecrets.join(', ')}`);
          logger.info('');
          logger.info("User: I don't have those API keys yet. Can you continue without them?");
          logger.info('');
          logger.info(
            "Agent: I'll continue development using mock data for now. You'll need to provide the API keys before we can test with real weather data."
          );

          // Simulate providing mock development key
          await orchestrationService.provideSecrets(project.id, {
            ANTHROPIC_API_KEY: 'mock-key-for-development',
          });

          // Wait for development to continue
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        // Check progress after MVP phase
        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject) return;

        if (currentProject.phase >= 8) {
          logger.info('');
          logger.info("Agent: I've completed the MVP! The plugin now has:");
          logger.info('- Basic structure with actions and providers');
          logger.info('- Mock weather data for testing');
          logger.info('- Support for getting current weather');
          logger.info('- Error handling for missing API keys');
        }

        // Add user feedback
        await orchestrationService.addUserFeedback(
          project.id,
          'Great! Can you also add support for 5-day forecasts and weather alerts?'
        );

        logger.info('');
        logger.info(
          'User: Great! Can you also add support for 5-day forecasts and weather alerts?'
        );
        logger.info('');
        logger.info(
          "Agent: I'll add those features now. Let me enhance the plugin with forecast and alert capabilities."
        );

        // Wait for full implementation
        await new Promise((resolve) => setTimeout(resolve, 10000));

        currentProject = await orchestrationService.getProject(project.id);
        if (!currentProject) return;

        if (currentProject.phase >= 13) {
          logger.info('');
          logger.info("Agent: I've added the requested features! The plugin now includes:");
          logger.info('- 5-day weather forecast');
          logger.info('- Severe weather alerts');
          logger.info('- Support for multiple weather providers');
          logger.info('- Caching to reduce API calls');
          logger.info('- Comprehensive error handling');
        }

        // Check if we need publishing secrets
        if (currentProject.status === 'awaiting-secrets' && currentProject.phase > 13) {
          logger.info('');
          logger.info(
            'Agent: The plugin is ready for publishing! I need your GitHub and npm credentials:'
          );
          logger.info(
            `Required: ${currentProject.requiredSecrets.filter((s) => !currentProject.providedSecrets.includes(s)).join(', ')}`
          );
          logger.info('');
          logger.info("User: I'll set those up later. Can you show me how to test it first?");
          logger.info('');
          logger.info("Agent: Of course! Here's how to test the weather plugin:");
          logger.info('1. Set your weather API keys in the .env file');
          logger.info('2. Run: elizaos test');
          logger.info('3. Try commands like "What\'s the weather in London?"');
          logger.info('4. The plugin will use mock data if API keys are missing');

          // Cancel the project since we're not publishing in the test
          await orchestrationService.cancelProject(project.id);
        }

        // Final status
        currentProject = await orchestrationService.getProject(project.id);
        if (currentProject) {
          logger.info('');
          logger.info(`Final project status: ${currentProject.status}`);
          logger.info(`Completed phases: ${currentProject.phase}/${currentProject.totalPhases}`);

          if (currentProject.testResults) {
            logger.info('Test results:');
            logger.info(`- Tests passed: ${currentProject.testResults.passed}`);
            logger.info(`- Tests failed: ${currentProject.testResults.failed}`);
            logger.info(`- Duration: ${currentProject.testResults.duration}ms`);
            if (
              currentProject.testResults.failures &&
              currentProject.testResults.failures.length > 0
            ) {
              logger.info('- Failures:');
              currentProject.testResults.failures.forEach((failure) => {
                logger.info(`  - ${failure.test}: ${failure.error}`);
              });
            }
          }
        }

        logger.info('');
        logger.info('=== Weather Plugin Scenario Complete ===');
      },
    },
  ];
}

export default new WeatherPluginScenarioTestSuite();
