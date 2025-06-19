import { elizaLogger } from '@elizaos/core';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  TestSuite,
  TestSuiteResult,
  TestRunResult,
  Implementation,
  Test,
  CoverageData
} from './types';

const execAsync = promisify(exec);

export interface TestRunOptions {
  parallel: boolean;
  timeout: number;
  coverage: boolean;
}

/**
 * Test runner for executing test suites
 */
export class TestRunner {
  private tempDir: string | null = null;

  constructor(private config: { testTimeout: number }) {}

  /**
   * Set up test environment
   */
  async setup(implementation: Implementation, testSuite: TestSuite): Promise<void> {
    // Create temp directory
    this.tempDir = await fs.mkdtemp(path.join(process.cwd(), '.test-runner-'));
    
    // Write implementation files
    for (const file of implementation.files) {
      const filePath = path.join(this.tempDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content);
    }
    
    // Write test files
    const testDir = path.join(this.tempDir, '__tests__');
    await fs.mkdir(testDir, { recursive: true });
    
    // Write test suite
    const testContent = this.generateTestFile(testSuite);
    await fs.writeFile(path.join(testDir, 'test-suite.test.ts'), testContent);
    
    // Write package.json
    await fs.writeFile(
      path.join(this.tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-runner',
        version: '1.0.0',
        scripts: {
          test: 'jest --json --outputFile=test-results.json --coverage --coverageReporters=json'
        },
        dependencies: implementation.dependencies,
        devDependencies: {
          ...implementation.devDependencies,
          'jest': '^29.0.0',
          '@types/jest': '^29.0.0',
          'ts-jest': '^29.0.0',
          'typescript': '^5.0.0'
        }
      }, null, 2)
    );
    
    // Write jest config
    await fs.writeFile(
      path.join(this.tempDir, 'jest.config.js'),
      `module.exports = {
        preset: 'ts-jest',
        testEnvironment: 'node',
        coverageDirectory: 'coverage',
        collectCoverageFrom: [
          'src/**/*.{ts,tsx}',
          '!src/**/*.d.ts',
          '!src/**/*.test.{ts,tsx}'
        ]
      };`
    );
    
