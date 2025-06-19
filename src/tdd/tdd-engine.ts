import { elizaLogger } from '@elizaos/core';
import type {
  TestSuite,
  Test,
  TestRunResult,
  TestSuiteResult,
  Implementation,
  FailureAnalysis,
  Fix,
  RefactoringSuggestion,
  TDDContext,
  Requirement,
  ProjectContext,
  TestGenerationOptions,
  FailurePattern
} from './types';
import { AITestGenerator } from './ai-test-generator';
import { TestRunner } from './test-runner';
import { CoverageAnalyzer } from './coverage-analyzer';
import { RefactoringEngine } from './refactoring-engine';

/**
 * Configuration for TDD engine
 */
export interface TDDConfig {
  maxIterations: number;
  targetCoverage: number;
  enableRefactoring: boolean;
  enablePropertyTests: boolean;
  enableFuzzTests: boolean;
  testTimeout: number;
  parallelTests: boolean;
}

const DEFAULT_CONFIG: TDDConfig = {
  maxIterations: 10,
  targetCoverage: 90,
  enableRefactoring: true,
  enablePropertyTests: true,
  enableFuzzTests: false,
  testTimeout: 30000,
  parallelTests: true
};

/**
 * Test-Driven Development Engine
 * Implements red-green-refactor cycle with AI assistance
 */
export class TDDEngine {
  private testGenerator: AITestGenerator;
  private testRunner: TestRunner;
  private coverageAnalyzer: CoverageAnalyzer;
  private refactoringEngine: RefactoringEngine;
  private config: TDDConfig;
  private iterationHistory: IterationHistory[] = [];

  constructor(
    private runtime: any, // IAgentRuntime
    config: Partial<TDDConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.testGenerator = new AITestGenerator(runtime);
    this.testRunner = new TestRunner(this.config);
    this.coverageAnalyzer = new CoverageAnalyzer();
    this.refactoringEngine = new RefactoringEngine(runtime);
  }

  /**
   * Generate comprehensive test suite from requirements
   */
  async generateTestsFirst(
    requirements: Requirement[],
    context: ProjectContext
  ): Promise<TestSuite> {
    elizaLogger.info('[TDD] Generating comprehensive test suite from requirements');
    
    const options: TestGenerationOptions = {
      includeEdgeCases: true,
      includePropertyTests: this.config.enablePropertyTests,
      includePerformanceTests: true,
      includeFuzzTests: this.config.enableFuzzTests,
      includeAccessibilityTests: context.targetEnvironment === 'web',
      includeSecurityTests: true,
      testFramework: 'jest',
      assertionLibrary: 'jest',
      mockingLibrary: 'jest'
    };
    
    // Generate test suite
    const testSuite = await this.testGenerator.generateFromRequirements(
      requirements,
      context,
      options
    );
    
    // Validate test quality
    await this.validateTestSuite(testSuite);
    
    // Add coverage requirements
    testSuite.coverage = {
      statements: this.config.targetCoverage,
      branches: this.config.targetCoverage - 5,
      functions: this.config.targetCoverage,
      lines: this.config.targetCoverage
    };
    
    elizaLogger.info(`[TDD] Generated ${testSuite.tests.length} tests covering ${requirements.length} requirements`);
    
    return testSuite;
  }

