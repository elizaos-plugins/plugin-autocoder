import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionExample,
} from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { BenchmarkRunner } from '../benchmarks/benchmark-runner';
import { getBenchmarkScenarioIds } from '../benchmarks/scenarios';
import * as path from 'path';

/**
 * Action to run AutoCoder benchmarks
 */
export const runBenchmarkAction: Action = {
  name: 'RUN_BENCHMARK',
  similes: ['benchmark', 'test performance', 'measure autocoder', 'run benchmarks'],
  description: 'Run performance benchmarks for the AutoCoder plugin',

  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'Run benchmarks for the autocoder' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll run the AutoCoder benchmarks to measure performance and quality.",
          actions: ['RUN_BENCHMARK'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'Test the autocoder performance on the simple action scenario' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll run the benchmark for the simple action scenario.",
          actions: ['RUN_BENCHMARK'],
        },
      },
    ],
  ] as ActionExample[][],

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    // Check if orchestration service is available
    const orchestrationService = runtime.getService('orchestration');
    if (!orchestrationService) {
      return false;
    }

    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ) => {
    try {
      elizaLogger.info('[BENCHMARK] Starting benchmark execution');

      // Parse scenario from message
      const messageText = message.content.text?.toLowerCase() || '';
      const availableScenarios = getBenchmarkScenarioIds();
      let selectedScenarios: string[] = [];

      // Check if specific scenario mentioned
      for (const scenarioId of availableScenarios) {
        if (messageText.includes(scenarioId.replace('-', ' '))) {
          selectedScenarios.push(scenarioId);
        }
      }

      // If no specific scenario, run all
      if (selectedScenarios.length === 0) {
        selectedScenarios = availableScenarios;
      }

      // Configure benchmark
      const outputDir = path.join(
        process.cwd(),
        'benchmarks',
        'results',
        new Date().toISOString().split('T')[0]
      );
      const config = {
        outputDir,
        scenarios: selectedScenarios
          .map((id) => {
            const { benchmarkScenarios } = require('../benchmarks/scenarios');
            return benchmarkScenarios.find((s: any) => s.id === id);
          })
          .filter(Boolean),
        verbose: true,
        saveArtifacts: true,
      };

      // Create benchmark runner
      const runner = new BenchmarkRunner(runtime, config);

      // Notify start
      if (callback) {
        await callback({
          text: `Starting AutoCoder benchmarks for ${selectedScenarios.length} scenario(s):\n${selectedScenarios.map((s) => `- ${s}`).join('\n')}\n\nThis may take several minutes...`,
          actions: ['RUN_BENCHMARK'],
        });
      }

      // Run benchmarks
      const results = await runner.runAll();

      // Prepare summary
      const passed = results.filter((r) => r.success).length;
      const total = results.length;
      const successRate = ((passed / total) * 100).toFixed(1);
      const totalDuration = results.reduce((sum, r) => sum + r.metrics.totalDuration, 0);
      const totalTokens = results.reduce((sum, r) => sum + r.metrics.tokenUsage.total, 0);
      const totalCost = results.reduce((sum, r) => sum + r.metrics.tokenUsage.cost, 0);

      let summary = `## Benchmark Results\n\n`;
      summary += `✅ **Success Rate**: ${passed}/${total} (${successRate}%)\n`;
      summary += `⏱️ **Total Duration**: ${formatDuration(totalDuration)}\n`;
      summary += `🔤 **Total Tokens**: ${totalTokens.toLocaleString()}\n`;
      summary += `💰 **Total Cost**: $${totalCost.toFixed(2)}\n\n`;

      summary += `### Scenario Results:\n`;
      for (const result of results) {
        const status = result.success ? '✅' : '❌';
        summary += `\n**${result.scenarioId}**: ${status}\n`;
        summary += `- Duration: ${formatDuration(result.metrics.totalDuration)}\n`;
        summary += `- Iterations: ${result.metrics.iterationCount}\n`;
        summary += `- Requirements Coverage: ${result.metrics.requirementsCoverage.toFixed(1)}%\n`;

        if (!result.success) {
          if (result.validation.details.requirementsMissed.length > 0) {
            summary += `- Missing: ${result.validation.details.requirementsMissed.join(', ')}\n`;
          }
          if (result.validation.details.performanceIssues.length > 0) {
            summary += `- Issues: ${result.validation.details.performanceIssues.join(', ')}\n`;
          }
        }
      }

      summary += `\n📊 Full report saved to: ${outputDir}`;

      elizaLogger.info('[BENCHMARK] Benchmark execution completed', {
        passed,
        total,
        successRate,
        outputDir,
      });

      if (callback) {
        await callback({
          text: summary,
          actions: ['RUN_BENCHMARK'],
        });
      }

      return {
        success: true,
        data: {
          results,
          outputDir,
        },
      };
    } catch (error) {
      elizaLogger.error('[BENCHMARK] Benchmark execution failed:', error);

      if (callback) {
        await callback({
          text: `❌ Benchmark execution failed: ${error.message || error}`,
          actions: ['RUN_BENCHMARK'],
        });
      }

      return {
        success: false,
        error: error.message || error,
      };
    }
  },
};

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}
