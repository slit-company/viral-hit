/** Measured facts about a rendered take, read from the decoded frames and audio. */
export type TakeMeasures = {
  durationSec: number; width: number; height: number; fps: number;
  frozenSec: number; blackSec: number; cuts: number[];
  hasAudio: boolean; maxVolumeDb: number | null;
};
export type TakeIssue = 'short' | 'low_resolution' | 'frozen' | 'black' | 'cuts' | 'silent' | 'low_fps';
export type TakeQuality = { score: number; verdict: 'good' | 'check' | 'retry'; issues: TakeIssue[]; measures: TakeMeasures };

/**
 * A technical gate, not a taste judgement: it catches the failures people otherwise find only after
 * export — frozen or black stretches, accidental cuts inside one shot, low resolution, missing sound.
 */
export function scoreTake(measures: TakeMeasures, expect: { durationSec?: number; audio?: boolean } = {}): TakeQuality {
  const issues: TakeIssue[] = [];
  let score = 100;
  const penalize = (issue: TakeIssue, points: number) => { issues.push(issue); score -= points; };
  if (expect.durationSec && measures.durationSec < expect.durationSec - 0.5) penalize('short', 15);
  const shortSide = Math.min(measures.width, measures.height);
  if (shortSide < 480) penalize('low_resolution', 30); else if (shortSide < 720) penalize('low_resolution', 12);
  const frozen = measures.durationSec > 0 ? measures.frozenSec / measures.durationSec : 0;
  if (frozen > 0.35) penalize('frozen', 35); else if (frozen > 0.15) penalize('frozen', 15);
  if (measures.durationSec > 0 && measures.blackSec / measures.durationSec > 0.2) penalize('black', 25);
  if (measures.cuts.length) penalize('cuts', Math.min(30, measures.cuts.length * 12));
  if (expect.audio && (!measures.hasAudio || (measures.maxVolumeDb ?? -99) < -50)) penalize('silent', 20);
  if (measures.fps > 0 && measures.fps < 20) penalize('low_fps', 10);
  score = Math.max(0, score);
  return { score, verdict: score >= 80 ? 'good' : score >= 60 ? 'check' : 'retry', issues, measures };
}

/** Reads FFmpeg's freezedetect, blackdetect, scdet and volumedetect log lines. */
export function parseAnalysisLog(log: string, durationSec: number) {
  let frozenSec = 0, blackSec = 0, openFreeze: number | null = null, maxVolumeDb: number | null = null;
  const cuts: number[] = [];
  for (const line of log.split('\n')) {
    const freezeStart = line.match(/freeze_start: ([\d.]+)/); if (freezeStart) openFreeze = Number(freezeStart[1]);
    const freezeDuration = line.match(/freeze_duration: ([\d.]+)/); if (freezeDuration) { frozenSec += Number(freezeDuration[1]); openFreeze = null; }
    const black = line.match(/black_duration:([\d.]+)/); if (black) blackSec += Number(black[1]);
    const cut = line.match(/lavfi\.scd\.time: ([\d.]+)/); if (cut && Number(cut[1]) > 0.2 && Number(cut[1]) < durationSec - 0.2) cuts.push(Number(cut[1]));
    const volume = line.match(/max_volume: (-?[\d.]+|-inf) dB/); if (volume) maxVolumeDb = volume[1] === '-inf' ? -99 : Number(volume[1]);
  }
  if (openFreeze !== null) frozenSec += Math.max(0, durationSec - openFreeze);
  return { frozenSec, blackSec, cuts, maxVolumeDb };
}
