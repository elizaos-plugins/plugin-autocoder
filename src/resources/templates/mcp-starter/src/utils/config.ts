import * as fs from 'fs/promises';
import * as path from 'path';

export interface MCPConfig {
  name: string;
  version: string;
  [key: string]: any;
}

/**
 * Load configuration from package.json and environment
 */
export async function loadConfig(): Promise<MCPConfig> {
  try {
    // Load package.json
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);

    // Build configuration
    const config: MCPConfig = {
      name: packageJson.name || 'mcp-server',
      version: packageJson.version || '0.1.0',
      ...process.env,
    };

    return config;
  } catch (error) {
    console.error('Failed to load configuration:', error);
    
    // Return default config
    return {
      name: 'mcp-server',
      version: '0.1.0',
    };
  }
} 