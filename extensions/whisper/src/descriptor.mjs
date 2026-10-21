export function whisperDescriptor(entry, sha256) {
return {
  schemaVersion: 1, operation: 'ext.whisper-transcribe', version: '1', label: 'Local speech transcription',
  author: 'Viral Hit contributors', license: 'Apache-2.0', entry, sha256,
  recovery: 'replay', generation: false, execution: { timeoutMs: 240000, abortOnCancel: true },
  configuration: ['VIRAL_HIT_WHISPER_CLI', 'VIRAL_HIT_WHISPER_CLI_SHA256', 'VIRAL_HIT_WHISPER_MODEL', 'VIRAL_HIT_WHISPER_MODEL_SHA256', 'VIRAL_HIT_FFMPEG', 'VIRAL_HIT_FFPROBE'].map(name => ({ name, required: true })),
  assetInputs: ['video', 'audio'].map(kind => ({ id: kind, pointer: '/' + kind + 'AssetId', kind, maxBytes: 64 * 1024 * 1024, optional: true })),
  inputSchema: { type: 'object', additionalProperties: false,
    properties: {
      videoAssetId: { type: ['string', 'null'], pattern: '^[a-zA-Z0-9_-]{1,128}$' }, audioAssetId: { type: ['string', 'null'], pattern: '^[a-zA-Z0-9_-]{1,128}$' },
      start: { type: 'number', minimum: 0, maximum: 3600 }, duration: { type: 'number', minimum: 1, maximum: 120 },
      language: { type: 'string', pattern: '^(auto|[a-z]{2,3})$' }, maxChars: { type: 'integer', minimum: 16, maximum: 160 }, threads: { type: 'integer', minimum: 1, maximum: 4 },
    }, required: ['videoAssetId', 'audioAssetId', 'start', 'duration', 'language', 'maxChars', 'threads'],
    oneOf: [{ properties: { videoAssetId: { type: 'string' }, audioAssetId: { type: 'null' } } }, { properties: { audioAssetId: { type: 'string' }, videoAssetId: { type: 'null' } } }],
  },
};
}
