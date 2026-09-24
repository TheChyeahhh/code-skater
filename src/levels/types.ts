/**
 * src/levels/types.ts: the level data schema and the builder / validator contract (SPEC §9.2,
 * DESIGN G "Level format" and G.3, REQ-LVL-*). Frozen after M0 (integration track only).
 *
 * Who does what:
 * - street / woodshed tracks AUTHOR LevelDef data (src/levels/marketStreet.ts, woodshed.ts) by
 *   transcribing DESIGN G.1 / G.2. Use xzy() from src/core/math.ts for the (x, z, y) tables.
 * - levels track BUILDS it: buildLevel(def) -> BuiltLevel (src/levels/builder.ts) produces render
 *   geometry, the collider, rail splines, triggers and decal quads from the SAME data, so every
 *   visible grind edge has a rail (REQ-LVL-01), and validateLevel(def, built) checks SPEC §9.2.
 * - sim track CONSUMES BuiltLevel.collider / rails / triggers / surfaces (src/sim/collision.ts,
 *   rails.ts, gaps.ts); render track draws BuiltLevel.parts / decals (src/render/levelView.ts).
 *
 * Conventions: x east, y up, z south, metres, origin = north-west corner at ground level.
 * Rectangles are {x0, z0, x1, z1} with x0 < x1 and z0 < z1. "Facing" words are compass directions
 * (north = -z). Every primitive id doubles as its SURFACE id: collider triangles and contact
 * events carry it (gap rules and goals refer to surfaces by these ids, e.g. "MS-F1").
 * Rendering classes are banned here; three.js geometry (BufferGeometry) is allowed in BuiltLevel.
 */

import type { BufferGeometry } from 'three';
import type { BrandKey } from '../data/brands';
import type { GoalDef } from '../data/goals';
import type {
  Box3Like, Facing, LetterId, LevelId, MacGuffinId, NpcId, RailKind, RectXZ, SurfaceTag, Vec3,
} from '../core/types';

// ---------------------------------------------------------------------------------------------
// Materials (render track implements every id in src/render/materials.ts)
// ---------------------------------------------------------------------------------------------

export type MaterialId =
  | 'asphalt' | 'concrete' | 'plazaTile' | 'marble' | 'granite' | 'brick'
  | 'glass' | 'towerFrame' | 'metalPanel' | 'roofTar' | 'paintedSteel'
  | 'maple' | 'mapleDark' | 'woodPanel'
  | 'steelCoping' | 'steelRail' | 'scaffold'
  | 'water' | 'signBoard' | 'neon' | 'boundary';

export type EnvironmentPreset = 'streetAfternoon' | 'woodshedInterior' | 'campusNight' | 'testGrid';

// ---------------------------------------------------------------------------------------------
// Primitives (DESIGN G format; kinds the parks do not use are still supported by the builder)
// ---------------------------------------------------------------------------------------------

interface PrimBase {
  /** Unique within the level; also the surface id (e.g. "MS-Q2"). */
  readonly id: string;
  /** Surface material; the builder picks a sensible default per kind when omitted. */
  readonly material?: MaterialId;
}

/** Flat walkable floor piece at height y. Author non-overlapping pieces (a street cut into the plaza is its own piece). */
export interface GroundPrim extends PrimBase {
  readonly kind: 'ground';
  readonly rect: RectXZ;
  readonly y: number;
}

/** A top-edge segment that must carry a rail (REQ-LVL-03 c). */
export interface GrindableEdge {
  readonly a: Vec3;
  readonly b: Vec3;
}

/** Solid block. Top at y0 + height is walkable. Its sides are walls. */
export interface BoxPrim extends PrimBase {
  readonly kind: 'box';
  readonly rect: RectXZ;
  readonly y0: number;
  readonly height: number;
  /** true = all four convex top edges must carry a rail; a list = only these segments (MS-T2 steps). */
  readonly grindable?: true | readonly GrindableEdge[];
}

