import { elizaLogger, type IAgentRuntime, type Memory, type State, type ActionResult, type Action, type Content } from '@elizaos/core';
import { SWEBenchRunner } from '../swe-bench/swe-bench-runner';
import type { BenchmarkOptions } from '../swe-bench/types';

function parseBenchmarkOptions(text: string): BenchmarkOptions {
  const options: BenchmarkOptions = {};
  const instancesMatch = text.match(/(all|\d+)\s+(?:typescript|javascript|ts|js)\s+instances?/i);
  if (instancesMatch) {
    const value = instancesMatch[1].toLowerCase();
    if (value === 'all') {
      // Don't set max_instances to run all available instances
      options.language_filter = ['TypeScript', 'JavaScript'];
    } else {
      options.max_instances = parseInt(value, 10);
      options.language_filter = ['TypeScript', 'JavaScript'];
    }
  }
  return options;
}

/**
 * Extract specific instance IDs from the message text
 */
function extractInstanceIds(text: string): string[] {
  const instanceIds: string[] = [];
  
  // Match patterns like "axios__axios-5919" or "microsoft__TypeScript-12345"
  const instancePattern = /([a-zA-Z0-9-_]+__[a-zA-Z0-9-_]+)/g;
  const matches = text.match(instancePattern);
  
  if (matches) {
    instanceIds.push(...matches);
  }
  
  return instanceIds;
}

export const runSWEBenchAction: Action = {
  name: 'RUN_SWE_BENCH',
  similes: [
    'run swe-bench',
    'evaluate on swe-bench',
    'benchmark typescript fixes',
    'test code generation capabilities',
    'run multi-swe-bench evaluation'
  ],
  description: 'Run Multi-SWE-bench evaluation on TypeScript/JavaScript instances',
  
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    // Check if we're in testing/development mode
    const isTestMode = process.env.ELIZA_TESTING === 'true' || 
                       process.env.NODE_ENV === 'test' ||
                       process.env.SWE_BENCH_ENABLED === 'true';
    
    if (!isTestMode) {
      elizaLogger.debug('[SWE-BENCH] SWE-bench action disabled - not in test mode');
      return false;
    }
    
    // Check if API key is configured
    const apiKey = runtime.getSetting('ANTHROPIC_API_KEY');
    if (!apiKey) {
      elizaLogger.warn('[SWE-BENCH] Anthropic API key not configured');
      return false;
    }
    
    // Check if the message is requesting SWE-bench evaluation
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('swe-bench') || text.includes('benchmark') || text.includes('evaluate');
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: { [key: string]: unknown }, callback?: (response: Content) => Promise<any[]>) => {
    try {
      const text = message.content.text || '';
      
      // Extract specific instance IDs if provided
      const instanceIds = extractInstanceIds(text);
      
      elizaLogger.info('[SWE-BENCH] Starting SWE-bench evaluation');
      if (instanceIds.length > 0) {
        elizaLogger.info(`[SWE-BENCH] Running specific instances: ${instanceIds.join(', ')}`);
      }
      
      // Parse other options
      const parsedOptions = parseBenchmarkOptions(text);
      
      // If specific instances are requested, override max_instances
      if (instanceIds.length > 0) {
        parsedOptions.instance_ids = instanceIds;
        parsedOptions.max_instances = instanceIds.length;
      }
      
      const runner = new SWEBenchRunner(runtime, parsedOptions);
      await runner.initialize();
      const report = await runner.runBenchmark(parsedOptions);

      const responseText = `SWE-bench run complete. Report available at: ${report.logs_dir}`;
      if (callback) {
        await callback({ text: responseText });
      }
      return { text: responseText };
    } catch (error: any) {
      elizaLogger.error(`[SWE-BENCH] Critical action error: ${error.message}`);
      elizaLogger.error(`[SWE-BENCH] Stack: ${error.stack}`);
      const errorText = `Error during SWE-bench evaluation: ${error.message}`;
      if (callback) {
        await callback({ text: errorText });
      }
      return { text: errorText };
    }
  }
};

/**
 * Format dataset statistics response
 */
