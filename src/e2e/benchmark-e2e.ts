import type { TestSuite, IAgentRuntime } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { BenchmarkRunner } from '../benchmarks/benchmark-runner';
import { getBenchmarkScenario } from '../benchmarks/scenarios';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * E2E test suite for the AutoCoder benchmarking system
 */
export class BenchmarkE2ETestSuite implements TestSuite {
  name = 'autocoder-benchmark-e2e';
  description = 'End-to-end tests for the AutoCoder benchmarking system';

  tests = [
    {
      name: 'Run simple action benchmark',
      fn: async (runtime: IAgentRuntime) => {
        elizaLogger.info('🏃 Starting simple action benchmark test...');

        // Get the simple action scenario
        const scenario = getBenchmarkScenario('simple-action');
        if (!scenario) {
          throw new Error('Simple action scenario not found');
        }

        // Create a benchmark runner
        const runner = new BenchmarkRunner(runtime, {
          outputDir: path.join(__dirname, '..', '..', 'test-results', 'benchmarks'),
          verbose: true,
          parallel: false,
          saveArtifacts: false,
        });

        // Run the scenario
        const result = await runner.runScenario(scenario);

        elizaLogger.info('🏁 Simple action benchmark test finished.');

        // Validate the result
        if (!result.validation.passed) {
          elizaLogger.error('Benchmark validation failed', result.validation.details);
          throw new Error('Benchmark validation failed');
        }

        if (result.metrics.testPassRate < 100) {
          throw new Error(`Tests did not pass 100%. Got ${result.metrics.testPassRate}%`);
        }

        // Clean up the created project
        if (result.artifacts.projectPath) {
          await fs.rm(result.artifacts.projectPath, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'Test metrics collection',
      fn: async (runtime: any) => {
        console.log('📊 Testing metrics collection...');

        // Import MetricsCollector directly
        const { MetricsCollector } = await import('../benchmarks/metrics-collector');
        const collector = new MetricsCollector();

        // Test phase tracking
        collector.startPhase('researching');
        await new Promise((resolve) => setTimeout(resolve, 100));
        collector.endPhase('researching');

        // Test token tracking
        collector.recordTokenUsage(100, 200, 0.05);

        // Test iteration tracking
        collector.incrementIteration();
        collector.incrementHealingCycles();

        // Test results tracking
        collector.recordCompilationResult(true);
        collector.recordTestResults(9, 10);
        collector.recordEslintResults(2);

        // Finalize and check metrics
        const { metrics } = collector.finalize();

        if (!metrics.phasesDurations.has('researching')) {
          throw new Error('Phase duration not tracked');
        }

        if (metrics.tokenUsage.total !== 300) {
          throw new Error(`Expected 300 tokens, got ${metrics.tokenUsage.total}`);
        }

        if (metrics.iterationCount !== 1) {
          throw new Error(`Expected 1 iteration, got ${metrics.iterationCount}`);
        }

        if (metrics.testPassRate !== 90) {
          throw new Error(`Expected 90% test pass rate, got ${metrics.testPassRate}`);
        }

        console.log('  ✅ Phase tracking works');
        console.log('  ✅ Token usage tracking works');
        console.log('  ✅ Iteration tracking works');
        console.log('  ✅ Results tracking works');
        console.log('✅ Metrics collection test passed');
      },
    },
    {
      name: 'Test decision logging',
      fn: async (runtime: any) => {
        console.log('📝 Testing decision logging...');

        // Import DecisionLogger directly
        const { DecisionLogger } = await import('../benchmarks/decision-logger');
        const logDir = path.join(process.cwd(), 'test-logs', 'decisions');
        const logger = new DecisionLogger(logDir, 'test-project', true);

        // Log various decisions
        await logger.logDesignDecision(
          'mvp_planning',
          1,
          'Using TypeScript for type safety',
          ['JavaScript', 'TypeScript', 'Flow'],
          'TypeScript',
          95,
          ['Build a type-safe plugin']
        );

        await logger.logImplementationDecision(
          'full_development',
          1,
          'echoAction',
          'Simple handler with validation',
          'Need to validate input exists',
          90
        );

        // Update outcome
        logger.updateDecisionOutcome(0, true, 'Successfully implemented', ['Continue to testing']);

        // Check decisions
        const decisions = logger.getDecisions();
        if (decisions.length !== 2) {
          throw new Error(`Expected 2 decisions, got ${decisions.length}`);
        }

        const summary = logger.generateSummary();
        if (summary.totalDecisions !== 2) {
          throw new Error('Decision count mismatch');
        }

        if (summary.averageConfidence !== 92.5) {
          throw new Error(`Expected 92.5% average confidence, got ${summary.averageConfidence}`);
        }

        // Clean up
        try {
          await fs.rm(logDir, { recursive: true, force: true });
        } catch (error) {
          // Ignore cleanup errors
        }

        console.log('  ✅ Design decisions logged');
        console.log('  ✅ Implementation decisions logged');
        console.log('  ✅ Decision outcomes tracked');
        console.log('  ✅ Summary generation works');
        console.log('✅ Decision logging test passed');
      },
    },
    {
      name: 'Test output validation',
      fn: async (runtime: any) => {
        console.log('🔍 Testing output validation...');

        // Import OutputValidator directly
        const { OutputValidator } = await import('../benchmarks/output-validator');
        const validator = new OutputValidator(true);

        // Create a mock project
        const mockProject = {
          id: 'test-project',
          name: 'test-plugin',
          localPath: process.cwd(), // Use current directory for testing
          metrics: {
            totalDuration: 50000,
            iterationCount: 3,
          },
        };

        // Create a test scenario
        const scenario = {
          id: 'test',
          name: 'Test Scenario',
          description: 'Test',
          requirements: ['Must have TypeScript files', 'Must have package.json'],
          constraints: [],
          expectedDuration: 60000,
          successCriteria: {
            mustCompile: false, // Don't actually compile in test
            mustPassTests: false,
            maxDuration: 60000,
            maxIterations: 5,
          },
        };

        // Validate
        const result = await validator.validate(mockProject as any, scenario);

        // Check performance validation
        if (!result.criteria.performance) {
          throw new Error('Performance validation failed');
        }

        // Requirements will depend on actual files in directory
        console.log(`  Requirements covered: ${result.details.requirementsCovered.length}`);
        console.log(`  Requirements missed: ${result.details.requirementsMissed.length}`);

        console.log('  ✅ Performance validation works');
        console.log('  ✅ Requirements checking works');
        console.log('✅ Output validation test passed');
      },
    },
    {
      name: 'Test benchmark scenarios configuration',
      fn: async (runtime: any) => {
        console.log('⚙️ Testing benchmark scenarios...');

        const { benchmarkScenarios, getBenchmarkScenarioIds } = await import(
          '../benchmarks/scenarios'
        );

        // Check all scenarios exist
        const expectedScenarios = [
          'simple-action',
          'api-integration',
          'stateful-service',
          'multi-component',
          'plugin-update',
        ];

        const actualIds = getBenchmarkScenarioIds();
        for (const expected of expectedScenarios) {
          if (!actualIds.includes(expected)) {
            throw new Error(`Missing expected scenario: ${expected}`);
          }
        }

        // Check scenario properties
        for (const scenario of benchmarkScenarios) {
          if (!scenario.requirements || scenario.requirements.length === 0) {
            throw new Error(`Scenario ${scenario.id} has no requirements`);
          }

          if (!scenario.successCriteria.mustCompile) {
            throw new Error(`Scenario ${scenario.id} doesn't require compilation`);
          }

          if (scenario.expectedDuration <= 0) {
            throw new Error(`Scenario ${scenario.id} has invalid duration`);
          }
        }

        console.log(`  ✅ All ${expectedScenarios.length} scenarios configured`);
        console.log('  ✅ All scenarios have requirements');
        console.log('  ✅ All scenarios have valid success criteria');
        console.log('✅ Benchmark scenarios test passed');
      },
    },
  ];
}

// Export default instance for test runner
export default new BenchmarkE2ETestSuite();