/** Collidable building dressing (towers, annex, depot, dock, closet row): a box plus facade detail. Exempt from rail coverage. */
export interface BuildingPrim extends PrimBase {
  readonly kind: 'building';
  readonly rect: RectXZ;
  readonly y0?: number;
  readonly height: number;
  readonly style: 'glassTower' | 'block' | 'annex' | 'closet' | 'depot' | 'dock' | 'booth';
  /** Roof is a walkable surface (MS-EB, MS-DB, MS-DP, MS-AX). */
  readonly walkableRoof?: boolean;
}

/** Ledge box: its top CENTRELINE must carry a rail within 0.1 m (REQ-LVL-03 b). At most 0.8 m wide. */
export interface LedgePrim extends PrimBase {
  readonly kind: 'ledge';
  readonly rect: RectXZ;
  readonly topY: number;
  readonly baseY?: number;
}

/** Plane bank from yHigh down to yLow toward `downhill` (not a transition, REQ-LVL-09). */
export interface BankPrim extends PrimBase {
  readonly kind: 'bank';
  readonly rect: RectXZ;
  readonly yHigh: number;
  readonly yLow: number;
  readonly downhill: Facing;
}

/** Stair set descending toward `down`, from topY over `steps` equal steps totalling `drop`. */
export interface StairsPrim extends PrimBase {
  readonly kind: 'stairs';
  readonly rect: RectXZ;
  readonly topY: number;
  readonly drop: number;
  readonly steps: number;
  readonly down: Facing;
}

/**
 * Hubba ledge: top at yTop at the upper end, sloping to yKink at `kinkAt` (coordinate along the
 * descent axis), then flat at yEnd to the lower end. `along` = the descent direction. Its top
 * centreline must carry a rail (REQ-LVL-03 b).
 */
export interface HubbaPrim extends PrimBase {
  readonly kind: 'hubba';
  readonly rect: RectXZ;
  readonly yTop: number;
  readonly yKink: number;
  readonly kinkAt: number;
  readonly yEnd: number;
  readonly along: Facing;
  readonly baseY?: number;
}

/**
 * Quarter-pipe: a circular transition of `radius` rising from the foot line to the coping line at
 * copingHeight above baseY (so the exit slope is below 90 deg when copingHeight < radius), plus
 * vertExt metres of vertical wall above the curve. `facing` = direction from the coping line
 * toward the foot line (the side the skater approaches from). footLine / copingLine are the
 * coordinates on the facing axis (x for east/west, z for north/south); span = extent on the
 * other axis. deckDepth > 0 adds a walkable deck behind the coping. Tagged transition.
 */
export interface QuarterPipePrim extends PrimBase {
  readonly kind: 'quarterPipe';
  readonly facing: Facing;
  readonly footLine: number;
  readonly copingLine: number;
  readonly span: readonly [number, number];
  readonly copingHeight: number;
  readonly radius: number;
  readonly vertExt?: number;
  readonly baseY?: number;
  readonly deckDepth?: number;
  /** Id of the coping rail in LevelDef.rails (kind coping). */
  readonly copingRailId: string;
}

/** Rounded-rectangle bowl sunk below y 0: walls of wallRadius, corners of cornerRadius. Tagged transition (walls). */
export interface BowlPrim extends PrimBase {
  readonly kind: 'bowl';
  readonly rect: RectXZ;
  readonly depth: number;
  readonly wallRadius: number;
  readonly cornerRadius: number;
  readonly rimY?: number;
  readonly copingRailId: string;
}

/**
 * Spine: two quarter-pipes back to back. The ridge runs along `axis`; `centre` is the ridge's
 * coordinate on the other axis (WS-SP1: axis "z", centre x 43.0); span = extent along the ridge.
 * gapWidth = deck gap between the two copings. Both faces tagged transition.
 */
export interface SpinePrim extends PrimBase {
  readonly kind: 'spine';
  readonly axis: 'x' | 'z';
  readonly centre: number;
  readonly span: readonly [number, number];
  readonly copingHeight: number;
  readonly radius: number;
  readonly gapWidth: number;
  /** [lower-coordinate side, higher-coordinate side] coping rail ids (e.g. west, east). */
  readonly copingRailIds: readonly [string, string];
  readonly peakRailId?: string;
}

