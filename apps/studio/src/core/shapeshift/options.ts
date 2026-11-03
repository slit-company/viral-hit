/** Choices shared by the Shapeshift page and its request contract; the page loads only this module. */
export const SHAPESHIFT_MODES = ['motion-transfer', 'object-swap'] as const;
export type ShapeshiftMode = (typeof SHAPESHIFT_MODES)[number];
export const SHAPESHIFT_STYLES = ['none', 'anime', 'animation-3d', 'claymation', 'comic', 'watercolor', 'pixel-art', 'film-noir', 'neon', 'oil-painting'] as const;
export type ShapeshiftStyle = (typeof SHAPESHIFT_STYLES)[number];
export const SHAPESHIFT_QUALITIES = ['480p', '720p', '1080p'] as const;
export type ShapeshiftQuality = (typeof SHAPESHIFT_QUALITIES)[number];
export const MAX_SUBJECT_IMAGES = 14, MAX_VARIATIONS = 3;
