/**
 * src/render/types.ts: contracts between the render, skater and fx tracks and the app
 * (frozen after M0; integration track only).
 *
 * - Every view reads an INTERPOLATED SimSnapshot (src/core/interp.ts lerpSnapshot) and never
 *   writes sim state (REQ-CTL-19, REQ-HUD-02).
 * - Every view owns a THREE.Group the app adds to the scene; dispose() frees GPU resources.
 * - Materials and textures are procedural (Canvas2D / shaders), zero downloaded assets (REQ-MAT-05).
 */

import type { Group, Material, PerspectiveCamera, Texture, WebGLRenderer, DirectionalLight } from 'three';
import type { SimEvent } from '../core/events';
import type { BoardConfig, QualityPresetId, RailKind, SimSnapshot, StickerPlacement, Vec2, Vec3 } from '../core/types';
import type { BuiltLevel, MaterialId, NpcDef } from '../levels/types';

// ---------------------------------------------------------------------------------------------
// render track: renderer, post, quality, lighting, sky, materials, levelView
// ---------------------------------------------------------------------------------------------

/** REQ-REN-05 preset row. Built from TUNING (PIXEL_RATIO_CAPS, SHADOW_MAP_SIZES) by src/render/quality.ts. */
export interface QualitySettings {
  readonly id: QualityPresetId;
  readonly pixelRatioCap: number;
  readonly shadowMapSize: number;
  readonly ao: boolean;
  readonly bloom: boolean;
  readonly smaa: boolean;
}

/** WebGLRenderer wrapper: SRGB output, AgX tone mapping (ACESFilmic fallback), exposure from TUNING (REQ-REN-01). */
export interface GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly quality: QualitySettings;
  setQuality(q: QualitySettings): void;
  /** CSS pixel size; the pixel ratio is min(devicePixelRatio, quality cap) (REQ-REN-07). */
  resize(width: number, height: number): void;
  dispose(): void;
}