/** Full pipe: a cylinder of radius around the axis a -> b (axis points at the axis height), open both ends. Tagged transition. */
export interface FullPipePrim extends PrimBase {
  readonly kind: 'fullPipe';
  readonly a: Vec3;
  readonly b: Vec3;
  readonly radius: number;
}

/**
 * Fountain / mini-vert: outer transition face from footRadius (ground) up to rimRadius at rimHeight
 * with face curve radius faceRadius; flat rim top; basin inside at basinY (rideable flat, water decal).
 */
export interface FountainPrim extends PrimBase {
  readonly kind: 'fountain';
  readonly centre: { readonly x: number; readonly z: number };
  readonly baseY?: number;
  readonly footRadius: number;
  readonly faceRadius: number;
  readonly rimRadius: number;
  readonly rimHeight: number;
  readonly basinY: number;
  readonly copingRailId: string;
}

/** Channel / snake run: a sunken path along a centreline, floor at floorY, curved walls of wallRadius up to the rims. */
export interface ChannelPrim extends PrimBase {
  readonly kind: 'channel';
  readonly centreline: readonly { readonly x: number; readonly z: number }[];
  readonly width: number;
  readonly floorY: number;
  readonly wallRadius: number;
  readonly wallHeight: number;
  /** Length of the ramps that bring each open end back up to y 0 (WS-SR1: 3 m). */
  readonly openEndRampM?: number;
  /** Rim coping rails [left of travel along the centreline, right]. */
  readonly rimRailIds?: readonly [string, string];
}

/** Euro gap: a trench with 45 deg banks, jumped across `across` (the axis you travel on). */
export interface EuroGapPrim extends PrimBase {
  readonly kind: 'euroGap';
  readonly rect: RectXZ;
  readonly floorY: number;
  readonly bankRunM: number;
  readonly across: 'x' | 'z';
}

/** Hump: a sine ridge along ridgeAxis, max `height` (DESIGN WS-H1). Tagged transition. */
export interface HumpPrim extends PrimBase {
  readonly kind: 'hump';
  readonly rect: RectXZ;
  readonly ridgeAxis: 'x' | 'z';
  readonly height: number;
}

/** Kicker ramp rising toward `up` to `height` (plane, not transition). */
export interface KickerPrim extends PrimBase {
  readonly kind: 'kicker';
  readonly rect: RectXZ;
  readonly height: number;
  readonly up: Facing;
}

/** Funbox: flat top deck `rect` at `height` with plane ramps of rampRunM on the listed sides. */
export interface FunboxPrim extends PrimBase {
  readonly kind: 'funbox';
  readonly rect: RectXZ;
  readonly height: number;
  readonly rampRunM: number;
  readonly ramps: readonly Facing[];
}

/** Pyramid: flat top `rect` at `height` with ramps of rampRunM on all four sides. */
export interface PyramidPrim extends PrimBase {
  readonly kind: 'pyramid';
  readonly rect: RectXZ;
  readonly height: number;
  readonly rampRunM: number;
}

/**
 * Who draws a rail's pipe (one rule, so no pipe is drawn twice and none is missing):
 * - The BUILDER emits a default round pipe for every RailDef of kind "rail" that no RailPipePrim
 *   references: radius TUNING.LEVELS_RAIL_PIPE_R_M, posts down to the surface below, material
 *   steelRail, role "rail".
 * - The BUILDER emits a coping pipe for every RailDef of kind "coping" (whichever primitive owns
 *   it: quarterPipe, bowl, spine, fountain, channel rims): radius TUNING.LEVELS_COPING_PIPE_R_M, no
 *   posts, material steelCoping, role "coping". Primitives never draw their own coping pipe.
 * - Rails of kind "ledge" get no pipe: the ledge / hubba / box edge is the visible surface.
 * - A RailPipePrim OVERRIDES the default for its rail (style, radius, posts). Levels author one only
 *   where the look matters: scaffold, handrail, rainbow, vent, wallMounted, parapet.
 * The visible pipe of a rail entry: points come from the referenced RailDef (single source).
 * Never part of the movement collider (REQ-LVL-11, REQ-CTL-22).
 */
