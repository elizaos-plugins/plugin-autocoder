#!/usr/bin/env bun

import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';

const DATASET_URLS = {
  test: 'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/resolve/main/data/test.jsonl',
  validation: 'https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/resolve/main/data/validation.jsonl'
};

async function downloadDataset() {
  const cacheDir = path.join(process.cwd(), '.swe-bench-cache', 'dataset');
  await fs.mkdir(cacheDir, { recursive: true });

  console.log('🔄 Downloading Multi-SWE-bench dataset...\n');

  for (const [split, url] of Object.entries(DATASET_URLS)) {
    const outputPath = path.join(cacheDir, `multi-swe-bench-${split}.jsonl`);
    
    // Check if already exists
    try {
      const stats = await fs.stat(outputPath);
      console.log(`✓ ${split} dataset already exists (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      continue;
    } catch {
      // File doesn't exist, download it
    }

    console.log(`📥 Downloading ${split} dataset from HuggingFace...`);
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ElizaOS-SWEBench/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const totalSize = contentLength ? parseInt(contentLength) : 0;
      
      const chunks: Buffer[] = [];
      let downloadedSize = 0;

      for await (const chunk of response.body!) {
        chunks.push(Buffer.from(chunk as any));
        downloadedSize += (chunk as any).length;
        
        if (totalSize > 0) {
          const progress = (downloadedSize / totalSize * 100).toFixed(1);
          process.stdout.write(`\r  Progress: ${progress}% (${(downloadedSize / 1024 / 1024).toFixed(2)} MB)`);
        }
      }
      
      console.log(); // New line after progress
      
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(outputPath, buffer);
      
      console.log(`✅ ${split} dataset downloaded (${(buffer.length / 1024 / 1024).toFixed(2)} MB)\n`);
    } catch (error) {
      console.error(`❌ Failed to download ${split} dataset:`, error);
      console.log(`\nNote: The dataset might require authentication or may not be publicly available.`);
      console.log(`You can manually download it from: ${url}\n`);
    }
  }

  // Parse and show statistics
  try {
    console.log('📊 Analyzing dataset...\n');
    
    const testPath = path.join(cacheDir, 'multi-swe-bench-test.jsonl');
    const content = await fs.readFile(testPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    const languages = new Map<string, number>();
    const repos = new Map<string, number>();
    let tsCount = 0;
    
    for (const line of lines) {
      try {
        const instance = JSON.parse(line);
        
        // Count by language
        const lang = instance.language || 'Unknown';
        languages.set(lang, (languages.get(lang) || 0) + 1);
        
        // Count by repo
        const repo = instance.repo || 'Unknown';
        repos.set(repo, (repos.get(repo) || 0) + 1);
        
        // Count TypeScript/JavaScript
        if (lang === 'TypeScript' || lang === 'JavaScript') {
          tsCount++;
        }
      } catch {
        // Skip invalid lines
      }
    }
    
    console.log('Dataset Statistics:');
    console.log(`- Total instances: ${lines.length}`);
    console.log(`- TypeScript/JavaScript: ${tsCount} (${(tsCount / lines.length * 100).toFixed(1)}%)`);
    console.log('\nTop Languages:');
    
    const sortedLangs = Array.from(languages.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [lang, count] of sortedLangs) {
      console.log(`  - ${lang}: ${count}`);
    }
    
    console.log('\nTop Repositories:');
    const sortedRepos = Array.from(repos.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [repo, count] of sortedRepos) {
      console.log(`  - ${repo}: ${count}`);
    }
    
  } catch (error) {
    console.log('Could not analyze dataset (file might not exist or be corrupted)');
  }
  
  console.log('\n✨ Setup complete! You can now run SWE-bench evaluation.');
}

// Run the download
downloadDataset().catch(console.error); 