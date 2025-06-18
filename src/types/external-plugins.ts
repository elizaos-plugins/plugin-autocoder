// Type definitions for external plugin services
// These match the actual interfaces from the ElizaOS plugins

import type { IAgentRuntime, Plugin, Service } from '@elizaos/core';

// Research Service Types (from @elizaos/plugin-research)
export interface ResearchProject {
  id: string;
  query: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'paused';
  phase:
    | 'initialization'
    | 'planning'
    | 'searching'
    | 'analyzing'
    | 'synthesizing'
    | 'reporting'
    | 'complete';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  findings: any[];
  sources: any[];
  report?: any;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ResearchService extends Service {
  createResearchProject(query: string, config?: any): Promise<ResearchProject>;
  getProject(projectId: string): Promise<ResearchProject | undefined>;
  startResearch(projectId: string): Promise<void>;
  getResearchStatus(projectId: string): Promise<ResearchProject | undefined>;
  getAllProjects(): Promise<ResearchProject[]>;
  getActiveProjects(): Promise<ResearchProject[]>;
  pauseResearch(projectId: string): Promise<void>;
  resumeResearch(projectId: string): Promise<void>;
  cancelResearch?(projectId: string): Promise<void>;
}

// Knowledge Service Types (from @elizaos/plugin-knowledge)
export interface KnowledgeDocument {
  id: string;
  content: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface KnowledgeService extends Service {
  addKnowledge(options: any): Promise<any>;
  getKnowledge(message: any, scope?: any): Promise<any[]>;
  checkExistingKnowledge(knowledgeId: string): Promise<boolean>;
  deleteMemory(memoryId: string): Promise<void>;
  storeDocument(doc: any): Promise<{ id: string }>;
}

// Environment Manager Service Types (from @elizaos/plugin-secrets-manager)
export interface EnvVarConfig {
  value?: string;
  type: 'api_key' | 'private_key' | 'public_key' | 'url' | 'credential' | 'config' | 'secret';
  required: boolean;
  description: string;
  canGenerate: boolean;
  validationMethod?: string;
  status: 'missing' | 'generating' | 'validating' | 'invalid' | 'valid';
  lastError?: string;
  attempts: number;
  createdAt?: number;
  validatedAt?: number;
  plugin: string;
}

export interface EnvManagerService extends Service {
  getEnvVar(varName: string): string | null;
  setEnvVar(
    varName: string,
    value: string,
    options: { scope: string; projectId: string }
  ): Promise<void>;
  updateEnvVar(
    pluginName: string,
    varName: string,
    updates: Partial<EnvVarConfig>
  ): Promise<boolean>;
  getAllEnvVars(): Promise<Record<string, Record<string, EnvVarConfig>> | null>;
  scanPluginRequirements(): Promise<void>;
  hasMissingEnvVars(): Promise<boolean>;
  getMissingEnvVars(): Promise<Array<{ plugin: string; varName: string; config: EnvVarConfig }>>;
}

// Plugin Manager Service Types (from @elizaos/plugin-plugin-manager)
export interface PublishResult {
  success: boolean;
  npmPackage?: string;
  githubRepo?: string;
}

export interface PluginManagerService extends Service {
  clonePlugin(options: { source: string; branch?: string }): Promise<{ path: string }>;
  cloneRepository(url: string, targetDir: string): Promise<string>;
  createBranch(branchName: string): Promise<void>;
  commitChanges(message: string): Promise<void>;
  pushToRemote(repoPath: string, credentials: { username: string; token: string }): Promise<void>;
  createGitHubRepo(name: string, description: string): Promise<string>;
  forkRepository(repoUrl: string): Promise<string>;
  createPullRequest(options: {
    title: string;
    body: string;
    branch: string;
    base: string;
    repo?: string;
  }): Promise<{ url: string }>;
  publishPlugin(options: {
    path: string;
    npm: boolean;
    github: boolean;
    registry: boolean;
  }): Promise<PublishResult>;
}

// Plugin Creation Service (from plugin-autocoder itself)
export interface PluginSpecification {
  name: string;
  description: string;
  version?: string;
  [key: string]: any;
}

export interface PluginCreationJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  outputPath?: string;
  error?: string;
  phase?: string;
  testResults?: any;
}

export interface PluginCreationService extends Service {
  createJob(options: {
    type: string;
    name?: string;
    path?: string;
    description?: string;
    options?: any;
  }): Promise<{ id: string }>;
  getJobStatus(jobId: string): Promise<PluginCreationJob | null>;
}

// Re-export for convenience
export type { KnowledgeService as KnowledgeServiceType };