export interface RailPipePrim extends PrimBase {
  readonly kind: 'railPipe';
  readonly railId: string;
  readonly style: 'flatbar' | 'handrail' | 'scaffold' | 'rainbow' | 'vent' | 'wallMounted' | 'parapet';
  /** Pipe radius in m (default TUNING.LEVELS_RAIL_PIPE_R_M; the levels track may vary the default by style). */
  readonly radius?: number;
  /** Draw support posts down to the surface below (default true except wallMounted / parapet). */
  readonly posts?: boolean;
}

/** Billboard / sign box with an emissive parody wordmark face (brand from BRANDS, REQ-MAT-04). Collidable. */
export interface BillboardPrim extends PrimBase {
  readonly kind: 'billboard';
  readonly rect: RectXZ;
  readonly y0: number;
  readonly height: number;
  readonly face: Facing;
  readonly brand: BrandKey;
}

/** Decorative prop. collidable props become boxes in the collider (booth, bench); others render only. */
export interface PropPrim extends PrimBase {
  readonly kind: 'prop';
  readonly prop: 'booth' | 'canopy' | 'busShelter' | 'scaffoldFrame' | 'trusses' | 'planter' | 'lamp' | 'vent' | 'coffeeTable';
  /** Centre of the footprint at ground level. */
  readonly at: Vec3;
  /** Width (x), height (y), depth (z) before rotation. */
  readonly size: Vec3;
  readonly yawDeg?: number;
  readonly collidable: boolean;
}

export type Primitive =
  | GroundPrim | BoxPrim | BuildingPrim | LedgePrim | BankPrim | StairsPrim | HubbaPrim
  | QuarterPipePrim | BowlPrim | SpinePrim | FullPipePrim | FountainPrim | ChannelPrim
  | EuroGapPrim | HumpPrim | KickerPrim | FunboxPrim | PyramidPrim | RailPipePrim
  | BillboardPrim | PropPrim;

export type PrimitiveKind = Primitive['kind'];

/** Primitive kinds whose rideable curved surfaces the builder tags "transition" (REQ-LVL-09). */
export const TRANSITION_KINDS: readonly PrimitiveKind[] = ['quarterPipe', 'bowl', 'spine', 'fullPipe', 'fountain', 'channel', 'hump'];

// ---------------------------------------------------------------------------------------------
// Rails, gaps, pickups, NPCs, decals
// ---------------------------------------------------------------------------------------------

export type RailTag = 'transfer';

/** Vertical plane containing a transfer rail's direction (REQ-VRT-08): axis "x" + at 43 = the plane x = 43. */
export interface TransferPlane {
  readonly axis: 'x' | 'z';
  readonly at: number;
}

/**
 * A grindable polyline (SPEC §9.2, REQ-GRD-01, REQ-LVL-02). One polyline = one object for the
 * same-object rule (REQ-BAL-04). A closed loop (bowl coping, fountain rim) repeats its first point
 * at the end and sets closed: true so grind motion wraps instead of ending.
 */
export interface RailDef {
  readonly id: string;
  readonly kind: RailKind;
  readonly points: readonly Vec3[];
  readonly name?: string;
  readonly tags?: readonly RailTag[];
  /** Required when tags include "transfer". */
  readonly transferPlane?: TransferPlane;
  readonly closed?: boolean;
}

/** Axis ranges of a trigger box; an omitted axis is unbounded. Use -Infinity / Infinity for one-sided bounds. */
export interface BoxRange {
  readonly x?: readonly [number, number];
  readonly y?: readonly [number, number];
  readonly z?: readonly [number, number];
}

export interface SpanBound {
  readonly op: '<=' | '>=';
  readonly value: number;
}

