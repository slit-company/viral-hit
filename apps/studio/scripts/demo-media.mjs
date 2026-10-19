import { execFileSync } from 'node:child_process';

/** Original procedural test media. No model generation, downloads or licensed stock. */
export function createDemoMedia(outputPath) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', "nullsrc=s=640x360:r=30:d=3,geq=r='70+60*sin(X/140+T)':g='85+70*sin(Y/100+T)':b='100+80*cos((X+Y)/150+T)'",
    '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-af', 'volume=0.2',
    '-shortest', '-movflags', '+faststart', outputPath], { stdio: 'pipe' });
}
