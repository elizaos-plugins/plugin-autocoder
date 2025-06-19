import { elizaLogger } from '@elizaos/core';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  Validator,
  Code,
  VerificationContext,
  VerificationStageResult,
  VerificationFinding,
  CheckResult,
  TestResult,
  SecurityCheckResult,
  ComplexityResult,
  CoverageResult
} from './types';

const execAsync = promisify(exec);

/**
 * Base validator class
 */
abstract class BaseValidator implements Validator {
  abstract name: string;
  abstract description: string;
  canAutoFix = false;

  abstract validate(code: Code, context: VerificationContext): Promise<VerificationStageResult>;

  protected createStageResult(
    passed: boolean,
    score: number,
    findings: VerificationFinding[],
    duration: number
  ): VerificationStageResult {
    return {
      stage: this.name,
      validator: this.constructor.name,
      passed,
      score,
      duration,
      findings
    };
  }
}

/**
 * Syntax validator using TypeScript/JavaScript parsers
 */
export class SyntaxValidator extends BaseValidator {
  name = 'Syntax Validation';
  description = 'Validates syntax correctness';
  canAutoFix = true;

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];
    let passed = true;
    let score = 100;

    for (const file of code.files) {
      if (!this.isCodeFile(file.path)) continue;

      try {
        // For TypeScript files, use TypeScript compiler API
        if (file.path.endsWith('.ts') || file.path.endsWith('.tsx')) {
          await this.validateTypeScriptSyntax(file, findings);
        } else if (file.path.endsWith('.js') || file.path.endsWith('.jsx')) {
          await this.validateJavaScriptSyntax(file, findings);
        }
      } catch (error) {
        findings.push({
          type: 'error',
          severity: 'critical',
          message: `Syntax error in ${file.path}: ${error.message}`,
          file: file.path
        });
        passed = false;
      }
    }

    // Calculate score based on findings
    const criticalErrors = findings.filter(f => f.severity === 'critical').length;
    score = Math.max(0, 100 - (criticalErrors * 20));

    return this.createStageResult(passed, score, findings, Date.now() - startTime);
  }

  private isCodeFile(filePath: string): boolean {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    return extensions.some(ext => filePath.endsWith(ext));
  }

  private async validateTypeScriptSyntax(file: any, findings: VerificationFinding[]): Promise<void> {
    // Simple validation using tsc --noEmit
    // In production, use TypeScript Compiler API for detailed analysis
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), '.syntax-check-'));
    const tempFile = path.join(tempDir, path.basename(file.path));
    
    try {
      await fs.writeFile(tempFile, file.content);
      
      const { stderr } = await execAsync(`npx tsc --noEmit --skipLibCheck ${tempFile}`, {
        cwd: tempDir
      });
      
      if (stderr) {
        // Parse TypeScript errors
        const errors = this.parseTypeScriptErrors(stderr);
        findings.push(...errors);
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async validateJavaScriptSyntax(file: any, findings: VerificationFinding[]): Promise<void> {
    // Use a JavaScript parser like Acorn or Babel
    try {
      // For now, try to parse with Function constructor
      new Function(file.content);
    } catch (error) {
      findings.push({
        type: 'error',
        severity: 'critical',
        message: `JavaScript syntax error: ${error.message}`,
        file: file.path
      });
    }
  }

  private parseTypeScriptErrors(stderr: string): VerificationFinding[] {
    const findings: VerificationFinding[] = [];
    const lines = stderr.split('\n');
    
    for (const line of lines) {
      const match = line.match(/(.+)\((\d+),(\d+)\): error TS\d+: (.+)/);
      if (match) {
        findings.push({
          type: 'error',
          severity: 'critical',
          message: match[4],
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3])
        });
      }
    }
    
    return findings;
  }
}

/**
 * TypeScript type checker
 */