/**
 * Named gap rules (REQ-LVL-07). Evaluated by src/sim/gaps.ts from element events and box tests only.
 * Grind rules sum CONSECUTIVE grind elements on the same rail id, so a mid-rail type switch never
 * voids them (DESIGN E.10). An air is one leftSurface -> contact interval.
 */
export type GapRule =
  /** An air that starts in `start` (and/or leaving startSurface) and lands in `land` (and/or on landSurface, or outside landOutside). eitherDirection also accepts start and land swapped. */
  | {
      readonly kind: 'airBoxToBox';
      readonly start?: BoxRange;
      readonly startSurface?: string;
      readonly land?: BoxRange;
      readonly landSurface?: string;
      readonly landOutside?: BoxRange;
      readonly eitherDirection?: boolean;
    }
  /** Consecutive grind elements on one of `rails` (same rail id) whose path covers from `from` to `to` on `axis`. */
  | { readonly kind: 'grindSpan'; readonly rails: readonly string[]; readonly axis: 'x' | 'z'; readonly from: SpanBound; readonly to: SpanBound; readonly eitherDirection?: boolean }
  /** Consecutive grind elements on one of `rails` (same rail id) with summed along-rail distance >= minM. */
  | { readonly kind: 'grindDistance'; readonly rails: readonly string[]; readonly minM: number }
  /** Grind elements on each step's rails in order within one combo; noGroundContact = only airs between them. */
  | { readonly kind: 'grindSequence'; readonly steps: readonly (readonly string[])[]; readonly noGroundContact: boolean }
  /** A spine transfer on one of `rails`, optionally followed in the same air by a landing in then.land or a grind on then.grindOn. */
  | { readonly kind: 'transferOn'; readonly rails: readonly string[]; readonly then?: { readonly land?: BoxRange; readonly grindOn?: readonly string[] } }
  /** One manual element whose path inside `within` covers from `from` to `to` on `axis`. */
  | { readonly kind: 'manualSpan'; readonly within: BoxRange; readonly axis: 'x' | 'z'; readonly from: SpanBound; readonly to: SpanBound; readonly eitherDirection?: boolean }
  /** An air inside `within` whose feet reach minApexY, landing on landSurface if given. */
  | { readonly kind: 'airApexIn'; readonly within: BoxRange; readonly minApexY: number; readonly landSurface?: string }
  /** Leave `surface` at azimuth a1 about centre; next contact on the same surface at a2 with wrapped |a1 - a2| >= minDeltaDeg. */
  | { readonly kind: 'surfaceAzimuth'; readonly surface: string; readonly centre: { readonly x: number; readonly z: number }; readonly minDeltaDeg: number }
  /** An air starting at y >= minStartY outside the footprint of `surfaces` whose first contact is a transition triangle of one of them. */
  | { readonly kind: 'dropIn'; readonly surfaces: readonly string[]; readonly minStartY: number };

export interface GapDef {
  /** Level gap id, e.g. "MS-G03"; the combo element id is "gap:MS-G03". */
  readonly id: string;
  /** Splash text, uppercase, no em dashes ("PLAZA BAR HOP"). */
  readonly name: string;
  /** 200..2000, never degrades (REQ-SCR-05). */
  readonly base: number;
  readonly rule: GapRule;
}

export interface LetterDef {
  readonly letter: LetterId;
  readonly pos: Vec3;
}

export interface MacGuffinDef {
  readonly id: MacGuffinId;
  readonly pos: Vec3;
  /**
   * Optional pickup gate (SPEC §9.2, the Woodshed drive: "needs speed + transfer"). transferInAir: collected
   * only in an air that already made a spine transfer, or on a grind that air reached.
   */
  readonly needs?: { readonly transferInAir?: boolean };
}

/** NPC figure and talk trigger (REQ-NPC-01..04). Name and line come from BRANDS.npcs[id]. */
export interface NpcDef {
  readonly id: NpcId;
  /** Feet position. */
  readonly pos: Vec3;
  readonly facing: Facing;
  readonly outfit: 'hoodie' | 'contestJacket';
  readonly prop: 'laptopSleeve' | 'coffee';
  /** Authored talk trigger radius override; omitted = TUNING.TALK_TRIGGER_M read live (TriggerSphere radius 0). */
  readonly talkRadius?: number;
}

