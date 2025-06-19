import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  Validator,
  Code,
  VerificationContext,
  VerificationStageResult,
  VerificationFinding
} from './types';

/**
 * Production readiness checks
 */
export interface ProductionChecks {
  documentation: DocumentationCheck;
  errorHandling: ErrorHandlingCheck;
  logging: LoggingCheck;
  monitoring: MonitoringCheck;
  security: SecurityCheck;
  performance: PerformanceCheck;
  deployment: DeploymentCheck;
  testing: TestingCheck;
}

export interface DocumentationCheck {
  hasReadme: boolean;
  hasApiDocs: boolean;
  hasInlineComments: boolean;
  hasTypeDefinitions: boolean;
  documentationScore: number;
}

export interface ErrorHandlingCheck {
  hasTryCatch: boolean;
  hasErrorBoundaries: boolean;
  hasGracefulDegradation: boolean;
  hasRetryLogic: boolean;
  errorHandlingScore: number;
}

export interface LoggingCheck {
  hasStructuredLogging: boolean;
  hasErrorLogging: boolean;
  hasPerformanceLogging: boolean;
  hasDebugLogging: boolean;
  loggingScore: number;
}

export interface MonitoringCheck {
  hasHealthChecks: boolean;
  hasMetrics: boolean;
  hasAlerts: boolean;
  hasTracing: boolean;
  monitoringScore: number;
}

export interface SecurityCheck {
  hasInputValidation: boolean;
  hasAuthentication: boolean;
  hasAuthorization: boolean;
  hasSecureConfiguration: boolean;
  securityScore: number;
}

export interface PerformanceCheck {
  hasOptimizations: boolean;
  hasCaching: boolean;
  hasLazyLoading: boolean;
  hasResourceLimits: boolean;
  performanceScore: number;
}

export interface DeploymentCheck {
  hasDockerfile: boolean;
  hasCI: boolean;
  hasEnvironmentConfig: boolean;
  hasHealthEndpoint: boolean;
  deploymentScore: number;
}

export interface TestingCheck {
  hasUnitTests: boolean;
  hasIntegrationTests: boolean;
  hasE2ETests: boolean;
  testCoverage: number;
  testingScore: number;
}

/**
 * Validates production readiness of code
 */
export class ProductionReadinessValidator implements Validator {
  name = 'Production Readiness Validation';
  description = 'Ensures code is production-ready';
  canAutoFix = true;

  async validate(code: Code, context: VerificationContext): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const findings: VerificationFinding[] = [];
    
    // Run all production checks
    const checks = await this.runProductionChecks(code, context);
    
    // Generate findings based on checks
    this.generateFindings(checks, findings);
    
    // Calculate overall score
    const score = this.calculateScore(checks);
    const passed = score >= 70 && this.hasMinimumRequirements(checks);
    
