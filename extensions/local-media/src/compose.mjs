import { createAdapter } from './adapter.mjs';
import { checkMediaInput, stageMedia } from './media-input.mjs';

export default createAdapter('video', { parse: checkMediaInput, prepare: stageMedia, renderTimeoutMs: 120000 });
