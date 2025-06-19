import { elizaLogger } from '@elizaos/core';
import type {
  Validator,
  Code,
  VerificationContext,
  VerificationResult,
  VerificationStageResult,
  VerificationFinding,
  VerificationError,
  VerificationWarning,
  VerificationSuggestion,
  VerificationMetrics,
  CheckResult
} from './types';
import {
  SyntaxValidator,
  TypeScriptValidator,
  ESLintValidator,
  UnitTestValidator,
  SecurityValidator,
  ComplexityValidator,
  CoverageValidator,
  PerformanceValidator
} from './verification-strategies';
import { ProductionReadinessValidator } from './production-readiness-validator';

/**
 * Configuration for verification pipeline
 */
export interface VerificationConfig {
  failFast: boolean;
  parallelExecution: boolean;
  timeoutMs: number;
  criticalOnly: boolean;
  autoFix: boolean;
  validators: {
    syntax: boolean;
    typescript: boolean;
    eslint: boolean;
    tests: boolean;
    security: boolean;
    complexity: boolean;
    coverage: boolean;
    performance: boolean;
    production: boolean;
  };
  thresholds: {
    minScore: number;
    maxCriticalErrors: number;
    maxHighErrors: number;
    minCoverage: number;
    maxComplexity: number;
  };
}

/**
 * Default verification configuration
 */
const DEFAULT_CONFIG: VerificationConfig = {
  failFast: true,
  parallelExecution: true,
  timeoutMs: 300000, // 5 minutes
  criticalOnly: false,
  autoFix: true,
  validators: {
    syntax: true,
    typescript: true,
    eslint: true,
    tests: true,
    security: true,
    complexity: true,
    coverage: true,
    performance: true,
    production: true
  },
  thresholds: {
    minScore: 80,
    maxCriticalErrors: 0,
    maxHighErrors: 3,
    minCoverage: 80,
    maxComplexity: 10
  }
};

/**
 * Manages continuous code verification throughout development
 */
export class ContinuousVerificationManager {
  private validators: Map<string, Validator> = new Map();
  private config: VerificationConfig;
  private metricsHistory: VerificationMetrics[] = [];

  constructor(config: Partial<VerificationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeValidators();
  }

  /**
   * Initialize all validators
   */
  private initializeValidators(): void {
    if (this.config.validators.syntax) {
      this.validators.set('syntax', new SyntaxValidator());
    }
    if (this.config.validators.typescript) {
      this.validators.set('typescript', new TypeScriptValidator());
    }
    if (this.config.validators.eslint) {
      this.validators.set('eslint', new ESLintValidator());
    }
    if (this.config.validators.tests) {
      this.validators.set('tests', new UnitTestValidator());
    }
    if (this.config.validators.security) {
      this.validators.set('security', new SecurityValidator());
    }
    if (this.config.validators.complexity) {
      this.validators.set('complexity', new ComplexityValidator());
    }
    if (this.config.validators.coverage) {
      this.validators.set('coverage', new CoverageValidator());
    }
    if (this.config.validators.performance) {
      this.validators.set('performance', new PerformanceValidator());
    }
    if (this.config.validators.production) {
      this.validators.set('production', new ProductionReadinessValidator());
    }
  }

  /**
   * Verify code with all configured validators
   */
  async verifyCode(
    code: Code,
    context: VerificationContext,
    autoFixAttempts: number = 0
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    elizaLogger.info('[VERIFICATION] Starting comprehensive code verification');

    // Run validators based on configuration
    const stages = await this.runValidators(code, context);
    
    // Analyze results
    const result = this.analyzeResults(stages, code);
    
    // Apply auto-fixes if enabled (with recursion limit)
    const MAX_AUTO_FIX_ATTEMPTS = 3;
    if (this.config.autoFix && !result.passed && autoFixAttempts < MAX_AUTO_FIX_ATTEMPTS) {
      const fixedCode = await this.attemptAutoFix(code, result);
      if (fixedCode) {
        // Re-verify after fixes
        elizaLogger.info(`[VERIFICATION] Re-verifying after auto-fixes (attempt ${autoFixAttempts + 1}/${MAX_AUTO_FIX_ATTEMPTS})`);
        return this.verifyCode(fixedCode, context, autoFixAttempts + 1);
      }
    } else if (autoFixAttempts >= MAX_AUTO_FIX_ATTEMPTS) {
      elizaLogger.warn('[VERIFICATION] Maximum auto-fix attempts reached, stopping');
    }
    
    // Update metrics history
    this.metricsHistory.push(result.metrics);
    
    // Log summary
    this.logSummary(result, Date.now() - startTime);
    
    return result;
  }

