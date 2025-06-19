#!/usr/bin/env bun

import { logger } from '@elizaos/core';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import { OrchestrationService } from './src/services/orchestration-service';

/**
 * Demo script to show the publishing workflow
 *
 * To run this demo:
 * 1. Set GITHUB_TOKEN and GITHUB_USERNAME environment variables
 * 2. Set ANTHROPIC_API_KEY for code generation
 * 3. Run: bun run test-publishing-demo.ts
 */

// Create a mock runtime
const createMockRuntime = (settings: Record<string, string>): IAgentRuntime => {
  const services = new Map<string, any>();

  return {
    getSetting: (key: string) => settings[key] || null,
    getService: (name: string) => services.get(name),
    registerService: (service: any) => {
      services.set(service.constructor.serviceType, service);
    },
    // Add other required runtime methods as stubs
    agentId: 'demo-agent' as UUID,
    serverUrl: 'http://localhost:3000',
    databaseAdapter: {} as any,
    token: null,
    modelProvider: {} as any,
    character: {} as any,
    messageManager: {} as any,
    descriptionManager: {} as any,
    documentsManager: {} as any,
    knowledgeManager: {} as any,
    loreManager: {} as any,
    cacheManager: {} as any,
    services: services,
    providers: [],
    actions: [],
    evaluators: [],
    plugins: [],
    getMemoryManager: () => ({}) as any,
    getConversationLength: () => 0,
    processActions: async () => {},
    evaluate: async () => [],
    ensureParticipantExists: async () => {},
    ensureUserExists: async () => {},
    ensureParticipantInRoom: async () => {},
    ensureConnection: async () => {},
    ensureRoomExists: async () => {},
    composeState: async () => ({}) as any,
    updateRecentMessageState: async () => ({}) as any,
  } as IAgentRuntime;
};

async function runPublishingDemo() {
  logger.info('=== ElizaOS Self-Improving Agent Publishing Demo ===');

  // Check for required environment variables
  const requiredEnvVars = ['GITHUB_TOKEN', 'GITHUB_USERNAME', 'ANTHROPIC_API_KEY'];
  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    logger.info('\nTo run this demo, please set:');
    logger.info('export GITHUB_TOKEN=your_github_personal_access_token');
    logger.info('export GITHUB_USERNAME=your_github_username');
    logger.info('export ANTHROPIC_API_KEY=your_anthropic_api_key');
    process.exit(1);
  }

  // Create runtime with settings
  const runtime = createMockRuntime({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
    GITHUB_USERNAME: process.env.GITHUB_USERNAME!,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  });

  // Initialize orchestration service
  const orchestrationService = await OrchestrationService.start(runtime);
  runtime.registerService(orchestrationService);

  logger.info('\nOrchestration service initialized');
  logger.info(`GitHub Username: ${process.env.GITHUB_USERNAME}`);
  logger.info('GitHub Token: ****** (hidden)');

  // Create a demo plugin project
  const userId = 'demo-user' as UUID;
  const pluginName = `demo-plugin-${Date.now()}`;
  const description = 'A demo plugin to showcase the self-improving agent publishing workflow';

  logger.info(`\nCreating plugin: ${pluginName}`);
  logger.info(`Description: ${description}`);

  const project = await orchestrationService.createPluginProject(pluginName, description, userId);

  logger.info(`\nProject created with ID: ${project.id}`);
  logger.info('The workflow will now proceed through 22 phases:');
  logger.info('1-4: Research phase');
  logger.info('5-8: MVP implementation');
  logger.info('9-13: Full implementation');
  logger.info('14-18: Final iteration');
  logger.info('19-22: Publishing to GitHub and creating registry PR');

  // Monitor progress
  let lastPhase = 0;
  let lastStatus = '';

  const checkProgress = async () => {
    const currentProject = await orchestrationService.getProject(project.id);
    if (!currentProject) return false;

    if (currentProject.phase !== lastPhase || currentProject.status !== lastStatus) {
      lastPhase = currentProject.phase;
      lastStatus = currentProject.status;

      logger.info(
        `\n[Phase ${currentProject.phase}/${currentProject.totalPhases}] Status: ${currentProject.status}`
      );

      if (currentProject.logs.length > 0) {
        const recentLogs = currentProject.logs.slice(-3);
        recentLogs.forEach((log) => logger.info(`  > ${log}`));
      }

      if (currentProject.status === 'awaiting-secrets') {
        logger.info('\nProject is awaiting secrets. This should not happen in demo mode.');
        logger.info('Required secrets: ' + currentProject.requiredSecrets.join(', '));
      }
    }

    return currentProject.status === 'completed' || currentProject.status === 'failed';
  };

  // Wait for completion
  logger.info('\nMonitoring progress...');

  while (true) {
    const isDone = await checkProgress();
    if (isDone) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Final results
  const finalProject = await orchestrationService.getProject(project.id);

  if (finalProject?.status === 'completed') {
    logger.info('\n=== Plugin Successfully Published! ===');
    logger.info(`GitHub Repository: ${finalProject.githubRepo}`);
    logger.info(`Registry PR: ${finalProject.pullRequestUrl}`);
    logger.info(`\nTest Results:`);
    logger.info(`  Passed: ${finalProject.testResults?.passed || 0}`);
    logger.info(`  Failed: ${finalProject.testResults?.failed || 0}`);
    logger.info(`  Duration: ${finalProject.testResults?.duration || 0}ms`);
  } else {
    logger.error('\n=== Plugin Creation Failed ===');
    logger.error(`Error: ${finalProject?.error || 'Unknown error'}`);
    if (finalProject?.errors && finalProject.errors.length > 0) {
      logger.error('\nError details:');
      finalProject.errors.forEach((e) => {
        logger.error(`  [Iteration ${e.iteration}, Phase ${e.phase}]: ${e.error}`);
      });
    }
  }

  // Cleanup
  await orchestrationService.stop();
  logger.info('\nDemo completed.');
}

// Run the demo
runPublishingDemo().catch((error) => {
  logger.error('Demo failed:', error);
  process.exit(1);
});
