export function descriptor(entry, sha256) {
  return { schemaVersion: 1, operation: 'ext.rea-inspect', version: '1', label: 'App and website inspection', author: 'Viral Hit contributors', license: 'Apache-2.0', entry, sha256,
    recovery: 'reconcile', generation: false, execution: { timeoutMs: 200000, abortOnCancel: true },
    configuration: ['VIRAL_HIT_REA_NODE', 'VIRAL_HIT_REA_CLI', 'VIRAL_HIT_REA_CLI_SHA256', 'VIRAL_HIT_REA_TARGETS', 'VIRAL_HIT_REA_EVIDENCE_DIR'].map(name => ({ name, required: true })),
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      targetId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
      kind: { type: 'string', enum: ['website', 'javascript'] },
      question: { type: 'string', minLength: 1, maxLength: 2000 },
    }, required: ['targetId', 'kind', 'question'] },
  };
}
