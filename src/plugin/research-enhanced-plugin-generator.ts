import { elizaLogger, type IAgentRuntime } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ResearchIntegration, type ImplementationGuidance, createResearchPrompt } from '../research/research-integration';
import { ContinuousVerificationManager } from '../verification/continuous-verification-manager';
import type { Code, VerificationContext } from '../verification/types';
import { MultiStageAIReviewer } from '../review/multi-stage-ai-reviewer';

/**
 * Plugin specification for research-driven development
 */
export interface PluginSpecification {
  name: string;
  description: string;
  category: 'action' | 'provider' | 'service' | 'evaluator' | 'client';
  requirements: string[];
  features: string[];
  dependencies?: string[];
  apis?: string[];
  outputFormat?: 'typescript' | 'javascript';
}

/**
 * Generated plugin structure
 */
export interface GeneratedPlugin {
  name: string;
  files: PluginFile[];
  package_json: Record<string, any>;
  readme: string;
  tests: TestFile[];
  documentation: string;
  research_insights: string;
  implementation_guidance: ImplementationGuidance;
  verification_score: number;
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total: number;
    cost: number;
  };
}

export interface PluginFile {
  path: string;
  content: string;
  type: 'source' | 'test' | 'config' | 'documentation';
}

export interface TestFile {
  path: string;
  content: string;
  coverage: string[];
}

/**
 * Research-enhanced plugin generator with comprehensive quality assurance
 */
export class ResearchEnhancedPluginGenerator {
  private anthropic: Anthropic | null = null;
  private researchIntegration: ResearchIntegration;
  private verificationManager: ContinuousVerificationManager;
  private aiReviewer: MultiStageAIReviewer;
  private totalTokenUsage = { prompt_tokens: 0, completion_tokens: 0, total: 0, cost: 0 };

  constructor(private runtime: IAgentRuntime) {
    const apiKey = runtime.getSetting('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }

    this.researchIntegration = new ResearchIntegration(runtime);
    this.verificationManager = new ContinuousVerificationManager({
      failFast: false,
      autoFix: true,
      thresholds: {
        minScore: 75, // Higher threshold for plugin quality
        maxCriticalErrors: 0,
        maxHighErrors: 3,
        minCoverage: 70,
        maxComplexity: 12
      }
    });
    this.aiReviewer = new MultiStageAIReviewer(apiKey || '');
  }

  /**
   * Generate a plugin with research-driven development
   */
  async generatePlugin(
    spec: PluginSpecification,
    outputDir: string
  ): Promise<GeneratedPlugin> {
    elizaLogger.info(`[PLUGIN-GEN] Generating ${spec.name} plugin with research`);

    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured');
    }

    // Reset token usage
    this.totalTokenUsage = { prompt_tokens: 0, completion_tokens: 0, total: 0, cost: 0 };

    // Phase 1: Research plugin development best practices
    elizaLogger.info('[PLUGIN-GEN] Phase 1: Researching plugin development');
    const guidance = await this.researchIntegration.researchPluginDevelopment(
      spec.category,
      spec.requirements
    );

    // Phase 2: Generate plugin architecture
    elizaLogger.info('[PLUGIN-GEN] Phase 2: Generating plugin architecture');
    const architecture = await this.generatePluginArchitecture(spec, guidance);

    // Phase 3: Generate implementation files
    elizaLogger.info('[PLUGIN-GEN] Phase 3: Generating implementation files');
    const files = await this.generatePluginFiles(spec, guidance, architecture);

    // Phase 4: Generate tests
    elizaLogger.info('[PLUGIN-GEN] Phase 4: Generating comprehensive tests');
    const tests = await this.generatePluginTests(spec, files);

    // Phase 5: Generate documentation
    elizaLogger.info('[PLUGIN-GEN] Phase 5: Generating documentation');
    const { readme, documentation } = await this.generatePluginDocumentation(spec, files, guidance);

    // Phase 6: Generate package.json
    const packageJson = await this.generatePackageJson(spec, files);

    // Phase 7: Verify generated code
    elizaLogger.info('[PLUGIN-GEN] Phase 7: Verifying generated code');
    const verificationScore = await this.verifyGeneratedPlugin(files, spec);

    // Phase 8: Create research insights summary
    const researchInsights = this.createResearchInsights(guidance, spec);

    const plugin: GeneratedPlugin = {
      name: spec.name,
      files,
      package_json: packageJson,
      readme,
      tests,
      documentation,
      research_insights: researchInsights,
      implementation_guidance: guidance,
      verification_score: verificationScore,
      token_usage: this.totalTokenUsage
    };

    // Phase 9: Write files to disk
    if (outputDir) {
      await this.writePluginToDisk(plugin, outputDir);
    }

    elizaLogger.info(`[PLUGIN-GEN] Plugin generated successfully with verification score: ${verificationScore}`);
    return plugin;
  }

