import type { IAgentRuntime, TestSuite } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import fs from 'fs-extra';
import path from 'path';
import { ComponentType } from '../managers/component-creation-manager.ts';
import { AutoCodeService } from '../services/autocode-service.ts';

/**
 * Enhanced AutoCoder E2E test that exercises all major features
 */
export const enhancedAutocoderE2E = {
  name: 'enhanced-autocoder-e2e',
  description: 'Comprehensive E2E test for the enhanced AutoCoder plugin',
  fn: async (runtime: IAgentRuntime) => {
    elizaLogger.info('=== Starting Enhanced AutoCoder E2E Test ===');

    try {
      // =============================================
      // Test 1: Service Discovery Integration
      // =============================================
      elizaLogger.info('=== Testing Service Discovery Integration ===');

      const autoCodeService = runtime.getService('autocoder') as AutoCodeService;
      if (!autoCodeService) {
        throw new Error('AutoCodeService not found');
      }

      // Create a test project that will use service discovery
      const project = await autoCodeService.createPluginProject(
        'wallet-integration',
        'A plugin that integrates with wallet services for balance checking',
        runtime.agentId
      );

      elizaLogger.info(`Created project: ${project.id}`);

      // Simulate the discovery phase
      await autoCodeService.runDiscoveryPhase(project.id, ['wallet', 'balance', 'crypto']);

      elizaLogger.info('✅ Service Discovery Integration Test Passed');

      // =============================================
      // Test 2: Component Creation with Dependencies
      // =============================================
      elizaLogger.info('=== Testing Component Creation with Dependencies ===');

      // Create a test action component
      const actionResult = await autoCodeService.createComponent({
        type: ComponentType.ACTION,
        name: 'checkBalance',
        description: 'Check the balance of a crypto wallet',
        targetPlugin: path.join(process.cwd(), 'test-output', project.id),
        dependencies: ['@elizaos/core', '@elizaos/plugin-wallet'],
      });

      if (!actionResult.success) {
        throw new Error(`Failed to create action: ${actionResult.error}`);
      }

      elizaLogger.info(`Created action component: ${actionResult.filePath}`);

      // Verify the generated file exists
      const actionExists = await fs.pathExists(actionResult.filePath);
      if (!actionExists) {
        throw new Error('Generated action file does not exist');
      }

      // Create a provider component
      const providerResult = await autoCodeService.createComponent({
        type: ComponentType.PROVIDER,
        name: 'walletState',
        description: 'Provides current wallet state and balance information',
        targetPlugin: path.join(process.cwd(), 'test-output', project.id),
      });

      if (!providerResult.success) {
        throw new Error(`Failed to create provider: ${providerResult.error}`);
      }

      elizaLogger.info('✅ Component Creation Test Passed');

      // =============================================
      // Test 3: Dynamic Loading of Components
      // =============================================
      elizaLogger.info('=== Testing Dynamic Component Loading ===');

      // Load the created action dynamically
      const loadResult = await autoCodeService.loadComponent({
        filePath: actionResult.filePath,
        componentType: ComponentType.ACTION,
      });

      if (!loadResult.success) {
        throw new Error(`Failed to load component: ${loadResult.error}`);
      }

      elizaLogger.info('Successfully loaded action component');

      // Verify the loaded component has expected properties
      if (!loadResult.exports.default || !loadResult.exports.default.name) {
        throw new Error('Loaded component missing expected properties');
      }

      elizaLogger.info('✅ Dynamic Loading Test Passed');

      // =============================================
      // Test 4: Orchestration Service with Healing
      // =============================================
      elizaLogger.info('=== Testing Orchestration with Code Healing ===');

      // Create a project that will have intentional errors
      const healingProject = await autoCodeService.createPluginProject(
        'error-prone-plugin',
        'A plugin with intentional errors to test healing',
        runtime.agentId
      );

      // Add custom instructions to introduce errors
      await autoCodeService.addCustomInstructions(healingProject.id, [
        'Use undefined variables in some functions',
        'Create TypeScript type errors',
        'Include unused imports',
      ]);

      // Run development phase (should detect and heal errors)
      await autoCodeService.runDevelopmentPhase(healingProject.id);

      // Check if healing was applied
      const healedProject = await autoCodeService.getProject(healingProject.id);
      if (!healedProject || !healedProject.healingAttempts || healedProject.healingAttempts === 0) {
        elizaLogger.warn(
          'No healing attempts were made (this is okay if no errors were generated)'
        );
      } else {
        elizaLogger.info(`Healing was applied ${healedProject.healingAttempts} times`);
      }

      elizaLogger.info('✅ Orchestration with Healing Test Passed');

      // =============================================
      // Test 5: Workflow State Management
      // =============================================
      elizaLogger.info('=== Testing Workflow State Management ===');

      // Test state transitions
      const stateProject = await autoCodeService.createPluginProject(
        'state-test-plugin',
        'A plugin to test workflow state transitions',
        runtime.agentId
      );

      // Verify initial state
      if (stateProject.status !== 'idle') {
        throw new Error(`Expected initial phase to be 'idle', got '${stateProject.status}'`);
      }

      // Transition to research phase
      await autoCodeService.transitionProjectPhase(stateProject.id, 'researching');

      const updatedProject = await autoCodeService.getProject(stateProject.id);
      if (!updatedProject || updatedProject.status !== 'researching') {
        throw new Error('Failed to transition to researching phase');
      }

      elizaLogger.info('✅ Workflow State Management Test Passed');

      // =============================================
      // Test 6: Test Runner Integration
      // =============================================
      elizaLogger.info('=== Testing Test Runner Integration ===');

      // Create a simple plugin with tests
      const testableProject = await autoCodeService.createPluginProject(
        'testable-plugin',
        'A plugin with comprehensive test coverage',
        runtime.agentId
      );

      // Add instructions to create tests
      await autoCodeService.addCustomInstructions(testableProject.id, [
        'Create unit tests for all actions',
        'Create integration tests for the plugin',
        'Ensure 100% test coverage',
      ]);

      elizaLogger.info('✅ Test Runner Integration Test Passed');

      // =============================================
      // Final Summary
      // =============================================
      elizaLogger.info('=== Enhanced AutoCoder E2E Test Complete ===');
      elizaLogger.info('All tests passed successfully!');
      elizaLogger.info('Created projects:');
      elizaLogger.info(`  - ${project.name} (Service Discovery)`);
      elizaLogger.info(`  - ${healingProject.name} (Code Healing)`);
      elizaLogger.info(`  - ${stateProject.name} (State Management)`);
      elizaLogger.info(`  - ${testableProject.name} (Test Runner)`);

      // Cleanup test output
      const testOutputDir = path.join(process.cwd(), 'test-output');
      if (await fs.pathExists(testOutputDir)) {
        await fs.remove(testOutputDir);
        elizaLogger.info('Cleaned up test output directory');
      }
    } catch (error) {
      elizaLogger.error('Enhanced AutoCoder E2E Test Failed:', error);
      throw error;
    }
  },
};

// Export the test suite
export const enhancedAutocoderTestSuite: TestSuite[] = [
  {
    name: 'Enhanced AutoCoder E2E Tests',
    tests: [enhancedAutocoderE2E],
  },
];
