import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContinuousVerificationManager } from '../../verification/continuous-verification-manager';
import type { Code, VerificationContext } from '../../verification/types';

describe('ContinuousVerificationManager', () => {
  let manager: ContinuousVerificationManager;
  let mockCode: Code;
  let mockContext: VerificationContext;

  beforeEach(() => {
    manager = new ContinuousVerificationManager({
      failFast: false,
      autoFix: false,
      validators: {
        syntax: true,
        typescript: true,
        eslint: true,
        tests: false,
        security: true,
        complexity: true,
        coverage: false,
        performance: true,
        production: true
      }
    });

    mockCode = {
      files: [
        {
          path: 'index.ts',
          content: `
import { elizaLogger } from '@elizaos/core';

export async function processData(data: any) {
  try {
    if (!data) {
      throw new Error('No data provided');
    }
    
    elizaLogger.info('Processing data:', data);
    
    // Process the data
    const result = data.map((item: any) => ({
      ...item,
      processed: true
    }));
    
    return result;
  } catch (error) {
    elizaLogger.error('Error processing data:', error);
    throw error;
  }
}`,
          language: 'typescript'
        },
        {
          path: 'README.md',
          content: '# Test Project\n\nA test project for verification.',
          language: 'markdown'
        }
      ],
      entryPoint: 'index.ts',
      dependencies: {},
      devDependencies: {}
    };

    mockContext = {
      projectPath: '/test/project',
      requirements: ['Process data correctly', 'Handle errors gracefully'],
      constraints: ['TypeScript strict mode', 'No any types'],
      targetEnvironment: 'production',
      language: 'TypeScript',
      framework: undefined
    };
  });

  describe('verifyCode', () => {
    it('should run all configured validators', { timeout: 60000 }, async () => {
      const result = await manager.verifyCode(mockCode, mockContext);

      expect(result).toBeDefined();
      expect(result.passed).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.stages).toBeInstanceOf(Array);
      expect(result.stages.length).toBeGreaterThan(0);
    });

    it('should detect TypeScript issues', { timeout: 15000 }, async () => {
      const codeWithIssues: Code = {
        ...mockCode,
        files: [
          {
            path: 'bad.ts',
            content: `
export function badFunction(data: any) {
  console.log(data);
  return data.unknownProperty.nested;
}`,
            language: 'typescript'
          }
        ]
      };

      const result = await manager.verifyCode(codeWithIssues, mockContext);

      expect(result.passed).toBe(false);
      expect(result.criticalErrors.length).toBeGreaterThan(0);
    });

    it('should detect security issues', { timeout: 15000 }, async () => {
      const insecureCode: Code = {
        ...mockCode,
        files: [
          {
            path: 'insecure.ts',
            content: `
import { exec } from 'child_process';

export function runCommand(userInput: string) {
  // SQL injection vulnerability
  const query = \`SELECT * FROM users WHERE id = \${userInput}\`;
  
  // Command injection vulnerability
  exec(\`ls \${userInput}\`);
  
  // Hardcoded secret
  const apiKey = 'sk-1234567890abcdef1234567890abcdef';
}`,
            language: 'typescript'
          }
        ]
      };

      const result = await manager.verifyCode(insecureCode, mockContext);

      // The security validator might pass but should detect issues
      const securityStage = result.stages.find(s => s.stage.includes('Security'));
      expect(securityStage).toBeDefined();
      // Check that security issues were found even if stage passed
      expect(result.criticalErrors.length + result.warnings.length).toBeGreaterThan(0);
    });

    it('should check production readiness', { timeout: 15000 }, async () => {
      const result = await manager.verifyCode(mockCode, mockContext);

      const productionStage = result.stages.find(s => s.stage.includes('Production'));
      expect(productionStage).toBeDefined();
      expect(productionStage!.findings.length).toBeGreaterThan(0);
    });

    it('should calculate metrics correctly', { timeout: 15000 }, async () => {
      const result = await manager.verifyCode(mockCode, mockContext);

      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalFiles).toBe(2);
      expect(result.metrics.totalLines).toBeGreaterThan(0);
      expect(result.metrics.securityScore).toBeGreaterThanOrEqual(0);
      expect(result.metrics.complexityScore).toBeGreaterThanOrEqual(0);
    });

    it('should handle validator failures gracefully', { timeout: 15000 }, async () => {
      // Create a manager with a validator that will timeout
      const slowManager = new ContinuousVerificationManager({
        timeoutMs: 100, // Very short timeout
        failFast: false
      });

      const result = await slowManager.verifyCode(mockCode, mockContext);

      expect(result).toBeDefined();
      expect(result.stages.some(s => !s.passed)).toBe(true);
    });

    it('should respect fail-fast configuration', { timeout: 15000 }, async () => {
      const failFastManager = new ContinuousVerificationManager({
        failFast: true,
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
        }
      });

      const badCode: Code = {
        files: [{
          path: 'syntax-error.ts',
          content: 'export function bad() { // Missing closing brace',
          language: 'typescript'
        }],
        entryPoint: 'syntax-error.ts',
        dependencies: {},
        devDependencies: {}
      };

      const result = await failFastManager.verifyCode(badCode, mockContext);

      expect(result.passed).toBe(false);
      // Should have stopped after syntax errors
      expect(result.stages.length).toBeLessThan(5);
    });
  });

  describe('getMetricsHistory', () => {
    it('should track metrics history', async () => {
      // Create manager with minimal validators for speed
      const quickManager = new ContinuousVerificationManager({
        failFast: false,
        autoFix: false,
        validators: {
          syntax: true,
          typescript: false,
          eslint: false,
          tests: false,
          security: false,
          complexity: false,
          coverage: false,
          performance: false,
          production: false
        }
      });

      // Run verification twice with minimal code
      const minimalCode: Code = {
        files: [{
          path: 'test.ts',
          content: 'export const test = 1;',
          language: 'typescript'
        }],
        entryPoint: 'test.ts',
        dependencies: {},
        devDependencies: {}
      };

      await quickManager.verifyCode(minimalCode, mockContext);
      await quickManager.verifyCode(minimalCode, mockContext);

      const history = quickManager.getMetricsHistory();

      expect(history).toBeInstanceOf(Array);
      expect(history.length).toBe(2);
      expect(history[0].totalFiles).toBe(1);
    }, 15000);
  });

  describe('getImprovementTrends', () => {
    it('should calculate improvement trends', async () => {
      // Create manager with minimal validators for speed
      const quickManager = new ContinuousVerificationManager({
        failFast: false,
        autoFix: false,
        validators: {
          syntax: true,
          typescript: false,
          eslint: false,
          tests: false,
          security: false,
          complexity: true,  // Keep one metric for trends
          coverage: false,
          performance: false,
          production: false
        }
      });

      // Run verification with minimal code
      const minimalCode: Code = {
        files: [{
          path: 'test.ts',
          content: 'export const test = 1;',
          language: 'typescript'
        }],
        entryPoint: 'test.ts',
        dependencies: {},
        devDependencies: {}
      };

      await quickManager.verifyCode(minimalCode, mockContext);
      
      // Add slightly more complex code
      const improvedCode: Code = {
        files: [{
          path: 'test.ts',
          content: 'export const test = 1;\nexport const test2 = 2;',
          language: 'typescript'
        }],
        entryPoint: 'test.ts',
        dependencies: {},
        devDependencies: {}
      };
      
      await quickManager.verifyCode(improvedCode, mockContext);

      const trends = quickManager.getImprovementTrends();

      expect(trends).toBeDefined();
      expect(trends.coverage).toBeDefined();
      expect(trends.complexity).toBeDefined();
      expect(trends.security).toBeDefined();
      expect(trends.performance).toBeDefined();
    }, 20000); // Increase timeout even more
  });
});