  /**
   * Generate plugin architecture based on research
   */
  private async generatePluginArchitecture(
    spec: PluginSpecification,
    guidance: ImplementationGuidance
  ): Promise<any> {
    const prompt = `Design the architecture for an ElizaOS ${spec.category} plugin.

**Plugin Specification:**
Name: ${spec.name}
Description: ${spec.description}
Category: ${spec.category}
Requirements: ${spec.requirements.join(', ')}
Features: ${spec.features.join(', ')}
${spec.dependencies ? `Dependencies: ${spec.dependencies.join(', ')}` : ''}
${spec.apis ? `APIs: ${spec.apis.join(', ')}` : ''}

**Research-Based Implementation Guidance:**
Approach: ${guidance.approach}
Key Considerations: ${guidance.keyConsiderations.join(', ')}
Code Patterns: ${guidance.codePatterns.map(p => p.pattern).join(', ')}

**Architecture Requirements:**
1. Follow ElizaOS plugin patterns
2. Use TypeScript with strict typing
3. Implement proper error handling
4. Include comprehensive logging
5. Design for testability
6. Consider performance implications
7. Ensure security best practices

Respond with a JSON architecture specification:
{
  "pluginStructure": {
    "mainFiles": ["file1.ts", "file2.ts"],
    "testFiles": ["test1.test.ts"],
    "configFiles": ["package.json", "tsconfig.json"]
  },
  "coreComponents": [
    {
      "name": "ComponentName",
      "type": "action|provider|service",
      "purpose": "What this component does",
      "interfaces": ["IInterface1"],
      "dependencies": ["dep1"]
    }
  ],
  "dataFlow": "How data flows through the plugin",
  "integrationPoints": ["How it integrates with ElizaOS"],
  "securityConsiderations": ["Security aspects to consider"],
  "testingStrategy": "How to test this plugin"
}`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    this.updateTokenUsage(response.usage);

    const responseText = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    try {
      return JSON.parse(responseText);
    } catch (error) {
      elizaLogger.warn('[PLUGIN-GEN] Failed to parse architecture JSON, using fallback');
      return {
        pluginStructure: {
          mainFiles: ['index.ts', 'actions.ts', 'providers.ts'],
          testFiles: [`${spec.name}.test.ts`],
          configFiles: ['package.json', 'tsconfig.json']
        },
        coreComponents: [{
          name: spec.name,
          type: spec.category,
          purpose: spec.description,
          interfaces: [],
          dependencies: spec.dependencies || []
        }],
        dataFlow: 'Standard ElizaOS plugin data flow',
        integrationPoints: ['ElizaOS runtime integration'],
        securityConsiderations: ['Input validation', 'Secure API calls'],
        testingStrategy: 'Unit and integration tests'
      };
    }
  }