function formatStatsResponse(stats: any): string {
  return `📊 **Multi-SWE-bench Dataset Statistics**

**Total Instances**: ${stats.total}

**By Language**:
${Object.entries(stats.byLanguage)
  .sort((a, b) => (b[1] as number) - (a[1] as number))
  .map(([lang, count]) => `- ${lang}: ${count}`)
  .join('\n')}

**Top Repositories**:
${Object.entries(stats.byRepo)
  .sort((a, b) => (b[1] as number) - (a[1] as number))
  .slice(0, 10)
  .map(([repo, count]) => `- ${repo}: ${count}`)
  .join('\n')}

**Test Coverage**:
- With tests: ${stats.withTests} (${((stats.withTests / stats.total) * 100).toFixed(1)}%)
- Without tests: ${stats.withoutTests} (${((stats.withoutTests / stats.total) * 100).toFixed(1)}%)

To run evaluation on specific instances, use:
- "Run SWE-bench on 5 instances" - Run on 5 random TypeScript/JavaScript instances
- "Run SWE-bench on microsoft/TypeScript" - Filter by repository
- "Run SWE-bench on easy instances" - Filter by complexity
- "Run SWE-bench instance: typescript-test-001" - Run specific instance`;
}

/**
 * Format benchmark summary for response
 */
function formatBenchmarkSummary(report: any): string {
  const results = report.results;
  const duration = (report.duration / 1000 / 60).toFixed(2);
  
  return `✅ **SWE-bench Evaluation Complete**

**Summary**:
- Duration: ${duration} minutes
- Total Instances: ${results.total_instances}
- Resolved: ${results.resolved_instances} (${(results.resolution_rate * 100).toFixed(1)}%)
- Compilation Success: ${(results.compilation_success_rate * 100).toFixed(1)}%
- Test Pass Rate: ${(results.test_pass_rate * 100).toFixed(1)}%

**Performance**:
- Avg Execution Time: ${(results.summary.avg_execution_time / 1000).toFixed(1)}s per instance
- Total Cost: $${results.summary.total_cost.toFixed(2)}

**Success by Complexity**:
${Object.entries(results.summary.success_by_complexity)
  .map(([complexity, rate]) => `- ${complexity}: ${((rate as number) * 100).toFixed(1)}%`)
  .join('\n')}

${results.summary.common_errors.length > 0 ? `
**Common Issues**:
${results.summary.common_errors.map(e => `- ${e.error}: ${e.count} occurrences`).join('\n')}
` : ''}

**Top Results**:
${results.per_instance_results
  .slice(0, 5)
  .map(r => `- ${r.instance_id}: ${r.resolved ? '✅ Resolved' : '❌ Failed'}`)
  .join('\n')}

Full report saved to: ${report.logs_dir || '.swe-bench-work/reports'}`;
}

export const getSWEBenchStatsAction: Action = {
  name: 'GET_SWE_BENCH_STATS',
  similes: [
    'swe-bench stats',
    'show benchmark dataset',
    'list swe-bench instances',
    'benchmark statistics'
  ],
  description: 'Get statistics about the Multi-SWE-bench dataset',
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    // Check if we're in testing/development mode
    const isTestMode = process.env.ELIZA_TESTING === 'true' || 
                       process.env.NODE_ENV === 'test' ||
                       process.env.SWE_BENCH_ENABLED === 'true';
    
    if (!isTestMode) {
      elizaLogger.debug('[SWE-BENCH] SWE-bench stats action disabled - not in test mode');
      return false;
    }
    
    const text = message.content.text?.toLowerCase() || '';
    return (text.includes('swe-bench') || text.includes('benchmark')) && 
           (text.includes('stats') || text.includes('statistics') || text.includes('dataset'));
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: { [key: string]: unknown }, callback?: (response: Content) => Promise<any[]>) => {
    const runner = new SWEBenchRunner(runtime);
    await runner.initialize();
    const stats = await runner.getDatasetStats();
    const responseText = `SWE-bench dataset stats: ${JSON.stringify(stats, null, 2)}`;
    if (callback) {
      await callback({ text: responseText });
    }
    return { text: responseText };
  }
};