    return {
      stage: this.name,
      validator: this.constructor.name,
      passed,
      score,
      duration: Date.now() - startTime,
      findings
    };
  }

  /**
   * Run all production readiness checks
   */
  private async runProductionChecks(
    code: Code,
    context: VerificationContext
  ): Promise<ProductionChecks> {
    const [
      documentation,
      errorHandling,
      logging,
      monitoring,
      security,
      performance,
      deployment,
      testing
    ] = await Promise.all([
      this.checkDocumentation(code),
      this.checkErrorHandling(code),
      this.checkLogging(code),
      this.checkMonitoring(code),
      this.checkSecurity(code),
      this.checkPerformance(code),
      this.checkDeployment(code),
      this.checkTesting(code)
    ]);

    return {
      documentation,
      errorHandling,
      logging,
      monitoring,
      security,
      performance,
      deployment,
      testing
    };
  }

  /**
   * Check documentation
   */
  private async checkDocumentation(code: Code): Promise<DocumentationCheck> {
    const hasReadme = code.files.some(f => f.path.toLowerCase() === 'readme.md');
    const hasApiDocs = code.files.some(f => 
      f.path.includes('docs') || f.content.includes('@api') || f.content.includes('swagger')
    );
    
    // Check inline comments
    let totalLines = 0;
    let commentLines = 0;
    
    for (const file of code.files) {
      if (this.isCodeFile(file.path)) {
        const lines = file.content.split('\n');
        totalLines += lines.length;
        commentLines += lines.filter(l => 
          l.trim().startsWith('//') || 
          l.trim().startsWith('/*') || 
          l.trim().startsWith('*')
        ).length;
      }
    }
    
    const commentRatio = totalLines > 0 ? commentLines / totalLines : 0;
    const hasInlineComments = commentRatio > 0.1;
    
    // Check type definitions
    const hasTypeDefinitions = code.files.some(f => 
      f.path.endsWith('.d.ts') || 
      f.content.includes('interface') || 
      f.content.includes('type ')
    );
    
    const documentationScore = 
      (hasReadme ? 25 : 0) +
      (hasApiDocs ? 25 : 0) +
      (hasInlineComments ? 25 : 0) +
      (hasTypeDefinitions ? 25 : 0);
    
    return {
      hasReadme,
      hasApiDocs,
      hasInlineComments,
      hasTypeDefinitions,
      documentationScore
    };
  }

  /**
   * Check error handling
   */
  private async checkErrorHandling(code: Code): Promise<ErrorHandlingCheck> {
    let hasTryCatch = false;
    let hasErrorBoundaries = false;
    let hasGracefulDegradation = false;
    let hasRetryLogic = false;
    
    for (const file of code.files) {
      if (this.isCodeFile(file.path)) {
        const content = file.content;
        
        // Check for try-catch blocks
        if (content.includes('try {') && content.includes('catch')) {
          hasTryCatch = true;
        }
        
        // Check for error boundaries (React)
        if (content.includes('componentDidCatch') || content.includes('ErrorBoundary')) {
          hasErrorBoundaries = true;
        }
        
        // Check for graceful degradation patterns
        if (content.includes('fallback') || content.includes('default:')) {
          hasGracefulDegradation = true;
        }
        
        // Check for retry logic
        if (content.includes('retry') || content.includes('backoff') || content.includes('exponential')) {
          hasRetryLogic = true;
        }
      }
    }
    
    const errorHandlingScore = 
      (hasTryCatch ? 25 : 0) +
      (hasErrorBoundaries ? 25 : 0) +
      (hasGracefulDegradation ? 25 : 0) +
      (hasRetryLogic ? 25 : 0);
    
    return {
      hasTryCatch,
      hasErrorBoundaries,
      hasGracefulDegradation,
      hasRetryLogic,
      errorHandlingScore
    };
  }

  /**
   * Check logging
   */
  private async checkLogging(code: Code): Promise<LoggingCheck> {
    let hasStructuredLogging = false;
    let hasErrorLogging = false;
    let hasPerformanceLogging = false;
    let hasDebugLogging = false;
    
    for (const file of code.files) {
      if (this.isCodeFile(file.path)) {
        const content = file.content;
        
        // Check for structured logging
        if (content.includes('logger.') || content.includes('elizaLogger') || content.includes('winston')) {
          hasStructuredLogging = true;
        }
        
        // Check for error logging
        if (content.includes('.error(') || content.includes('console.error')) {
          hasErrorLogging = true;
        }
        
        // Check for performance logging
        if (content.includes('performance.') || content.includes('Date.now()') || content.includes('performance.mark')) {
          hasPerformanceLogging = true;
        }
        
        // Check for debug logging
        if (content.includes('.debug(') || content.includes('console.debug')) {
          hasDebugLogging = true;
        }
      }
    }
    
    const loggingScore = 
      (hasStructuredLogging ? 40 : 0) +
      (hasErrorLogging ? 30 : 0) +
      (hasPerformanceLogging ? 15 : 0) +
      (hasDebugLogging ? 15 : 0);
    
    return {
      hasStructuredLogging,
      hasErrorLogging,
      hasPerformanceLogging,
      hasDebugLogging,
      loggingScore
    };
  }

  /**
   * Check monitoring
   */
  private async checkMonitoring(code: Code): Promise<MonitoringCheck> {
    let hasHealthChecks = false;
    let hasMetrics = false;
    let hasAlerts = false;
    let hasTracing = false;
    
    for (const file of code.files) {
      if (this.isCodeFile(file.path)) {
        const content = file.content;
        
        // Check for health checks
        if (content.includes('/health') || content.includes('healthcheck') || content.includes('ping')) {
          hasHealthChecks = true;
        }
        
        // Check for metrics
        if (content.includes('metrics') || content.includes('prometheus') || content.includes('statsd')) {
          hasMetrics = true;
        }
        
        // Check for alerts
        if (content.includes('alert') || content.includes('notification') || content.includes('webhook')) {
          hasAlerts = true;
        }
        
        // Check for tracing
        if (content.includes('trace') || content.includes('span') || content.includes('opentelemetry')) {
          hasTracing = true;
        }
      }
    }
    
    const monitoringScore = 
      (hasHealthChecks ? 30 : 0) +
      (hasMetrics ? 30 : 0) +
      (hasAlerts ? 20 : 0) +
      (hasTracing ? 20 : 0);
    
    return {
      hasHealthChecks,
      hasMetrics,
      hasAlerts,
      hasTracing,
      monitoringScore
    };
  }

  /**
   * Check security
   */
  private async checkSecurity(code: Code): Promise<SecurityCheck> {
    let hasInputValidation = false;
    let hasAuthentication = false;
    let hasAuthorization = false;
    let hasSecureConfiguration = false;
    
    for (const file of code.files) {
      if (this.isCodeFile(file.path)) {
        const content = file.content;
        
        // Check for input validation
        if (content.includes('validate') || content.includes('sanitize') || content.includes('escape')) {
          hasInputValidation = true;
        }
        
        // Check for authentication
        if (content.includes('auth') || content.includes('jwt') || content.includes('token')) {
          hasAuthentication = true;
        }
        
        // Check for authorization
        if (content.includes('permission') || content.includes('role') || content.includes('access')) {
          hasAuthorization = true;
        }
        
        // Check for secure configuration
        if (content.includes('process.env') || content.includes('config') || content.includes('.env')) {
          hasSecureConfiguration = true;
        }
      }
    }
    
    const securityScore = 
      (hasInputValidation ? 30 : 0) +
      (hasAuthentication ? 25 : 0) +
      (hasAuthorization ? 25 : 0) +
      (hasSecureConfiguration ? 20 : 0);
    
    return {
      hasInputValidation,
      hasAuthentication,
      hasAuthorization,
      hasSecureConfiguration,
      securityScore
    };
  }

  /**
   * Check performance
   */
  private async checkPerformance(code: Code): Promise<PerformanceCheck> {
    let hasOptimizations = false;
    let hasCaching = false;
    let hasLazyLoading = false;
    let hasResourceLimits = false;
    
    for (const file of code.files) {
      if (this.isCodeFile(file.path)) {
        const content = file.content;
        
        // Check for optimizations
        if (content.includes('memo') || content.includes('useMemo') || content.includes('optimize')) {
          hasOptimizations = true;
        }
        
        // Check for caching
        if (content.includes('cache') || content.includes('redis') || content.includes('memcached')) {
          hasCaching = true;
        }
        
        // Check for lazy loading
        if (content.includes('lazy') || content.includes('dynamic') || content.includes('import(')) {
          hasLazyLoading = true;
        }
        
        // Check for resource limits
        if (content.includes('limit') || content.includes('throttle') || content.includes('debounce')) {
          hasResourceLimits = true;
        }
      }
    }
    
    const performanceScore = 
      (hasOptimizations ? 25 : 0) +
      (hasCaching ? 25 : 0) +
      (hasLazyLoading ? 25 : 0) +
      (hasResourceLimits ? 25 : 0);
    
    return {
      hasOptimizations,
      hasCaching,
      hasLazyLoading,
      hasResourceLimits,
      performanceScore
    };
  }

  /**
   * Check deployment readiness
   */
  private async checkDeployment(code: Code): Promise<DeploymentCheck> {
    const hasDockerfile = code.files.some(f => 
      f.path.toLowerCase() === 'dockerfile' || f.path.toLowerCase().endsWith('dockerfile')
    );
    
    const hasCI = code.files.some(f => 
      f.path.includes('.github/workflows') || 
      f.path.includes('.gitlab-ci') || 
      f.path.includes('.circleci')
    );
    
    const hasEnvironmentConfig = code.files.some(f => 
      f.path.includes('.env.example') || 
      f.path.includes('config') ||
      f.content.includes('process.env')
    );
    
    let hasHealthEndpoint = false;
    for (const file of code.files) {
      if (this.isCodeFile(file.path) && 
          (file.content.includes('/health') || file.content.includes('healthcheck'))) {
        hasHealthEndpoint = true;
        break;
      }
    }
    
    const deploymentScore = 
      (hasDockerfile ? 25 : 0) +
      (hasCI ? 25 : 0) +
      (hasEnvironmentConfig ? 25 : 0) +
      (hasHealthEndpoint ? 25 : 0);
    
    return {
      hasDockerfile,
      hasCI,
      hasEnvironmentConfig,
      hasHealthEndpoint,
      deploymentScore
    };
  }

  /**
   * Check testing
   */
  private async checkTesting(code: Code): Promise<TestingCheck> {
    const testFiles = code.files.filter(f => 
      f.path.includes('.test.') || 
      f.path.includes('.spec.') || 
      f.path.includes('__tests__')
    );
    
    const hasUnitTests = testFiles.some(f => 
      f.content.includes('describe') || f.content.includes('test(') || f.content.includes('it(')
    );
    
    const hasIntegrationTests = testFiles.some(f => 
      f.path.includes('integration') || f.content.includes('integration')
    );
    
    const hasE2ETests = testFiles.some(f => 
      f.path.includes('e2e') || f.content.includes('end-to-end')
    );
    
    // Estimate test coverage (simplified)
    const sourceFiles = code.files.filter(f => this.isCodeFile(f.path) && !this.isTestFile(f.path));
    const testCoverage = sourceFiles.length > 0 
      ? Math.min(100, (testFiles.length / sourceFiles.length) * 100)
      : 0;
    
    const testingScore = 
      (hasUnitTests ? 40 : 0) +
      (hasIntegrationTests ? 20 : 0) +
      (hasE2ETests ? 20 : 0) +
      (testCoverage >= 80 ? 20 : testCoverage >= 60 ? 10 : 0);
    
    return {
      hasUnitTests,
      hasIntegrationTests,
      hasE2ETests,
      testCoverage,
      testingScore
    };
  }

  /**
   * Generate findings based on checks
   */
  private generateFindings(checks: ProductionChecks, findings: VerificationFinding[]): void {
    // Documentation findings
    if (!checks.documentation.hasReadme) {
      findings.push({
        type: 'error',
        severity: 'high',
        message: 'Missing README.md file',
        fix: {
          description: 'Add a comprehensive README.md file',
          automatic: true,
          confidence: 0.9
        }
      });
    }
    
    if (!checks.documentation.hasApiDocs) {
      findings.push({
        type: 'warning',
        severity: 'medium',
        message: 'Missing API documentation',
        fix: {
          description: 'Add API documentation using JSDoc or similar',
          automatic: false,
          confidence: 0.7
        }
      });
    }
    
    // Error handling findings
    if (!checks.errorHandling.hasTryCatch) {
      findings.push({
        type: 'error',
        severity: 'high',
        message: 'Missing error handling (try-catch blocks)',
        fix: {
          description: 'Add try-catch blocks around async operations',
          automatic: true,
          confidence: 0.8
        }
      });
    }
    
    // Logging findings
    if (!checks.logging.hasStructuredLogging) {
      findings.push({
        type: 'warning',
        severity: 'medium',
        message: 'No structured logging found',
        fix: {
          description: 'Implement structured logging using elizaLogger',
          automatic: true,
          confidence: 0.9
        }
      });
    }
    
    // Security findings
    if (!checks.security.hasInputValidation) {
      findings.push({
        type: 'error',
        severity: 'critical',
        message: 'Missing input validation',
        fix: {
          description: 'Add input validation for all user inputs',
          automatic: false,
          confidence: 0.7
        }
      });
    }
    
    // Testing findings
    if (checks.testing.testCoverage < 60) {
      findings.push({
        type: 'warning',
        severity: 'high',
        message: `Low test coverage: ${checks.testing.testCoverage.toFixed(1)}%`,
        fix: {
          description: 'Add more unit tests to increase coverage',
          automatic: false,
          confidence: 0.6
        }
      });
    }
    
    // Deployment findings
    if (!checks.deployment.hasDockerfile) {
      findings.push({
        type: 'suggestion',
        severity: 'medium',
        message: 'Missing Dockerfile for containerization',
        fix: {
          description: 'Add a Dockerfile for easy deployment',
          automatic: true,
          confidence: 0.9
        }
      });
    }
  }

  /**
   * Calculate overall score
   */
  private calculateScore(checks: ProductionChecks): number {
    const weights = {
      documentation: 0.15,
      errorHandling: 0.20,
      logging: 0.10,
      monitoring: 0.10,
      security: 0.20,
      performance: 0.10,
      deployment: 0.10,
      testing: 0.15
    };
    
    const score = 
      checks.documentation.documentationScore * weights.documentation +
      checks.errorHandling.errorHandlingScore * weights.errorHandling +
      checks.logging.loggingScore * weights.logging +
      checks.monitoring.monitoringScore * weights.monitoring +
      checks.security.securityScore * weights.security +
      checks.performance.performanceScore * weights.performance +
      checks.deployment.deploymentScore * weights.deployment +
      checks.testing.testingScore * weights.testing;
    
    return Math.round(score);
  }

  /**
   * Check if minimum requirements are met
   */
  private hasMinimumRequirements(checks: ProductionChecks): boolean {
    return (
      checks.errorHandling.hasTryCatch &&
      checks.logging.hasErrorLogging &&
      checks.security.hasInputValidation &&
      checks.testing.testCoverage >= 50
    );
  }

  /**
   * Auto-fix production readiness issues
   */
  async autoFix(code: Code, findings: VerificationFinding[]): Promise<Code> {
    const fixedCode = { ...code };
    
    for (const finding of findings) {
      if (finding.fix?.automatic) {
        switch (finding.message) {
          case 'Missing README.md file':
            fixedCode.files.push(await this.generateReadme(code));
            break;
          case 'No structured logging found':
            fixedCode.files = await this.addStructuredLogging(fixedCode.files);
            break;
          case 'Missing error handling (try-catch blocks)':
            fixedCode.files = await this.addErrorHandling(fixedCode.files);
            break;
          case 'Missing Dockerfile for containerization':
            fixedCode.files.push(await this.generateDockerfile(code));
            break;
        }
      }
    }
    
    return fixedCode;
  }

  /**
   * Generate README file
   */
  private async generateReadme(code: Code): Promise<any> {
    const packageJson = code.files.find(f => f.path === 'package.json');
    const projectName = packageJson 
      ? JSON.parse(packageJson.content).name 
      : 'Project';
    
    return {
      path: 'README.md',
      content: `# ${projectName}

## Overview
This project implements ${projectName}.

## Installation
\`\`\`bash
npm install
\`\`\`

## Usage
\`\`\`bash
npm start
\`\`\`

## Testing
\`\`\`bash
npm test
\`\`\`

## Configuration
See \`.env.example\` for configuration options.

## API Documentation
See \`docs/api.md\` for API documentation.

## License
MIT`,
      language: 'markdown'
    };
  }

  /**
   * Add structured logging
   */
  private async addStructuredLogging(files: any[]): Promise<any[]> {
    return files.map(file => {
      if (this.isCodeFile(file.path) && !file.content.includes('elizaLogger')) {
        // Add import at the top
        const lines = file.content.split('\n');
        const importIndex = lines.findIndex(l => l.startsWith('import'));
        
        if (importIndex >= 0) {
          lines.splice(importIndex, 0, "import { elizaLogger } from '@elizaos/core';");
          
          // Replace console.log with elizaLogger
          file.content = lines.join('\n')
            .replace(/console\.log/g, 'elizaLogger.info')
            .replace(/console\.error/g, 'elizaLogger.error')
            .replace(/console\.warn/g, 'elizaLogger.warn');
        }
      }
      return file;
    });
  }

  /**
   * Add error handling
   */
  private async addErrorHandling(files: any[]): Promise<any[]> {
    return files.map(file => {
      if (this.isCodeFile(file.path)) {
        // Find async functions without try-catch
        const asyncFunctionPattern = /async\s+(\w+)\s*\([^)]*\)\s*{([^}]+)}/g;
        
        file.content = file.content.replace(asyncFunctionPattern, (match, name, body) => {
          if (!body.includes('try {')) {
            return `async ${name}(...args) {
  try {${body}} catch (error) {
    elizaLogger.error(\`Error in ${name}:\`, error);
    throw error;
  }
}`;
          }
          return match;
        });
      }
      return file;
    });
  }

  /**
   * Generate Dockerfile
   */
  private async generateDockerfile(code: Code): Promise<any> {
    const hasTypeScript = code.files.some(f => f.path.endsWith('.ts'));
    
    return {
      path: 'Dockerfile',
      content: `FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

${hasTypeScript ? '# Build TypeScript\nRUN npm run build\n' : ''}

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Start application
CMD ["npm", "start"]`,
      language: 'dockerfile'
    };
  }

  private isCodeFile(filePath: string): boolean {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    return extensions.some(ext => filePath.endsWith(ext));
  }

  private isTestFile(filePath: string): boolean {
    return filePath.includes('.test.') || 
           filePath.includes('.spec.') || 
           filePath.includes('__tests__');
  }
}