/**
 * Presentation covers for recipe templates. Specific shipped recipes may have their own image;
 * every other recipe, including third-party ones, gets the cover of its category.
 */
// Several related covers per category, chosen by recipe id, so neighbouring cards rarely repeat.
const CATEGORY_COVERS: Record<string, string[]> = {
  general: ['/app/create-thumb-portrait.webp', '/app/create-thumb-road.webp'],
  video: ['/app/covers/video.webp', '/app/create-thumb-road.webp', '/app/create-thumb-horse.webp'],
  audio: ['/app/covers/audio.webp', '/app/create-thumb-ripple.webp'],
  storyboard: ['/app/covers/storyboard.webp', '/app/covers/canvas.webp'],
  editing: ['/app/covers/editing.webp', '/app/covers/mask-edit.webp', '/app/create-thumb-horse.webp'],
  references: ['/app/covers/references.webp', '/app/covers/canvas.webp', '/app/covers/storyboard.webp'],
  'self-hosted': ['/app/covers/self-hosted.webp', '/app/covers/utility.webp'],
  utility: ['/app/covers/utility.webp', '/app/covers/self-hosted.webp'],
};
const RECIPE_COVERS: Record<string, string> = {
  'open-frame': '/app/create-thumb-road.webp',
  'open-motion': '/app/covers/video.webp',
  'spoken-line': '/app/covers/audio.webp',
  'picture-in-picture': '/app/create-thumb-horse.webp',
  'detect-video-scenes': '/app/covers/canvas.webp',
};
const FALLBACK_COVER = '/app/create-thumb-ripple.webp';

const hash = (value: string) => [...value].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7);

export function templateCover(recipe: { id: string; category: string }) {
  const pool = CATEGORY_COVERS[recipe.category];
  return RECIPE_COVERS[recipe.id] ?? (pool ? pool[hash(recipe.id) % pool.length] : FALLBACK_COVER);
}

export const categoryLabel = (category: string) =>
  category.split('-').map((word, index) => (index ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');