  /**
   * Generate plugin implementation files
   */
  private async generatePluginFiles(
    spec: PluginSpecification,
    guidance: ImplementationGuidance,
    architecture: any
  ): Promise<PluginFile[]> {
    const files: PluginFile[] = [];

    // Generate main index file
    const indexFile = await this.generateIndexFile(spec, guidance, architecture);
    files.push(indexFile);

    // Generate component files based on architecture
    for (const component of architecture.coreComponents) {
      if (component.type === 'action' || spec.category === 'action') {
        const actionFile = await this.generateActionFile(spec, component, guidance);
        files.push(actionFile);
      }
      
      if (component.type === 'provider' || spec.category === 'provider') {
        const providerFile = await this.generateProviderFile(spec, component, guidance);
        files.push(providerFile);
      }
      
      if (component.type === 'service' || spec.category === 'service') {
        const serviceFile = await this.generateServiceFile(spec, component, guidance);
        files.push(serviceFile);
      }
    }

    // Generate types file
    const typesFile = await this.generateTypesFile(spec, architecture);
    files.push(typesFile);

    // Generate configuration files
    const tsconfigFile = this.generateTsConfigFile();
    files.push(tsconfigFile);

    return files;
  }

  /**
   * Generate main index.ts file
   */
  private async generateIndexFile(
    spec: PluginSpecification,
    guidance: ImplementationGuidance,
    architecture: any
  ): Promise<PluginFile> {
    const prompt = `Generate the main index.ts file for the ElizaOS ${spec.name} plugin.

**Plugin Details:**
- Name: ${spec.name}
- Description: ${spec.description}
- Category: ${spec.category}
- Features: ${spec.features.join(', ')}

**Architecture:**
${JSON.stringify(architecture, null, 2)}

**Implementation Guidance:**
${guidance.approach}

**Requirements:**
1. Export the plugin object with correct ElizaOS structure
2. Import all necessary components
3. Use proper TypeScript typing
4. Include comprehensive JSDoc comments
5. Follow ElizaOS plugin patterns
6. Include proper error handling

Generate a complete, production-ready index.ts file.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    this.updateTokenUsage(response.usage);

    const content = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return {
      path: 'src/index.ts',
      content: this.extractCodeFromResponse(content),
      type: 'source'
    };
  }

  /**
   * Generate action file
   */
  private async generateActionFile(
    spec: PluginSpecification,
    component: any,
    guidance: ImplementationGuidance
  ): Promise<PluginFile> {
    const prompt = `Generate an actions.ts file for the ElizaOS ${spec.name} plugin.

**Plugin Details:**
- Name: ${spec.name}
- Description: ${spec.description}
- Requirements: ${spec.requirements.join(', ')}
- Features: ${spec.features.join(', ')}

**Component Details:**
${JSON.stringify(component, null, 2)}

**Implementation Guidance:**
${guidance.approach}
Key Considerations: ${guidance.keyConsiderations.join(', ')}

**Requirements:**
1. Implement Action interface from @elizaos/core
2. Include proper validation logic
3. Use comprehensive error handling
4. Add detailed logging with elizaLogger
5. Include examples and JSDoc comments
6. Handle async operations properly
7. Implement proper memory and state handling

Generate a complete, production-ready actions.ts file with at least one well-implemented action.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 6144,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    this.updateTokenUsage(response.usage);

    const content = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return {
      path: 'src/actions.ts',
      content: this.extractCodeFromResponse(content),
      type: 'source'
    };
  }

