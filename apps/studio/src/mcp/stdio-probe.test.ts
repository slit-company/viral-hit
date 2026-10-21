import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { VIRAL_HIT_MCP_TOOL_NAMES } from './tools';

const send = (
  child: ReturnType<typeof spawn>,
  message: Record<string, unknown>
) => {
  child.stdin?.write(`${JSON.stringify(message)}\n`);
};

const readJsonLine = async (
  child: ReturnType<typeof spawn>,
  timeoutMs = 12_000
) =>
  new Promise<Record<string, unknown>>((resolveLine, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for MCP stdio response'));
    }, timeoutMs);
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      child.stdout?.off('data', onData);
      clearTimeout(timer);
      resolveLine(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
    };
    child.stdout?.on('data', onData);
  });

test('MCP stdio handshake lists the catalogued tools and can list projects', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'vh-stdio-probe-'));
  const env = { ...process.env, NODE_ENV: 'development', VIRAL_HIT_SKILLS_DIR: resolve('../../examples/skills'), VIRAL_HIT_DATA_DIR: dataRoot };
  execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env, stdio: 'pipe' });
  const child = spawn(
    resolve('node_modules/.bin/tsx'),
    ['scripts/mcp-server.ts'],
    {
      cwd: resolve('.'),
      // The example skills folder stands in for an operator's own skills.
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );

  try {
    send(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'viral-hit-stdio-probe', version: '0.0.1' },
      },
    });
    const initialized = await readJsonLine(child);
    const initResult = initialized.result as {
      serverInfo?: { name?: string; version?: string };
      capabilities?: { resources?: object };
    };
    const packageVersion = (
      JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
        version: string;
      }
    ).version;
    const pluginVersion = (
      JSON.parse(
        readFileSync(
          resolve('integrations/codex/viral-hit/.codex-plugin/plugin.json'),
          'utf8'
        )
      ) as { version: string }
    ).version;
    assert.equal(initResult.serverInfo?.name, 'viral-hit');
    assert.equal(initResult.serverInfo?.version, packageVersion);
    assert.equal(pluginVersion, packageVersion);
    assert.ok(initResult.capabilities?.resources);

    send(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
    send(child, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listed = await readJsonLine(child);
    const tools = (
      listed.result as { tools?: Array<{ name: string }> }
    ).tools?.map((tool) => tool.name);
    assert.deepEqual(tools, [...VIRAL_HIT_MCP_TOOL_NAMES]);

    send(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/list',
    });
    const listedResources = await readJsonLine(child);
    const resources = (
      listedResources.result as {
        resources?: Array<{ uri: string; mimeType?: string }>;
      }
    ).resources;
    assert.ok(
      resources?.some(
        (resource) =>
          resource.uri === 'viral-hit://skills' &&
          resource.mimeType === 'application/json'
      )
    );

    send(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/templates/list',
    });
    const listedTemplates = await readJsonLine(child);
    const resourceTemplates = (
      listedTemplates.result as {
        resourceTemplates?: Array<{ uriTemplate: string }>;
      }
    ).resourceTemplates;
    assert.ok(
      resourceTemplates?.some(
        (resource) => resource.uriTemplate === 'viral-hit://skills/{skillId}'
      )
    );

    send(child, {
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/read',
      params: { uri: 'viral-hit://skills' },
    });
    const readCatalog = await readJsonLine(child);
    const catalogText = (
      readCatalog.result as { contents?: Array<{ text?: string }> }
    ).contents?.[0]?.text;
    assert.ok(catalogText);
    const catalog = JSON.parse(catalogText) as { skills?: { manifest: { id: string; scope: string }; source: string; compatible: boolean }[]; problems?: unknown[] };
    assert.deepEqual((catalog.skills ?? []).map(skill => [skill.manifest.id, skill.source, skill.manifest.scope, skill.compatible]), [
      ['consistent-characters', 'official', 'general', true],
      ['product-ad-shots', 'local', 'specialized', true],
      ['recipe-packs', 'official', 'general', true],
      ['storyboard', 'official', 'general', true],
    ]);
    assert.deepEqual(catalog.problems, []);

    send(child, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'viral_hit_skill_list', arguments: {} },
    });
    const listedSkills = await readJsonLine(child);
    const skillPayload = listedSkills.result as {
      structuredContent?: { result?: { skills?: { manifest: { id: string } }[] } };
    };
    assert.deepEqual(skillPayload.structuredContent?.result?.skills?.map(skill => skill.manifest.id), ['consistent-characters', 'product-ad-shots', 'recipe-packs', 'storyboard']);

    send(child, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'viral_hit_project_list', arguments: { limit: 5 } },
    });
    const listedProjects = await readJsonLine(child, 15_000);
    const payload = listedProjects.result as {
      structuredContent?: { result?: unknown };
    };
    assert.ok(Array.isArray(payload.structuredContent?.result));
  } finally {
    const stopped = new Promise<void>(done => { if (child.exitCode !== null || child.signalCode !== null) done(); else child.once('exit', () => done()); });
    child.kill(); await stopped;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
