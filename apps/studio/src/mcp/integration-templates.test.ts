import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const jsonTemplates = [
  'integrations/claude-code/mcp.json.example',
  'integrations/claude-code/viral-hit/.mcp.json',
  'integrations/cline/mcp_settings.json.example',
  'integrations/cursor/mcp.json.example',
  'integrations/gemini/settings.example.json',
  'integrations/kiro/mcp.json.example',
  'integrations/qwenwork/mcp.json.example',
  'integrations/doubao-work/mcp.json.example',
  'integrations/opencode/opencode.example.json',
  'integrations/qwen/settings.example.json',
  'integrations/trae/mcp.json.example',
  'integrations/vscode/mcp.json.example',
  'integrations/windsurf/mcp_config.json.example',
  'integrations/workbuddy/mcp.json.snippet',
  'integrations/workbuddy/viral-hit/mcp.json',
  'integrations/zcode/config.example.json',
];

type ServerConfig = {
  command?: string | string[];
  args?: string[];
  npmRegistry?: string;
  runtime?: { type?: string; version?: string };
  type?: string;
  url?: string;
};

const asObject = (value: unknown) =>
  value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;

const getViralHitServer = (config: Record<string, unknown>) => {
  const mcpServers = asObject(config.mcpServers);
  const servers = asObject(config.servers);
  const mcp = asObject(config.mcp);
  const nestedServers = asObject(mcp?.servers);
  return (mcpServers?.["viral-hit"] ??
    servers?.["viral-hit"] ??
    mcp?.["viral-hit"] ??
    nestedServers?.["viral-hit"]) as ServerConfig | undefined;
};

test('all JSON Agent integration templates are valid and target the MCP entrypoint', () => {
  const packageVersion = (
    JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  for (const relativePath of jsonTemplates) {
    const absolutePath = resolve(relativePath);
    const config = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<
      string,
      unknown
    >;
    const server = getViralHitServer(config);

    assert.ok(server, `${relativePath} must define viral-hit`);
    if (relativePath === 'integrations/workbuddy/viral-hit/mcp.json') {
      assert.equal(server.type, 'stdio');
      assert.equal(server.command, 'npx');
      assert.deepEqual(server.args, [
        '--yes',
        `@viral-hit/studio-workbuddy@${packageVersion}`,
      ]);
      assert.deepEqual(server.runtime, { type: 'node', version: '22' });
      assert.equal(server.npmRegistry, 'https://registry.npmjs.org');
      continue;
    }
    if (server.url) {
      assert.ok(
        ['http', 'streamable-http', 'streamableHttp'].includes(server.type ?? ''),
        `${relativePath} must use Streamable HTTP`
      );
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      continue;
    }

    assert.ok(server.command, `${relativePath} must define a command`);

    const command =
      typeof server.command === 'string'
        ? [server.command, ...(server.args ?? [])]
        : server.command ?? [];
    assert.ok(
      command.some((part) => String(part).endsWith('scripts/mcp-server.ts')),
      `${relativePath} must invoke scripts/mcp-server.ts`
    );
  }
});

test('host packages are complete and version-aligned', () => {
  const packageVersion = (
    JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  const manifests = [
    '.claude-plugin/marketplace.json',
    'integrations/codex/viral-hit/.codex-plugin/plugin.json',
    'integrations/claude-code/viral-hit/.claude-plugin/plugin.json',
    'integrations/workbuddy/viral-hit/connector-meta.json',
    'lhm.plugin.json',
  ];

  for (const relativePath of manifests) {
    const manifest = JSON.parse(
      readFileSync(resolve(relativePath), 'utf8')
    ) as { version?: string };
    assert.equal(
      manifest.version,
      packageVersion,
      `${relativePath} must match package.json version`
    );
  }

  const marketplace = JSON.parse(
    readFileSync(resolve('.claude-plugin/marketplace.json'), 'utf8')
  ) as { plugins?: Array<{ name?: string; source?: string; version?: string }> };
  assert.deepEqual(marketplace.plugins, [
    {
      name: 'viral-hit',
      source: './integrations/claude-code/viral-hit',
      description:
        'Operate a local Viral Hit Canvas and video Editor through MCP.',
      version: packageVersion,
      author: { name: 'Viral Hit' },
    },
  ]);

  const workbuddy = JSON.parse(
    readFileSync(
      resolve('integrations/workbuddy/viral-hit/connector-meta.json'),
      'utf8'
    )
  ) as {
    source?: string;
    type?: string;
    minWorkbuddyVersion?: string;
    examples_zh?: string[];
    examples_en?: string[];
  };
  assert.match(workbuddy.source ?? '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(workbuddy.type, 'mcp');
  assert.equal(workbuddy.minWorkbuddyVersion, '5.0.0');
  assert.ok((workbuddy.examples_zh?.length ?? 0) >= 2);
  assert.ok((workbuddy.examples_en?.length ?? 0) >= 2);
  assert.match(
    readFileSync(resolve('integrations/workbuddy/viral-hit/icon.svg'), 'utf8'),
    /^<svg[\s>]/
  );
});