  /**
   * Generate provider file
   */
  private async generateProviderFile(
    spec: PluginSpecification,
    component: any,
    guidance: ImplementationGuidance
  ): Promise<PluginFile> {
    const prompt = `Generate a providers.ts file for the ElizaOS ${spec.name} plugin.

**Plugin Details:**
- Name: ${spec.name}
- Description: ${spec.description}
- Requirements: ${spec.requirements.join(', ')}

**Component Details:**
${JSON.stringify(component, null, 2)}

**Implementation Guidance:**
${guidance.approach}

**Requirements:**
1. Implement Provider interface from @elizaos/core
2. Include proper get() method implementation
3. Handle different types of content and contexts
4. Add comprehensive error handling and logging
5. Include proper TypeScript typing
6. Add JSDoc documentation

Generate a complete, production-ready providers.ts file.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    this.updateTokenUsage(response.usage);

    const content = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return {
      path: 'src/providers.ts',
      content: this.extractCodeFromResponse(content),
      type: 'source'
    };
  }

  /**
   * Generate service file
   */
  private async generateServiceFile(
    spec: PluginSpecification,
    component: any,
    guidance: ImplementationGuidance
  ): Promise<PluginFile> {
    const prompt = `Generate a service.ts file for the ElizaOS ${spec.name} plugin.

**Plugin Details:**
- Name: ${spec.name}
- Description: ${spec.description}
- Requirements: ${spec.requirements.join(', ')}

**Component Details:**
${JSON.stringify(component, null, 2)}

**Implementation Guidance:**
${guidance.approach}
Security Considerations: ${guidance.securityConsiderations.join(', ')}

**Requirements:**
1. Extend Service class from @elizaos/core
2. Implement proper service lifecycle (start/stop)
3. Add comprehensive error handling
4. Include proper state management
5. Add logging and monitoring
6. Implement proper cleanup
7. Use TypeScript strict typing

Generate a complete, production-ready service.ts file.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    this.updateTokenUsage(response.usage);

    const content = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return {
      path: 'src/service.ts',
      content: this.extractCodeFromResponse(content),
      type: 'source'
    };
  }

  /**
   * Generate types file
   */
  private async generateTypesFile(
    spec: PluginSpecification,
    architecture: any
  ): Promise<PluginFile> {
    const content = `/**
 * Type definitions for ${spec.name} plugin
 */

// Core plugin types
export interface ${this.toPascalCase(spec.name)}Config {
  enabled: boolean;
  [key: string]: any;
}

export interface ${this.toPascalCase(spec.name)}State {
  initialized: boolean;
  lastUpdate: number;
}

// Component-specific types
${architecture.coreComponents.map((component: any) => `
export interface ${this.toPascalCase(component.name)}Options {
  // Add component-specific options
}

export interface ${this.toPascalCase(component.name)}Result {
  success: boolean;
  data?: any;
  error?: string;
}
`).join('\n')}

// Plugin response types
export interface PluginResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// Event types
export interface ${this.toPascalCase(spec.name)}Event {
  type: string;
  payload: any;
  timestamp: number;
}

// Error types
export class ${this.toPascalCase(spec.name)}Error extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = '${this.toPascalCase(spec.name)}Error';
  }
}`;

    return {
      path: 'src/types.ts',
      content,
      type: 'source'
    };
  }

