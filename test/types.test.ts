import { describe, it, expect } from 'vitest';
import type { 
  RepomirrorConfig, 
  RemoteConfig, 
  InitOptions,
  SyncOptions,
  PushOptions,
  PullOptions
} from '../types';

describe('Type Definitions', () => {
  it('should have correct RepomirrorConfig structure', () => {
    const config: RepomirrorConfig = {
      source_repo: './source',
      target_repo: './target',
      transformation_instructions: 'convert to typescript',
      config_version: '0.1.0',
      remotes: [
        {
          name: 'origin',
          url: 'https://github.com/user/repo.git',
          branch: 'main'
        }
      ]
    };
    
    expect(config.source_repo).toBe('./source');
    expect(config.target_repo).toBe('./target');
    expect(config.transformation_instructions).toBe('convert to typescript');
    expect(config.config_version).toBe('0.1.0');
    expect(config.remotes).toHaveLength(1);
    expect(config.remotes![0].name).toBe('origin');
  });

  it('should have correct InitOptions structure', () => {
    const options: InitOptions = {
      sourceRepo: './src',
      targetRepo: './dest',
      transformationInstructions: 'migrate to new framework'
    };
    
    expect(options.sourceRepo).toBe('./src');
    expect(options.targetRepo).toBe('./dest');
    expect(options.transformationInstructions).toBe('migrate to new framework');
  });

  it('should have correct PushOptions structure', () => {
    const options: PushOptions = {
      remote: 'origin',
      branch: 'develop',
      all: false,
      dryRun: true
    };
    
    expect(options.remote).toBe('origin');
    expect(options.branch).toBe('develop');
    expect(options.all).toBe(false);
    expect(options.dryRun).toBe(true);
  });

  it('should allow optional fields', () => {
    const minimalConfig: RepomirrorConfig = {
      source_repo: './source',
      target_repo: './target',
      transformation_instructions: 'transform',
      config_version: '0.1.0'
    };
    
    expect(minimalConfig.remotes).toBeUndefined();
    expect(minimalConfig.default_remote).toBeUndefined();
    expect(minimalConfig.auto_sync).toBeUndefined();
  });
});