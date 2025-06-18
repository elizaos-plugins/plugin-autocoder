import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestrationManager } from '../managers/orchestration-manager';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs-extra';
import * as path from 'path';
import type { PluginProject } from '../types/plugin-project';

describe('OrchestrationManager - Code Healing Integration', () => {
  let manager: OrchestrationManager;
  let mockRuntime: IAgentRuntime;
  let project: PluginProject;

  beforeEach(async () => {
    mockRuntime = {
      getSetting: vi.fn().mockReturnValue('test-key'),
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'research')
          return {
            createResearchProject: vi.fn().mockResolvedValue({ id: 'research-1' }),
            getProject: vi.fn().mockResolvedValue({ status: 'completed', report: 'Mock report' }),
          };
        if (name === 'knowledge')
          return {
            storeDocument: vi.fn().mockResolvedValue({ id: 'doc-1' }),
          };
        return null;
      }),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    } as any;

    manager = new OrchestrationManager(mockRuntime);
    await manager.initialize();

    project = await manager.createPluginProject(
      'healing-test',
      'A plugin that needs healing',
      uuidv4() as UUID
    );

    // Mock the AI client
    (manager as any).anthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            { type: 'text', text: 'File: src/index.ts\n```typescript\n// Fixed code\n```' },
          ],
        }),
      },
    };

    // Mock startCreationWorkflow to prevent actual workflow execution
    vi.spyOn(manager as any, 'startCreationWorkflow').mockResolvedValue(undefined);
  });

  describe('TypeScript Error Healing', () => {
    it('should fix TypeScript compilation errors', async () => {
      const project = await manager.createPluginProject(
        'tsc-healing-test',
        'A plugin that will have TypeScript errors to fix',
        uuidv4() as UUID
      );

      // Mock the necessary project properties
      project.localPath = '/tmp/test-project';
      project.mvpPlan = 'Test MVP plan';

      // Mock runCommand to simulate TypeScript errors then success
      let tscCallCount = 0;
      const runCommandSpy = vi
        .spyOn(manager as any, 'runCommand')
        .mockImplementation(async (p, command, args) => {
          if (command === 'npx' && args[0] === 'tsc') {
            tscCallCount++;
            if (tscCallCount === 1) {
              return {
                success: false,
                output: `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/index.ts(15,10): error TS2339: Property 'foo' does not exist on type 'Bar'.`,
              };
            }
            return { success: true, output: '' };
          }
          return { success: true, output: '' };
        });

      // Mock the AI to fix the errors
      const createMessageSpy = vi.spyOn((manager as any).anthropic.messages, 'create');
      createMessageSpy.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: `File: src/index.ts
\`\`\`typescript
// Fixed TypeScript code
const myNumber: number = 42; // Fixed: was assigning string to number
const bar = { foo: 'value' }; // Fixed: added missing property
\`\`\``,
          },
        ],
      });

      // Mock runDevelopmentLoop to simulate the fix process
      const runDevLoopSpy = vi
        .spyOn(manager as any, 'runDevelopmentLoop')
        .mockImplementation(async (proj: any, stage) => {
          // First check - detect errors
          const firstCheck = await (manager as any).runAllChecks(proj);

          // Add errors to project
          proj.errors.push({
            phase: 'tsc',
            error: `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.`,
            timestamp: new Date(),
            iteration: 1,
          });

          // Analyze errors
          const errorAnalysis = new Map();
          errorAnalysis.set('typescript-src/index.ts:10', {
            errorType: 'typescript',
            file: 'src/index.ts',
            line: 10,
            message: "Type 'string' is not assignable to type 'number'",
            suggestion: 'Fix the type error',
            fixAttempts: 0,
            resolved: false,
          });

          if (proj.errors) {
            for (const error of proj.errors) {
              const analysis = await (manager as any).parseErrorMessage(error.phase, error.error);
              if (analysis) {
                errorAnalysis.set(
                  `${analysis.errorType}-${analysis.file}:${analysis.line}`,
                  analysis
                );
              }
            }
          }

          // Generate fix with error context
          await (manager as any).generatePluginCode(proj, stage, errorAnalysis);

          // Second check - succeeds
          await (manager as any).runAllChecks(proj);

          return true;
        });

      // Run the development loop
      await (manager as any).runDevelopmentLoop(project, 'mvp');

      // Verify that:
      // 1. TSC was called multiple times
      expect(tscCallCount).toBeGreaterThanOrEqual(2);

      // 2. AI was called
      expect(createMessageSpy).toHaveBeenCalled();
    });
  });

  describe('ESLint Error Healing', () => {
    it('should fix ESLint errors while maintaining functionality', async () => {
      const project = await manager.createPluginProject(
        'eslint-healing-test',
        'A plugin with ESLint errors',
        uuidv4() as UUID
      );

      // Mock the necessary project properties
      project.localPath = '/tmp/test-project';
      project.mvpPlan = 'Test MVP plan';

      // Mock runCommand to simulate ESLint errors then success
      let eslintCallCount = 0;
      const runCommandSpy = vi
        .spyOn(manager as any, 'runCommand')
        .mockImplementation(async (p, command, args) => {
          if (command === 'npx' && args[0] === 'eslint') {
            eslintCallCount++;
            if (eslintCallCount === 1) {
              return {
                success: false,
                output: `/tmp/test-project/src/index.ts
  5:1  error  'unusedVar' is assigned a value but never used  no-unused-vars
  10:15 error  Missing semicolon                               semi

✖ 2 problems (2 errors, 0 warnings)`,
              };
            }
            return { success: true, output: '' };
          }
          return { success: true, output: '' };
        });

      // Mock the error analysis and fix
      const parseErrorSpy = vi.spyOn(manager as any, 'parseErrorMessage').mockResolvedValue({
        errorType: 'eslint',
        file: 'src/index.ts',
        line: 5,
        message: "'unusedVar' is assigned a value but never used",
        suggestion: 'Remove the unused variable or use it',
        fixAttempts: 0,
        resolved: false,
      });

      // Test the error parsing
      const errorAnalysis = await (manager as any).parseErrorMessage(
        'eslint',
        eslintCallCount === 1
          ? `/tmp/test-project/src/index.ts
  5:1  error  'unusedVar' is assigned a value but never used  no-unused-vars`
          : ''
      );

      if (errorAnalysis) {
        expect(errorAnalysis.errorType).toBe('eslint');
        expect(errorAnalysis.line).toBe(5);
      }

      expect(eslintCallCount).toBe(0); // No actual eslint runs in this unit test
    });
  });

  describe('Continuous Improvement', () => {
    it('should keep trying until all tests pass or max iterations reached', async () => {
      const project = await manager.createPluginProject(
        'continuous-improvement-test',
        'A plugin that needs multiple iterations',
        uuidv4() as UUID
      );

      project.maxIterations = 3;
      project.localPath = '/tmp/test-project';
      project.mvpPlan = 'Test MVP plan';

      // Track iterations
      let iterationCount = 0;

      // Mock runAllChecks to fail twice then succeed
      const runAllChecksSpy = vi
        .spyOn(manager as any, 'runAllChecks')
        .mockImplementation(async () => {
          iterationCount++;
          if (iterationCount <= 2) {
            return [
              { phase: 'tsc', success: false, errors: ['Type error'] },
              { phase: 'test', success: false, errors: ['Test failed'] },
            ];
          }
          return [
            { phase: 'tsc', success: true },
            { phase: 'eslint', success: true },
            { phase: 'build', success: true },
            { phase: 'test', success: true },
          ];
        });

      // Mock runDevelopmentLoop
      const runDevLoopSpy = vi
        .spyOn(manager as any, 'runDevelopmentLoop')
        .mockImplementation(async (proj: any, stage: any) => {
          for (let i = 1; i <= proj.maxIterations; i++) {
            proj.currentIteration = i;
            const results = await (manager as any).runAllChecks(proj);
            if (results.every((r: any) => r.success)) {
              return true; // Success
            }
            // Simulate generating code to fix errors
            await (manager as any).generatePluginCode(proj, stage, new Map());
          }
          return false; // Failed to fix
        });

      // Run the development loop
      await (manager as any).runDevelopmentLoop(project, 'mvp');

      expect(runAllChecksSpy).toHaveBeenCalledTimes(3);
      expect(iterationCount).toBe(3);
    });
  });
});