    // Install dependencies
    await execAsync('npm install --prefer-offline', { cwd: this.tempDir });
  }

  /**
   * Run test suite
   */
  async run(testSuite: TestSuite, options: TestRunOptions): Promise<TestSuiteResult> {
    if (!this.tempDir) {
      throw new Error('Test environment not set up');
    }
    
    const startTime = Date.now();
    
    try {
      // Run tests
      const { stdout, stderr } = await execAsync('npm test', {
        cwd: this.tempDir,
        timeout: options.timeout
      });
      
      // Read results
      const resultsPath = path.join(this.tempDir, 'test-results.json');
      const results = JSON.parse(await fs.readFile(resultsPath, 'utf-8'));
      
      // Read coverage
      const coveragePath = path.join(this.tempDir, 'coverage', 'coverage-final.json');
      const coverage = await this.readCoverage(coveragePath);
      
      // Parse results
      const testResults = this.parseTestResults(results, testSuite);
      
      return {
        suite: testSuite,
        results: testResults,
        passed: results.success,
        duration: Date.now() - startTime,
        coverage,
        summary: this.generateSummary(testResults)
      };
    } catch (error) {
      // Handle test failures
      return this.handleTestFailure(error, testSuite, Date.now() - startTime);
    }
  }

  /**
   * Clean up test environment
   */
  async cleanup(): Promise<void> {
    if (this.tempDir) {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      this.tempDir = null;
    }
  }

  /**
   * Generate test file content
   */
  private generateTestFile(testSuite: TestSuite): string {
    return `
// Generated test suite: ${testSuite.name}
// ${testSuite.description}

${testSuite.setupCode || ''}

describe('${testSuite.name}', () => {
  ${testSuite.tests.map(test => `
  test('${test.name}', async () => {
    ${test.code}
  });
  `).join('\n')}
});

${testSuite.teardownCode || ''}
`;
  }

  /**
   * Parse test results from Jest output
   */
  private parseTestResults(jestResults: any, testSuite: TestSuite): TestRunResult[] {
    const results: TestRunResult[] = [];
    
    // Map Jest results to our format
    for (const testResult of jestResults.testResults) {
      for (const assertionResult of testResult.assertionResults) {
        const test = testSuite.tests.find(t => t.name === assertionResult.title);
        
        if (test) {
          results.push({
            test,
            passed: assertionResult.status === 'passed',
            duration: assertionResult.duration || 0,
            error: assertionResult.status === 'failed' ? {
              message: assertionResult.failureMessages.join('\n'),
              stack: assertionResult.failureDetails?.[0]?.stack
            } : undefined
          });
        }
      }
    }
    
    return results;
  }

  /**
   * Read coverage data
   */
  private async readCoverage(coveragePath: string): Promise<CoverageData> {
    try {
      const coverageData = JSON.parse(await fs.readFile(coveragePath, 'utf-8'));
      
      // Aggregate coverage
      let statements = { total: 0, covered: 0 };
      let branches = { total: 0, covered: 0 };
      let functions = { total: 0, covered: 0 };
      let lines = { total: 0, covered: 0 };
      const uncoveredLines: number[] = [];
      
      for (const file in coverageData) {
        const fileCoverage = coverageData[file];
        
        statements.total += fileCoverage.s ? Object.keys(fileCoverage.s).length : 0;
        statements.covered += fileCoverage.s ? Object.values(fileCoverage.s).filter((v: any) => v > 0).length : 0;
        
        // Similar for branches, functions, lines...
      }
      
      return {
        statements: { ...statements, percentage: statements.total > 0 ? (statements.covered / statements.total) * 100 : 0 },
        branches: { ...branches, percentage: branches.total > 0 ? (branches.covered / branches.total) * 100 : 0 },
        functions: { ...functions, percentage: functions.total > 0 ? (functions.covered / functions.total) * 100 : 0 },
        lines: { ...lines, percentage: lines.total > 0 ? (lines.covered / lines.total) * 100 : 0 },
        uncoveredLines
      };
    } catch (error) {
      // Return default coverage if reading fails
      return {
        statements: { total: 0, covered: 0, percentage: 0 },
        branches: { total: 0, covered: 0, percentage: 0 },
        functions: { total: 0, covered: 0, percentage: 0 },
        lines: { total: 0, covered: 0, percentage: 0 },
        uncoveredLines: []
      };
    }
  }

  /**
   * Generate test summary
   */
  private generateSummary(results: TestRunResult[]): any {
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    const durations = results.map(r => r.duration);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    
    const slowestTest = results.reduce((slowest, r) => 
      r.duration > (slowest?.duration || 0) ? r : slowest
    , results[0]);
    
    return {
      total,
      passed,
      failed,
      skipped: 0,
      errorRate: total > 0 ? (failed / total) * 100 : 0,
      avgDuration,
      slowestTest: slowestTest ? {
        name: slowestTest.test.name,
        duration: slowestTest.duration
      } : null,
      failureReasons: this.categorizeFailures(results.filter(r => !r.passed))
    };
  }

  /**
   * Categorize test failures
   */
  private categorizeFailures(failures: TestRunResult[]): any[] {
    const categories = new Map<string, string[]>();
    
    for (const failure of failures) {
      if (failure.error) {
        const category = this.categorizeError(failure.error.message);
        if (!categories.has(category)) {
          categories.set(category, []);
        }
        categories.get(category)!.push(failure.test.name);
      }
    }
    
    return Array.from(categories.entries()).map(([category, examples]) => ({
      category,
      count: examples.length,
      examples: examples.slice(0, 3)
    }));
  }

  /**
   * Categorize error message
   */
  private categorizeError(message: string): string {
    const lower = message.toLowerCase();
    
    if (lower.includes('undefined') || lower.includes('null')) {
      return 'Null Reference';
    }
    if (lower.includes('type')) {
      return 'Type Error';
    }
    if (lower.includes('timeout')) {
      return 'Timeout';
    }
    if (lower.includes('expect')) {
      return 'Assertion Failure';
    }
    
    return 'Other';
  }

  /**
   * Handle test execution failure
   */
  private handleTestFailure(error: any, testSuite: TestSuite, duration: number): TestSuiteResult {
    elizaLogger.error('[TEST-RUNNER] Test execution failed:', error);
    
    // Try to parse partial results
    // For now, return all tests as failed
    const results = testSuite.tests.map(test => ({
      test,
      passed: false,
      duration: 0,
      error: {
        message: 'Test execution failed',
        stack: error.stack
      }
    }));
    
    return {
      suite: testSuite,
      results,
      passed: false,
      duration,
      coverage: {
        statements: { total: 0, covered: 0, percentage: 0 },
        branches: { total: 0, covered: 0, percentage: 0 },
        functions: { total: 0, covered: 0, percentage: 0 },
        lines: { total: 0, covered: 0, percentage: 0 },
        uncoveredLines: []
      },
      summary: this.generateSummary(results)
    };
  }
}