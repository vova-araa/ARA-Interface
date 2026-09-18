import * as THREE from 'three';

export interface StylizeOptions {
  rim?: string;
  rimStrength?: number;
  shadowTint?: string;
  shadowStrength?: number;
  /** Fijne korrel over de diffuse kleur: tuff is poreus steen, geen vinyl. */
  grain?: number;
  /** Grove vlekken: verwering en verkleuring over meerdere tegels heen. */
  mottle?: number;
  /** Ruwheidsvariatie; een uniform hooglicht is precies wat plastic verraadt. */
  roughVary?: number;
  /** Gesteentelagen (horizontale banden) — alleen zinnig op de sokkelwand. */
  strata?: number;
  /** Golfnormaal + glans op water. Vereist een tijdsupdate via `tickSurface`. */
  waves?: number;
  /** Tempo van die golven; los instelbaar zodat rust ≠ traagheid. */
  waveSpeed?: number;
}

/**
 * Waarde-ruis in de shader. Bewust een hash van de wereldpositie en geen
 * texture: een texture kost een bind, een upload en geheugen per materiaal, en
 * de wereld is oneindig ver te pannen — een hash herhaalt zich nooit en kost
 * geen enkele draw call. Net als in HexGround is een hash deterministisch, dus
 * het beeld is op elke machine identiek.
 *
 * Twee dimensies, geen drie: een 3D-cel kost acht hoekpunten, een 2D-cel vier.
 * Onder software-rendering (CI, container, geen GPU) is dat het verschil tussen
 * wel en niet halen — de grond beslaat het hele scherm, dus elke hash telt
 * mee per pixel. De hoogte wordt in de coördinaat meegemengd, zodat de wanden
 * van een tegel niet dezelfde streep krijgen als de bovenkant.
 */