  /**
   * Run validators based on configuration
   */
  private async runValidators(
    code: Code,
    context: VerificationContext
  ): Promise<VerificationStageResult[]> {
    const stages: VerificationStageResult[] = [];
    
    if (this.config.parallelExecution) {
      // Run level 1 validators (syntax, typescript)
      const level1 = await this.runLevel1Validators(code, context);
      stages.push(...level1);
      
      // Fail fast if critical errors
      if (this.shouldFailFast(level1)) {
        return stages;
      }
      
      // Run level 2 validators (security, complexity, eslint)
      const level2 = await this.runLevel2Validators(code, context);
      stages.push(...level2);
      
      if (this.shouldFailFast(level2)) {
        return stages;
      }
      
      // Run level 3 validators (tests, coverage, performance)
      const level3 = await this.runLevel3Validators(code, context);
      stages.push(...level3);
      
      if (this.shouldFailFast(level3)) {
        return stages;
      }
      
      // Run level 4 validators (production readiness)
      const level4 = await this.runLevel4Validators(code, context);
      stages.push(...level4);
    } else {
      // Run validators sequentially
      for (const [name, validator] of this.validators) {
        const stage = await this.runValidator(validator, code, context);
        stages.push(stage);
        
        if (this.shouldFailFast([stage])) {
          break;
        }
      }
    }
    
    return stages;
  }

  /**
   * Run level 1 validators (critical for basic code validity)
   */
  private async runLevel1Validators(
    code: Code,
    context: VerificationContext
  ): Promise<VerificationStageResult[]> {
    const promises: Promise<VerificationStageResult>[] = [];
    
    const syntax = this.validators.get('syntax');
    if (syntax) {
      promises.push(this.runValidator(syntax, code, context));
    }
    
    const typescript = this.validators.get('typescript');
    if (typescript && context.language === 'TypeScript') {
      promises.push(this.runValidator(typescript, code, context));
    }
    
    return Promise.all(promises);
  }

  /**
   * Run level 2 validators (code quality and security)
   */
  private async runLevel2Validators(
    code: Code,
    context: VerificationContext
  ): Promise<VerificationStageResult[]> {
    const promises: Promise<VerificationStageResult>[] = [];
    
    const security = this.validators.get('security');
    if (security) {
      promises.push(this.runValidator(security, code, context));
    }
    
    const complexity = this.validators.get('complexity');
    if (complexity) {
      promises.push(this.runValidator(complexity, code, context));
    }
    
    const eslint = this.validators.get('eslint');
    if (eslint) {
      promises.push(this.runValidator(eslint, code, context));
    }
    
    return Promise.all(promises);
  }

  /**
   * Run level 3 validators (tests and advanced checks)
   */
  private async runLevel3Validators(
    code: Code,
    context: VerificationContext
  ): Promise<VerificationStageResult[]> {
    const promises: Promise<VerificationStageResult>[] = [];
    
    const tests = this.validators.get('tests');
    if (tests) {
      promises.push(this.runValidator(tests, code, context));
    }
    
    const coverage = this.validators.get('coverage');
    if (coverage) {
      promises.push(this.runValidator(coverage, code, context));
    }
    
    const performance = this.validators.get('performance');
    if (performance) {
      promises.push(this.runValidator(performance, code, context));
    }
    
    return Promise.all(promises);
  }

  /**
   * Run level 4 validators (production readiness)
   */
  private async runLevel4Validators(
    code: Code,
    context: VerificationContext
  ): Promise<VerificationStageResult[]> {
    const promises: Promise<VerificationStageResult>[] = [];
    
    const production = this.validators.get('production');
    if (production) {
      promises.push(this.runValidator(production, code, context));
    }
    
    return Promise.all(promises);
  }

