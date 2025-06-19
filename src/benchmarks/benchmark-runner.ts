import type { BenchmarkResult, BenchmarkScenario, BenchmarkConfig } from './types';
import type { PluginProject } from '../types/plugin-project';
import type { IAgentRuntime } from '@elizaos/core';
import { MetricsCollector } from './metrics-collector';
import { DecisionLogger } from './decision-logger';
import { OutputValidator } from './output-validator';
import { benchmarkScenarios, getBenchmarkScenario } from './scenarios';
import { OrchestrationManager } from '../managers/orchestration-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Main benchmark runner for AutoCoder
 */
export class BenchmarkRunner {
  private config: BenchmarkConfig;
  private runtime: IAgentRuntime;
  private orchestrationManager: OrchestrationManager;

  constructor(runtime: IAgentRuntime, config: Partial<BenchmarkConfig> = {}) {
    this.runtime = runtime;
    this.config = {
      outputDir: config.outputDir || path.join(process.cwd(), 'benchmarks', 'results'),
      scenarios: config.scenarios || benchmarkScenarios,
      parallel: config.parallel || false,
      verbose: config.verbose || false,
      saveArtifacts: config.saveArtifacts !== false,
      compareBaseline: config.compareBaseline,
    };

    this.orchestrationManager = new OrchestrationManager(runtime);
  }

  /**
   * Initialize the benchmark runner
   */
  async initialize(): Promise<void> {
    // Initialize the orchestration manager
    await this.orchestrationManager.initialize();
  }

  /**
   * Run all configured benchmarks
   */
  async runAll(): Promise<BenchmarkResult[]> {
    console.log(`[BENCHMARK] Starting ${this.config.scenarios.length} benchmark scenarios`);

    // Ensure output directory exists
    await fs.mkdir(this.config.outputDir, { recursive: true });

    const results: BenchmarkResult[] = [];

    if (this.config.parallel) {
      // Run scenarios in parallel
      const promises = this.config.scenarios.map((scenario) =>
        this.runScenario(scenario).catch((error) => {
          console.error(`[BENCHMARK] Scenario ${scenario.id} failed:`, error);
          return this.createFailedResult(scenario, error);
        })
      );

      const parallelResults = await Promise.all(promises);
      results.push(...parallelResults);
    } else {
      // Run scenarios sequentially
      for (const scenario of this.config.scenarios) {
        try {
          const result = await this.runScenario(scenario);
          results.push(result);
        } catch (error) {
          console.error(`[BENCHMARK] Scenario ${scenario.id} failed:`, error);
          results.push(this.createFailedResult(scenario, error));
        }
      }
    }

    // Generate summary report
    await this.generateSummaryReport(results);

    // Compare with baseline if provided
    if (this.config.compareBaseline) {
      await this.compareWithBaseline(results);
    }

    return results;
  }

