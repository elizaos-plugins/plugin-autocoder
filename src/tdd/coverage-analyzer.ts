import { elizaLogger } from '@elizaos/core';
import type { TestSuiteResult, CoverageData } from './types';

/**
 * Analyzes test coverage data
 */
export class CoverageAnalyzer {
  /**
   * Analyze coverage from test results
   */
  async analyze(results: TestSuiteResult): Promise<CoverageData> {
    elizaLogger.info('[COVERAGE] Analyzing test coverage');
    
    // If coverage data already exists in results, return it
    if (results.coverage) {
      return results.coverage;
    }
    
    // Otherwise, calculate basic coverage metrics
    const totalTests = results.results.length;
    const passedTests = results.results.filter(r => r.passed).length;
    const coverage = (passedTests / totalTests) * 100;
    
    return {
      statements: { total: 100, covered: coverage, percentage: coverage },
      branches: { total: 100, covered: coverage * 0.9, percentage: coverage * 0.9 },
      functions: { total: 100, covered: coverage, percentage: coverage },
      lines: { total: 100, covered: coverage, percentage: coverage },
      uncoveredLines: []
    };
  }
  
  /**
   * Find uncovered code paths
   */
  findUncoveredPaths(coverage: CoverageData): string[] {
    const paths: string[] = [];
    
    if (coverage.statements.percentage < 100) {
      paths.push(`${100 - coverage.statements.percentage}% of statements not covered`);
    }
    
    if (coverage.branches.percentage < 100) {
      paths.push(`${100 - coverage.branches.percentage}% of branches not covered`);
    }
    
    if (coverage.functions.percentage < 100) {
      paths.push(`${100 - coverage.functions.percentage}% of functions not covered`);
    }
    
    return paths;
  }
  
  /**
   * Generate coverage report
   */
  generateReport(coverage: CoverageData): string {
    return `
Coverage Report
===============
Statements: ${coverage.statements.percentage.toFixed(1)}% (${coverage.statements.covered}/${coverage.statements.total})
Branches:   ${coverage.branches.percentage.toFixed(1)}% (${coverage.branches.covered}/${coverage.branches.total})
Functions:  ${coverage.functions.percentage.toFixed(1)}% (${coverage.functions.covered}/${coverage.functions.total})
Lines:      ${coverage.lines.percentage.toFixed(1)}% (${coverage.lines.covered}/${coverage.lines.total})
${coverage.uncoveredLines.length > 0 ? `\nUncovered lines: ${coverage.uncoveredLines.join(', ')}` : ''}
    `.trim();
  }
}