  /**
   * Run a single validator with timeout
   */
  private async runValidator(
    validator: Validator,
    code: Code,
    context: VerificationContext
  ): Promise<VerificationStageResult> {
    try {
      const timeoutPromise = new Promise<VerificationStageResult>((_, reject) => {
        setTimeout(() => reject(new Error('Validation timeout')), this.config.timeoutMs);
      });
      
      const validationPromise = validator.validate(code, context);
      
      return await Promise.race([validationPromise, timeoutPromise]);
    } catch (error) {
      elizaLogger.error(`[VERIFICATION] ${validator.name} failed:`, error);
      
      return {
        stage: validator.name,
        validator: validator.constructor.name,
        passed: false,
        score: 0,
        duration: 0,
        findings: [{
          type: 'error',
          severity: 'critical',
          message: `Validator failed: ${error.message}`
        }]
      };
    }
  }

  /**
   * Check if should fail fast based on results
   */
  private shouldFailFast(stages: VerificationStageResult[]): boolean {
    if (!this.config.failFast) return false;
    
    const criticalErrors = stages.reduce((sum, stage) => 
      sum + stage.findings.filter(f => f.severity === 'critical').length, 0
    );
    
    return criticalErrors > this.config.thresholds.maxCriticalErrors;
  }

  /**
   * Analyze verification results
   */
  private analyzeResults(
    stages: VerificationStageResult[],
    code: Code
  ): VerificationResult {
    // Extract all findings
    const allFindings = stages.flatMap(s => s.findings);
    
    // Categorize findings
    const criticalErrors = allFindings.filter(
      f => f.type === 'error' && f.severity === 'critical'
    ) as VerificationError[];
    
    const warnings = allFindings.filter(
      f => f.type === 'warning'
    ) as VerificationWarning[];
    
    const suggestions = allFindings.filter(
      f => f.type === 'suggestion'
    ) as VerificationSuggestion[];
    
    // Calculate overall score
    const avgScore = stages.length > 0
      ? stages.reduce((sum, s) => sum + s.score, 0) / stages.length
      : 0;
    
    // Determine if passed
    const passed = this.evaluatePass(avgScore, criticalErrors, stages);
    
    // Calculate metrics
    const metrics = this.calculateMetrics(code, stages);
    
    return {
      passed,
      score: avgScore,
      stages,
      criticalErrors,
      warnings,
      suggestions,
      metrics
    };
  }