  /**
   * Run a single benchmark scenario
   */
  async runScenario(scenario: BenchmarkScenario): Promise<BenchmarkResult> {
    console.log(`\n[BENCHMARK] Running scenario: ${scenario.name}`);
    console.log(`  Description: ${scenario.description}`);

    // Initialize tracking
    const metricsCollector = new MetricsCollector();
    const decisionLogger = new DecisionLogger(
      path.join(this.config.outputDir, 'decisions'),
      scenario.id,
      this.config.verbose
    );
    const validator = new OutputValidator(this.config.verbose);

    // Create project
    const project: PluginProject = {
      id: `benchmark-${scenario.id}-${Date.now()}`,
      name: scenario.name,
      description: scenario.description,
      type: 'create',
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
      logs: [],
      userId: this.runtime.agentId,
      userNotifications: [],
      phaseHistory: [],
      currentIteration: 0,
      maxIterations: scenario.successCriteria.maxIterations || 10,
      infiniteMode: false,
      requiredSecrets: [],
      providedSecrets: [],
      errors: [],
      errorAnalysis: new Map(),
      customInstructions: [...scenario.requirements, ...scenario.constraints],
      knowledgeIds: [],
      totalPhases: 10,
      phase: 0,
    };

    try {
      // Inject metrics collector and decision logger
      const instrumentedManager = this.instrumentOrchestrationManager(
        metricsCollector,
        decisionLogger
      );

      // Run the AutoCoder
      const startTime = Date.now();
      metricsCollector.startPhase('full_development');

      // Create plugin project through orchestration manager
      const createdProject = await instrumentedManager.createPluginProject(
        project.name,
        project.description,
        project.userId,
        project.conversationId
      );

      // Add custom instructions based on requirements and constraints
      if (scenario.requirements.length > 0 || scenario.constraints.length > 0) {
        await instrumentedManager.addCustomInstructions(
          createdProject.id,
          [...scenario.requirements, ...scenario.constraints]
        );
      }

      // Wait for completion
      let completedProject = await instrumentedManager.getProject(createdProject.id);
      while (completedProject && completedProject.status !== 'completed' && completedProject.status !== 'failed') {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
        completedProject = await instrumentedManager.getProject(createdProject.id);
      }

      if (!completedProject) {
        throw new Error('Project not found');
      }

      metricsCollector.endPhase('full_development');
      const duration = Date.now() - startTime;

      // Validate output
      const validation = await validator.validate(completedProject, scenario);

      // Finalize metrics
      const { metrics, decisions } = metricsCollector.finalize();

      // Create result
      const result: BenchmarkResult = {
        scenarioId: scenario.id,
        success:
          validation.passed && duration <= (scenario.successCriteria.maxDuration || Infinity),
        metrics,
        decisions,
        validation,
        logs: completedProject.logs,
        artifacts: {
          projectPath: completedProject.localPath,
          generatedFiles: await this.listGeneratedFiles(completedProject),
          testResults: completedProject.testResults,
        },
      };

      // Save results
      await this.saveResult(scenario.id, result);

      // Clean up if not saving artifacts
      if (!this.config.saveArtifacts && completedProject.localPath) {
        await fs.rm(completedProject.localPath, { recursive: true, force: true });
      }

      return result;
    } catch (error) {
      // Finalize metrics even on error
      const { metrics, decisions } = metricsCollector.finalize();

      return {
        scenarioId: scenario.id,
        success: false,
        metrics,
        decisions,
        validation: {
          passed: false,
          criteria: {
            compilation: false,
            tests: false,
            coverage: false,
            performance: false,
            requirements: false,
          },
          details: {
            requirementsCovered: [],
            requirementsMissed: scenario.requirements,
            unexpectedBehaviors: [`Execution error: ${error}`],
            performanceIssues: [],
          },
        },
        logs: project.logs,
        artifacts: {
          generatedFiles: []
        },
      };
    }
  }

  /**
   * Instrument the orchestration manager for metrics collection
   */
  private instrumentOrchestrationManager(
    metricsCollector: MetricsCollector,
    decisionLogger: DecisionLogger
  ): OrchestrationManager {
    // Create a proxy to intercept method calls
    return new Proxy(this.orchestrationManager, {
      get(target, prop) {
        const original = target[prop as keyof OrchestrationManager];

        if (typeof original === 'function') {
          return async (...args: any[]) => {
            // Log method calls for observability
            if (prop === 'generateCode') {
              const [prompt] = args;
              decisionLogger.logImplementationDecision(
                'full_development',
                metricsCollector.getSnapshot().iterationCount,
                'code_generation',
                'AI generation',
                'Generating code based on requirements',
                80
              );
            }

            // Track iterations
            if (prop === 'healErrors') {
              metricsCollector.incrementHealingCycles();
            }

            // Call original method
            const result = await original.apply(target, args);

            // Track token usage if available
            if (result && typeof result === 'object' && 'tokenUsage' in result) {
              const usage = result.tokenUsage as any;
              metricsCollector.recordTokenUsage(
                usage.input || 0,
                usage.output || 0,
                usage.cost || 0
              );
            }

            return result;
          };
        }

        return original;
      },
    });
  }

  /**
   * List generated files in a project
   */
  private async listGeneratedFiles(project: PluginProject): Promise<string[]> {
    if (!project.localPath) return [];

    const files: string[] = [];
    const srcDir = path.join(project.localPath, 'src');

    try {
      await this.walkDirectory(srcDir, files, project.localPath);
    } catch (error) {
      // Source directory might not exist
    }

    return files;
  }

