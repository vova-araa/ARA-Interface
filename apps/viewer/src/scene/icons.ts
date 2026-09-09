import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

/** Emoji → CanvasTexture, cached (tool icons above figures). */
export function emojiTexture(emoji: string): THREE.CanvasTexture {
  let texture = cache.get(emoji);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 32, 36);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    cache.set(emoji, texture);
  }
  return texture;
}
