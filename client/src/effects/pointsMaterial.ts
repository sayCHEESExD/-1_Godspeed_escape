import { AdditiveBlending, NormalBlending, ShaderMaterial } from 'three';

/**
 * ONE point shader for every particle system in the game.
 *
 * Per-point colour, size and life, so a burst of sparks, a bolt of lightning
 * and a ring of aura motes are all the same draw: one `Points` mesh, one
 * material, attributes rewritten in place. Texture-free - the glyph is a soft
 * disc computed in the fragment shader - so it costs nothing against the
 * 12 MB budget and nothing to upload.
 *
 * `aLife` runs 1 -> 0 and drives both the fade and a shrink, so a particle is
 * spent exactly as it dies rather than blinking out at full size.
 */
export const createPointsMaterial = (additive = true): ShaderMaterial =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    fog: false,
    uniforms: {
      uScale: { value: 1 },
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aLife;
      uniform float uScale;
      varying vec3 vColor;
      varying float vLife;
      void main() {
        vColor = aColor;
        vLife = aLife;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float shrink = 0.35 + 0.65 * clamp(aLife, 0.0, 1.0);
        gl_PointSize = aSize * shrink * uScale * (240.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vLife;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        if (r > 1.0) discard;
        float core = smoothstep(1.0, 0.0, r);
        float glow = core * core;
        float alpha = clamp(vLife, 0.0, 1.0) * (glow * 0.85 + core * 0.15);
        gl_FragColor = vec4(vColor * (0.6 + 0.4 * core), alpha);
      }
    `,
  });
