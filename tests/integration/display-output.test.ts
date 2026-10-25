import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const args = ['--import', 'tsx', 'src/cli.ts'];
const fixture = './tests/fixtures/demo-display.mjs';

describe('display output isolation', () => {
  it('exports complete JSON from a real child process with display overlays', async () => {
    const { stdout } = await run(process.execPath, [...args, 'export', fixture], { cwd: root });
    const tools = JSON.parse(stdout) as Array<{ function: { name: string } }>;
    expect(tools.map((tool) => tool.function.name)).toContain('demo-display');
  });

  it('keeps registration silent before an SDK stdio transport starts', async () => {
    const client = new Client({ name: 'display-regression', version: '1.0.0' });
    const errors = vi.fn();
    client.onerror = errors;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'tests/fixtures/display-stdio.mjs'],
      cwd: root, stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain('_9_display_tool');
      expect(errors).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  }, 15_000);
});
