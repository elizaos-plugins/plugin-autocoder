import type { BenchmarkMetrics, DecisionLog } from './types';
import type { DevelopmentPhase, ErrorAnalysis } from '../types/plugin-project';
import { performance } from 'perf_hooks';
import * as os from 'os';

/**
 * Collects metrics during AutoCoder execution
 */
export class MetricsCollector {
  private metrics: BenchmarkMetrics;
  private phaseStartTimes: Map<DevelopmentPhase, number> = new Map();
  private startTime: number;
  private decisions: DecisionLog[] = [];
  private resourceInterval?: NodeJS.Timeout;
  private memoryPeak = 0;
  private cpuSamples: number[] = [];

  constructor() {
    this.startTime = performance.now();
    this.metrics = {
      totalDuration: 0,
      phasesDurations: new Map(),
      iterationCount: 0,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0,
        cost: 0,
      },
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
    };

    // Start resource monitoring
    this.startResourceMonitoring();
  }

  /**
   * Start monitoring system resources
   */
  private startResourceMonitoring(): void {
    const startCpuUsage = process.cpuUsage();

    this.resourceInterval = setInterval(() => {
      // Memory monitoring
      const memUsage = process.memoryUsage();
      const totalMem = memUsage.heapUsed + memUsage.external;
      if (totalMem > this.memoryPeak) {
        this.memoryPeak = totalMem;
      }

      // CPU monitoring
      const cpuUsage = process.cpuUsage(startCpuUsage);
      const totalCpu = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      this.cpuSamples.push(totalCpu);
    }, 100); // Sample every 100ms
  }

  /**
   * Stop resource monitoring
   */
  private stopResourceMonitoring(): void {
    if (this.resourceInterval) {
      clearInterval(this.resourceInterval);
      this.resourceInterval = undefined;
    }

    // Calculate averages
    this.metrics.memoryPeak = this.memoryPeak;
    if (this.cpuSamples.length > 0) {
      this.metrics.cpuAverage = this.cpuSamples.reduce((a, b) => a + b, 0) / this.cpuSamples.length;
    }
  }

  /**
   * Mark the start of a phase
   */
  startPhase(phase: DevelopmentPhase): void {
    this.phaseStartTimes.set(phase, performance.now());
  }

  /**
   * Mark the end of a phase
   */
  endPhase(phase: DevelopmentPhase): void {
    const startTime = this.phaseStartTimes.get(phase);
    if (startTime) {
      const duration = performance.now() - startTime;
      this.metrics.phasesDurations.set(phase, duration);
    }
  }

  /**
   * Record a decision made during code generation
   */
  recordDecision(
    phase: DevelopmentPhase,
    iteration: number,
    decision: {
      type: 'design' | 'implementation' | 'fix' | 'optimization';
      reasoning: string;
      alternatives: string[];
      chosenPath: string;
      confidence: number;
    },
    context: {
      errors: ErrorAnalysis[];
      requirements: string[];
      constraints: string[];
    },
    outcome: {
      success: boolean;
      impact: string;
      nextSteps: string[];
    }
  ): void {
    this.decisions.push({
      timestamp: new Date(),
      phase,
      iteration,
      decision,
      context,
      outcome,
    });
  }

  /**
   * Record token usage from an AI call
   */
  recordTokenUsage(input: number, output: number, cost: number): void {
    this.metrics.tokenUsage.input += input;
    this.metrics.tokenUsage.output += output;
    this.metrics.tokenUsage.total += input + output;
    this.metrics.tokenUsage.cost += cost;
  }

  /**
   * Record compilation result
   */
  recordCompilationResult(success: boolean, errors: number = 0): void {
    this.metrics.compilationSuccess = success;
    if (!success) {
      this.metrics.typeErrorCount = errors;
    }
  }

  /**
   * Record test results
   */
  recordTestResults(passed: number, total: number): void {
    this.metrics.testPassRate = total > 0 ? (passed / total) * 100 : 0;
  }

  /**
   * Record ESLint results
   */
  recordEslintResults(errorCount: number): void {
    this.metrics.eslintErrorCount = errorCount;
  }

  /**
   * Record code churn (lines changed between iterations)
   */
  recordCodeChurn(linesChanged: number): void {
    this.metrics.codeChurn += linesChanged;
  }

  /**
   * Record a fix attempt
   */
  recordFixAttempt(errorType: string): void {
    const current = this.metrics.fixAttempts.get(errorType) || 0;
    this.metrics.fixAttempts.set(errorType, current + 1);
  }

  /**
   * Increment healing cycles
   */
  incrementHealingCycles(): void {
    this.metrics.healingCycles++;
  }

  /**
   * Increment iteration count
   */
  incrementIteration(): void {
    this.metrics.iterationCount++;
  }

  /**
   * Set requirements coverage
   */
  setRequirementsCoverage(coverage: number): void {
    this.metrics.requirementsCoverage = coverage;
  }

  /**
   * Set unnecessary code count
   */
  setUnnecessaryCode(lines: number): void {
    this.metrics.unnecessaryCode = lines;
  }

  /**
   * Set API correctness
   */
  setApiCorrectness(correct: boolean): void {
    this.metrics.apiCorrectness = correct;
  }

  /**
   * Set disk usage
   */
  setDiskUsage(bytes: number): void {
    this.metrics.diskUsage = bytes;
  }

  /**
   * Finalize metrics collection
   */
  finalize(): { metrics: BenchmarkMetrics; decisions: DecisionLog[] } {
    this.stopResourceMonitoring();
    this.metrics.totalDuration = performance.now() - this.startTime;

    return {
      metrics: this.metrics,
      decisions: this.decisions,
    };
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): BenchmarkMetrics {
    return { ...this.metrics };
  }

  /**
   * Export metrics to JSON
   */
  exportToJson(): string {
    const data = {
      metrics: {
        ...this.metrics,
        phasesDurations: Object.fromEntries(this.metrics.phasesDurations),
        fixAttempts: Object.fromEntries(this.metrics.fixAttempts),
      },
      decisions: this.decisions,
      timestamp: new Date().toISOString(),
    };

    return JSON.stringify(data, null, 2);
  }
}