export interface SpawnDef {
  /** Feet position. */
  readonly pos: Vec3;
  readonly facing: Facing;
}

/** A listed rail feed for REQ-LVL-06 / REQ-LVL-10 validation. */
export interface FeedDef {
  readonly from: string;
  readonly to: string;
  /** Speed at the end of `from`, m/s (the recorded exit speed in DESIGN G). */
  readonly exitSpeed: number;
  readonly pop: 'tap' | 'full';
}

export type DecalKind = 'crosswalk' | 'paint' | 'water' | 'wordmark' | 'graffiti' | 'arrow' | 'drain' | 'stain';

/**
 * Flat decal quad on a surface. Never within 0.15 m of a rail (REQ-LVL-04). Textures are generated
 * by src/render/textures; wordmarks read BRANDS via `brand`.
 */
export interface DecalDef {
  readonly id: string;
  readonly kind: DecalKind;
  /** Centre of the quad, lifted 1 cm off the surface by the builder. */
  readonly center: Vec3;
  /** Surface the decal lies on: "up" = floors, a facing = a wall that faces that way. */
  readonly on: 'up' | Facing;
  readonly width: number;
  readonly height: number;
  readonly rotDeg?: number;
  readonly brand?: BrandKey;
  readonly text?: string;
}

/** A whole level as authored data (DESIGN G "Level format"). */
export interface LevelDef {
  readonly id: LevelId;
  /** Display name ("Market Street", "Woodshed"). */
  readonly name: string;
  /** Size of the park rectangle; the builder closes it with four boundary walls (REQ-LVL-11). */
  readonly size: { readonly x: number; readonly z: number };
  /** Boundary wall height, default 12 m. */
  readonly boundaryHeight?: number;
  readonly environment: EnvironmentPreset;
  readonly spawn: SpawnDef;
  /** Rectangle for the REQ-LVL-05 spawn-ollie MacGuffin check (3 x 4 grid of points). */
  readonly spawnArea: RectXZ;
  readonly primitives: readonly Primitive[];
  readonly rails: readonly RailDef[];
  readonly gaps: readonly GapDef[];
  /** Four letters C, O, D, E for a park; empty for the test level. */
  readonly letters: readonly LetterDef[];
  readonly macguffin: MacGuffinDef | null;
  readonly npcs: readonly NpcDef[];
  /** Ten goals for a park (DESIGN G.1 / G.2); empty for the test level. */
  readonly goals: readonly GoalDef[];
  readonly decals: readonly DecalDef[];
  readonly feeds: readonly FeedDef[];
}

// ---------------------------------------------------------------------------------------------
// BuiltLevel: what buildLevel(def) returns
// ---------------------------------------------------------------------------------------------

/** Numeric codes stored per collider triangle in BuiltCollider.triTag. */
export const SURFACE_TAG_CODES: Readonly<Record<SurfaceTag, number>> = { solid: 0, transition: 1, boundary: 2 };
export const SURFACE_TAG_BY_CODE: readonly SurfaceTag[] = ['solid', 'transition', 'boundary'];

/**
 * Render descriptor: one geometry + one material id. The render track wraps it in a Mesh with the
 * registry material (src/render/levelView.ts). Geometry carries position, normal, uv and a
 * "color" attribute holding the baked-looking fake AO (REQ-REN-03).
 */
export interface LevelMeshPart {
  readonly id: string;
  /** Primitive (surface) id this part belongs to. */
  readonly surfaceId: string;
  readonly material: MaterialId;
  readonly geometry: BufferGeometry;
  readonly role: 'surface' | 'wall' | 'rail' | 'coping' | 'dressing' | 'sign';
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
}

