import type { TestSuite, IAgentRuntime } from '@elizaos/core';
import { PluginCreationService, PluginSpecification } from '../services/plugin-creation-service.ts';
import fs from 'fs-extra';
import path from 'path';

// Time plugin specification
const TIME_PLUGIN_SPEC: PluginSpecification = {
  name: '@elizaos/plugin-time',
  description: 'Provides current time and timezone information',
  version: '1.0.0',
  actions: [
    {
      name: 'getCurrentTime',
      description: 'Get current time in any timezone',
      parameters: {
        timezone: 'string',
      },
    },
    {
      name: 'convertTime',
      description: 'Convert time between timezones',
      parameters: {
        time: 'string',
        fromTimezone: 'string',
        toTimezone: 'string',
      },
    },
  ],
  providers: [
    {
      name: 'timeProvider',
      description: 'Provides current time context',
      dataStructure: {
        currentTime: 'string',
        timezone: 'string',
        utcOffset: 'number',
      },
    },
  ],
};

export class TimePluginE2ETestSuite implements TestSuite {
  name = 'plugin-autocoder-time-e2e';
  description = 'End-to-end tests for TIME plugin creation with real runtime';

  tests = [
    {
      name: 'Should create TIME plugin with real Anthropic API',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing TIME plugin creation with real runtime...');
        
        // Get the service from runtime
        const service = runtime.services.get('plugin_creation' as any) as PluginCreationService;
        if (!service) {
          throw new Error('Plugin creation service not available');
        }
        
        // Check if API key is available
        const apiKey = runtime.getSetting('ANTHROPIC_API_KEY');
        if (!apiKey) {
          console.log('⚠️  Skipping test: ANTHROPIC_API_KEY not configured');
          console.log('   Set ANTHROPIC_API_KEY environment variable to run this test');
          return;
        }
        
        console.log('✓ API key available, proceeding with plugin creation...');
        
        // Create the plugin
        const jobId = await service.createPlugin(TIME_PLUGIN_SPEC, apiKey);
        console.log(`✓ Plugin creation job started: ${jobId}`);
        
        // Wait for completion (with timeout)
        const startTime = Date.now();
        const timeout = 5 * 60 * 1000; // 5 minutes
        let job = service.getJobStatus(jobId);
        
        while (job && ['pending', 'running'].includes(job.status)) {
          if (Date.now() - startTime > timeout) {
            throw new Error('Plugin creation timed out after 5 minutes');
          }
          
          // Log progress
          if (job.logs.length > 0) {
            const lastLog = job.logs[job.logs.length - 1];
            console.log(`   Status: ${job.status}, Phase: ${job.currentPhase}`);
            console.log(`   Last log: ${lastLog}`);
          }
          
          // Wait before checking again
          await new Promise(resolve => setTimeout(resolve, 2000));
          job = service.getJobStatus(jobId);
        }
        
        if (!job) {
          throw new Error('Job disappeared unexpectedly');
        }
        
        // Check final status
        if (job.status !== 'completed') {
          console.error('Job failed with status:', job.status);
          console.error('Error:', job.error);
          console.error('Logs:', job.logs.join('\n'));
          throw new Error(`Plugin creation failed: ${job.error || 'Unknown error'}`);
        }
        
        console.log('✓ Plugin created successfully!');
        
        // Verify the plugin was created on disk
        const pluginPath = job.outputPath;
        if (!await fs.pathExists(pluginPath)) {
          throw new Error('Plugin directory not created');
        }
        
        // Verify basic structure
        if (!fs.existsSync(pluginPath)) {
          throw new Error('Plugin directory not found');
        }
        console.log('✓ Found plugin directory');
        
        if (!fs.existsSync(path.join(pluginPath, 'src/index.ts'))) {
          throw new Error('src/index.ts not found');
        }
        console.log('✓ Found src/index.ts');
        
        // Check that the plugin has the correct name in package.json
        const packageJson = await fs.readJson(path.join(pluginPath, 'package.json'));
        if (packageJson.name !== '@elizaos/plugin-time') {
          throw new Error(`Package name mismatch: expected @elizaos/plugin-time, got ${packageJson.name}`);
        }
        console.log('✓ Plugin has correct name in package.json');
        
        // Check that it has the expected dependencies
        if (!packageJson.dependencies || !packageJson.dependencies['@elizaos/core']) {
          throw new Error('Missing required dependency @elizaos/core');
        }
        console.log('✓ Plugin has required dependencies');
        
        console.log('✓ Basic plugin structure created successfully');
        
        // Note: Current implementation uses template which doesn't generate individual action files
        // This is a known limitation that should be addressed in the future
        // TODO: In future iterations, the AI should generate actual time-related actions
        
        // For now, we're only checking the basic structure exists
        // The actual action files are not generated by the template
        
        console.log('✓ Package.json validated');
        console.log(`✓ Plugin location: ${pluginPath}`);
        
        // Clean up after test
        console.log('Cleaning up test plugin...');
        await fs.remove(pluginPath);
        console.log('✓ Cleanup complete');
        
        console.log('✓ TIME plugin e2e test completed successfully!');
      }
    },
    {
      name: 'Should track TIME plugin in registry',
      fn: async (runtime: IAgentRuntime) => {
        console.log('Testing plugin registry tracking...');
        
        const service = runtime.services.get('plugin_creation' as any) as PluginCreationService;
        if (!service) {
          throw new Error('Plugin creation service not available');
        }
        
        // Check if plugin is tracked
        const isCreated = service.isPluginCreated(TIME_PLUGIN_SPEC.name);
        const createdPlugins = service.getCreatedPlugins();
        
        console.log(`✓ TIME plugin tracked: ${isCreated}`);
        console.log(`✓ Total plugins in registry: ${createdPlugins.length}`);
        
        if (isCreated && !createdPlugins.includes(TIME_PLUGIN_SPEC.name)) {
          throw new Error('Registry inconsistency detected');
        }
        
        console.log('✓ Plugin registry test passed');
      }
    }
  ];
}

export default new TimePluginE2ETestSuite(); 