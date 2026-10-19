/** The current export policy: landscape/square 1080p or portrait 1080p. */
export function timelineOutputFrame(width: number, height: number) {
  return height > width ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}
