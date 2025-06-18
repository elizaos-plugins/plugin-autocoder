import type { IAgentRuntime, UUID } from '@elizaos/core';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as ts from 'typescript';

/**
 * E2E Test for the autocoder plugin's ability to fix intentionally broken code
 */
export const brokenScenariosE2ETest = {
  name: 'broken-scenarios-e2e',
  description:
    'E2E test that verifies the autocoder can fix the intentionally broken test scenarios',
  fn: async (runtime: IAgentRuntime) => {
    console.log('Starting Broken Scenarios E2E Test...');

    try {
      // Find the orchestration-service action
      const autocoderAction = runtime.actions.find((action) => action.name === 'DEVELOP_PLUGIN');

      if (!autocoderAction) {
        throw new Error('DEVELOP_PLUGIN action not found');
      }

      // Create a test project with broken code
      const testProjectPath = path.join(__dirname, 'temp-e2e-broken-scenarios');
      await fs.ensureDir(testProjectPath);
      await fs.ensureDir(path.join(testProjectPath, 'src'));

      // Copy the broken TypeScript file
      await fs.copy(
        path.join(__dirname, 'test-scenarios/broken-tsc.ts'),
        path.join(testProjectPath, 'src/index.ts')
      );

      // Create package.json
      await fs.writeJson(path.join(testProjectPath, 'package.json'), {
        name: '@elizaos/plugin-broken-test',
        version: '0.1.0',
        type: 'module',
        main: 'dist/index.js',
        scripts: {
          build: 'tsc',
          test: 'echo "No tests"',
        },
        devDependencies: {
          '@types/node': '^20.0.0',
          typescript: '^5.0.0',
        },
      });

      // Create tsconfig.json
      await fs.writeJson(path.join(testProjectPath, 'tsconfig.json'), {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          outDir: './dist',
          declaration: true,
        },
        include: ['src/**/*'],
      });

      // Create a message to trigger the autocoder
      const message = {
        id: uuidv4() as UUID,
        content: {
          text: `Fix all TypeScript errors in the plugin at ${testProjectPath}`,
          source: 'test',
        },
        roomId: uuidv4() as UUID,
        agentId: runtime.agentId,
        entityId: runtime.agentId,
        createdAt: Date.now(),
      };

      // Validate the action
      const isValid = await autocoderAction.validate(runtime, message);
      if (!isValid) {
        throw new Error('Message validation failed');
      }

      // Execute the action
      const state = await runtime.composeState(message);
      const responses: any[] = [];
      const callback = async (response: any) => {
        responses.push(response);
        return [];
      };

      await autocoderAction.handler(runtime, message, state, {}, callback);

      // Wait for the action to complete
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Read the fixed file
      const fixedFilePath = path.join(testProjectPath, 'src/index.ts');
      const fixedContent = await fs.readFile(fixedFilePath, 'utf-8');

      console.log('Fixed content preview:', fixedContent.substring(0, 200));

      // Verify the TypeScript errors are fixed by compiling
      const program = ts.createProgram([fixedFilePath], {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        strict: true,
        noEmit: true,
      });

      const diagnostics = ts.getPreEmitDiagnostics(program);
      const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);

      console.log(`TypeScript compilation resulted in ${errors.length} errors`);

      if (errors.length > 0) {
        console.error('TypeScript errors still present:');
        errors.forEach((error) => {
          const message = ts.flattenDiagnosticMessageText(error.messageText, '\n');
          console.error(`- ${error.file?.fileName}:${error.start}: ${message}`);
        });
      }

      // Verify specific fixes were applied
      const checks = {
        'String to number conversion': !fixedContent.includes(
          "const count: number = 'not a number'"
        ),
        'Return types added':
          fixedContent.includes('function getValue()') && fixedContent.includes(': number'),
        'Missing properties fixed':
          fixedContent.includes('email') || !fixedContent.includes('user.email'),
        'Undefined variables defined':
          !fixedContent.includes('undefinedVariable') ||
          fixedContent.includes('const undefinedVariable'),
        'Array types consistent':
          !fixedContent.includes("'three'") || fixedContent.includes('string | number'),
        'Required properties added':
          fixedContent.includes('timeout:') && fixedContent.includes('retries:'),
        'Invalid awaits fixed':
          fixedContent.includes('Promise.resolve') ||
          !fixedContent.includes("await 'not a promise'"),
        'Type assertions fixed':
          fixedContent.includes('as unknown as') || !fixedContent.includes("'hello' as number"),
      };

      console.log('\nFix verification:');
      Object.entries(checks).forEach(([check, passed]) => {
        console.log(`${passed ? '✓' : '✗'} ${check}`);
      });

      const allChecksPassed = Object.values(checks).every((v) => v);

      // Clean up
      await fs.remove(testProjectPath);

      if (!allChecksPassed || errors.length > 0) {
        throw new Error(`Not all TypeScript errors were fixed. ${errors.length} errors remain.`);
      }

      console.log('✅ Broken Scenarios E2E Test PASSED\n');
    } catch (error) {
      console.error('❌ Broken Scenarios E2E Test FAILED:', error);
      throw error;
    }
  },
};