/** AO -> bloom -> SMAA -> vignette -> chromatic aberration (glowing only) (REQ-REN-04). */
export interface PostChain {
  /** Render the scene through the chain (replaces renderer.render). */
  render(dtS: number): void;
  setQuality(q: QualitySettings): void;
  /** Chromatic aberration on while the special meter glows. */
  setGlowing(on: boolean): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** Sky / IBL for an environment preset (REQ-REN-02). */
export interface EnvironmentHandle {
  /** scene.background */
  readonly background: Texture | null;
  /** scene.environment (PMREM) */
  readonly environment: Texture | null;
  dispose(): void;
}

/** Sun + fill lights; the shadow frustum follows the skater, texel-snapped (REQ-REN-03). */
export interface Lighting {
  readonly group: Group;
  readonly sun: DirectionalLight | null;
  /** Re-centre the shadow box on the skater's interpolated position each frame. */
  update(focus: Vec3): void;
  setQuality(q: QualitySettings): void;
  dispose(): void;
}

/** Procedural material registry: one shared Material per MaterialId (REQ-MAT-01..04). */
export interface MaterialRegistry {
  get(id: MaterialId): Material;
  /** Rail / coping material with the RAIL_EMISSIVE_RIM rim (REQ-MAT-02). */
  rail(kind: RailKind): Material;
  dispose(): void;
}

/**
 * BuiltLevel -> scene objects (parts, decals, letters, MacGuffin, NPC figures via the skater track's factory).
 * Materials: parts with role "rail" or "coping" use registry.rail(role === 'coping' ? 'coping' : 'rail')
 * (the emissive rim, REQ-MAT-02); every other part uses registry.get(part.material). MaterialId
 * "boundary" (the four boundary walls) renders invisible: registry.get('boundary') is transparent,
 * opacity 0, depthWrite off, or the view skips those parts' meshes entirely (they stay in the collider).
 */
export interface LevelView {
  readonly group: Group;
  /** Hide collected letters / the MacGuffin, animate emissive signage, spin pickups. */
  update(snapshot: SimSnapshot, dtS: number): void;
  dispose(): void;
}

export interface LevelViewDeps {
  readonly built: BuiltLevel;
  readonly materials: MaterialRegistry;
  /** Figure factory from the skater track (src/render/npc.ts createNpcFigure). */
  readonly createNpc: (def: NpcDef) => NpcFigure;
}

// ---------------------------------------------------------------------------------------------
// skater track: skater rig, board, poses, NPC figures, Board Lab preview
// ---------------------------------------------------------------------------------------------

/** Board from the Board Lab config (REQ-SKT-02): top = grip, bottom = graphic + stickers. */
export interface BoardModel {
  readonly group: Group;
  setConfig(config: BoardConfig): void;
  /** Kernel Panic swaps the deck bottom to the blue-screen texture mid-air (SPEC §9.1). */
  setDeckOverride(mode: 'none' | 'blueScreen'): void;
  dispose(): void;
}

/**
 * Interpolated snapshot -> posed rig + board (REQ-SKT-01..05). Pose = getPose(skater.pose,
 * skater.poseVariant, skater.posePhase) per the PoseId table in src/core/types.ts. Board =
 * skater.boardRel x boardFlipRotation(skater.flipId, skater.flipPhase) while flipId is set
 * (REQ-SKT-04; flipPhase keeps running when a grab or a snap takes the pose), else boardRel.
 */
export interface SkaterView {
  readonly group: Group;
  readonly board: BoardModel;
  update(snapshot: SimSnapshot, dtS: number): void;
  setBoard(config: BoardConfig): void;
  dispose(): void;
}

/** Low-poly NPC built from primitives, no facial likeness (REQ-NPC-01). */
export interface NpcFigure {
  readonly group: Group;
  update(dtS: number, talking: boolean): void;
  dispose(): void;
}

/** 3D Board Lab turntable the UI mounts into a DOM element (REQ-LAB-01). */
export interface BoardPreviewHost {
  mount(container: HTMLElement): void;
  setConfig(config: BoardConfig): void;
  /** Right stick / drag spin, degrees. */
  nudge(yawDeg: number): void;
  /** Show the other face (A flips top / bottom). */
  flip(): void;
  /**
   * REQ-LAB-03 sticker cursor: a highlight ring on the deck underside at (u, v) (StickerPlacement
   * coordinates: u 0 tail .. 1 nose, v 0 .. 1 across), drawn in 3D so it follows the turntable; null hides it.
   */
  setCursor(uv: Vec2 | null): void;
  /** The sticker being placed, drawn at its provisional spot before confirm; null hides it. */
  setPreviewSticker(sticker: StickerPlacement | null): void;
  unmount(): void;
}

// ---------------------------------------------------------------------------------------------
// fx track: particles, trails, flash, speed lines, chase camera
// ---------------------------------------------------------------------------------------------

/** Sparks, dust, speed lines, trails, ribbon, flash (REQ-FX-01..04). Owns a Group added to the scene. */
export interface FxSystem {
  readonly group: Group;
  onEvent(e: SimEvent): void;
  update(snapshot: SimSnapshot, dtS: number): void;
  setQuality(q: QualitySettings): void;
  dispose(): void;
}

/** Camera look input for one render frame. */
export interface CameraLookInput {
  /** Right stick, x right +, y up +. */
  readonly stick: Vec2;
  /** Mouse delta under pointer lock, px. */
  readonly mouseDeltaPx: Vec2;
}

/** Distance to the first level hit along dir from origin, or null (camera collision, REQ-CAM-05). */
export type CameraRaycast = (origin: Vec3, dir: Vec3, maxDist: number) => number | null;

/** Chase camera (REQ-CAM-01..07). */
export interface CameraRig {
  readonly camera: PerspectiveCamera;
  update(snapshot: SimSnapshot, look: CameraLookInput, dtS: number): void;
  /** Bail shake and similar reactions. */
  onEvent(e: SimEvent): void;
  /** Jump to the rest pose behind the skater (run start, teleport). */
  snapTo(snapshot: SimSnapshot): void;
  setAspect(aspect: number): void;
}

// ---------------------------------------------------------------------------------------------
// render track: main menu park flythrough (REQ-MNU-01)
// ---------------------------------------------------------------------------------------------

/**
 * The main menu backdrop camera: a closed spline over a built park, one loop per MENU_FLYTHROUGH_S
 * (src/render/menuFlythrough.ts, render track). The app builds the park scene exactly as for a run
 * (Market Street LevelView, lighting, sky; no skater, no sim), renders it through this camera behind
 * #ui-root while the mainMenu screen shows, and disposes it when a run starts. The UI never touches it.
 */
export interface MenuFlythrough {
  readonly camera: PerspectiveCamera;
  /** Advance along the spline (real seconds). */
  update(dtS: number): void;
  setAspect(aspect: number): void;
  dispose(): void;
}
