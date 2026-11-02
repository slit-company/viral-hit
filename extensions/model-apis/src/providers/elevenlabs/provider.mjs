import { send, sendJson } from '../../kit/http.mjs';
import { credential } from '../../kit/polling.mjs';
import { readReference, outputMime, extensionFor } from '../../kit/media.mjs';
import { promptOf, optionsOf, referencesOf, select, toggle, number, text, refs } from '../../kit/options.mjs';
// ElevenLabs API: https://elevenlabs.io/docs/api-reference (text-to-speech, music, sound-generation, voice-changer)
const API = 'https://api.elevenlabs.io/v1';
// Default voices every ElevenLabs account can use (GET /v2/voices?voice_type=default). Any other voice ID stays allowed.
const DEFAULT_VOICES = [
  ['pNInz6obpgDQGcFmaJgB', 'Adam · American man · dominant, firm'],
  ['Xb7hH8MSUJpSbSDYk0k2', 'Alice · British woman · clear, engaging educator'],
  ['hpp4J3VqNfWAUOO0d1Us', 'Bella · American woman · professional, bright, warm'],
  ['pqHfZKP75CvOlQylNhV4', 'Bill · American man · wise, mature, balanced'],
  ['nPczCjzI2devNBz1zQrb', 'Brian · American man · deep, resonant and comforting'],
  ['N2lVS1w4EtoT3dr4eOWO', 'Callum · American man · husky trickster'],
  ['IKne3meq5aSn9XLyUdCD', 'Charlie · Australian man · deep, confident, energetic'],
  ['iP95p4xoKVk53GoZ742B', 'Chris · American man · charming, down-to-earth'],
  ['onwK4e9ZLuTAKqWW03F9', 'Daniel · British man · steady broadcaster'],
  ['cjVigY5qzO86Huf0OWal', 'Eric · American man · smooth, trustworthy'],
  ['JBFqnCBsd6RMkjVDRZzb', 'George · British man · warm, captivating storyteller'],
  ['SOYHLrjzK2X1ezoPC6cr', 'Harry · American man · fierce warrior'],
  ['cgSgspJ2msm6clMCkdW9', 'Jessica · American woman · playful, bright, warm'],
  ['FGY2WhTYpPnrIDTdsKH5', 'Laura · American woman · enthusiast, quirky attitude'],
  ['TX3LPaxmHKxFdv7VOQHJ', 'Liam · American man · energetic, social media creator'],
  ['pFZP5JQG7iQjIQuC4Bku', 'Lily · British woman · velvety actress'],
  ['XrExE9yKIg1WjnnlVkGX', 'Matilda · American woman · knowledgeable, professional'],
  ['SAz9YHcvj6GT2YYXdXww', 'River · American neutral voice · relaxed, neutral, informative'],
  ['CwhRBWXzGAHq8TQ4Fs17', 'Roger · American man · laid-back, casual, resonant'],
  ['EXAVITQu4vr4xnSDxMaL', 'Sarah · American woman · mature, reassuring, confident'],
  ['bIHbv24MWmeRgasZH58o', 'Will · American man · relaxed optimist'],
].map(([value, label]) => ({ value, label }));
const VOICE = { ...text('voice_id', 'Voice', 'JBFqnCBsd6RMkjVDRZzb', 64), suggestions: DEFAULT_VOICES };
export const manifest = {
  id: 'elevenlabs', setupUrl: 'https://elevenlabs.io/app/settings/api-keys', label: 'ElevenLabs', description: 'Voice, music, sound effects and voice changing through the ElevenLabs API.', environment: ['ELEVENLABS_API_KEY'], balanceCheck: true,
  models: [
    { id: 'elevenlabs-speech', name: 'ElevenLabs voice', kind: 'audio', upstreamModelId: 'text-to-speech', studioTasks: ['text-to-speech'], controls: [select('model_id', 'Voice model', ['eleven_v4', 'eleven_v4_turbo', 'eleven_multilingual_v2', 'eleven_flash_v2_5']), VOICE, number('stability', 'Stability', 0, 1, 0.5), number('similarity_boost', 'Similarity', 0, 1, 0.75), number('style', 'Style', 0, 1, 0), number('speed', 'Speed', 0.7, 1.2, 1)] },
    { id: 'elevenlabs-music', name: 'Eleven Music 2.5', kind: 'audio', upstreamModelId: 'music_v2_5', studioTasks: ['music-generate'], controls: [number('seconds', 'Length (seconds)', 3, 600, 30, true), toggle('force_instrumental', 'Instrumental only')] },
    { id: 'elevenlabs-sound-effects', name: 'ElevenLabs sound effects', kind: 'audio', upstreamModelId: 'eleven_text_to_sound_v3', studioTasks: ['audio-generate'], controls: [number('seconds', 'Length (seconds)', 0.5, 30, 5), number('prompt_influence', 'Prompt influence', 0, 1, 0.3), toggle('loop', 'Seamless loop')] },
    { id: 'elevenlabs-voice-changer', name: 'ElevenLabs voice changer', kind: 'audio', upstreamModelId: 'eleven_multilingual_sts_v2', studioTasks: ['voice-change'], promptInput: 'none', controls: [VOICE, toggle('remove_background_noise', 'Remove background noise')], referenceInputs: refs([0, 0], [0, 0], [1, 1]) },
  ],
};
const headers = configuration => ({ 'xi-api-key': credential(configuration, 'ELEVENLABS_API_KEY', 'ElevenLabs') });
const voiceId = value => { if (!/^[A-Za-z0-9]{8,40}$/.test(value)) throw Error('Enter an ElevenLabs voice ID from your voice library'); return value; };
const round = value => Math.round(value * 1000) / 1000;