  /**
   * Implement code using TDD cycle
   */
  async implementWithTDD(
    testSuite: TestSuite,
    context: TDDContext
  ): Promise<Implementation> {
    elizaLogger.info('[TDD] Starting TDD implementation cycle');
    
    let implementation = await this.createInitialImplementation(testSuite, context);
    let iteration = 0;
    
    while (iteration < this.config.maxIterations) {
      elizaLogger.info(`[TDD] Iteration ${iteration + 1}/${this.config.maxIterations}`);
      
      // RED: Run tests
      const testResults = await this.runTests(testSuite, implementation);
      
      // Log iteration
      this.logIteration(iteration, testResults);
      
      if (testResults.passed) {
        elizaLogger.success('[TDD] All tests passing! Moving to refactoring phase.');
        break;
      }
      
      // Analyze failures
      const failureAnalysis = await this.analyzeFailures(testResults);
      
      // GREEN: Generate minimal fix
      const fix = await this.generateMinimalFix(
        failureAnalysis,
        implementation,
        testSuite
      );
      
      // Apply fix
      implementation = await this.applyFix(implementation, fix);
      
      iteration++;
    }
    
    if (iteration >= this.config.maxIterations) {
      elizaLogger.warn('[TDD] Reached maximum iterations without all tests passing');
    }
    
    // REFACTOR: Improve code quality
    if (this.config.enableRefactoring) {
      implementation = await this.refactorWithTests(implementation, testSuite);
    }
    
    // Final validation
    await this.validateImplementation(implementation, testSuite);
    
    return implementation;
  }

  /**
   * Create initial implementation skeleton
   */
  private async createInitialImplementation(
    testSuite: TestSuite,
    context: TDDContext
  ): Promise<Implementation> {
    elizaLogger.info('[TDD] Creating initial implementation skeleton');
    
    // Analyze test suite to understand structure
    const structure = await this.testGenerator.analyzeTestStructure(testSuite);
    
    // Generate minimal skeleton
    const skeleton = await this.testGenerator.generateSkeleton(
      structure,
      context
    );
    
    return skeleton;
  }

  /**
   * Run test suite against implementation
   */
  private async runTests(
    testSuite: TestSuite,
    implementation: Implementation
  ): Promise<TestSuiteResult> {
    elizaLogger.info('[TDD] Running test suite');
    
    // Set up test environment
    await this.testRunner.setup(implementation, testSuite);
    
    try {
      // Run tests
      const results = await this.testRunner.run(testSuite, {
        parallel: this.config.parallelTests,
        timeout: this.config.testTimeout,
        coverage: true
      });
      
      // Analyze coverage
      const coverage = await this.coverageAnalyzer.analyze(results);
      results.coverage = coverage;
      
      return results;
    } finally {
      // Clean up
      await this.testRunner.cleanup();
    }
  }

  /**
   * Analyze test failures to understand what needs fixing
   */
  private async analyzeFailures(
    testResults: TestSuiteResult
  ): Promise<FailureAnalysis> {
    const failedTests = testResults.results.filter(r => !r.passed);
    
    elizaLogger.info(`[TDD] Analyzing ${failedTests.length} test failures`);
    
    // Group failures by pattern
    const patterns = await this.identifyFailurePatterns(failedTests);
    
    // Generate fix suggestions
    const suggestedFixes = await this.generateFixSuggestions(
      failedTests,
      patterns
    );
    
    // Identify root cause
    const rootCause = await this.identifyRootCause(patterns, failedTests);
    
    return {
      failedTests,
      patterns,
      suggestedFixes,
      rootCause
    };
  }

  /**
   * Identify patterns in test failures
   */
  private async identifyFailurePatterns(
    failures: TestRunResult[]
  ): Promise<FailurePattern[]> {
    const patterns: FailurePattern[] = [];
    
    // Group by error type
    const errorGroups = new Map<string, TestRunResult[]>();
    
    for (const failure of failures) {
      if (failure.error) {
        const errorType = this.classifyError(failure.error);
        if (!errorGroups.has(errorType)) {
          errorGroups.set(errorType, []);
        }
        errorGroups.get(errorType)!.push(failure);
      }
    }
    
    // Create patterns
    for (const [type, tests] of errorGroups) {
      patterns.push({
        type,
        description: this.describeErrorPattern(type, tests),
        affectedTests: tests.map(t => t.test.name),
        confidence: tests.length / failures.length
      });
    }
    
    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Classify error type
   */
  private classifyError(error: any): string {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('undefined') || message.includes('null')) {
      return 'null-reference';
    }
    if (message.includes('type') || message.includes('cannot read')) {
      return 'type-error';
    }
    if (message.includes('not a function')) {
      return 'missing-function';
    }
    if (message.includes('expected') && message.includes('received')) {
      return 'assertion-failure';
    }
    if (message.includes('timeout')) {
      return 'timeout';
    }
    
    return 'unknown';
  }

