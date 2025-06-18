import type { Plugin } from '@elizaos/core';
import { orchestrationActions } from './actions/orchestration-actions.ts';
import comprehensivePluginScenarios from './e2e/comprehensive-plugin-scenarios.ts';
import { enhancedAutocoderTestSuite } from './e2e/enhanced-autocoder-e2e.ts';
import orchestrationScenarioTests from './e2e/orchestration-scenarios.ts';
import publishingScenarios from './e2e/publishing-scenarios.ts';
import testRealOrchestration from './e2e/test-real-orchestration.ts';
import weatherPluginScenario from './e2e/weather-plugin-scenario.ts';
import benchmarkE2ETestSuite from './e2e/benchmark-e2e.ts';
import { orchestrationProviders } from './providers/orchestration-providers.ts';
import { AutoCodeService } from './services/autocode-service.ts';

// Export the plugin
export const pluginAutocoderPlugin: Plugin = {
  name: '@elizaos/plugin-autocoder',
  description: 'Self-improving agent system with dynamic plugin creation and orchestration',
  actions: [...orchestrationActions],
  providers: [...orchestrationProviders],
  services: [AutoCodeService],
  evaluators: [],
  tests: [
    orchestrationScenarioTests,
    testRealOrchestration,
    weatherPluginScenario,
    comprehensivePluginScenarios,
    publishingScenarios,
    benchmarkE2ETestSuite,
    ...enhancedAutocoderTestSuite,
  ],
};

// Default export
export default pluginAutocoderPlugin;
