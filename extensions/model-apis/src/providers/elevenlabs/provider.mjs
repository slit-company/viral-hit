import { send, sendJson } from '../../kit/http.mjs';
import { credential } from '../../kit/polling.mjs';
import { readReference, outputMime, extensionFor } from '../../kit/media.mjs';
import { promptOf, optionsOf, referencesOf, select, toggle, number, text, refs } from '../../kit/options.mjs';
// ElevenLabs API: https://elevenlabs.io/docs/api-reference (text-to-speech, music, sound-generation, voice-changer)
const API = 'https://api.elevenlabs.io/v1';
const VOICE = text('voice_id', 'Voice ID', 'JBFqnCBsd6RMkjVDRZzb', 64);
export const manifest = {
  id: 'elevenlabs', label: 'ElevenLabs', description: 'Voice, music, sound effects and voice changing through the ElevenLabs API.', environment: ['ELEVENLABS_API_KEY'],
  models: [
    { id: 'elevenlabs-speech', name: 'ElevenLabs voice', kind: 'audio', upstreamModelId: 'text-to-speech', studioTasks: ['text-to-speech'], controls: [select('model_id', 'Voice model', ['eleven_v4', 'eleven_v4_turbo', 'eleven_multilingual_v2', 'eleven_flash_v2_5']), VOICE, number('stability', 'Stability', 0, 1, 0.5), number('similarity_boost', 'Similarity', 0, 1, 0.75), number('style', 'Style', 0, 1, 0), number('speed', 'Speed', 0.7, 1.2, 1)] },
    { id: 'elevenlabs-music', name: 'Eleven Music 2.5', kind: 'audio', upstreamModelId: 'music_v2_5', studioTasks: ['music-generate'], controls: [number('seconds', 'Length (seconds)', 3, 600, 30, true), toggle('force_instrumental', 'Instrumental only')] },
    { id: 'elevenlabs-sound-effects', name: 'ElevenLabs sound effects', kind: 'audio', upstreamModelId: 'eleven_text_to_sound_v3', studioTasks: ['audio-generate'], controls: [number('seconds', 'Length (seconds)', 0.5, 30, 5), number('prompt_influence', 'Prompt influence', 0, 1, 0.3), toggle('loop', 'Seamless loop')] },
    { id: 'elevenlabs-voice-changer', name: 'ElevenLabs voice changer', kind: 'audio', upstreamModelId: 'eleven_multilingual_sts_v2', studioTasks: ['voice-change'], controls: [VOICE, toggle('remove_background_noise', 'Remove background noise')], referenceInputs: refs([0, 0], [0, 0], [1, 1]) },
  ],
};
const headers = configuration => ({ 'xi-api-key': credential(configuration, 'ELEVENLABS_API_KEY', 'ElevenLabs', /^[\w-]{20,}$/) });
const voiceId = value => { if (!/^[A-Za-z0-9]{8,40}$/.test(value)) throw Error('Enter an ElevenLabs voice ID from your voice library'); return value; };

export async function createGeneration({ model, input, configuration, signal, readMedia }) {
  const profile = manifest.models.find(item => item.id === model.id);
  if (!profile) throw Error('Unknown ElevenLabs model');
  const options = optionsOf(profile, input), auth = headers(configuration);
  const call = (path, body) => send('ElevenLabs', API + path, { method: 'POST', body, headers: auth, signal, timeout: 600_000, maxBytes: 128 * 1048576 });
  let result;
  if (profile.id === 'elevenlabs-speech') {
    result = await call('/text-to-speech/' + voiceId(options.voice_id) + '?output_format=mp3_44100_128', { text: promptOf(input, { max: 5_000 }), model_id: options.model_id, voice_settings: { stability: options.stability, similarity_boost: options.similarity_boost, style: options.style, speed: options.speed } });
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