const NOISE_GLSL = `
float araHash(vec2 p) {
  vec3 h = fract(vec3(p.xyx) * 0.1031);
  h += dot(h, h.yzx + 33.33);
  return fract((h.x + h.y) * h.z);
}
float araNoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(araHash(i), araHash(i + vec2(1.0, 0.0)), f.x),
             mix(araHash(i + vec2(0.0, 1.0)), araHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/**
 * Monument-Valley-shading via shader-injectie op een MeshStandardMaterial:
 *  - schaduwkant krijgt een koele paarse tint (i.p.v. dof grijs),
 *  - een fresnel-randlicht licht de silhouetranden warm op,
 *  - optioneel een procedureel oppervlak: korrel, vlekken, gesteentelagen of
 *    golven, zodat een vlak niet één matte kleur blijft.
 * Behoudt metalness/env-reflecties (anders dan MeshToonMaterial). Kost niets:
 * geen extra mesh, geen extra draw call, geen texture — alleen rekenwerk in
 * fragmenten die toch al getekend worden.
 */
export function stylize<T extends THREE.MeshStandardMaterial>(material: T, opts: StylizeOptions = {}): T {
  const rim = new THREE.Color(opts.rim ?? '#9ec6ff');
  const shadow = new THREE.Color(opts.shadowTint ?? '#4a3d6b');
  const rimStrength = (opts.rimStrength ?? 0.45).toFixed(3);
  const shadowStrength = (opts.shadowStrength ?? 0.25).toFixed(3);

  const grain = (opts.grain ?? 0).toFixed(3);
  const mottle = (opts.mottle ?? 0).toFixed(3);
  const roughVary = (opts.roughVary ?? 0).toFixed(3);
  const strata = (opts.strata ?? 0).toFixed(3);
  const waves = (opts.waves ?? 0).toFixed(3);
  const waveSpeed = (opts.waveSpeed ?? 1).toFixed(3);

  const parts: string[] = [];
  // De ruwheidsvariatie leent de fijne octaaf van de korrel: waar het steen
  // korrelig is, is het ook mat — één sample voor twee effecten.
  const needsGrainSamples = !!opts.grain || !!opts.roughVary;
  if (needsGrainSamples) {
    // Twee octaven: de grove geeft de steenslag, de fijne de korrel zelf. Eén
    // frequentie leest als ruis over een plaat, twee lezen als materiaal.
    // De fijne bewust niet hoger dan ~17: een tegel beslaat op de gebruikelijke
    // zoom zo'n 60 px, en ruis fijner dan een paar pixels flikkert bij het
    // pannen in plaats van dat het steen wordt.
    parts.push(`
    float araG1 = araNoise(araP * 6.5);
    float araG2 = araNoise(araP * 17.0);`);
  }
  if (opts.grain) {
    parts.push(`
    diffuseColor.rgb *= 1.0 + ((araG1 - 0.5) * 0.58 + (araG2 - 0.5) * 0.42) * 2.0 * ${grain};
    // Alleen de bovenkant van de ruis wordt een putje: poriën zijn donkere
    // gaatjes, geen lichte stippen — licht speckle leest meteen als vuil glas.
    diffuseColor.rgb *= 1.0 - smoothstep(0.62, 0.98, araG2) * ${grain} * 0.5;`);
  }
  if (opts.mottle) {
    parts.push(`
    float araM = araNoise(araP * 1.3);
    diffuseColor.rgb *= 1.0 + (araM - 0.5) * 2.0 * ${mottle};`);
  }
  if (opts.strata) {
    // De banden worden met ruis verschoven; kaarsrechte lagen lezen als
    // behang, een golvende laag leest als afzetting.
    parts.push(`
    float araWarp = araNoise(vSurfPos.xz * 0.45) * 1.6;
    float araBand = fract(vSurfPos.y * 0.8 + araWarp);
    float araSeam = smoothstep(0.0, 0.09, araBand) * (1.0 - smoothstep(0.86, 1.0, araBand));
    diffuseColor.rgb *= mix(1.0 - ${strata}, 1.0 + ${strata} * 0.4, araSeam);`);
  }
  if (opts.roughVary) {
    parts.push(`
    roughnessFactor = clamp(roughnessFactor + (araG2 - 0.5) * 2.0 * ${roughVary}, 0.04, 1.0);`);
  }
  if (opts.waves) {
    // Drie sinussen onder een hoek in plaats van ruis: de helling is analytisch
    // bekend, dus de normaal kost geen extra ruis-samples. Ruis zou er drie
    // nodig hebben om een gradiënt te benaderen.
    parts.push(`
    vec2 wp = vSurfPos.xz;
    float wt = uTime * ${waveSpeed};
    vec2 d1 = vec2(0.87, 0.49);
    vec2 d2 = vec2(-0.41, 0.91);
    vec2 d3 = vec2(0.66, -0.75);
    float s1 = cos(dot(wp, d1) * 2.3 + wt * 0.9);
    float s2 = cos(dot(wp, d2) * 3.9 - wt * 0.7);
    float s3 = cos(dot(wp, d3) * 7.1 + wt * 1.6);
    vec2 slope = d1 * (2.3 * s1 * 0.055) + d2 * (3.9 * s2 * 0.022) + d3 * (7.1 * s3 * 0.008);
    // De normaal in deze shader staat in view-space; de golf in wereld-space.
    // Zonder deze omrekening draaien de hooglichten mee met de camera.
    normal = normalize(normal + (viewMatrix * vec4(slope.x * ${waves}, 0.0, slope.y * ${waves}, 0.0)).xyz);
    // Op de golfrug is het water glad en glanst het; in het dal breekt het.
    roughnessFactor = clamp(roughnessFactor - (s1 * 0.5 + 0.5) * 0.09 * ${waves}, 0.02, 1.0);`);
  }

  const hasSurface = parts.length > 0;
  const surfaceKey = hasSurface ? `${grain}-${mottle}-${roughVary}-${strata}-${waves}-${waveSpeed}` : 'flat';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uShadow = { value: shadow };
    if (opts.waves) shader.uniforms.uTime = { value: 0 };
    // Zo kan de aanroeper de tijd bijwerken zonder de shader te kennen.
    material.userData.araShader = shader;

    if (hasSurface) {
      // Eigen varying in plaats van three's `worldPosition`: die bestaat alleen
      // onder bepaalde defines (envmap/shadowmap) en zou hier stil uitvallen.
      // Na `project_vertex`, want de instanceMatrix hoort erbij — anders
      // krijgen duizenden tegels exact dezelfde korrel op dezelfde plek.
      shader.vertexShader =
        'varying vec3 vSurfPos;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
    {
      vec4 araWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        araWorld = instanceMatrix * araWorld;
      #endif
      vSurfPos = (modelMatrix * araWorld).xyz;
    }`,
        );
    }

    shader.fragmentShader =
      'uniform vec3 uRim;\nuniform vec3 uShadow;\n' +
      (hasSurface ? `varying vec3 vSurfPos;\n${opts.waves ? 'uniform float uTime;\n' : ''}${NOISE_GLSL}` : '') +
      shader.fragmentShader
        .replace(
          // Na de normaal-chunks: diffuseColor, roughnessFactor én normal zijn
          // hier alle drie in scope, en het licht wordt pas daarna berekend.
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
  ${hasSurface ? `{\n    vec2 araP = vSurfPos.xz + vSurfPos.y * 2.7;${parts.join('')}\n  }` : ''}`,
        )
        .replace(
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
  material.customProgramCacheKey = () => `stylize-${rimStrength}-${shadowStrength}-${surfaceKey}`;
  return material;
}

/**
 * Zet de tijd door naar een materiaal met golven. Losse functie omdat het
 * materiaal module-niveau is en de aanroeper niets van de shader hoeft te weten;
 * vóór de eerste compile bestaat de uniform nog niet, vandaar de check.
 */
export function tickSurface(material: THREE.Material, seconds: number): void {
  const shader = material.userData.araShader as { uniforms?: Record<string, { value: number }> } | undefined;
  const uniform = shader?.uniforms?.uTime;
  if (uniform) uniform.value = seconds;
}
