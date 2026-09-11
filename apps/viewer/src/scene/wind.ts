import * as THREE from 'three';

/** Gedeelde windklok — elke frame getikt door WindTicker in Scene. */
export const windTime = { value: 0 };

/**
 * GPU-wind via shader-injectie: vertices zwaaien mee op hoogte, de voet
 * blijft geplant; wereldpositie geeft elk object z'n eigen fase. Werkt op
 * gewone én instanced meshes (USE_INSTANCING-guard). Kost niets op de CPU.
 */
export function applyWind<T extends THREE.Material>(material: T, strength = 0.06, base = 0): T {
  const s = strength.toFixed(4);
  const b = base.toFixed(4);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader =
      'uniform float uWindTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
    float windSway = pow(max(position.y + ${b}, 0.0), 2.0);
    #ifdef USE_INSTANCING
      vec3 windWp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #else
      vec3 windWp = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #endif
    transformed.x += sin(uWindTime * 1.7 + windWp.x * 0.9 + windWp.z * 0.7) * windSway * ${s};
    transformed.z += cos(uWindTime * 1.3 + windWp.z * 0.8) * windSway * ${s} * 0.66;`,
      );
  };
  material.customProgramCacheKey = () => `wind-${s}-${b}`;
  return material;
}

/** Gedeeld bladerdak-materiaal met wind: alle boomkruinen zwaaien in één stijl. */
export const FOLIAGE_MATERIAL = applyWind(
  new THREE.MeshStandardMaterial({ color: '#6aa84f', flatShading: true }),
  0.09,
  0.55,
);
