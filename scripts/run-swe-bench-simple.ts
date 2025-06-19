#!/usr/bin/env bun

// Import from the source folder to avoid dynamic require issues
import { autocoderPlugin } from './src/index.ts';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runSWEBenchReal() {
  console.log('🚀 Starting SWE-bench evaluation with REAL AI patch generation...\n');
  
  // Create mock runtime with API key from env
  const mockRuntime = {
    getSetting: (key: string) => {
      if (key === 'ANTHROPIC_API_KEY') {
        return process.env.ANTHROPIC_API_KEY;
      }
      return undefined;
    },
    getService: (serviceName: string) => {
      // Return null to allow graceful fallback for research service
      return null;
    },
    registerAction: (action: any) => {
      // Mock action registration
      console.log(`Registering action: ${action.name}`);
    },
    agentId: 'swe-bench-real',
    character: {
      name: 'SWEBenchAgent',
      bio: ['Agent for SWE-bench evaluation'],
      knowledge: [],
      messageExamples: [],
      postExamples: [],
      topics: [],
      adjectives: [],
      clients: [],
      plugins: []
    },
    // Add action processing capability
    processActions: async (message: any, responses: any[], state: any, callback: any) => {
      // Find the SWE-bench action
      const action = autocoderPlugin.actions?.find(a => a.name === 'RUN_SWE_BENCH');
      if (action) {
        const result = await action.handler(mockRuntime, message, state, {}, callback);
        return result;
      }
    }
  } as any;

  // Verify API key is available
  const apiKey = mockRuntime.getSetting('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found');
    console.log('Please configure ANTHROPIC_API_KEY using the secrets manager or .env file');
    process.exit(1);
  }

      console.log('✅ Anthropic API key loaded from environment\n');

  // Initialize the plugin
  if (autocoderPlugin.init) {
    await autocoderPlugin.init({}, mockRuntime);
  }

  // Create a message to trigger the SWE-bench action
  const message = {
    entityId: '00000000-0000-0000-0000-000000000001' as any,
    roomId: '00000000-0000-0000-0000-000000000002' as any,
    content: {
      text: `run swe-bench on ${process.env.SWE_BENCH_MAX || 'all'} typescript instances`,
      source: 'test',
      actions: ['RUN_SWE_BENCH']
    }
  };

  const state = {
    values: {},
    data: {},
    text: ''
  };

  let reportPath = '';
  const callback = async (response: any) => {
    console.log('\n📊 Results received:');
    
    if (response.text) {
      console.log(response.text);
      
      // Extract report path from response
      const pathMatch = response.text.match(/Results saved to: (.+)/);
      if (pathMatch) {
        reportPath = pathMatch[1];
      }
    }
    
    return [];
  };

  try {
    // Run the SWE-bench action
    const action = autocoderPlugin.actions?.find(a => a.name === 'RUN_SWE_BENCH');
    if (!action) {
      throw new Error('RUN_SWE_BENCH action not found in plugin');
    }

    console.log('🔧 Running SWE-bench evaluation...\n');
    await action.handler(mockRuntime, message, state, {}, callback);
    
    // Create a human-readable summary
    if (reportPath) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const reviewDir = path.join(process.cwd(), 'swe-bench-human-review', `simple-run-${timestamp}`);
      await fs.mkdir(reviewDir, { recursive: true });
      
      console.log(`\n📁 Review directory: ${reviewDir}`);
    }
    
  } catch (error: any) {
    console.error('\n❌ Error running SWE-bench:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Save error report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const errorReport = {
      timestamp: new Date().toISOString(),
      mode: 'REAL',
      error: error.message,
      stack: error.stack
    };
    
    await fs.writeFile(
      path.join(process.cwd(), 'swe-bench-human-review', `simple-error-${timestamp}.json`),
      JSON.stringify(errorReport, null, 2)
    );
  }
}

// Run the test
runSWEBenchReal().catch(console.error); 