  /**
   * Describe error pattern
   */
  private describeErrorPattern(type: string, tests: TestRunResult[]): string {
    switch (type) {
      case 'null-reference':
        return 'Null or undefined reference errors';
      case 'type-error':
        return 'Type mismatches or invalid property access';
      case 'missing-function':
        return 'Missing function implementations';
      case 'assertion-failure':
        return 'Incorrect return values or behavior';
      case 'timeout':
        return 'Performance issues or infinite loops';
      default:
        return 'Unclassified errors';
    }
  }

  /**
   * Generate fix suggestions based on failure analysis
   */
  private async generateFixSuggestions(
    failures: TestRunResult[],
    patterns: FailurePattern[]
  ): Promise<Fix[]> {
    const fixes: Fix[] = [];
    
    // Use AI to generate fixes for each pattern
    for (const pattern of patterns) {
      const patternFixes = await this.testGenerator.generateFixes(
        pattern,
        failures.filter(f => pattern.affectedTests.includes(f.test.name))
      );
      fixes.push(...patternFixes);
    }
    
    // Sort by confidence and impact
    return fixes.sort((a, b) => {
      const scoreA = a.confidence * (a.impact === 'high' ? 3 : a.impact === 'medium' ? 2 : 1);
      const scoreB = b.confidence * (b.impact === 'high' ? 3 : b.impact === 'medium' ? 2 : 1);
      return scoreB - scoreA;
    });
  }

  /**
   * Identify root cause of failures
   */
  private async identifyRootCause(
    patterns: FailurePattern[],
    failures: TestRunResult[]
  ): Promise<string | undefined> {
    // Use AI to analyze patterns and identify root cause
    const analysis = await this.testGenerator.analyzeRootCause(
      patterns,
      failures
    );
    
    return analysis.rootCause;
  }

  /**
   * Generate minimal fix for failures
   */
  private async generateMinimalFix(
    analysis: FailureAnalysis,
    implementation: Implementation,
    testSuite: TestSuite
  ): Promise<Fix> {
    elizaLogger.info('[TDD] Generating minimal fix for test failures');
    
    // Try suggested fixes first
    if (analysis.suggestedFixes.length > 0) {
      return analysis.suggestedFixes[0];
    }
    
    // Generate new fix using AI
    const fix = await this.testGenerator.generateMinimalFix(
      analysis,
      implementation,
      testSuite
    );
    
    return fix;
  }

  /**
   * Apply fix to implementation
   */
  private async applyFix(
    implementation: Implementation,
    fix: Fix
  ): Promise<Implementation> {
    elizaLogger.info(`[TDD] Applying fix: ${fix.description}`);
    
    const updated = { ...implementation };
    
    // Find target file
    const fileIndex = updated.files.findIndex(f => f.path === fix.targetFile);
    
    if (fileIndex === -1) {
      // Create new file if doesn't exist
      updated.files.push({
        path: fix.targetFile,
        content: fix.code,
        language: 'typescript',
        purpose: fix.description
      });
    } else {
      // Update existing file
      const file = updated.files[fileIndex];
      
      if (fix.targetLine) {
        // Insert at specific line
        const lines = file.content.split('\n');
        lines.splice(fix.targetLine, 0, fix.code);
        file.content = lines.join('\n');
      } else {
        // Append to file
        file.content += '\n\n' + fix.code;
      }
    }
    
    return updated;
  }

