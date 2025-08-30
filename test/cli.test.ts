import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execa } from 'execa';
import path from 'path';

describe('CLI', () => {
  const cliPath = path.join(__dirname, '../dist/cli.js');

  describe('help command', () => {
    it('should display help information', async () => {
      const result = await execa('node', [cliPath, '--help']);
      expect(result.stdout).toContain('repomirror');
      expect(result.stdout).toContain('Sync and transform repositories');
      expect(result.stdout).toContain('Commands:');
      expect(result.stdout).toContain('init');
      expect(result.stdout).toContain('sync');
      expect(result.stdout).toContain('remote');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('version command', () => {
    it('should display version', async () => {
      const result = await execa('node', [cliPath, '--version']);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('unknown command', () => {
    it('should show error for unknown command', async () => {
      try {
        await execa('node', [cliPath, 'unknown-command']);
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        expect(error.stderr).toContain('error');
      }
    });
  });
});