import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodeHealingManager } from '../managers/code-healing-manager';
import { AutoCodeService } from '../services/autocode-service';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Tests that verify specific error types are actually fixed correctly,
 * not just that the healing process runs.
 */
describe('Error Fixing Verification Tests', () => {
  let healingService: CodeHealingManager;
  let orchestrationService: AutoCodeService;
  let mockRuntime: IAgentRuntime;
  let testProjectPath: string;

  beforeEach(async () => {
    testProjectPath = path.join(__dirname, 'temp-verify-fixes');
    await fs.ensureDir(testProjectPath);

    mockRuntime = {
      agentId: uuidv4() as UUID,
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return 'test-key';
        return null;
      }),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    } as any;

    healingService = new CodeHealingManager();
    orchestrationService = new AutoCodeService(mockRuntime);
  });

  afterEach(async () => {
    await fs.remove(testProjectPath);
  });

  describe('TypeScript Error Fixes', () => {
    describe('Type Assignment Errors', () => {
      it('should fix string assigned to number', async () => {
        const brokenCode = `
const count: number = 'not a number';
const age: number = "25";
`;

        const fixedCode = await healingService.fixTypeScriptError(
          brokenCode,
          "Type 'string' is not assignable to type 'number'",
          'test.ts'
        );

        // The implementation converts numeric strings to numbers
        expect(fixedCode).toContain('const age: number = 25');
        // Non-numeric strings get a comment
        expect(fixedCode).toContain('// Fixed: non-numeric string');
      });

      it('should fix missing return type annotations', async () => {
        const brokenCode = `
function getValue() {
  return 42;
}

function getName() {
  return "John";
}
`;

        const fixedCode = await healingService.fixTypeScriptError(
          brokenCode,
          'Missing return type on function',
          'test.ts'
        );

        // Verify return types are added (implementation adds them)
        expect(fixedCode).toMatch(/function getValue\(\)\s*:\s*number/);
        expect(fixedCode).toMatch(/function getName\(\)\s*:\s*string/);
      });

      it('should fix missing object properties', async () => {
        const brokenCode = `
function processUser(user: { name: string; age: number }) {
  console.log(user.email);
}
`;

        const fixedCode = await healingService.fixTypeScriptError(
          brokenCode,
          "Property 'email' does not exist on type",
          'test.ts'
        );

        // Fixed code should add email as optional
        expect(fixedCode).toMatch(/email\?:\s*string/);
      });

      it('should fix undefined variables', async () => {
        const brokenCode = `
console.log(undefinedVariable);
const result = someUndefinedFunction();
`;

        // Test undefinedVariable
        const fixedCode1 = await healingService.fixTypeScriptError(
          brokenCode,
          "Cannot find name 'undefinedVariable'",
          'test.ts'
        );

        expect(fixedCode1).toContain("const undefinedVariable = 'defined'");

        // Test someUndefinedFunction
        const fixedCode2 = await healingService.fixTypeScriptError(
          brokenCode,
          "Cannot find name 'someUndefinedFunction'",
          'test.ts'
        );

        expect(fixedCode2).toContain("const someUndefinedFunction = () => 'result'");
      });

      it('should fix array type mismatches', async () => {
        const brokenCode = `
const numbers: number[] = [1, 2, 'three', 4];
const items: string[] = ['a', 'b', 3, 'd'];
`;

        const fixedCode = await healingService.fixTypeScriptError(
          brokenCode,
          "Type 'string' is not assignable to type 'number'",
          'test.ts'
        );

        // The implementation replaces 'three' with 3
        expect(fixedCode).toContain('const numbers: number[] = [1, 2, 3, 4]');

        // For items array, numbers are converted to strings
        expect(fixedCode).toMatch(/const items: string\[\] = \[.*'3'.*\]/);
      });

      it('should fix missing required properties in objects', async () => {
        const brokenCode = `
interface Config {
  apiKey: string;
  timeout: number;
  retries: number;
}

const config: Config = {
  apiKey: 'test'
};
`;

        const fixedCode = await healingService.fixTypeScriptError(
          brokenCode,
          "Property 'timeout' is missing",
          'test.ts'
        );

        // Verify required properties are added with defaults
        expect(fixedCode).toMatch(/timeout:\s*5000/);
        expect(fixedCode).toMatch(/retries:\s*3/);
      });

      it('should fix incorrect promise handling', async () => {
        const brokenCode = `
async function fetchData() {
  const result = await 'not a promise';
  const data = await 42;
  return result;
}
`;

        const fixedCode = await healingService.fixTypeScriptError(
          brokenCode,
          "not a valid operand for 'await'",
          'test.ts'
        );

        // Fixed code should wrap non-promises in Promise.resolve
        expect(fixedCode).toMatch(/await\s+Promise\.resolve/);
      });

      it('should fix invalid type assertions', async () => {
        const brokenCode = `
const value = 'hello' as number;
const num = true as string;
`;

        const fixedCode = await healingService.fixTypeScriptError(
          brokenCode,
          'Conversion of type',
          'test.ts'
        );

        // Fixed code should use double assertion through unknown
        expect(fixedCode).toContain('as unknown as');
      });
    });
  });

  describe('ESLint Error Fixes', () => {
    it('should fix unused variables', async () => {
      const brokenCode = `
const unused = "I'm not used anywhere";
const used = "I am used";
console.log(used);
`;

      const fixedCode = await healingService.fixESLintError(
        brokenCode,
        "'unused' is assigned a value but never used",
        'test.ts'
      );

      // Verify unused variable is removed
      expect(fixedCode).not.toContain("I'm not used anywhere");
      expect(fixedCode).toContain('used');
    });

    it('should fix missing semicolons', async () => {
      const brokenCode = `
const a = 1
const b = 2
function test() {
  return a + b
}
`;

      const fixedCode = await healingService.fixESLintError(
        brokenCode,
        'Missing semicolon',
        'test.ts'
      );

      // Verify semicolons are added
      expect(fixedCode).toContain('const a = 1;');
      expect(fixedCode).toContain('const b = 2;');
      expect(fixedCode).toContain('return a + b;');
    });

    it('should fix == to ===', async () => {
      const brokenCode = `
if (5 == '5') {
  console.log('equal');
}
if (null == undefined) {
  console.log('null');
}
`;

      const fixedCode = await healingService.fixESLintError(
        brokenCode,
        "Expected '===' and instead saw '=='",
        'test.ts'
      );

      // Verify strict equality is used
      expect(fixedCode).toContain('===');
      expect(fixedCode).not.toMatch(/([^=])==([^=])/);
    });

    it('should fix var to let/const', async () => {
      const brokenCode = `
var oldStyle = 'use let or const instead';
var mutable = 1;
mutable = 2;
var immutable = 'never changes';
`;

      const fixedCode = await healingService.fixESLintError(
        brokenCode,
        'Unexpected var',
        'test.ts'
      );

      // Verify var is replaced with let/const
      expect(fixedCode).not.toContain('var ');
      expect(fixedCode).toMatch(/const\s+oldStyle/);
      expect(fixedCode).toMatch(/let\s+mutable/);
      expect(fixedCode).toMatch(/const\s+immutable/);
    });

    it('should remove or fix console.log statements', async () => {
      const brokenCode = `
console.log('debug info');
function process() {
  console.error('An error occurred');
  return true;
}
`;

      const fixedCode = await healingService.fixESLintError(
        brokenCode,
        'Unexpected console statement',
        'test.ts'
      );

      // Verify console statements are removed
      expect(fixedCode).not.toContain('console.log');
      expect(fixedCode).not.toContain('console.error');
    });

    it('should fix unreachable code', async () => {
      const brokenCode = `
function unreachable() {
  return true;
  console.log('This is unreachable');
  const neverRuns = 'dead code';
}
`;

      const fixedCode = await healingService.fixESLintError(
        brokenCode,
        'Unreachable code',
        'test.ts'
      );

      // Verify unreachable code is removed
      expect(fixedCode).not.toContain('This is unreachable');
      expect(fixedCode).not.toContain('dead code');
    });
  });

  describe('Build Error Fixes', () => {
    it('should fix module import errors', async () => {
      const brokenCode = `
import { NonExistent } from './does-not-exist';
import express from 'express';
export { phantom } from './phantom-module';
`;

      const fixedCode = await healingService.fixBuildError(
        brokenCode,
        'Cannot find module',
        'test.ts'
      );

      // Verify problematic imports are commented out
      expect(fixedCode).toContain('// Removed broken import');
      expect(fixedCode).toContain('// Removed broken re-export');
      expect(fixedCode).toContain('express'); // Valid import should remain
    });

    it('should fix circular dependencies', async () => {
      const brokenCode = `
export { brokenBuild } from './broken-build';
import { something } from './broken-build';
`;

      const fixedCode = await healingService.fixBuildError(
        brokenCode,
        'Circular',
        'broken-build.ts'
      );

      // Verify circular export is removed
      expect(fixedCode).toContain('// Removed circular export');
    });

    it('should fix invalid export syntax', async () => {
      const brokenCode = `
export default function() {
  return "test";
} as const;

export const conflict = "first";
export { conflict };
`;

      const fixedCode = await healingService.fixBuildError(brokenCode, 'export', 'test.ts');

      // Verify exports are valid
      expect(fixedCode).not.toMatch(/\}\s+as\s+const/);

      // Check that duplicate is commented out
      expect(fixedCode).toContain('// Removed duplicate export');
    });
  });

  describe('Integration: Full Fix Verification', () => {
    it('should fix a file with multiple TypeScript errors', async () => {
      // Create test scenario file if it doesn't exist
      const testScenarioPath = path.join(__dirname, 'test-scenarios/broken-tsc.ts');
      if (!(await fs.pathExists(testScenarioPath))) {
        await fs.ensureDir(path.dirname(testScenarioPath));
        await fs.writeFile(
          testScenarioPath,
          `
export function brokenTypeScript() {
  const count: number = "not a number";
  
  function getValue() {
    return 42;
  }
  
  function processUser(user: { name: string; age: number }) {
    console.log(user.email);
  }
  
  console.log(undefinedVariable);
  
  const numbers: number[] = [1, 2, 'three', 4];
  
  interface Config {
    apiKey: string;
    timeout: number;
  }
  
  const config: Config = {
    apiKey: "test"
  };
  
  async function fetchData() {
    const result = await "not a promise";
    return result;
  }
  
  const value = "hello" as number;
}
`
        );
      }

      const testFile = path.join(testProjectPath, 'multi-error.ts');
      await fs.copy(testScenarioPath, testFile);

      const project = {
        id: uuidv4(),
        name: 'multi-error-test',
        localPath: testProjectPath,
        errors: [],
        currentIteration: 0,
        maxIterations: 5,
      } as any;

      // We can't actually test the full healing without mocking exec,
      // so just test the individual fixes
      const content = await fs.readFile(testFile, 'utf-8');

      // Fix string to number
      let fixed = await healingService.fixTypeScriptError(
        content,
        "Type 'string' is not assignable to type 'number'",
        'test.ts'
      );

      // Fix missing property
      fixed = await healingService.fixTypeScriptError(
        fixed,
        "Property 'email' does not exist on type",
        'test.ts'
      );

      // Verify fixes were applied
      expect(fixed).toContain('// Fixed: non-numeric string');
      expect(fixed).toContain('email?: string');
    });
  });
});