  /**
   * Generate TypeScript configuration
   */
  private generateTsConfigFile(): PluginFile {
    const content = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "allowJs": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "noEmitOnError": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}`;

    return {
      path: 'tsconfig.json',
      content,
      type: 'config'
    };
  }

  /**
   * Generate comprehensive tests
   */
  private async generatePluginTests(
    spec: PluginSpecification,
    files: PluginFile[]
  ): Promise<TestFile[]> {
    const tests: TestFile[] = [];

    for (const file of files) {
      if (file.type === 'source' && file.path.endsWith('.ts')) {
        const testFile = await this.generateTestFile(spec, file);
        tests.push(testFile);
      }
    }

    return tests;
  }

  /**
   * Generate individual test file
   */
  private async generateTestFile(
    spec: PluginSpecification,
    sourceFile: PluginFile
  ): Promise<TestFile> {
    const prompt = `Generate comprehensive tests for this ElizaOS plugin file.

**Plugin:** ${spec.name}
**File:** ${sourceFile.path}

**Source Code:**
\`\`\`typescript
${sourceFile.content}
\`\`\`

**Test Requirements:**
1. Use vitest testing framework
2. Test all exported functions and classes
3. Include edge cases and error scenarios
4. Mock external dependencies properly
5. Achieve high test coverage
6. Include integration tests where appropriate
7. Use proper TypeScript typing in tests
8. Include setup and teardown as needed

Generate complete, production-ready test code.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 6144,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    this.updateTokenUsage(response.usage);

    const content = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    const testPath = sourceFile.path.replace('src/', 'src/__tests__/').replace('.ts', '.test.ts');

    return {
      path: testPath,
      content: this.extractCodeFromResponse(content),
      coverage: [] // Could be populated with coverage analysis
    };
  }

  /**
   * Generate documentation
   */
  private async generatePluginDocumentation(
    spec: PluginSpecification,
    files: PluginFile[],
    guidance: ImplementationGuidance
  ): Promise<{ readme: string; documentation: string }> {
    const readmePrompt = `Generate a comprehensive README.md for the ${spec.name} ElizaOS plugin.

**Plugin Details:**
- Name: ${spec.name}
- Description: ${spec.description}
- Category: ${spec.category}
- Features: ${spec.features.join(', ')}
- Requirements: ${spec.requirements.join(', ')}

**Implementation Guidance:**
${guidance.approach}

**Files Generated:**
${files.map(f => `- ${f.path}`).join('\n')}

**README Requirements:**
1. Clear title and description
2. Installation instructions
3. Configuration guide
4. Usage examples
5. API documentation
6. Troubleshooting section
7. Contributing guidelines
8. License information

Generate a complete, professional README.md in markdown format.`;

    const readmeResponse = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content: readmePrompt }]
    });

    this.updateTokenUsage(readmeResponse.usage);

    const readme = readmeResponse.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    const docPrompt = `Generate technical documentation for the ${spec.name} plugin.

Include:
1. Architecture overview
2. Component breakdown
3. API reference
4. Integration guide
5. Best practices
6. Performance considerations
7. Security guidelines

Format as markdown.`;

    const docResponse = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content: docPrompt }]
    });

    this.updateTokenUsage(docResponse.usage);

    const documentation = docResponse.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return { readme, documentation };
  }

  /**
   * Generate package.json
   */
  private async generatePackageJson(
    spec: PluginSpecification,
    files: PluginFile[]
  ): Promise<Record<string, any>> {
    return {
      name: `@elizaos/plugin-${spec.name.toLowerCase()}`,
      version: '1.0.0',
      description: spec.description,
      type: 'module',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      files: ['dist'],
      scripts: {
        build: 'tsc',
        test: 'vitest',
        'test:coverage': 'vitest --coverage',
        lint: 'eslint src/**/*.ts',
        'lint:fix': 'eslint src/**/*.ts --fix',
        typecheck: 'tsc --noEmit'
      },
      dependencies: {
        '@elizaos/core': 'workspace:*',
        ...(spec.dependencies?.reduce((acc, dep) => {
          acc[dep] = 'latest';
          return acc;
        }, {} as Record<string, string>) || {})
      },
      devDependencies: {
        '@types/node': '^20.0.0',
        'typescript': '^5.0.0',
        'vitest': '^1.0.0',
        'eslint': '^8.0.0',
        '@typescript-eslint/eslint-plugin': '^6.0.0',
        '@typescript-eslint/parser': '^6.0.0'
      },
      keywords: [
        'elizaos',
        'plugin',
        spec.category,
        ...spec.features.map(f => f.toLowerCase().replace(/\s+/g, '-'))
      ],
      author: 'ElizaOS Team',
      license: 'MIT'
    };
  }

  /**
   * Verify generated plugin code
   */
  private async verifyGeneratedPlugin(
    files: PluginFile[],
    spec: PluginSpecification
  ): Promise<number> {
    try {
      // Create Code object for verification
      const code: Code = {
        files: files
          .filter(f => f.type === 'source')
          .map(f => ({
            path: f.path,
            content: f.content,
            language: 'typescript'
          })),
        entryPoint: 'src/index.ts',
        dependencies: spec.dependencies?.reduce((acc, dep) => {
          acc[dep] = 'latest';
          return acc;
        }, {} as Record<string, string>) || {},
        devDependencies: {}
      };

      // Create verification context
      const context: VerificationContext = {
        projectPath: '/generated/plugin',
        requirements: spec.requirements,
        constraints: [
          'Follow ElizaOS plugin patterns',
          'Use TypeScript strict mode',
          'Implement proper error handling',
          'Include comprehensive logging'
        ],
        targetEnvironment: 'production',
        language: 'TypeScript',
        framework: 'ElizaOS'
      };

      // Run verification
      const result = await this.verificationManager.verifyCode(code, context);
      
      elizaLogger.info(`[PLUGIN-GEN] Verification completed with score: ${result.score}`);
      return result.score;

    } catch (error) {
      elizaLogger.error('[PLUGIN-GEN] Verification failed:', error);
      return 50; // Default score on verification failure
    }
  }

  /**
   * Create research insights summary
   */
  private createResearchInsights(
    guidance: ImplementationGuidance,
    spec: PluginSpecification
  ): string {
    return `# Research Insights for ${spec.name} Plugin

## Implementation Approach
${guidance.approach}

## Key Considerations
${guidance.keyConsiderations.map((consideration, i) => `${i + 1}. ${consideration}`).join('\n')}

## Testing Strategy
${guidance.testingStrategy}

## Performance Considerations
${guidance.performanceConsiderations.map((consideration, i) => `${i + 1}. ${consideration}`).join('\n')}

## Security Considerations
${guidance.securityConsiderations.map((consideration, i) => `${i + 1}. ${consideration}`).join('\n')}

## Code Patterns Applied
${guidance.codePatterns.map((pattern, i) => `
### ${i + 1}. ${pattern.pattern}
**Description:** ${pattern.description}
**When to Use:** ${pattern.whenToUse}
**Example:** \`${pattern.example}\`
**Alternatives:** ${pattern.alternatives.join(', ')}
`).join('\n')}

## Research-Driven Benefits
- Enhanced code quality through proven patterns
- Improved security through research-backed practices
- Better performance through optimization insights
- Reduced technical debt through best practices
- Increased maintainability through structured approach
`;
  }

  /**
   * Write plugin to disk
   */
  private async writePluginToDisk(
    plugin: GeneratedPlugin,
    outputDir: string
  ): Promise<void> {
    elizaLogger.info(`[PLUGIN-GEN] Writing plugin to ${outputDir}`);

    // Create directory structure
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'src', '__tests__'), { recursive: true });

    // Write source files
    for (const file of plugin.files) {
      const filePath = path.join(outputDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content);
    }

    // Write test files
    for (const test of plugin.tests) {
      const testPath = path.join(outputDir, test.path);
      await fs.mkdir(path.dirname(testPath), { recursive: true });
      await fs.writeFile(testPath, test.content);
    }

    // Write package.json
    await fs.writeFile(
      path.join(outputDir, 'package.json'),
      JSON.stringify(plugin.package_json, null, 2)
    );

    // Write README
    await fs.writeFile(
      path.join(outputDir, 'README.md'),
      plugin.readme
    );

    // Write documentation
    await fs.writeFile(
      path.join(outputDir, 'DOCUMENTATION.md'),
      plugin.documentation
    );

    // Write research insights
    await fs.writeFile(
      path.join(outputDir, 'RESEARCH_INSIGHTS.md'),
      plugin.research_insights
    );

    elizaLogger.info(`[PLUGIN-GEN] Plugin written successfully to ${outputDir}`);
  }

  /**
   * Utility functions
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  private extractCodeFromResponse(response: string): string {
    // Extract code blocks from markdown responses
    const codeBlockMatch = response.match(/```(?:typescript|ts)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1];
    }
    
    // If no code block, return the response as-is (might be plain code)
    return response.trim();
  }

  private updateTokenUsage(usage: any): void {
    if (usage) {
      this.totalTokenUsage.prompt_tokens += usage.input_tokens || 0;
      this.totalTokenUsage.completion_tokens += usage.output_tokens || 0;
      this.totalTokenUsage.total = this.totalTokenUsage.prompt_tokens + this.totalTokenUsage.completion_tokens;
      this.totalTokenUsage.cost = (this.totalTokenUsage.prompt_tokens / 1000) * 0.015 + 
                                 (this.totalTokenUsage.completion_tokens / 1000) * 0.075;
    }
  }
}