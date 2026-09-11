import * as THREE from 'three';

/**
 * Monument-Valley-shading via shader-injectie op een MeshStandardMaterial:
 *  - schaduwkant krijgt een koele paarse tint (i.p.v. dof grijs),
 *  - een fresnel-randlicht licht de silhouetranden warm op,
 *  - height-fog: lage, verre tegels smelten extra in de horizon.
 * Behoudt metalness/env-reflecties (anders dan MeshToonMaterial). Kost niets.
 */
export function stylize<T extends THREE.MeshStandardMaterial>(
  material: T,
  opts: { rim?: string; rimStrength?: number; shadowTint?: string; shadowStrength?: number } = {},
): T {
  const rim = new THREE.Color(opts.rim ?? '#9ec6ff');
  const shadow = new THREE.Color(opts.shadowTint ?? '#4a3d6b');
  const rimStrength = (opts.rimStrength ?? 0.45).toFixed(3);
  const shadowStrength = (opts.shadowStrength ?? 0.25).toFixed(3);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uShadow = { value: shadow };
    // vViewPosition bestaat al in de standard-shader; die geeft de kijkrichting.
    shader.fragmentShader =
      'uniform vec3 uRim;\nuniform vec3 uShadow;\n' +
      shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
    {
      // Koele tint in de schaduw: hoe minder direct licht, hoe paarser.
      float lum = dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114));
      float sh = 1.0 - smoothstep(0.0, 0.35, lum);
      reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, uShadow, sh * ${shadowStrength});
      // Fresnel-randlicht op het silhouet.
      float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
      totalEmissiveRadiance += uRim * rimF * ${rimStrength};
    }`,
      );
  };
  material.customProgramCacheKey = () => `stylize-${rimStrength}-${shadowStrength}`;
  return material;
}
