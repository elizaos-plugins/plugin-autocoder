import type { PluginProject, DevelopmentPhase, ErrorAnalysis } from '../types/plugin-project';

/**
 * Metrics collected during benchmark execution
 */
export interface BenchmarkMetrics {
  // Performance Metrics
  totalDuration: number;
  phasesDurations: Map<DevelopmentPhase, number>;
  iterationCount: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
    cost: number;
  };

  // Quality Metrics
  compilationSuccess: boolean;
  testPassRate: number;
  eslintErrorCount: number;
  typeErrorCount: number;

  // Efficiency Metrics
  codeChurn: number; // Lines changed between iterations
  fixAttempts: Map<string, number>;
  healingCycles: number;

  // Accuracy Metrics
  requirementsCoverage: number; // % of requirements met
  unnecessaryCode: number; // Lines of unused code
  apiCorrectness: boolean; // Does it match ElizaOS patterns

  // Resource Usage
  memoryPeak: number;
  cpuAverage: number;
  diskUsage: number;
}

/**
 * Decision made during code generation
 */
export interface DecisionLog {
  timestamp: Date;
  phase: DevelopmentPhase;
  iteration: number;
  decision: {
    type: 'design' | 'implementation' | 'fix' | 'optimization';
    reasoning: string;
    alternatives: string[];
    chosenPath: string;
    confidence: number;
  };
  context: {
    errors: ErrorAnalysis[];
    requirements: string[];
    constraints: string[];
  };
  outcome: {
    success: boolean;
    impact: string;
    nextSteps: string[];
  };
}

/**
 * Benchmark scenario definition
 */
export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  requirements: string[];
  constraints: string[];
  expectedDuration: number; // milliseconds
  successCriteria: SuccessCriteria;
  testData?: any;
}

/**
 * Success criteria for a benchmark
 */
export interface SuccessCriteria {
  mustCompile: boolean;
  mustPassTests: boolean;
  minTestCoverage?: number;
  maxDuration?: number;
  maxIterations?: number;
  requiredComponents?: string[];
  customValidation?: (project: PluginProject) => Promise<boolean>;
}

/**
 * Result of a benchmark run
 */
export interface BenchmarkResult {
  scenarioId: string;
  success: boolean;
  metrics: BenchmarkMetrics;
  decisions: DecisionLog[];
  validation: ValidationResult;
  logs: string[];
  artifacts: {
    projectPath?: string;
    generatedFiles: string[];
    testResults?: any;
  };
}

/**
 * Validation result
 */
export interface ValidationResult {
  passed: boolean;
  criteria: {
    compilation: boolean;
    tests: boolean;
    coverage: boolean;
    performance: boolean;
    requirements: boolean;
  };
  details: {
    requirementsCovered: string[];
    requirementsMissed: string[];
    unexpectedBehaviors: string[];
    performanceIssues: string[];
  };
}

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  outputDir: string;
  scenarios: BenchmarkScenario[];
  parallel: boolean;
  verbose: boolean;
  saveArtifacts: boolean;
  compareBaseline?: string;
}
