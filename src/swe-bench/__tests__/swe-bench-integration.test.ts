import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SWEBenchRunner } from '../swe-bench-runner';
import { SWEBenchDataLoader } from '../data-loader';
import type { IAgentRuntime } from '@elizaos/core';

// Only run SWE-bench tests when explicitly enabled
const RUN_SWE_BENCH = process.env.RUN_SWE_BENCH === 'true';

describe.skipIf(!RUN_SWE_BENCH)('SWE-bench Integration', () => {
  let mockRuntime: IAgentRuntime;
  let runner: SWEBenchRunner;

  beforeAll(() => {
    // Create a mock runtime with necessary settings
    mockRuntime = {
      getSetting: (key: string) => {
        if (key === 'ANTHROPIC_API_KEY') {
          return process.env.ANTHROPIC_API_KEY;
        }
        return undefined;
      },
      agentId: 'test-agent',
      character: {
        name: 'TestAgent',
        bio: ['Test agent for SWE-bench'],
        knowledge: [],
        messageExamples: [],
        postExamples: [],
        topics: [],
        adjectives: [],
        clients: [],
        plugins: []
      }
    } as unknown as IAgentRuntime;

    runner = new SWEBenchRunner(mockRuntime, {
      docker_enabled: false,
      max_parallel_instances: 1,
      cleanup_after_run: true
    });
  });

  it('should initialize successfully', async () => {
    await runner.initialize();
    expect(runner).toBeDefined();
  });

  it('should load dataset statistics', async () => {
    await runner.initialize();
    const stats = await runner.getDatasetStats();
    
    expect(stats).toBeDefined();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.byLanguage).toBeDefined();
    expect(stats.byLanguage['TypeScript'] || stats.byLanguage['JavaScript']).toBeGreaterThan(0);
  });

  it('should run a single TypeScript instance', async () => {
    // Skip if no API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping SWE-bench run test - no ANTHROPIC_API_KEY');
      return;
    }

    await runner.initialize();
    
    // Run on a single instance
    const report = await runner.runBenchmark({
      max_instances: 1,
      language_filter: ['TypeScript'],
      save_artifacts: true,
      skip_evaluation: true // Skip Python evaluation for unit tests
    });
    
    expect(report).toBeDefined();
    expect(report.results).toBeDefined();
    expect(report.results.total_instances).toBe(1);
    expect(report.results.per_instance_results).toHaveLength(1);
    
    const result = report.results.per_instance_results[0];
    expect(result.instance_id).toBeDefined();
    expect(result.execution_time).toBeGreaterThan(0);
    
    console.log(`Instance ${result.instance_id}: ${result.resolved ? 'RESOLVED' : 'FAILED'}`);
    console.log(`Execution time: ${(result.execution_time / 1000).toFixed(1)}s`);
  }, 300000); // 5 minute timeout

  it('should handle specific instance IDs', async () => {
    await runner.initialize();
    
    // Use a sample instance ID
    const report = await runner.runBenchmark({
      instance_ids: ['microsoft__TypeScript-12345'],
      save_artifacts: false,
      skip_evaluation: true
    });
    
    expect(report.results.total_instances).toBeLessThanOrEqual(1);
    if (report.results.total_instances > 0) {
      expect(report.results.per_instance_results[0].instance_id).toBe('microsoft__TypeScript-12345');
    }
  });

  afterAll(async () => {
    // Cleanup is handled by the runner
  });
});

// Performance benchmark test
describe.skipIf(!RUN_SWE_BENCH || !process.env.SWE_BENCH_FULL)('SWE-bench Full Benchmark', () => {
  let mockRuntime: IAgentRuntime;
  let runner: SWEBenchRunner;

  beforeAll(() => {
    mockRuntime = {
      getSetting: (key: string) => {
        if (key === 'ANTHROPIC_API_KEY') {
          return process.env.ANTHROPIC_API_KEY;
        }
        return undefined;
      },
      agentId: 'benchmark-agent',
      character: {
        name: 'BenchmarkAgent',
        bio: ['Benchmark agent for SWE-bench'],
        knowledge: [],
        messageExamples: [],
        postExamples: [],
        topics: [],
        adjectives: [],
        clients: [],
        plugins: ['@elizaos/plugin-sql']
      }
    } as unknown as IAgentRuntime;

    runner = new SWEBenchRunner(mockRuntime, {
      docker_enabled: process.env.SWE_BENCH_DOCKER === 'true',
      max_parallel_instances: parseInt(process.env.SWE_BENCH_PARALLEL || '1'),
      cleanup_after_run: true
    });
  });

  it('should run full benchmark', async () => {
    await runner.initialize();
    
    const maxInstances = parseInt(process.env.SWE_BENCH_MAX || '10');
    
    const report = await runner.runBenchmark({
      max_instances: maxInstances,
      language_filter: ['TypeScript', 'JavaScript'],
      save_artifacts: true,
      skip_evaluation: false
    });
    
    // Log results
    console.log('\n=== SWE-BENCH FULL BENCHMARK RESULTS ===');
    console.log(`Total Instances: ${report.results.total_instances}`);
    console.log(`Resolved: ${report.results.resolved_instances} (${(report.results.resolution_rate * 100).toFixed(1)}%)`);
    console.log(`Compilation Success: ${(report.results.compilation_success_rate * 100).toFixed(1)}%`);
    console.log(`Test Pass Rate: ${(report.results.test_pass_rate * 100).toFixed(1)}%`);
    console.log(`Average Time: ${(report.results.summary.avg_execution_time / 1000).toFixed(1)}s`);
    console.log(`Total Cost: $${report.results.summary.total_cost.toFixed(2)}`);
    console.log('\nSuccess by Complexity:');
    Object.entries(report.results.summary.success_by_complexity).forEach(([complexity, rate]) => {
      console.log(`  ${complexity}: ${((rate as number) * 100).toFixed(1)}%`);
    });
    
    // Save detailed results
    const fs = await import('fs/promises');
    const resultsPath = `swe-bench-results-${Date.now()}.json`;
    await fs.writeFile(resultsPath, JSON.stringify(report, null, 2));
    console.log(`\nDetailed results saved to: ${resultsPath}`);
    
    // Assertions
    expect(report.results.resolution_rate).toBeGreaterThanOrEqual(0);
    expect(report.results.resolution_rate).toBeLessThanOrEqual(1);
  }, 7200000); // 2 hour timeout
}); 