  /**
   * Evaluate if verification passed based on thresholds
   */
  private evaluatePass(
    score: number,
    criticalErrors: VerificationError[],
    stages: VerificationStageResult[]
  ): boolean {
    // Must have no critical errors
    if (criticalErrors.length > this.config.thresholds.maxCriticalErrors) {
      return false;
    }
    
    // Must meet minimum score
    if (score < this.config.thresholds.minScore) {
      return false;
    }
    
    // Count high severity errors
    const highErrors = stages.reduce((sum, stage) => 
      sum + stage.findings.filter(f => f.severity === 'high').length, 0
    );
    
    if (highErrors > this.config.thresholds.maxHighErrors) {
      return false;
    }
    
    // All critical stages must pass
    const criticalStages = ['syntax', 'typescript'];
    for (const stageName of criticalStages) {
      const stage = stages.find(s => s.stage.toLowerCase().includes(stageName));
      if (stage && !stage.passed) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Calculate verification metrics
   */
  private calculateMetrics(
    code: Code,
    stages: VerificationStageResult[]
  ): VerificationMetrics {
    // Count lines of code
    const totalLines = code.files.reduce((sum, file) => 
      sum + file.content.split('\n').length, 0
    );
    
    // Extract specific metrics from stages
    let coveragePercentage = 0;
    let complexityScore = 100;
    let securityScore = 100;
    let performanceScore = 100;
    let typeScore = 100;
    let testScore = 100;
    
    stages.forEach(stage => {
      switch (stage.stage.toLowerCase()) {
        case 'coverage validation':
          coveragePercentage = stage.score;
          break;
        case 'complexity validation':
          complexityScore = stage.score;
          break;
        case 'security validation':
          securityScore = stage.score;
          break;
        case 'performance validation':
          performanceScore = stage.score;
          break;
        case 'typescript validation':
          typeScore = stage.score;
          break;
        case 'unit test validation':
          testScore = stage.score;
          break;
      }
    });
    
    // Calculate maintainability score
    const maintainabilityScore = (complexityScore + typeScore + testScore) / 3;
    
    return {
      totalFiles: code.files.length,
      totalLines,
      coveragePercentage,
      complexityScore,
      securityScore,
      performanceScore,
      maintainabilityScore,
      typeScore,
      testScore
    };
  }

  /**
   * Attempt to auto-fix issues
   */
  private async attemptAutoFix(
    code: Code,
    result: VerificationResult
  ): Promise<Code | null> {
    let fixedCode = code;
    let hasChanges = false;
    
    // Get fixable issues
    const fixableIssues = result.stages
      .flatMap(s => s.findings)
      .filter(f => f.fix?.automatic);
    
    if (fixableIssues.length === 0) {
      return null;
    }
    
    elizaLogger.info(`[VERIFICATION] Attempting to auto-fix ${fixableIssues.length} issues`);
    
    // Group fixes by validator
    const fixesByValidator = new Map<string, VerificationFinding[]>();
    
    for (const issue of fixableIssues) {
      const stage = result.stages.find(s => 
        s.findings.includes(issue)
      );
      
      if (stage) {
        const validatorName = stage.validator;
        if (!fixesByValidator.has(validatorName)) {
          fixesByValidator.set(validatorName, []);
        }
        fixesByValidator.get(validatorName)!.push(issue);
      }
    }
    
    // Apply fixes by validator
    for (const [validatorName, findings] of fixesByValidator) {
      const validator = Array.from(this.validators.values())
        .find(v => v.constructor.name === validatorName);
      
      if (validator?.canAutoFix && validator.autoFix) {
        try {
          fixedCode = await validator.autoFix(fixedCode, findings);
          hasChanges = true;
        } catch (error) {
          elizaLogger.error(`[VERIFICATION] Auto-fix failed for ${validatorName}:`, error);
        }
      }
    }
    
    return hasChanges ? fixedCode : null;
  }

  /**
   * Log verification summary
   */
  private logSummary(result: VerificationResult, duration: number): void {
    const emoji = result.passed ? '✅' : '❌';
    const status = result.passed ? 'PASSED' : 'FAILED';
    
    elizaLogger.info(`
${emoji} Verification ${status}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Score: ${result.score.toFixed(1)}/100
Duration: ${(duration / 1000).toFixed(2)}s
Critical Errors: ${result.criticalErrors.length}
Warnings: ${result.warnings.length}
Suggestions: ${result.suggestions.length}

Metrics:
- Files: ${result.metrics.totalFiles}
- Lines: ${result.metrics.totalLines}
- Coverage: ${result.metrics.coveragePercentage.toFixed(1)}%
- Complexity: ${result.metrics.complexityScore.toFixed(1)}/100
- Security: ${result.metrics.securityScore.toFixed(1)}/100
- Performance: ${result.metrics.performanceScore.toFixed(1)}/100
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
    
    // Log critical errors
    if (result.criticalErrors.length > 0) {
      elizaLogger.error('Critical Errors:');
      result.criticalErrors.forEach((error, i) => {
        elizaLogger.error(`  ${i + 1}. ${error.message}`);
        if (error.file) {
          elizaLogger.error(`     File: ${error.file}:${error.line || 0}`);
        }
      });
    }
  }

  /**
   * Get verification history
   */
  getMetricsHistory(): VerificationMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Get improvement trends
   */
  getImprovementTrends(): {
    coverage: number;
    complexity: number;
    security: number;
    performance: number;
  } {
    if (this.metricsHistory.length < 2) {
      return { coverage: 0, complexity: 0, security: 0, performance: 0 };
    }
    
    const recent = this.metricsHistory[this.metricsHistory.length - 1];
    const previous = this.metricsHistory[this.metricsHistory.length - 2];
    
    return {
      coverage: recent.coveragePercentage - previous.coveragePercentage,
      complexity: recent.complexityScore - previous.complexityScore,
      security: recent.securityScore - previous.securityScore,
      performance: recent.performanceScore - previous.performanceScore
    };
  }
}

// Export for convenience
// Types are exported from ./types directly