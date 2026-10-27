// Pixel ratio cap for the three.js scenes: unchanged on desktop (>= 1200 px), at most 1.5 on tablet / mobile (lighter canvases).
export const capDpr = (max) => Math.min(window.devicePixelRatio || 1, matchMedia('(max-width: 1199px)').matches ? Math.min(max, 1.5) : max);
