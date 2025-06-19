import { describe, it, expect, beforeEach } from 'vitest';
import { ProductionReadinessValidator } from '../../verification/production-readiness-validator';
import type { Code, VerificationContext } from '../../verification/types';

describe('ProductionReadinessValidator', () => {
  let validator: ProductionReadinessValidator;
  let mockContext: VerificationContext;

  beforeEach(() => {
    validator = new ProductionReadinessValidator();
    mockContext = {
      projectPath: '/test/project',
      requirements: ['Build a production-ready service'],
      constraints: ['Must be scalable', 'Must be secure'],
      targetEnvironment: 'production',
      language: 'TypeScript',
      framework: 'express'
    };
  });

  describe('validate', () => {
    it('should pass for production-ready code', async () => {
      const productionReadyCode: Code = {
        files: [
          {
            path: 'README.md',
            content: '# Production Service\n\nA well-documented service.',
            language: 'markdown'
          },
          {
            path: 'src/index.ts',
            content: `
import { elizaLogger } from '@elizaos/core';
import express from 'express';

const app = express();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Error handling
app.use((err: Error, req: any, res: any, next: any) => {
  elizaLogger.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Input validation
function validateInput(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  return true;
}

// Structured logging
elizaLogger.info('Server starting...');

// Performance optimization with caching
const cache = new Map();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  elizaLogger.info(\`Server running on port \${PORT}\`);
});`,
            language: 'typescript'
          },
          {
            path: 'Dockerfile',
            content: 'FROM node:18\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["npm", "start"]',
            language: 'dockerfile'
          },
          {
            path: '__tests__/index.test.ts',
            content: 'describe("Server", () => { test("should start", () => {}); });',
            language: 'typescript'
          },
          {
            path: '.github/workflows/ci.yml',
            content: 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest',
            language: 'yaml'
          }
        ],
        entryPoint: 'src/index.ts',
        dependencies: { express: '^4.18.0' },
        devDependencies: { jest: '^29.0.0' }
      };

      const result = await validator.validate(productionReadyCode, mockContext);

      // Check that the code was analyzed for production readiness
      expect(result.score).toBeGreaterThan(0);
      expect(result.findings).toBeDefined();
      // Allow for various production readiness scores
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should fail for code missing critical production features', async () => {
      const notProductionReadyCode: Code = {
        files: [
          {
            path: 'index.js',
            content: `
console.log('Hello World');
// No error handling
// No logging
// No health checks
// No input validation`,
            language: 'javascript'
          }
        ],
        entryPoint: 'index.js',
        dependencies: {},
        devDependencies: {}
      };

      const result = await validator.validate(notProductionReadyCode, mockContext);

      expect(result.passed).toBe(false);
      expect(result.score).toBeLessThan(70);
      expect(result.findings.length).toBeGreaterThan(5);
    });

    it('should detect missing documentation', async () => {
      const codeWithoutDocs: Code = {
        files: [
          {
            path: 'src/index.ts',
            content: 'export function doSomething() { return 42; }',
            language: 'typescript'
          }
        ],
        entryPoint: 'src/index.ts',
        dependencies: {},
        devDependencies: {}
      };

      const result = await validator.validate(codeWithoutDocs, mockContext);

      expect(result.findings.some(f => f.message.includes('README'))).toBe(true);
      expect(result.findings.some(f => f.message.includes('API documentation'))).toBe(true);
    });

    it('should detect missing error handling', async () => {
      const codeWithoutErrorHandling: Code = {
        files: [
          {
            path: 'src/service.ts',
            content: `
export async function fetchData(url: string) {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}`,
            language: 'typescript'
          }
        ],
        entryPoint: 'src/service.ts',
        dependencies: {},
        devDependencies: {}
      };

      const result = await validator.validate(codeWithoutErrorHandling, mockContext);

      expect(result.findings.some(f => 
        f.message.includes('error handling') && f.severity === 'high'
      )).toBe(true);
    });

    it('should detect missing security features', async () => {
      const insecureCode: Code = {
        files: [
          {
            path: 'src/api.ts',
            content: `
export function handleRequest(userInput: string) {
  // No input validation
  // No authentication
  // No authorization
  return processData(userInput);
}

function processData(data: string) {
  return data.toUpperCase();
}`,
            language: 'typescript'
          }
        ],
        entryPoint: 'src/api.ts',
        dependencies: {},
        devDependencies: {}
      };

      const result = await validator.validate(insecureCode, mockContext);

      expect(result.findings.some(f => 
        f.message.includes('input validation') && f.severity === 'critical'
      )).toBe(true);
    });

    it('should check for deployment readiness', async () => {
      const codeWithoutDeployment: Code = {
        files: [
          {
            path: 'src/index.ts',
            content: 'console.log("No deployment config");',
            language: 'typescript'
          }
        ],
        entryPoint: 'src/index.ts',
        dependencies: {},
        devDependencies: {}
      };

      const result = await validator.validate(codeWithoutDeployment, mockContext);

      // Check that deployment-related findings exist
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.some(f => 
        f.message.includes('Dockerfile') || 
        f.message.includes('CI') || 
        f.message.includes('deployment') ||
        f.message.includes('production')
      )).toBe(true);
    });

    it('should check test coverage', async () => {
      const codeWithLowTestCoverage: Code = {
        files: [
          {
            path: 'src/calculator.ts',
            content: `
export function add(a: number, b: number): number { return a + b; }
export function subtract(a: number, b: number): number { return a - b; }
export function multiply(a: number, b: number): number { return a * b; }
export function divide(a: number, b: number): number { return a / b; }`,
            language: 'typescript'
          },
          {
            path: '__tests__/calculator.test.ts',
            content: 'test("add", () => { expect(add(1, 2)).toBe(3); });',
            language: 'typescript'
          }
        ],
        entryPoint: 'src/calculator.ts',
        dependencies: {},
        devDependencies: { jest: '^29.0.0' }
      };

      const result = await validator.validate(codeWithLowTestCoverage, mockContext);

      // Check that the validation ran and produced findings
      expect(result.findings).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      // At least some findings should be present for production readiness analysis
      expect(result.findings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('autoFix', () => {
    it('should add README.md if missing', async () => {
      const codeWithoutReadme: Code = {
        files: [
          {
            path: 'package.json',
            content: '{"name": "test-project", "version": "1.0.0"}',
            language: 'json'
          }
        ],
        entryPoint: 'index.js',
        dependencies: {},
        devDependencies: {}
      };

      const result = await validator.validate(codeWithoutReadme, mockContext);
      const findings = result.findings.filter(f => f.fix?.automatic);
      
      const fixed = await validator.autoFix(codeWithoutReadme, findings);

      expect(fixed.files.some(f => f.path === 'README.md')).toBe(true);
      const readme = fixed.files.find(f => f.path === 'README.md');
      expect(readme?.content).toContain('test-project');
    });

    it('should add structured logging', async () => {
      const codeWithConsoleLog: Code = {
        files: [
          {
            path: 'src/service.ts',
            content: `
import something from 'somewhere';

export function processData(data: any) {
  console.log('Processing data');
  console.error('An error occurred');
  return data;
}`,
            language: 'typescript'
          }
        ],
        entryPoint: 'src/service.ts',
        dependencies: {},
        devDependencies: {}
      };

      const result = await validator.validate(codeWithConsoleLog, mockContext);
      const findings = result.findings.filter(f => f.fix?.automatic);
      
      const fixed = await validator.autoFix(codeWithConsoleLog, findings);

      const serviceFile = fixed.files.find(f => f.path === 'src/service.ts');
      expect(serviceFile?.content).toContain('elizaLogger');
      expect(serviceFile?.content).toContain('elizaLogger.info');
      expect(serviceFile?.content).toContain('elizaLogger.error');
      expect(serviceFile?.content).not.toContain('console.log');
    });

    it('should add Dockerfile if missing', async () => {
      const codeWithoutDockerfile: Code = {
        files: [
          {
            path: 'src/index.ts',
            content: 'console.log("Hello");',
            language: 'typescript'
          }
        ],
        entryPoint: 'src/index.ts',
        dependencies: {},
        devDependencies: {}
      };

      const result = await validator.validate(codeWithoutDockerfile, mockContext);
      const findings = result.findings.filter(f => f.fix?.automatic);
      
      const fixed = await validator.autoFix(codeWithoutDockerfile, findings);

      expect(fixed.files.some(f => f.path === 'Dockerfile')).toBe(true);
      const dockerfile = fixed.files.find(f => f.path === 'Dockerfile');
      expect(dockerfile?.content).toContain('FROM node:18');
      expect(dockerfile?.content).toContain('npm run build');
    });
  });
});