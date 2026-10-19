declare global {
  var __viralHitGenerationSubmissionTail: Promise<void> | undefined;
}

export async function withGenerationSubmissionLock<T>(
  work: () => Promise<T>
): Promise<T> {
  const previous = globalThis.__viralHitGenerationSubmissionTail ?? Promise.resolve();
  let release: () => void = () => {};
  globalThis.__viralHitGenerationSubmissionTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}
