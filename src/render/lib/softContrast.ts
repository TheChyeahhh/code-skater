/**
 * src/render/lib/softContrast.ts (render track): the grade's contrast curve (REQ-REN-04, SPEC section 10).
 *
 * postprocessing's BrightnessContrastEffect works on the LINEAR image with a straight line through
 * 0.5: with contrast 0.14 every linear value under 0.07 (sRGB 75) went to exactly 0, which turned
 * every Street shadow face into a black slab (polish round 2 audit). This curve instead works on a
 * gamma 2.2 encoding of the display-referred colour and is an S-curve pinned at 0, 0.5 and 1:
 *
 *   s' = s + 2k (2s - 1) s (1 - s)
 *
 * The midtone slope is 1 + k, the slope at black and at white is 1 - 2k, so for 0 <= k <= 0.5 it is
 * monotonic and never clips: shadows keep their detail and hue, midtones get the punch.
 * softContrast() is the same curve in JS (unit-tested); SoftContrastEffect runs it on the GPU.
 */

import { Uniform } from 'three';
import { Effect } from 'postprocessing';

/** Encoding gamma of the curve (an sRGB-like perceptual space). */
export const SOFT_CONTRAST_GAMMA = 2.2;

/** The curve on one linear channel value (display-referred, 0..1 after tone mapping). */
export function softContrast(linear: number, k: number): number {
  const s = Math.min(1, Math.max(0, linear)) ** (1 / SOFT_CONTRAST_GAMMA);
  const out = s + 2 * k * (2 * s - 1) * s * (1 - s);
  return Math.max(0, out) ** SOFT_CONTRAST_GAMMA;
}

const FRAGMENT = /* glsl */ `
uniform float contrast;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 s = pow(clamp(inputColor.rgb, 0.0, 1.0), vec3(1.0 / ${SOFT_CONTRAST_GAMMA.toFixed(1)}));
  s += 2.0 * contrast * (2.0 * s - 1.0) * s * (1.0 - s);
  outputColor = vec4(pow(max(s, vec3(0.0)), vec3(${SOFT_CONTRAST_GAMMA.toFixed(1)})), inputColor.a);
}
`;

/** The GPU side of softContrast(): an S-curve contrast that never crushes blacks. */
export class SoftContrastEffect extends Effect {
  constructor(contrast: number) {
    super('SoftContrastEffect', FRAGMENT, { uniforms: new Map<string, Uniform>([['contrast', new Uniform(contrast)]]) });
  }

  get contrast(): number {
    return (this.uniforms.get('contrast') as Uniform<number>).value;
  }

  set contrast(value: number) {
    (this.uniforms.get('contrast') as Uniform<number>).value = value;
  }
}