  /**
   * Walk directory recursively
   */
  private async walkDirectory(dir: string, files: string[], baseDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, files, baseDir);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
          files.push(path.relative(baseDir, fullPath));
        }
      }
    } catch (error) {
      // Directory doesn't exist
    }
  }

  /**
   * Save benchmark result
   */
  private async saveResult(scenarioId: string, result: BenchmarkResult): Promise<void> {
    const filename = `${scenarioId}_${Date.now()}.json`;
    const filepath = path.join(this.config.outputDir, filename);

    await fs.writeFile(filepath, JSON.stringify(result, null, 2));

    if (this.config.verbose) {
      console.log(`[BENCHMARK] Saved result to: ${filepath}`);
    }
  }

  /**
   * Generate summary report
   */
  private async generateSummaryReport(results: BenchmarkResult[]): Promise<void> {
    const summary = {
      timestamp: new Date().toISOString(),
      totalScenarios: results.length,
      passed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      scenarios: results.map((r) => ({
        id: r.scenarioId,
        success: r.success,
        duration: r.metrics.totalDuration,
        iterations: r.metrics.iterationCount,
        tokenUsage: r.metrics.tokenUsage.total,
        cost: r.metrics.tokenUsage.cost,
        requirementsCoverage: r.metrics.requirementsCoverage,
        compilation: r.validation.criteria.compilation,
        tests: r.validation.criteria.tests,
      })),
      aggregates: {
        totalDuration: results.reduce((sum, r) => sum + r.metrics.totalDuration, 0),
        totalTokens: results.reduce((sum, r) => sum + r.metrics.tokenUsage.total, 0),
        totalCost: results.reduce((sum, r) => sum + r.metrics.tokenUsage.cost, 0),
        averageIterations:
          results.reduce((sum, r) => sum + r.metrics.iterationCount, 0) / results.length,
        averageRequirementsCoverage:
          results.reduce((sum, r) => sum + r.metrics.requirementsCoverage, 0) / results.length,
      },
    };

    const summaryPath = path.join(this.config.outputDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    // Also create a human-readable report
    const report = this.generateHumanReadableReport(results);
    const reportPath = path.join(this.config.outputDir, 'report.md');
    await fs.writeFile(reportPath, report);

    console.log(`\n[BENCHMARK] Summary saved to: ${summaryPath}`);
    console.log(`[BENCHMARK] Report saved to: ${reportPath}`);
  }

  /**
   * Generate human-readable report
   */
  private generateHumanReadableReport(results: BenchmarkResult[]): string {
    let report = '# AutoCoder Benchmark Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    // Summary
    report += '## Summary\n\n';
    const passed = results.filter((r) => r.success).length;
    const total = results.length;
    report += `- **Success Rate**: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)\n`;
    report += `- **Total Duration**: ${this.formatDuration(results.reduce((sum, r) => sum + r.metrics.totalDuration, 0))}\n`;
    report += `- **Total Tokens**: ${results.reduce((sum, r) => sum + r.metrics.tokenUsage.total, 0).toLocaleString()}\n`;
    report += `- **Total Cost**: $${results.reduce((sum, r) => sum + r.metrics.tokenUsage.cost, 0).toFixed(2)}\n\n`;

    // Individual Results
    report += '## Scenario Results\n\n';

    for (const result of results) {
      const scenario = getBenchmarkScenario(result.scenarioId);
      if (!scenario) continue;

      report += `### ${scenario.name}\n\n`;
      report += `- **Status**: ${result.success ? '✅ PASSED' : '❌ FAILED'}\n`;
      report += `- **Duration**: ${this.formatDuration(result.metrics.totalDuration)} (expected: ${this.formatDuration(scenario.expectedDuration)})\n`;
      report += `- **Iterations**: ${result.metrics.iterationCount}\n`;
      report += `- **Healing Cycles**: ${result.metrics.healingCycles}\n`;
      report += `- **Requirements Coverage**: ${result.metrics.requirementsCoverage.toFixed(1)}%\n`;
      report += `- **Token Usage**: ${result.metrics.tokenUsage.total.toLocaleString()} ($${result.metrics.tokenUsage.cost.toFixed(2)})\n`;

      if (!result.success) {
        report += '\n**Failures**:\n';
        if (!result.validation.criteria.compilation) {
          report += '- Compilation failed\n';
        }
        if (!result.validation.criteria.tests) {
          report += '- Tests failed\n';
        }
        if (result.validation.details.requirementsMissed.length > 0) {
          report += `- Missing requirements: ${result.validation.details.requirementsMissed.join(', ')}\n`;
        }
        if (result.validation.details.performanceIssues.length > 0) {
          report += `- Performance issues: ${result.validation.details.performanceIssues.join(', ')}\n`;
        }
      }

      report += '\n';
    }

    // Decision Analysis
    report += '## Decision Analysis\n\n';

    for (const result of results) {
      const scenario = getBenchmarkScenario(result.scenarioId);
      if (!scenario) continue;

      const designDecisions = result.decisions.filter((d) => d.decision.type === 'design').length;
      const fixDecisions = result.decisions.filter((d) => d.decision.type === 'fix').length;
      const avgConfidence =
        result.decisions.reduce((sum, d) => sum + d.decision.confidence, 0) /
          result.decisions.length || 0;

      report += `### ${scenario.name}\n`;
      report += `- Design decisions: ${designDecisions}\n`;
      report += `- Fix decisions: ${fixDecisions}\n`;
      report += `- Average confidence: ${avgConfidence.toFixed(1)}%\n\n`;
    }

    return report;
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Compare results with baseline
   */
  private async compareWithBaseline(results: BenchmarkResult[]): Promise<void> {
    try {
      const baselineData = await fs.readFile(this.config.compareBaseline!, 'utf-8');
      const baseline = JSON.parse(baselineData);

      console.log('\n[BENCHMARK] Comparison with baseline:');

      // Compare success rates
      const currentSuccess = results.filter((r) => r.success).length / results.length;
      const baselineSuccess = baseline.passed / baseline.totalScenarios;
      const successDiff = ((currentSuccess - baselineSuccess) * 100).toFixed(1);

      console.log(
        `  Success rate: ${currentSuccess * 100}% (${successDiff > '0' ? '+' : ''}${successDiff}%)`
      );

      // Compare performance
      const currentDuration = results.reduce((sum, r) => sum + r.metrics.totalDuration, 0);
      const durationDiff = (
        ((currentDuration - baseline.aggregates.totalDuration) /
          baseline.aggregates.totalDuration) *
        100
      ).toFixed(1);

      console.log(
        `  Total duration: ${this.formatDuration(currentDuration)} (${durationDiff > '0' ? '+' : ''}${durationDiff}%)`
      );

      // Compare token usage
      const currentTokens = results.reduce((sum, r) => sum + r.metrics.tokenUsage.total, 0);
      const tokenDiff = (
        ((currentTokens - baseline.aggregates.totalTokens) / baseline.aggregates.totalTokens) *
        100
      ).toFixed(1);

      console.log(
        `  Token usage: ${currentTokens.toLocaleString()} (${tokenDiff > '0' ? '+' : ''}${tokenDiff}%)`
      );
    } catch (error) {
      console.error('[BENCHMARK] Failed to compare with baseline:', error);
    }
  }

  /**
   * Create a failed result for error cases
   */
  private createFailedResult(scenario: BenchmarkScenario, error: any): BenchmarkResult {
    return {
      scenarioId: scenario.id,
      success: false,
      metrics: {
        totalDuration: 0,
        phasesDurations: new Map(),
        iterationCount: 0,
        tokenUsage: { input: 0, output: 0, total: 0, cost: 0 },
        compilationSuccess: false,
        testPassRate: 0,
        eslintErrorCount: 0,
        typeErrorCount: 0,
        codeChurn: 0,
        fixAttempts: new Map(),
        healingCycles: 0,
        requirementsCoverage: 0,
        unnecessaryCode: 0,
        apiCorrectness: false,
        memoryPeak: 0,
        cpuAverage: 0,
        diskUsage: 0,
      },
      decisions: [],
      validation: {
        passed: false,
        criteria: {
          compilation: false,
          tests: false,
          coverage: false,
          performance: false,
          requirements: false,
        },
        details: {
          requirementsCovered: [],
          requirementsMissed: scenario.requirements,
          unexpectedBehaviors: [`Benchmark execution failed: ${error.message || error}`],
          performanceIssues: [],
        },
      },
      logs: [`Error: ${error.message || error}`],
      artifacts: {
        generatedFiles: []
      },
    };
  }
}
