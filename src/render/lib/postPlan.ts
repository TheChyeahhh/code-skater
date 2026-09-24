/**
 * src/render/lib/postPlan.ts (render track): the post chain as data (REQ-REN-04). planPostChain says
 * which stages a quality preset gets, in order; assemblePasses turns the plan into passes through
 * injectable factories, so render.test can prove the order and the N8AO -> SSAO fallback (one
 * console.warn, chain still complete) without a WebGL context.
 *
 * Stage order: render -> ao (N8AO, or SSAO if N8AO throws at init) -> bloom + tone mapping (one
 * EffectPass: bloom thresholds the linear HDR buffer, then AgX maps it once) -> smaa (its own pass,
 * a convolution effect on the LDR image) -> vignette + chromatic aberration (one pass; the aberration
 * offset is zero unless the special meter glows). Tone mapping happens exactly once, in the bloom
 * pass, because three skips renderer.toneMapping when drawing into a render target.
 */

import type { QualitySettings } from '../types';

export type PostStage = 'render' | 'ao' | 'bloomTone' | 'smaa' | 'finish';

/** Which stages a preset gets, in pass order. */
export function planPostChain(q: QualitySettings): readonly PostStage[] {
  const stages: PostStage[] = ['render'];
  if (q.ao) stages.push('ao');
  stages.push('bloomTone');
  if (q.smaa) stages.push('smaa');
  stages.push('finish');
  return stages;
}

export interface StageFactories<P> {
  render(): P;
  /** May throw (N8AO init failure): assemblePasses then falls back to ssao. */
  n8ao(): P;
  ssao(): P;
  bloomTone(bloom: boolean): P;
  smaa(): P;
  finish(): P;
}

export interface AssembledPass<P> {
  readonly name: string;
  readonly pass: P;
}

/**
 * Build the passes for a plan. When the N8AO factory throws, the SSAO factory is used instead and
 * warn() is called once with the reason.
 */
export function assemblePasses<P>(stages: readonly PostStage[], q: QualitySettings, f: StageFactories<P>, warn: (msg: string) => void): AssembledPass<P>[] {
  const out: AssembledPass<P>[] = [];
  for (const s of stages) {
    switch (s) {
      case 'render':
        out.push({ name: 'render', pass: f.render() });
        break;
      case 'ao':
        try {
          out.push({ name: 'n8ao', pass: f.n8ao() });
        } catch (err) {
          warn(`render/post: N8AO failed to initialise (${err instanceof Error ? err.message : String(err)}); using SSAO`);
          out.push({ name: 'ssao', pass: f.ssao() });
        }
        break;
      case 'bloomTone':
        out.push({ name: q.bloom ? 'bloom+toneMapping' : 'toneMapping', pass: f.bloomTone(q.bloom) });
        break;
      case 'smaa':
        out.push({ name: 'smaa', pass: f.smaa() });
        break;
      case 'finish':
        out.push({ name: 'vignette+chromaticAberration', pass: f.finish() });
        break;
    }
  }
  return out;
}
