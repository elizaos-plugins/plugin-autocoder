import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { logger as elizaLogger } from '@elizaos/core';
import { SWEBenchRunner } from './swe-bench-runner.ts';
import type { BenchmarkOptions } from './types';

export const runSWEBenchAction: Action = {
  name: 'RUN_SWE_BENCH',
  similes: ['EVALUATE_SWE_BENCH', 'START_BENCHMARK', 'TEST_CODING'],
  description: 'Run SWE-bench evaluation on coding tasks',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return text.includes('swe') && text.includes('bench') || 
           text.includes('coding') && text.includes('benchmark') ||
           text.includes('evaluate') && text.includes('coding');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ) => {
    try {
      const text = message.content.text || '';
      elizaLogger.info('[SWE-BENCH] Starting SWE-bench evaluation');

      // Parse instance IDs from command if provided
      const instanceIds = text.match(/instance[_-]ids?:\s*([^\s,]+(?:,\s*[^\s,]+)*)/i)?.[1]
        ?.split(',')
        .map(id => id.trim())
        .filter(id => id) || [];

      // Extract max instances if specified
      const maxInstancesMatch = text.match(/max[_-]?instances?:\s*(\d+)/i);
      const maxInstances = maxInstancesMatch ? maxInstancesMatch[1] : '5';

      const options: BenchmarkOptions = {
        instance_ids: instanceIds.length > 0 ? instanceIds : undefined,
        max_instances: parseInt(maxInstances) || 5,
        language_filter: ['TypeScript', 'JavaScript'],
        save_artifacts: true,
        verbose: text.includes('verbose') || text.includes('detailed'),
        skip_evaluation: text.includes('skip eval'),
        docker_enabled: false,
        timeout_per_instance: 600000 // 10 minutes per instance
      };

      if (instanceIds.length > 0) {
        elizaLogger.info(`[SWE-BENCH] Running specific instances: ${instanceIds.join(', ')}`);
      }

      // Initialize runner
      const runner = new SWEBenchRunner(runtime);
      await runner.initialize();

      // Run benchmark
      const results = await runner.runBenchmark(options);

      const responseText = `SWE-bench evaluation completed. Results: ${JSON.stringify(results, null, 2)}`;

      if (callback) {
        await callback({
          text: responseText,
          actions: ['RUN_SWE_BENCH'],
        });
      }

      return { text: responseText, success: true };
    } catch (error) {
      const errorMessage = `SWE-bench evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      elizaLogger.error('[SWE-BENCH] Error:', error);

      if (callback) {
        await callback({
          text: errorMessage,
          error: true,
        });
      }

      return { text: errorMessage, success: false };
    }
  },

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Run SWE-bench evaluation',
        },
      },
      {
        name: 'agent',
        content: {
          text: 'Starting SWE-bench evaluation...',
          actions: ['RUN_SWE_BENCH'],
        },
      },
    ],
  ],
};

export const getSWEBenchStatsAction: Action = {
  name: 'GET_SWE_BENCH_STATS',
  similes: ['SWE_BENCH_RESULTS', 'BENCHMARK_STATS'],
  description: 'Get SWE-bench statistics and results',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return (text.includes('swe') && text.includes('stats')) ||
           (text.includes('benchmark') && text.includes('results'));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ) => {
    try {
      const runner = new SWEBenchRunner(runtime);
      // Since getStats might not exist, we'll provide a placeholder
      const stats = { message: 'SWE-bench stats not available' };

      const responseText = `SWE-bench Statistics: ${JSON.stringify(stats, null, 2)}`;

      if (callback) {
        await callback({
          text: responseText,
          actions: ['GET_SWE_BENCH_STATS'],
        });
      }

      return { text: responseText, success: true };
    } catch (error) {
      const errorMessage = `Failed to get SWE-bench stats: ${error instanceof Error ? error.message : 'Unknown error'}`;
      elizaLogger.error('[SWE-BENCH] Stats error:', error);

      if (callback) {
        await callback({
          text: errorMessage,
          error: true,
        });
      }

      return { text: errorMessage, success: false };
    }
  },

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Show me SWE-bench stats',
        },
      },
      {
        name: 'agent',
        content: {
          text: 'Here are the SWE-bench statistics...',
          actions: ['GET_SWE_BENCH_STATS'],
        },
      },
    ],
  ],
};

function extractInstanceIds(text: string): string[] {
  const instancePattern = /instance[_\s]*id[:\s]*([a-zA-Z0-9_-]+)/gi;
  const matches = Array.from(text.matchAll(instancePattern));
  return matches.map(match => match[1]).filter(Boolean);
}