  /**
   * Refactor implementation while maintaining test compatibility
   */
  private async refactorWithTests(
    implementation: Implementation,
    testSuite: TestSuite
  ): Promise<Implementation> {
    elizaLogger.info('[TDD] Starting refactoring phase');
    
    let refactored = implementation;
    
    // Get refactoring suggestions
    const suggestions = await this.refactoringEngine.suggestRefactorings(
      implementation,
      {
        maintainTestCompatibility: true,
        improvePerformance: true,
        reduceComplexity: true,
        enhanceReadability: true,
        eliminateDuplication: true
      }
    );
    
    // Apply each refactoring and verify tests still pass
    for (const suggestion of suggestions) {
      elizaLogger.info(`[TDD] Trying refactoring: ${suggestion.type} - ${suggestion.description}`);
      
      // Apply refactoring
      const candidate = await this.refactoringEngine.applyRefactoring(
        refactored,
        suggestion
      );
      
      // Run tests to ensure they still pass
      const testResults = await this.runTests(testSuite, candidate);
      
      if (testResults.passed) {
        refactored = candidate;
        elizaLogger.success(`[TDD] Refactoring applied successfully`);
      } else {
        elizaLogger.warn(`[TDD] Refactoring caused test failures, skipping`);
      }
    }
    
    return refactored;
  }

  /**
   * Validate test suite quality
   */
  private async validateTestSuite(testSuite: TestSuite): Promise<void> {
    const issues: string[] = [];
    
    // Check test coverage
    if (testSuite.tests.length < testSuite.requirements.length) {
      issues.push('Not all requirements have corresponding tests');
    }
    
    // Check test diversity
    const testTypes = new Set(testSuite.tests.map(t => t.type));
    if (testTypes.size < 3) {
      issues.push('Limited test type diversity');
    }
    
    // Check for edge cases
    const edgeCases = testSuite.tests.filter(t => t.category === 'edge-case');
    if (edgeCases.length < testSuite.tests.length * 0.2) {
      issues.push('Insufficient edge case coverage');
    }
    
    if (issues.length > 0) {
      elizaLogger.warn('[TDD] Test suite quality issues:', issues);
    }
  }

  /**
   * Validate final implementation
   */
  private async validateImplementation(
    implementation: Implementation,
    testSuite: TestSuite
  ): Promise<void> {
    // Run final test suite
    const results = await this.runTests(testSuite, implementation);
    
    if (!results.passed) {
      throw new Error('Final validation failed: Not all tests passing');
    }
    
    // Check coverage
    if (results.coverage.lines.percentage < this.config.targetCoverage) {
      elizaLogger.warn(
        `[TDD] Coverage ${results.coverage.lines.percentage.toFixed(1)}% ` +
        `is below target ${this.config.targetCoverage}%`
      );
    }
    
    elizaLogger.success('[TDD] Implementation validated successfully');
  }

  /**
   * Log iteration details
   */
  private logIteration(iteration: number, results: TestSuiteResult): void {
    const history: IterationHistory = {
      iteration,
      timestamp: new Date(),
      totalTests: results.summary.total,
      passedTests: results.summary.passed,
      failedTests: results.summary.failed,
      coverage: results.coverage.lines.percentage,
      duration: results.duration
    };
    
    this.iterationHistory.push(history);
    
    elizaLogger.info(
      `[TDD] Iteration ${iteration + 1}: ` +
      `${history.passedTests}/${history.totalTests} tests passing ` +
      `(${history.coverage.toFixed(1)}% coverage)`
    );
  }

  /**
   * Get TDD metrics
   */
  getMetrics(): TDDMetrics {
    const totalIterations = this.iterationHistory.length;
    const finalIteration = this.iterationHistory[totalIterations - 1];
    
    return {
      totalIterations,
      totalDuration: this.iterationHistory.reduce((sum, h) => sum + h.duration, 0),
      finalCoverage: finalIteration?.coverage || 0,
      testPassRate: finalIteration 
        ? (finalIteration.passedTests / finalIteration.totalTests) * 100
        : 0,
      avgIterationTime: totalIterations > 0
        ? this.iterationHistory.reduce((sum, h) => sum + h.duration, 0) / totalIterations
        : 0
    };
  }
}

interface IterationHistory {
  iteration: number;
  timestamp: Date;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  coverage: number;
  duration: number;
}

interface TDDMetrics {
  totalIterations: number;
  totalDuration: number;
  finalCoverage: number;
  testPassRate: number;
  avgIterationTime: number;
}