/**
 * Movement collider (REQ-CTL-01, REQ-LVL-11): NON-INDEXED triangle soup, 9 floats per triangle.
 * Rail and coping pipes are NOT in it. Per-triangle tag and surface arrays are indexed by the
 * ORIGINAL triangle index. After three-mesh-bvh reorders triangles, recover the original index of
 * a hit as Math.floor(hit.face.a / 3) (a non-indexed geometry's vertex i belongs to triangle i/3).
 */
export interface BuiltCollider {
  readonly positions: Float32Array;
  readonly triangleCount: number;
  /** SURFACE_TAG_CODES value per triangle. */
  readonly triTag: Uint8Array;
  /** Index into surfaceIds per triangle. */
  readonly triSurface: Uint16Array;
  readonly surfaceIds: readonly string[];
}

export interface RailSegment {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly length: number;
  /** Arc length along the rail at a. */
  readonly start: number;
  /** Unit direction a -> b. */
  readonly tangent: Vec3;
  /** Direction change to the next segment in degrees (0 for the last segment of an open rail). */
  readonly bendToNextDeg: number;
}

/** A rail with its derived spline data, ready for the sim's RailNetwork (src/sim/rails.ts). */
export interface BuiltRail extends RailDef {
  readonly segments: readonly RailSegment[];
  readonly length: number;
  readonly closed: boolean;
}

/** Spherical trigger (REQ-LVL-08): letters and MacGuffins use COLLECT_RADIUS_M, NPC talk TALK_TRIGGER_M. */
export interface TriggerSphere {
  readonly id: string;
  readonly kind: 'letter' | 'macguffin' | 'npcTalk';
  readonly center: Vec3;
  /**
   * Authored override in m (NpcDef.talkRadius), or 0 = use the tuning radius read LIVE at test time
   * (COLLECT_RADIUS_M / TALK_TRIGGER_M, src/sim/run.ts triggersHit). The builder never bakes a
   * tuning value in here, so the dev panel sliders act without a rebuild.
   */
  readonly radius: number;
  /** The letter, MacGuffin id or NPC id. */
  readonly ref: LetterId | MacGuffinId | NpcId;
}

export interface BuiltDecal {
  readonly def: DecalDef;
  /** Quad corners in world space, counter-clockwise seen from the front. */
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
  readonly normal: Vec3;
}

export interface SurfaceInfo {
  readonly id: string;
  readonly kind: PrimitiveKind | 'boundary';
  readonly bounds: Box3Like;
  /** Ground footprint (bowls, fountains, channels) for dropIn and outside-box rules. */
  readonly footprint: RectXZ;
}

/** Counts for the "parks play differently" census (REQ-STR-07, REQ-WSH-07). */
export interface LevelCensus {
  readonly primitives: Readonly<Partial<Record<PrimitiveKind, number>>>;
  readonly rails: Readonly<Record<RailKind, number>>;
}

export interface BuiltLevel {
  readonly def: LevelDef;
  readonly parts: readonly LevelMeshPart[];
  readonly collider: BuiltCollider;
  readonly rails: readonly BuiltRail[];
  readonly triggers: readonly TriggerSphere[];
  readonly decals: readonly BuiltDecal[];
  readonly surfaces: Readonly<Record<string, SurfaceInfo>>;
  /** Bounds of everything built, boundary walls included. */
  readonly bounds: Box3Like;
  /** Spawn feet position and yaw (radians, src/core/types.ts heading convention). */
  readonly spawn: { readonly pos: Vec3; readonly yaw: number };
  readonly census: LevelCensus;
}

/** Validation rule ids: the REQ each check implements. */
export type LevelRule =
  | 'REQ-LVL-03' | 'REQ-LVL-04' | 'REQ-LVL-05' | 'REQ-LVL-06' | 'REQ-LVL-10' | 'REQ-LVL-11' | 'REQ-LVL-12'
  | 'REQ-NPC-04' | 'schema';

export interface LevelViolation {
  readonly rule: LevelRule;
  readonly message: string;
  /** Primitive, rail, gap or decal ids involved. */
  readonly ids: readonly string[];
  readonly at?: Vec3;
}