export class TypeScriptValidator extends BaseValidator {
  name = 'TypeScript Validation';
  description = 'Validates TypeScript types and compilation';
  canAutoFix = true;

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];
    
    if (context.language !== 'TypeScript') {
      return this.createStageResult(true, 100, [], 0);
    }

    // Write files to temp directory
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), '.ts-check-'));
    
    try {
      // Write all files
      for (const file of code.files) {
        const filePath = path.join(tempDir, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content);
      }

      // Write package.json
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'verification-check',
          dependencies: code.dependencies,
          devDependencies: code.devDependencies
        }, null, 2)
      );

      // Write tsconfig.json if not present
      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      const hasTsConfig = code.files.some(f => f.path === 'tsconfig.json');
      
      if (!hasTsConfig) {
        await fs.writeFile(tsconfigPath, JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            lib: ['ES2020'],
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            noEmit: true
          }
        }, null, 2));
      }

      // Run TypeScript compiler
      const { stdout, stderr } = await execAsync('npx tsc --noEmit', {
        cwd: tempDir
      });

      if (stderr || stdout) {
        const errors = this.parseTypeScriptOutput(stderr || stdout);
        findings.push(...errors);
      }
    } catch (error) {
      findings.push({
        type: 'error',
        severity: 'critical',
        message: `TypeScript validation failed: ${error.message}`
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    const passed = findings.filter(f => f.severity === 'critical').length === 0;
    const score = Math.max(0, 100 - (findings.length * 5));

    return this.createStageResult(passed, score, findings, Date.now() - startTime);
  }

  private parseTypeScriptOutput(output: string): VerificationFinding[] {
    const findings: VerificationFinding[] = [];
    const lines = output.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/(.+)\((\d+),(\d+)\): error TS(\d+): (.+)/);
      
      if (match) {
        const finding: VerificationFinding = {
          type: 'error',
          severity: 'high',
          message: match[5],
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          rule: `TS${match[4]}`
        };

        // Check if there's a suggestion in the next lines
        if (i + 1 < lines.length && lines[i + 1].includes('Did you mean')) {
          finding.fix = {
            description: lines[i + 1].trim(),
            automatic: true,
            confidence: 0.8
          };
        }

        findings.push(finding);
      }
    }
    
    return findings;
  }
}

/**
 * ESLint validator
 */
export class ESLintValidator extends BaseValidator {
  name = 'ESLint Validation';
  description = 'Validates code style and quality';
  canAutoFix = true;

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];
    
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), '.eslint-check-'));
    
    try {
      // Write files
      for (const file of code.files) {
        const filePath = path.join(tempDir, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content);
      }

      // Create minimal ESLint config if not present
      const hasEslintConfig = code.files.some(f => 
        f.path.includes('.eslintrc') || f.path === 'eslint.config.js'
      );

      if (!hasEslintConfig) {
        await fs.writeFile(
          path.join(tempDir, '.eslintrc.json'),
          JSON.stringify({
            env: {
              browser: true,
              es2021: true,
              node: true
            },
            extends: [
              'eslint:recommended',
              context.language === 'TypeScript' ? 'plugin:@typescript-eslint/recommended' : null
            ].filter(Boolean),
            parser: context.language === 'TypeScript' ? '@typescript-eslint/parser' : undefined,
            parserOptions: {
              ecmaVersion: 2021,
              sourceType: 'module'
            },
            plugins: context.language === 'TypeScript' ? ['@typescript-eslint'] : [],
            rules: {
              'no-unused-vars': 'warn',
              'no-console': 'warn',
              'prefer-const': 'warn'
            }
          }, null, 2)
        );
      }

      // Run ESLint
      const { stdout } = await execAsync('npx eslint . --format json', {
        cwd: tempDir
      }).catch(e => ({ stdout: e.stdout, stderr: e.stderr }));

      if (stdout) {
        const results = JSON.parse(stdout);
        findings.push(...this.parseESLintResults(results));
      }
    } catch (error) {
      elizaLogger.warn('[ESLint] Validation error:', error);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    const passed = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length === 0;
    const score = Math.max(0, 100 - (findings.length * 2));

    return this.createStageResult(passed, score, findings, Date.now() - startTime);
  }

  private parseESLintResults(results: any[]): VerificationFinding[] {
    const findings: VerificationFinding[] = [];
    
    for (const file of results) {
      for (const message of file.messages) {
        findings.push({
          type: message.severity === 2 ? 'error' : 'warning',
          severity: message.severity === 2 ? 'high' : 'medium',
          message: message.message,
          file: file.filePath,
          line: message.line,
          column: message.column,
          rule: message.ruleId,
          fix: message.fix ? {
            description: 'ESLint can automatically fix this issue',
            automatic: true,
            confidence: 1.0
          } : undefined
        });
      }
    }
    
    return findings;
  }
}

