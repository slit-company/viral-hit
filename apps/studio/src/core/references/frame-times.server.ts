import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
/** Select existing presentation timestamps; a fractional position can fall after the final frame. */
export async function referenceFrameTimes(file: string, durationMs: number, signal: AbortSignal) {
  const targets = [0, 0.25, 0.5, 0.75, 0.95].map(fraction => durationMs * fraction / 1000);
  const results: number[] = [];
  for (const target of targets) {
    const { stdout } = await execute(process.env.VIRAL_HIT_FFPROBE || 'ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file',
      '-format_whitelist', 'mov,matroska', '-select_streams', 'v:0',
      '-read_intervals', `${Math.max(0, target - 2)}%${target + 2}`,
      '-show_entries', 'packet=pts_time:format=start_time', '-of', 'json', file,
    ], { signal, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    const data = JSON.parse(stdout) as { packets?: { pts_time?: string }[]; format?: { start_time?: string } };
    const start = Number(data.format?.start_time ?? 0);
    if (!Number.isFinite(start) || !Array.isArray(data.packets)) throw new Error('Reference frame timestamps are unavailable');
    const times = data.packets.map(packet => Number(packet.pts_time) - start).filter(time => Number.isFinite(time) && time >= 0).sort((a, b) => a - b);
    const selected = times.findLast(time => time <= target + 0.000001) ?? times[0];
    if (selected === undefined) throw new Error('No bounded video frame was found near a reference sample');
    // Seeking at the rounded-down millisecond selects this frame, never skips past it.
    results.push(Math.floor(selected * 1000 + 0.000001));
  }
  return results;
}
