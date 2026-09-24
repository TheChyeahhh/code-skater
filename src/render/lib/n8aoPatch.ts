/**
 * src/render/lib/n8aoPatch.ts (render track): two fixes to the vendored N8AO pass (REQ-REN-04),
 * applied from src/render/post.ts without touching node_modules.
 *
 * 1. Transparency off. N8AO turns `transparencyAware` on by itself whenever the scene holds any
 *    transparent material (our decals, the water, the MacGuffin beacon). That costs two extra scene
 *    renders a frame (plus a shadow map re-render each) and five scene traversals. Decals sit flush on
 *    opaque surfaces, so AO from the depth underneath is right: we switch the auto detect off.
 * 2. Denoise shader. The poisson denoise samples tDiffuse and sceneDepth with implicit derivatives
 *    inside its sample loop. D3D (ANGLE on Windows) warns X3595 ("gradient instruction used in a loop
 *    with varying iteration") and three prints that as a THREE.WebGLProgram warning on every load.
 *    The targets have no mipmaps, so an explicit LOD 0 fetch is the same value without the warning.
 *    N8AO rebuilds the denoise materials when its quality or depth type changes, so post.ts calls
 *    patchN8aoPass every frame; a patched material is skipped by its marker.
 * 3. AO floor (polish round 2). The compositer darkens by pow(ao, intensity), which reaches 0 in any
 *    crease or wall foot, and on the Street's shade faces it multiplied already dark pixels to pure
 *    black. The patched compositer lerps that toward 1 by RPOST_AO_FLOOR (shared uniform, read live):
 *    contact shadows stay, but occlusion can never take more than (1 - floor) of the light.
 */

/** Marker userData key on a denoise material that already has the explicit-LOD samples. */
export const N8AO_PATCHED = 'codeSkaterLod0';

/** The loop fetches that need an explicit LOD (exact text in n8ao 2.0.1). */
const LOOP_FETCHES: readonly (readonly [string, string])[] = [
  ['texture2D(tDiffuse, uv + offset)', 'textureLod(tDiffuse, uv + offset, 0.0)'],
  ['texture2D(sceneDepth, uv + offset)', 'textureLod(sceneDepth, uv + offset, 0.0)'],
];

/** The compositer lines the AO floor rewrites (exact text in n8ao 2.0.1). */
const AO_FLOOR_EDITS: readonly (readonly [string, string])[] = [
  ['uniform float intensity;', 'uniform float intensity;\nuniform float codeSkaterAoFloor;'],
  ['float finalAo = pow(texel.r, intensity);', 'float finalAo = mix(pow(texel.r, intensity), 1.0, codeSkaterAoFloor);'],
];

/** The live AO floor every patched compositer reads (post.ts writes TUNING.RPOST_AO_FLOOR into it each frame). */
export const AO_FLOOR_UNIFORM: { value: number } = { value: 0 };

/** Rewrite the compositer so finalAo = mix(pow(ao, intensity), 1, floor). Returns the input unchanged if the text is not there. */
export function patchCompositerShader(fragmentShader: string): string {
  if (fragmentShader.includes('codeSkaterAoFloor')) return fragmentShader;
  if (!AO_FLOOR_EDITS.every(([from]) => fragmentShader.includes(from))) return fragmentShader;
  let out = fragmentShader;
  for (const [from, to] of AO_FLOOR_EDITS) out = out.replace(from, to);
  return out;
}

/** Rewrite the denoise loop's texture fetches to explicit LOD 0 (idempotent). */
export function patchDenoiseShader(fragmentShader: string): string {
  let out = fragmentShader;
  for (const [from, to] of LOOP_FETCHES) out = out.split(from).join(to);
  return out;
}

interface PatchableMaterial {
  fragmentShader: string;
  needsUpdate: boolean;
  userData: Record<string, unknown>;
  uniforms?: Record<string, { value: unknown }>;
}

/** The parts of N8AOPostPass this patch touches (duck-typed: the vendor types do not declare them). */
export interface PatchableN8ao {
  configuration: { transparencyAware: boolean };
  autoDetectTransparency?: boolean;
  standardDenoiseMaterial?: PatchableMaterial | null;
  neuralDenoiseMaterial?: PatchableMaterial | null;
  effectCompositerQuad?: { material: PatchableMaterial } | null;
}

/** Turn the auto transparency pass off for good (call once after construction). */
export function disableN8aoTransparency(pass: PatchableN8ao): void {
  pass.autoDetectTransparency = false;
  // Setting the value through the configuration proxy also frees the transparency targets when it
  // was on; the explicit flag above covers the case where it was already false (no proxy change).
  pass.configuration.transparencyAware = false;
  pass.autoDetectTransparency = false;
}

/** Patch any denoise material that is not patched yet. Returns how many were patched this call. */
export function patchN8aoPass(pass: PatchableN8ao): number {
  let n = 0;
  for (const m of [pass.standardDenoiseMaterial, pass.neuralDenoiseMaterial]) {
    if (!m || m.userData[N8AO_PATCHED] === true) continue;
    const next = patchDenoiseShader(m.fragmentShader);
    if (next !== m.fragmentShader) {
      m.fragmentShader = next;
      m.needsUpdate = true;
    }
    m.userData[N8AO_PATCHED] = true;
    n += 1;
  }
  const c = pass.effectCompositerQuad?.material;
  if (c && c.userData[N8AO_PATCHED] !== true) {
    const next = patchCompositerShader(c.fragmentShader);
    if (next !== c.fragmentShader) {
      c.fragmentShader = next;
      if (c.uniforms) c.uniforms.codeSkaterAoFloor = AO_FLOOR_UNIFORM;
      c.needsUpdate = true;
    }
    c.userData[N8AO_PATCHED] = true;
    n += 1;
  }
  return n;
}