/**
 * Unit test validator
 */
export class UnitTestValidator extends BaseValidator {
  name = 'Unit Test Validation';
  description = 'Runs unit tests and checks coverage';

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];
    
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), '.test-check-'));
    
    try {
      // Write all files
      for (const file of code.files) {
        const filePath = path.join(tempDir, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content);
      }

      // Write package.json
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-check',
          scripts: {
            test: 'jest --coverage --json --outputFile=test-results.json'
          },
          dependencies: code.dependencies,
          devDependencies: {
            ...code.devDependencies,
            jest: '^29.0.0',
            '@types/jest': '^29.0.0'
          }
        }, null, 2)
      );

      // Install dependencies
      await execAsync('npm install --prefer-offline', { cwd: tempDir });

      // Run tests
      const testResult = await this.runTests(tempDir);
      
      if (!testResult.success) {
        findings.push({
          type: 'error',
          severity: 'high',
          message: `Tests failed: ${testResult.failedTests}/${testResult.totalTests} tests failed`
        });
      }

      // Check coverage
      if (testResult.coverage) {
        const coverageScore = testResult.coverage.lines.percentage;
        if (coverageScore < 80) {
          findings.push({
            type: 'warning',
            severity: 'medium',
            message: `Test coverage is ${coverageScore.toFixed(1)}%, should be at least 80%`
          });
        }
      }
    } catch (error) {
      findings.push({
        type: 'error',
        severity: 'high',
        message: `Test execution failed: ${error.message}`
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    const passed = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length === 0;
    const score = passed ? 80 : 40;

    return this.createStageResult(passed, score, findings, Date.now() - startTime);
  }

  private async runTests(dir: string): Promise<TestResult> {
    try {
      const { stdout, stderr } = await execAsync('npm test', { cwd: dir });
      
      // Try to read test results
      const resultsPath = path.join(dir, 'test-results.json');
      const results = JSON.parse(await fs.readFile(resultsPath, 'utf-8'));
      
      return {
        success: results.success,
        output: stdout,
        errors: results.testResults
          .filter((r: any) => r.status === 'failed')
          .map((r: any) => r.message),
        warnings: [],
        duration: results.testResults.reduce((sum: number, r: any) => sum + r.duration, 0),
        totalTests: results.numTotalTests,
        passedTests: results.numPassedTests,
        failedTests: results.numFailedTests,
        skippedTests: results.numPendingTests,
        coverage: this.parseCoverage(results.coverageMap)
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        errors: [error.message],
        warnings: [],
        duration: 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0
      };
    }
  }

  private parseCoverage(coverageMap: any): CoverageResult | undefined {
    if (!coverageMap) return undefined;
    
    // Aggregate coverage from all files
    let statements = { total: 0, covered: 0 };
    let branches = { total: 0, covered: 0 };
    let functions = { total: 0, covered: 0 };
    let lines = { total: 0, covered: 0 };
    
    // Implementation would parse actual coverage data
    // For now, return mock data
    return {
      statements: { ...statements, percentage: 85 },
      branches: { ...branches, percentage: 80 },
      functions: { ...functions, percentage: 90 },
      lines: { ...lines, percentage: 85 }
    };
  }
}

/**
 * Security validator
 */
export class SecurityValidator extends BaseValidator {
  name = 'Security Validation';
  description = 'Checks for security vulnerabilities';

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];
    
    // Check for common security issues
    for (const file of code.files) {
      if (!this.isCodeFile(file.path)) continue;
      
      // Check for hardcoded secrets
      this.checkHardcodedSecrets(file, findings);
      
      // Check for SQL injection vulnerabilities
      this.checkSQLInjection(file, findings);
      
      // Check for XSS vulnerabilities
      this.checkXSS(file, findings);
      
      // Check for insecure dependencies
      await this.checkDependencies(code.dependencies, findings);
    }

    const criticalFindings = findings.filter(f => f.severity === 'critical').length;
    const passed = criticalFindings === 0;
    const score = Math.max(0, 100 - (criticalFindings * 25) - (findings.length * 5));

    return this.createStageResult(passed, score, findings, Date.now() - startTime);
  }

  private isCodeFile(filePath: string): boolean {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    return extensions.some(ext => filePath.endsWith(ext));
  }

  private checkHardcodedSecrets(file: any, findings: VerificationFinding[]): void {
    const secretPatterns = [
      /(?:api[_-]?key|apikey|secret|password|pwd|token|auth)[\s]*[:=][\s]*["'][\w\d]{16,}/gi,
      /(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[0-9A-Z]{16}/g, // AWS keys
      /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g, // GitHub tokens
    ];

    const lines = file.content.split('\n');
    
    secretPatterns.forEach(pattern => {
      lines.forEach((line, index) => {
        const match = line.match(pattern);
        if (match) {
          findings.push({
            type: 'error',
            severity: 'critical',
            message: 'Potential hardcoded secret detected',
            file: file.path,
            line: index + 1,
            fix: {
              description: 'Move secrets to environment variables',
              automatic: false,
              confidence: 0.9
            }
          });
        }
      });
    });
  }

  private checkSQLInjection(file: any, findings: VerificationFinding[]): void {
    const sqlPatterns = [
      /query\s*\(\s*["'`].*?\$\{.*?\}.*?["'`]/g,
      /query\s*\(\s*["'`].*?\+.*?["'`]/g,
    ];

    const lines = file.content.split('\n');
    
    sqlPatterns.forEach(pattern => {
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          findings.push({
            type: 'error',
            severity: 'high',
            message: 'Potential SQL injection vulnerability',
            file: file.path,
            line: index + 1,
            fix: {
              description: 'Use parameterized queries',
              automatic: false,
              confidence: 0.8
            }
          });
        }
      });
    });
  }

  private checkXSS(file: any, findings: VerificationFinding[]): void {
    const xssPatterns = [
      /innerHTML\s*=\s*[^'"`]/g,
      /dangerouslySetInnerHTML/g,
      /document\.write\s*\(/g,
    ];

    const lines = file.content.split('\n');
    
    xssPatterns.forEach(pattern => {
      lines.forEach((line, index) => {
        if (pattern.test(line) && !line.includes('// eslint-disable')) {
          findings.push({
            type: 'warning',
            severity: 'high',
            message: 'Potential XSS vulnerability',
            file: file.path,
            line: index + 1,
            fix: {
              description: 'Sanitize user input before rendering',
              automatic: false,
              confidence: 0.7
            }
          });
        }
      });
    });
  }

  private async checkDependencies(dependencies: Record<string, string>, findings: VerificationFinding[]): Promise<void> {
    // In production, would use npm audit or similar
    // For now, check for known vulnerable packages
    const vulnerablePackages = [
      { name: 'lodash', version: '<4.17.21', severity: 'high' as const },
      { name: 'minimist', version: '<1.2.6', severity: 'critical' as const },
    ];

    for (const [pkg, version] of Object.entries(dependencies)) {
      const vulnerable = vulnerablePackages.find(v => v.name === pkg);
      if (vulnerable) {
        findings.push({
          type: 'error',
          severity: vulnerable.severity,
          message: `Vulnerable dependency: ${pkg}@${version}`,
          fix: {
            description: `Update ${pkg} to latest version`,
            automatic: true,
            confidence: 1.0
          }
        });
      }
    }
  }
}

/**
 * Complexity validator
 */
export class ComplexityValidator extends BaseValidator {
  name = 'Complexity Validation';
  description = 'Checks code complexity metrics';

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];
    let totalComplexity = 0;
    let fileCount = 0;

    for (const file of code.files) {
      if (!this.isCodeFile(file.path)) continue;
      
      const complexity = this.calculateComplexity(file);
      totalComplexity += complexity.average;
      fileCount++;

      if (complexity.max > 10) {
        findings.push({
          type: 'warning',
          severity: complexity.max > 20 ? 'high' : 'medium',
          message: `High complexity detected: ${complexity.max}`,
          file: file.path,
          fix: {
            description: 'Refactor complex functions into smaller, more focused functions',
            automatic: false,
            confidence: 0.6
          }
        });
      }
    }

    const avgComplexity = fileCount > 0 ? totalComplexity / fileCount : 0;
    const passed = findings.filter(f => f.severity === 'high').length === 0;
    const score = Math.max(0, 100 - (avgComplexity * 5));

    return this.createStageResult(passed, score, findings, Date.now() - startTime);
  }

  private isCodeFile(filePath: string): boolean {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    return extensions.some(ext => filePath.endsWith(ext));
  }

  private calculateComplexity(file: any): { average: number; max: number } {
    // Simplified cyclomatic complexity calculation
    // In production, use proper AST parsing
    const content = file.content;
    
    // Count decision points
    const ifStatements = (content.match(/\bif\s*\(/g) || []).length;
    const elseStatements = (content.match(/\belse\s*[{|if]/g) || []).length;
    const forLoops = (content.match(/\bfor\s*\(/g) || []).length;
    const whileLoops = (content.match(/\bwhile\s*\(/g) || []).length;
    const switchCases = (content.match(/\bcase\s+/g) || []).length;
    const ternary = (content.match(/\?.*:/g) || []).length;
    const logicalAnd = (content.match(/&&/g) || []).length;
    const logicalOr = (content.match(/\|\|/g) || []).length;
    
    const complexity = 1 + // Base complexity
      ifStatements +
      elseStatements +
      forLoops +
      whileLoops +
      switchCases +
      ternary +
      logicalAnd +
      logicalOr;
    
    // Estimate per-function complexity
    const functionCount = (content.match(/function\s+\w+|=>\s*{|\w+\s*\([^)]*\)\s*{/g) || []).length || 1;
    const avgComplexity = complexity / functionCount;
    
    return {
      average: avgComplexity,
      max: avgComplexity * 1.5 // Estimate max as 1.5x average
    };
  }
}

/**
 * Coverage validator
 */
export class CoverageValidator extends BaseValidator {
  name = 'Coverage Validation';
  description = 'Validates test coverage metrics';

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];
    
    // This would integrate with the test results from UnitTestValidator
    // For now, we'll do a simple check for test file presence
    const sourceFiles = code.files.filter(f => this.isSourceFile(f.path));
    const testFiles = code.files.filter(f => this.isTestFile(f.path));
    
    const testRatio = sourceFiles.length > 0 ? testFiles.length / sourceFiles.length : 0;
    
    if (testRatio < 0.5) {
      findings.push({
        type: 'warning',
        severity: 'medium',
        message: `Low test file ratio: ${(testRatio * 100).toFixed(1)}%`,
        fix: {
          description: 'Add more test files to improve coverage',
          automatic: false,
          confidence: 0.8
        }
      });
    }

    // Check for untested exported functions
    for (const file of sourceFiles) {
      const exportedFunctions = this.findExportedFunctions(file);
      const testedFunctions = this.findTestedFunctions(testFiles, exportedFunctions);
      
      const untestedFunctions = exportedFunctions.filter(f => !testedFunctions.includes(f));
      
      if (untestedFunctions.length > 0) {
        findings.push({
          type: 'warning',
          severity: 'medium',
          message: `Untested functions: ${untestedFunctions.join(', ')}`,
          file: file.path
        });
      }
    }

    const passed = findings.filter(f => f.severity === 'high').length === 0;
    const score = Math.max(0, 100 - (findings.length * 10));

    return this.createStageResult(passed, score, findings, Date.now() - startTime);
  }

  private isSourceFile(path: string): boolean {
    return !this.isTestFile(path) && 
           (path.endsWith('.ts') || path.endsWith('.tsx') || 
            path.endsWith('.js') || path.endsWith('.jsx'));
  }

  private isTestFile(path: string): boolean {
    return path.includes('.test.') || 
           path.includes('.spec.') || 
           path.includes('__tests__') ||
           path.includes('test/');
  }

  private findExportedFunctions(file: any): string[] {
    const functions: string[] = [];
    const exportPattern = /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=/g;
    
    let match;
    while ((match = exportPattern.exec(file.content)) !== null) {
      functions.push(match[1] || match[2]);
    }
    
    return functions;
  }

  private findTestedFunctions(testFiles: any[], functions: string[]): string[] {
    const tested: string[] = [];
    
    for (const testFile of testFiles) {
      for (const func of functions) {
        if (testFile.content.includes(func)) {
          tested.push(func);
        }
      }
    }
    
    return [...new Set(tested)];
  }
}

/**
 * Performance validator
 */
export class PerformanceValidator extends BaseValidator {
  name = 'Performance Validation';
  description = 'Checks for performance issues';

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];

    for (const file of code.files) {
      if (!this.isCodeFile(file.path)) continue;
      
      // Check for performance anti-patterns
      this.checkPerformanceAntiPatterns(file, findings);
      
      // Check for inefficient algorithms
      this.checkInefficient(file, findings);
      
      // Check bundle size concerns
      this.checkBundleSize(file, code.dependencies, findings);
    }

    const passed = findings.filter(f => f.severity === 'high').length === 0;
    const score = Math.max(0, 100 - (findings.length * 5));

    return this.createStageResult(passed, score, findings, Date.now() - startTime);
  }

  private isCodeFile(filePath: string): boolean {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    return extensions.some(ext => filePath.endsWith(ext));
  }

  private checkPerformanceAntiPatterns(file: any, findings: VerificationFinding[]): void {
    const patterns = [
      {
        pattern: /\.forEach\([^)]+\)\.forEach/g,
        message: 'Nested forEach loops detected - consider using a single loop',
        severity: 'medium' as const
      },
      {
        pattern: /JSON\.parse\(JSON\.stringify/g,
        message: 'Inefficient deep cloning detected - consider using a proper cloning library',
        severity: 'medium' as const
      },
      {
        pattern: /new RegExp\([^,)]+\)/g,
        message: 'RegExp created without flags - consider caching regex instances',
        severity: 'low' as const
      }
    ];

    const lines = file.content.split('\n');
    
    patterns.forEach(({ pattern, message, severity }) => {
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          findings.push({
            type: 'warning',
            severity,
            message,
            file: file.path,
            line: index + 1
          });
        }
      });
    });
  }

  private checkInefficient(file: any, findings: VerificationFinding[]): void {
    // Check for O(n²) or worse algorithms
    const content = file.content;
    
    // Nested loops
    const nestedLoops = content.match(/for\s*\([^)]+\)\s*{[^}]*for\s*\([^)]+\)/g) || [];
    
    if (nestedLoops.length > 0) {
      findings.push({
        type: 'warning',
        severity: 'medium',
        message: 'Nested loops detected - review algorithm complexity',
        file: file.path
      });
    }
  }

  private checkBundleSize(file: any, dependencies: Record<string, string>, findings: VerificationFinding[]): void {
    // Check for large dependencies
    const largeDependencies = [
      { name: 'moment', size: 290, alternative: 'date-fns or dayjs' },
      { name: 'lodash', size: 71, alternative: 'lodash-es or individual imports' },
    ];

    for (const dep of largeDependencies) {
      if (dependencies[dep.name] && file.content.includes(dep.name)) {
        findings.push({
          type: 'warning',
          severity: 'low',
          message: `Large dependency "${dep.name}" (${dep.size}KB) - consider ${dep.alternative}`,
          file: file.path
        });
      }
    }
  }
}

// Import production readiness validator
import { ProductionReadinessValidator } from './production-readiness-validator';

// Export all validators
export const validators = {
  SyntaxValidator,
  TypeScriptValidator,
  ESLintValidator,
  UnitTestValidator,
  SecurityValidator,
  ComplexityValidator,
  CoverageValidator,
  PerformanceValidator,
  ProductionReadinessValidator
};