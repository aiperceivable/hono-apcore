import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const optionalPeer = /\/apcore-(?:mcp|cli|a2a)(?:@|\/)/;
const optionalPeerSpecifier = /^apcore-(?:mcp|cli|a2a)(?:\/|$)/;
const nodeHttp = /^node:https?(?:\/|$)/;
const nodeBuiltin = /^node:/;

function formatFailure(error) {
  const failures = error.errors?.map((item) => {
    const location = item.location
      ? ` (${relative(root, item.location.file)}:${item.location.line})`
      : '';
    return `  ${item.text}${location}`;
  });
  return failures?.length ? failures.join('\n') : `  ${error.message}`;
}

async function bundle(label, options) {
  const {
    allowNodeBuiltinsInEntry = false,
    splitting = true,
    absWorkingDir = root,
    ...buildOptions
  } = options;
  const outdir = mkdtempSync(join(tmpdir(), 'hono-apcore-edge-out-'));
  let result;
  try {
    result = await build({
      bundle: true,
      write: false,
      outdir,
      platform: 'browser',
      format: 'esm',
      splitting,
      conditions: ['browser', 'worker', 'workerd'],
      external: ['node:*'],
      metafile: true,
      logLevel: 'silent',
      absWorkingDir,
      ...buildOptions,
    });
  } catch (error) {
    console.error(`✘ ${label}: bundling failed`);
    console.error(formatFailure(error));
    process.exitCode = 1;
    return;
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }

  const outputs = Object.entries(result.metafile.outputs);
  const entry = outputs.find(([, meta]) => meta.entryPoint);
  const problems = [];

  for (const [file, meta] of outputs) {
    for (const imported of meta.imports ?? []) {
      if (nodeHttp.test(imported.path)) {
        problems.push(`${relative(root, file)} imports ${imported.path} (${imported.kind})`);
      }
    }
  }

  const inputs = Object.keys(result.metafile.inputs);
  const peerInput = inputs.find((file) => optionalPeer.test(file));
  if (peerInput) problems.push(`optional peer is bundled: ${relative(root, peerInput)}`);

  if (!inputs.some((file) => file.endsWith('dist/edge.js'))) {
    problems.push('package root did not resolve to dist/edge.js');
  }
  const nodeEntry = inputs.find((file) => file.endsWith('dist/index.js'));
  if (nodeEntry) problems.push(`Node entry is bundled: ${relative(root, nodeEntry)}`);

  if (!entry) {
    problems.push('could not identify the entry chunk');
  } else if (!allowNodeBuiltinsInEntry) {
    const [entryFile, entryMeta] = entry;
    for (const imported of entryMeta.imports ?? []) {
      if (imported.path.startsWith('node:')) {
        problems.push(`entry chunk imports ${imported.path} (${imported.kind})`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`✘ ${label}`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `✓ ${label}: ${Object.keys(result.metafile.inputs).length} modules, `
    + 'no node:http or optional peers',
  );
}

async function checkLocalGraph() {
  const outdir = mkdtempSync(join(tmpdir(), 'hono-apcore-edge-local-'));
  let result;
  try {
    result = await build({
      entryPoints: [resolve(root, 'dist/edge.js')],
      bundle: true,
      write: false,
      outdir,
      platform: 'node',
      format: 'esm',
      splitting: true,
      packages: 'external',
      metafile: true,
      logLevel: 'silent',
    });
  } catch (error) {
    console.error('✘ local edge graph: bundling failed');
    console.error(formatFailure(error));
    process.exitCode = 1;
    return;
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }

  const problems = [];
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    for (const imported of meta.imports ?? []) {
      if (nodeBuiltin.test(imported.path) || optionalPeerSpecifier.test(imported.path)) {
        problems.push(`${relative(root, file)} imports ${imported.path} (${imported.kind})`);
      }
    }
  }

  if (problems.length > 0) {
    console.error('✘ local edge graph');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(`✓ local edge graph: ${Object.keys(result.metafile.inputs).length} modules, no node:* or optional peers`);
}

await checkLocalGraph();
await bundle('explicit edge entry', { entryPoints: [resolve(root, 'dist/edge.js')] });
await bundle('explicit edge entry, single chunk', {
  entryPoints: [resolve(root, 'dist/edge.js')],
  splitting: false,
  allowNodeBuiltinsInEntry: true,
});

const consumerDir = mkdtempSync(join(tmpdir(), 'hono-apcore-edge-'));
try {
  mkdirSync(join(consumerDir, 'node_modules'), { recursive: true });
  symlinkSync(root, join(consumerDir, 'node_modules', 'hono-apcore'), 'dir');
  const consumer = join(consumerDir, 'consumer.mjs');
  writeFileSync(
    consumer,
    "export { HonoApcore, createApcore, apcore, defineTool } from 'hono-apcore';\n",
  );
  await bundle('package root with browser conditions', {
    entryPoints: [consumer],
    absWorkingDir: consumerDir,
  });
  await bundle('package root with browser conditions, single chunk', {
    entryPoints: [consumer],
    absWorkingDir: consumerDir,
    splitting: false,
    allowNodeBuiltinsInEntry: true,
  });
} finally {
  rmSync(consumerDir, { recursive: true, force: true });
}