/** Character timestamps from /with-timestamps grouped into words (whitespace separates words). */
export function wordsFromAlignment(alignment) {
  const characters = alignment?.characters, starts = alignment?.character_start_times_seconds, ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends) || characters.length !== starts.length || characters.length !== ends.length) return [];
  const words = [];
  let current = null;
  characters.forEach((character, index) => {
    if (typeof character !== 'string' || /\s/.test(character)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    current ??= { text: '', start: starts[index], end: ends[index] };
    current.text += character;
    current.end = ends[index];
  });
  if (current) words.push(current);
  let previous = 0;
  return words
    .filter(word => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start && word.start >= previous - 0.001 && (previous = word.end, true))
    .slice(0, 10_000)
    .map(word => ({ text: word.text.slice(0, 80), start: round(word.start), end: round(word.end) }));
}

export async function createGeneration({ model, input, configuration, signal, readMedia }) {
  const profile = manifest.models.find(item => item.id === model.id);
  if (!profile) throw Error('Unknown ElevenLabs model');
  const options = optionsOf(profile, input), auth = headers(configuration);
  const call = (path, body) => send('ElevenLabs', API + path, { method: 'POST', body, headers: auth, signal, timeout: 600_000, maxBytes: 128 * 1048576 });
  let result;
  if (profile.id === 'elevenlabs-speech') {
    // The timestamped endpoint returns the same audio plus character timing, which becomes word timing for captions.
    const data = await sendJson('ElevenLabs', API + '/text-to-speech/' + voiceId(options.voice_id) + '/with-timestamps?output_format=mp3_44100_128', {
      method: 'POST', headers: auth, signal, timeout: 600_000, maxBytes: 192 * 1048576,
      body: { text: promptOf(input, { max: 5_000 }), model_id: options.model_id, voice_settings: { stability: options.stability, similarity_boost: options.similarity_boost, style: options.style, speed: options.speed } },
    });
    if (typeof data.audio_base64 !== 'string' || !data.audio_base64) throw Error('ElevenLabs returned empty audio');
    const speechWords = wordsFromAlignment(data.alignment);
    return { status: 'succeeded', media: [{ data: new Uint8Array(Buffer.from(data.audio_base64, 'base64')), mimeType: 'audio/mpeg' }], ...(speechWords.length ? { speechWords } : {}) };
  } else if (profile.id === 'elevenlabs-music') {
    result = await call('/music', { prompt: promptOf(input, { max: 4_100 }), model_id: profile.upstreamModelId, music_length_ms: Math.round(options.seconds * 1000), force_instrumental: options.force_instrumental });
  } else if (profile.id === 'elevenlabs-sound-effects') {
    result = await call('/sound-generation?output_format=mp3_44100_128', { text: promptOf(input, { max: 1_000 }), model_id: profile.upstreamModelId, duration_seconds: options.seconds, prompt_influence: options.prompt_influence, loop: options.loop });
  } else {
    const [reference] = referencesOf(profile, input).audio, media = await readReference(readMedia, reference), form = new FormData();
    form.append('audio', new Blob([media.bytes], { type: media.mimeType }), 'voice.' + extensionFor(media.mimeType));
    form.append('model_id', profile.upstreamModelId);
    form.append('remove_background_noise', String(options.remove_background_noise));
    result = await call('/voice-changer/' + voiceId(options.voice_id) + '?output_format=mp3_44100_128', form);
  }
  if (!result.bytes.length) throw Error('ElevenLabs returned empty audio');
  return { status: 'succeeded', media: [{ data: result.bytes, mimeType: outputMime(result.type || 'audio/mpeg', '', 'audio') }] };
}

export async function testConnection({ configuration, signal }) {
  await sendJson('ElevenLabs', API + '/user', { headers: headers(configuration), signal });
  return { ok: true };
}

/** Remaining characters in the current subscription period. */
export async function checkBalance({ configuration, signal }) {
  const subscription = await sendJson('ElevenLabs', API + '/user/subscription', { headers: headers(configuration), signal });
  const limit = subscription?.character_limit, used = subscription?.character_count;
  return Number.isFinite(limit) && Number.isFinite(used)
    ? { state: 'known', amount: Math.max(0, limit - used), unit: 'characters' }
    : { state: 'unknown', reason: 'ElevenLabs did not report a character allowance' };
}
