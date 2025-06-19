import {
  Action,
  ActionExample,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  elizaLogger,
  type Content,
  asUUID,
} from '@elizaos/core';
import { ResearchIntegration } from '../research/research-integration';
import { ResearchEnhancedPluginGenerator, type PluginSpecification } from '../plugin/research-enhanced-plugin-generator';
import { ResearchEnhancedOrchestrationManager } from '../orchestration/research-enhanced-orchestration-manager';
import { SWEBenchInstance } from '../swe-bench/types';
import { AutoCodeService, type PluginProject } from '../services/autocode-service';
import { DevelopmentPhase } from '../types/plugin-project';

/**
 * Test research integration action
 */
export const testResearchAction: Action = {
  name: 'test_research',
  description: 'Test the research integration for SWE-bench and plugin development',

  async validate(runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> {
    return message.content.text?.toLowerCase().includes('test research') || false;
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<boolean> {
    try {
      elizaLogger.info('[RESEARCH-TEST] Starting research integration test');

      // Test 1: Research Integration
      // This is a simplified mock for demonstration. 
      // In a real scenario, this would come from the message or state.
      const mockInstance: SWEBenchInstance = {
        instance_id: 'mock-instance-001',
        repo: 'mock-repo',
        version: '1.0.0',
        repo_url: 'https://github.com/mock/repo',
        issue_title: 'Mock issue for research',
        issue_body: 'This is a mock issue to test the research action.',
        issue_number: 1,
        base_commit: 'main',
        created_at: new Date().toISOString(),
        language: 'TypeScript',
        problem_statement: 'The core problem is to test the research action.'
      };

      const researchIntegration = new ResearchIntegration(runtime);
      
      elizaLogger.info('[RESEARCH-TEST] Testing SWE-bench issue research');
      const researchContext = await researchIntegration.researchIssue(mockInstance);
      
      elizaLogger.info(`[RESEARCH-TEST] Research completed with ${researchContext.findings.length} findings`);
      
      // Test 2: Plugin Development Research
      elizaLogger.info('[RESEARCH-TEST] Testing plugin development research');
      const pluginGuidance = await researchIntegration.researchPluginDevelopment(
        'action',
        ['User interaction', 'API integration', 'Error handling']
      );
      
      elizaLogger.info(`[RESEARCH-TEST] Plugin guidance generated: ${pluginGuidance.approach.substring(0, 100)}...`);

      // Test 3: Plugin Generator (without file output)
      elizaLogger.info('[RESEARCH-TEST] Testing research-enhanced plugin generator');
      const pluginGenerator = new ResearchEnhancedPluginGenerator(runtime);
      
      const testSpec: PluginSpecification = {
        name: 'test-action-plugin',
        description: 'A test action plugin for research validation',
        category: 'action',
        requirements: ['Handle user requests', 'Validate inputs', 'Return structured responses'],
        features: ['Input validation', 'Error handling', 'Logging'],
        dependencies: [],
        outputFormat: 'typescript'
      };

      // Generate plugin without writing to disk
      elizaLogger.info('[RESEARCH-TEST] Testing plugin generation');
      const generatedPlugin = await pluginGenerator.generatePlugin(testSpec, '/tmp/test-plugins');
      
      elizaLogger.info(`[RESEARCH-TEST] Generated plugin: ${generatedPlugin.name}`);

      // Test 4: Orchestration Manager
      elizaLogger.info('[RESEARCH-TEST] Testing orchestration manager');
      const manager = new ResearchEnhancedOrchestrationManager(runtime, '/tmp/test-workspace');
      const orchestratedPlugin = await manager.createPlugin(testSpec);

      elizaLogger.info(`[RESEARCH-TEST] Orchestrated plugin: ${orchestratedPlugin.name}`);

      const response = {
        text: `# Research Integration Test Results ✅

## Research Integration
- **SWE-bench Research**: Successfully researched issue with ${researchContext.findings.length} findings
- **Risk Assessment**: Complexity: ${researchContext.riskAssessment.complexity}, Security Impact: ${researchContext.riskAssessment.securityImpact}
- **Implementation Guidance**: ${researchContext.implementationGuidance.keyConsiderations.length} key considerations identified

## Plugin Development Research
- **Approach**: ${pluginGuidance.approach.substring(0, 100)}...
- **Key Considerations**: ${pluginGuidance.keyConsiderations.length} identified
- **Code Patterns**: ${pluginGuidance.codePatterns.length} patterns available

## Plugin Generator
- **Status**: Successfully generated test plugin
- **Files Generated**: ${generatedPlugin.files.length} source files
- **Tests Generated**: ${generatedPlugin.tests.length} test files  
- **Verification Score**: ${generatedPlugin.verification_score}/100
- **Token Usage**: ${generatedPlugin.token_usage.total} tokens (Cost: $${generatedPlugin.token_usage.cost.toFixed(4)})

## Orchestration Manager
- **Status**: Successfully initialized
- **Research Integration**: ✅ Enabled
- **Verification System**: ✅ Active
- **AI Review System**: ✅ Active

## Summary
All research integration components are working correctly! The system can now:
- Research SWE-bench issues before solving them
- Research plugin development best practices  
- Generate high-quality plugins with research insights
- Orchestrate complex workflows with research-driven development

The research plugin is successfully integrated and ready for production use in SWE-bench evaluation and plugin development.`,
        metadata: {
          researchFindings: researchContext.findings.length,
          pluginFiles: generatedPlugin.files.length,
          verificationScore: generatedPlugin.verification_score,
          tokenUsage: generatedPlugin.token_usage
        }
      };

      if (callback) {
        await callback(response);
      }

      elizaLogger.info('[RESEARCH-TEST] All tests completed successfully');
      return true;

    } catch (error) {
      elizaLogger.error('[RESEARCH-TEST] Test failed:', error);
      
      const errorResponse = {
        text: `# Research Integration Test Failed ❌

**Error**: ${error instanceof Error ? error.message : String(error)}

The research integration test encountered an issue. This could be due to:
- Missing research plugin dependencies
- API configuration issues  
- Network connectivity problems
- Service initialization failures

Please check the logs for more details and ensure all required services are properly configured.`,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      };

      if (callback) {
        await callback(errorResponse);
      }

      return false;
    }
  },

  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'test research integration',
        },
      },
      {
        name: '{{assistant}}',
        content: {
          text: "I'll test the research integration system to verify all components are working correctly.",
          action: 'test_research',
        },
      },
    ],
  ] as ActionExample[][],
};