/**
 * src/render/fx/fxSystem.ts (fx track): juice driven by SimEvents + the interpolated snapshot
 * (REQ-FX-01..04, REQ-GRD-12):
 * - grind sparks: GPU points, additive, gravity, SPARK_RATE_PER_S at skater.grind.contact, seeded Rng,
 *   streaked along their screen velocity with a hot core and HDR colour; a contact hot spot pulsing
 *   with the spark rate and a snap flash on grindStart; concrete ledges throw dark chips (normal
 *   blending) and small dust puffs instead of sparks;
 * - landing dust burst (DUST_BURST_COUNT) on the wheel line on "land" (a smaller puff on "bail") plus
 *   a one-shot ground ring at the landing point;
 * - speed lines ramping in from CAM_FOV_KICK_SPEED x vmax (screen-space overlay; the FOV kick is the
 *   camera's, same ramp);
 * - board motion trail (a ghost of the deck, nose to tail, coloured per special) while
 *   special.activeId is set; for gpu_slide a green ribbon trailing the last N grind contact points
 *   (snapshot.skater.grind.contact), fading over FX_RIBBON_FADE_S (no level access needed); the
 *   special-glow aura while special.glowing, with a pop on specialReady;
 * - Kernel Panic: a generated blue-screen card with two black flickers over a blue tint, plus the deck
 *   override hook (the blue-screen deck itself is BoardModel.setDeckOverride, skater track; the app
 *   wires hooks.setDeckOverride to it);
 * - Token Overflow: die-cut sticker particles fanning up and back off the deck, tumbling; 900ms
 *   Inference: the letterboxed slow-mo overlay;
 * - letter pickup: gold glints and a pickup ring; MacGuffin: full-screen flash FLASH_MACGUFFIN_MS +
 *   hitstop requested through hooks.freeze(hitstopTicks) (FixedLoop.freeze keeps the larger pending
 *   value, so the app may also apply it directly: both paths are safe).
 * Everything is pooled: zero allocations per frame in steady state (typed arrays, reused temps).
 * World effects advance by dt x snapshot.timeScale (they slow with 900ms Inference); overlays by dt.
 */

import { Group, Vector3, type PerspectiveCamera } from 'three';
import type { SimEvent } from '../../core/events';
import { createRng, type Rng } from '../../core/rng';
import { TUNING } from '../../core/tuning';
import type { QualityPresetId, RailKind, SimSnapshot, SpecialId } from '../../core/types';
import { kickRamp } from '../camera';
import type { FxSystem, QualitySettings } from '../types';
import { SpecialAura } from './aura';
import { Flare, FlareShot } from './glow';
import { BlueScreenCard, ScreenFlash, StrengthOverlay } from './overlays';
import { ParticlePool } from './particles';
import { Ribbon } from './ribbon';

/** Optional app hooks. Every one is optional so harnesses and tests can omit them. */
export interface FxHooks {
  /** Hitstop request in sim ticks (REQ-FX-03): wire to FixedLoop.freeze. */
  readonly freeze?: (ticks: number) => void;
  /** Kernel Panic deck swap (SPEC section 9.1): wire to the skater's BoardModel.setDeckOverride. */
  readonly setDeckOverride?: (mode: 'none' | 'blueScreen') => void;
  /** Viewport height in device pixels, for point sizes; default window.innerHeight x devicePixelRatio (720 in node). */
  readonly viewportHeightPx?: () => number;
}

/** Read-only counters and levels for tests and the dev harness. */
export interface FxDebug {
  /** Sparks and ledge chips spawned (both pools). */
  readonly sparksSpawned: number;
  readonly sparksAlive: number;
  readonly dustSpawned: number;
  readonly stickersSpawned: number;
  readonly burstSpawned: number;
  /** Rail kind the sparks are tuned for right now (null when not grinding). */
  readonly sparkKind: RailKind | null;
  readonly speedLines: number;
  readonly slowMo: number;
  readonly aura: number;
  /** Aura pop multiplier (1 when idle). */
  readonly auraPop: number;
  readonly flashActive: boolean;
  readonly flashAlpha: number;
  readonly flashRemainingS: number;
  /** The Kernel Panic card is on screen. */
  readonly cardActive: boolean;
  /** Grind contact glow opacity this frame. */
  readonly contactGlow: number;
  /** One-shot flares running (grind flash, land ring, pickup ring). */
  readonly shotsActive: number;
  readonly trailSamples: number;
  readonly ribbonSamples: number;
  readonly deckOverride: 'none' | 'blueScreen';
  readonly qualityMult: number;
}

export interface FxRuntime extends FxSystem {
  readonly debug: FxDebug;
}

// Pool sizes (structural, not tunables: they cap GPU memory, the rates live in TUNING).
const SPARK_CAPACITY = 1024;
const CHIP_CAPACITY = 512;
const DUST_CAPACITY = 256;
const STICKER_CAPACITY = 192;
const BURST_CAPACITY = 384;
const TRAIL_SAMPLES = 48;
const RIBBON_SAMPLES = 96;
const RING_SHOTS = 4;

// Colours (fx look; strings so they read at a glance).
// Spark body colours (sRGB, turned linear below: the pool writes linear light); they start white hot
// and cool to red in the shader (particles.ts). The grind snap flash keeps the old pale gold.
const SPARK_RAIL = '#ffa126';
const SPARK_COPING = '#ffb035';
const GRIND_FLASH = '#ffd27a';
const CHIP_LEDGE = '#6e665c';
const DUST = '#b9b1a3';
const RIBBON = '#3dff7a';
const AURA = '#ffb347';
const FLASH_WHITE = '#ffffff';
const FLASH_BLUE = '#1d5cff';
const LETTER = '#ffd54a';
const MACGUFFIN = '#ffffff';
const CONTACT = '#ffc46b';
const LAND_RING = '#d9d2c4';
const STICKER_PALETTE = ['#ff7a3d', '#3de1ff', '#ff3dd1', '#ffe23d', '#7dff3d', '#8f7bff'];
/** Board trail colour per special, so the trail says which special is running. */
const TRAIL_COLOR: Readonly<Record<SpecialId, string>> = {
  kernel_panic: '#4f8dff',
  token_overflow: '#ffc93d',
  gpu_slide: '#3dff7a',
  inference_900ms: '#8fe3ff',
  context_window: '#c48bff',
};

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** sRGB hex to linear light (the spark pool's colour is light, not a paint value). */
function linearRgb(hex: string): Rgb {
  const c = rgb(hex);
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return { r: lin(c.r), g: lin(c.g), b: lin(c.b) };
}

function qualityMult(id: QualityPresetId): number {
  if (id === 'low') return TUNING.FX_QUALITY_LOW_MULT;
  if (id === 'med') return TUNING.FX_QUALITY_MED_MULT;
  return 1;
}

function defaultViewportHeight(): number {
  if (typeof window === 'undefined') return 720;
  return window.innerHeight * Math.min(2, window.devicePixelRatio || 1);
}

export function createFxSystem(camera: PerspectiveCamera, seed: number, hooks: FxHooks = {}): FxRuntime {
  const group = new Group();
  group.name = 'fx';
  const rng: Rng = createRng(seed);
  // The spark pool stays child 0 (tests read it there).
  const sparks = new ParticlePool({ capacity: SPARK_CAPACITY, shape: 'spark', additive: true, renderOrder: 12 });
  const chips = new ParticlePool({ capacity: CHIP_CAPACITY, shape: 'chip', additive: false, renderOrder: 11 });
  const dust = new ParticlePool({ capacity: DUST_CAPACITY, shape: 'smoke', additive: false, renderOrder: 11 });
  const stickers = new ParticlePool({ capacity: STICKER_CAPACITY, shape: 'sticker', additive: false, renderOrder: 13 });
  const bursts = new ParticlePool({ capacity: BURST_CAPACITY, shape: 'star', additive: true, renderOrder: 12 });
  const trail = new Ribbon(TRAIL_SAMPLES, TRAIL_COLOR.gpu_slide, 20, true);
  // A camera-facing core under the deck ghost so the trail keeps a body when seen edge-on from behind.
  const trailCore = new Ribbon(TRAIL_SAMPLES, TRAIL_COLOR.gpu_slide, 19);
  const ribbon = new Ribbon(RIBBON_SAMPLES, RIBBON, 21);
  const aura = new SpecialAura(AURA);
  const flash = new ScreenFlash();
  const card = new BlueScreenCard();
  const speedLines = new StrengthOverlay('speedLines');
  const slowMo = new StrengthOverlay('slowMo');
  const contactGlow = new Flare('glow', CONTACT, 16, false);
  const grindFlash = new FlareShot(new Flare('glow', GRIND_FLASH, 16, false));
  const rings: FlareShot[] = [];
  for (let i = 0; i < RING_SHOTS; i++) rings.push(new FlareShot(new Flare('ring', LAND_RING, 14, true)));
  let nextRing = 0;
  group.add(
    sparks.points, chips.points, dust.points, stickers.points, bursts.points, trail.mesh, trailCore.mesh, ribbon.mesh, aura.group,
    contactGlow.mesh, grindFlash.flare.mesh, ...rings.map((r) => r.flare.mesh),
    speedLines.mesh, slowMo.mesh, flash.mesh, card.mesh,
  );

  const cRail = linearRgb(SPARK_RAIL);
  const cCoping = linearRgb(SPARK_COPING);
  const cChip = rgb(CHIP_LEDGE);
  const cDust = rgb(DUST);
  const cLetter = rgb(LETTER);
  const cMac = rgb(MACGUFFIN);
  const cStickers = STICKER_PALETTE.map(rgb);

  let quality = 1;
  let sparkAcc = 0;
  let stickerAcc = 0;
  let ledgeDustT = 0;
  let sparkKind: RailKind | null = null;
  let deckOverride: 'none' | 'blueScreen' = 'none';
  let trailSpecial: SpecialId | null = null;
  let lastX = 0;
  let lastY = 0;
  let lastZ = 0;
  let lastFx = 0; // last known board axis (unit forward), for bursts that arrive as events
  let lastFz = -1;
  let haveLast = false;
  let time = 0;
  const camPos = new Vector3();
  const tmp = new Vector3();

  function setDeck(mode: 'none' | 'blueScreen'): void {
    if (deckOverride === mode) return;
    deckOverride = mode;
    hooks.setDeckOverride?.(mode);
  }

  function sparkRate(kind: RailKind): number {
    const mult = kind === 'coping' ? TUNING.FX_SPARK_COPING_RATE_MULT : kind === 'ledge' ? TUNING.FX_SPARK_LEDGE_RATE_MULT : 1;
    return TUNING.SPARK_RATE_PER_S * mult * quality;
  }

  /** A few dust wisps (used by the ledge grind and shared with the landing burst). */
  function dustPuff(x: number, y: number, z: number, n: number, vx: number, vz: number, sizeScale: number): void {
    const s = TUNING.FX_DUST_SPEED_MPS;
    for (let i = 0; i < n; i++) {
      const ang = rng.next() * Math.PI * 2;
      const r = s * 0.25 * rng.next();
      dust.spawn(
        x + (rng.next() - 0.5) * 0.1, y + 0.04, z + (rng.next() - 0.5) * 0.1,
        vx + Math.cos(ang) * r, s * (0.05 + rng.next() * 0.1), vz + Math.sin(ang) * r,
        TUNING.FX_DUST_LIFE_S * (0.7 + rng.next() * 0.6), TUNING.FX_DUST_SIZE_M * sizeScale * (0.7 + rng.next() * 0.6),
        cDust.r, cDust.g, cDust.b, (rng.next() - 0.5) * 2,
      );
    }
  }

  function emitSparks(snapshot: SimSnapshot, dt: number): void {
    const g = snapshot.skater.grind;
    if (!g || snapshot.skater.state !== 'Grind') {
      sparkKind = null;
      sparkAcc = 0;
      ledgeDustT = 0;
      contactGlow.hide();
      return;
    }
    sparkKind = g.railKind;
    const cp = g.contact;
    const t = g.tangent;
    const heavy = g.railKind === 'ledge';
    sparkAcc += sparkRate(g.railKind) * dt;
    const n = Math.floor(sparkAcc);
    // Contact hot spot (steel and coping): flickers with the spark stream.
    if (!heavy) {
      const flicker = 0.7 + 0.3 * Math.sin(time * 113) * Math.sin(time * 71);
      contactGlow.set(cp.x, cp.y + 0.03, cp.z, TUNING.FX_CONTACT_GLOW_M * (0.85 + 0.3 * flicker), 0.9 * flicker, 2.0, camera.quaternion);
    } else {
      contactGlow.hide();
      ledgeDustT += dt;
      if (ledgeDustT >= TUNING.FX_LEDGE_DUST_INTERVAL_S) {
        ledgeDustT = 0;
        dustPuff(cp.x, cp.y, cp.z, 2, -t.x * 0.6, -t.z * 0.6, 0.6);
      }
    }
    if (n <= 0) return;
    sparkAcc -= n;
    const speed = TUNING.FX_SPARK_SPEED_MPS;
    const life = TUNING.FX_SPARK_LIFE_S;
    const size = TUNING.FX_SPARK_SIZE_M;
    const sx = -t.z;
    const sz = t.x;
    // Spray backward along the rail (against travel), skimming up and to both sides; the ledge throws
    // slower, heavier chips from its own pool (normal blending, dark) so they read on sunlit concrete.
    const pool = heavy ? chips : sparks;
    const c = heavy ? cChip : g.railKind === 'coping' ? cCoping : cRail;
    const spray = heavy ? 0.5 : 1;
    // Back-date each spark by a slice of the frame so a low frame rate still draws a continuous stream.
    const clock = pool.clock;
    for (let i = 0; i < n; i++) {
      // A fan: mostly low and back along the rail, a wide sideways spread, a few thrown high.
      const back = speed * spray * (0.15 + rng.next() * 0.55);
      const sideways = (rng.next() - 0.5) * speed * 0.7;
      const up = speed * (0.1 + rng.next() * rng.next() * 0.6) * (heavy ? 0.6 : 1);
      pool.spawn(
        cp.x + (rng.next() - 0.5) * 0.06, cp.y + 0.02, cp.z + (rng.next() - 0.5) * 0.06,
        -t.x * back + sx * sideways, up, -t.z * back + sz * sideways,
        life * (0.6 + rng.next() * 0.8), (heavy ? 0.05 : size) * (0.7 + rng.next() * 0.6),
        c.r, c.g, c.b, heavy ? (rng.next() - 0.5) * 20 : 0, clock - (dt * i) / n,
      );
    }
  }

  /** Landing dust: DUST_BURST_COUNT puffs along the wheel line, mostly outward, plus the impact ring. */
  function dustBurst(x: number, y: number, z: number, count: number, ring: boolean): void {
    const n = Math.round(count * quality);
    const s = TUNING.FX_DUST_SPEED_MPS;
    const fx = lastFx;
    const fz = lastFz;
    const sx = -fz; // right of the board
    const sz = fx;
    for (let i = 0; i < n; i++) {
      const along = (rng.next() - 0.5) * 0.7;
      const sideSign = i % 2 === 0 ? 1 : -1;
      const out = s * (0.4 + rng.next() * 0.6) * sideSign;
      const drift = (rng.next() - 0.5) * s * 0.3;
      dust.spawn(
        x + fx * along + sx * 0.12 * sideSign, y + 0.04, z + fz * along + sz * 0.12 * sideSign,
        sx * out + fx * drift, s * (0.025 + rng.next() * 0.075), sz * out + fz * drift,
        TUNING.FX_DUST_LIFE_S * (0.7 + rng.next() * 0.6), TUNING.FX_DUST_SIZE_M * (0.7 + rng.next() * 0.6),
        cDust.r, cDust.g, cDust.b, (rng.next() - 0.5) * 3,
      );
    }
    if (ring) fireRing(x, y + 0.02, z, 0.4, TUNING.FX_LAND_RING_M, 0.5, 0, TUNING.FX_LAND_RING_S, LAND_RING, 1.2);
  }

  function fireRing(x: number, y: number, z: number, size0: number, size1: number, a0: number, a1: number, durationS: number, color: string, hdr: number): void {
    const shot = rings[nextRing] as FlareShot;
    nextRing = (nextRing + 1) % rings.length;
    shot.flare.setColor(color);
    shot.fire(x, y, z, size0, size1, a0, a1, durationS, hdr);
  }

  /** Glints in a ring around the body: gold for letters, white for the MacGuffin; plus a pickup ring. */
  function sparkleBurst(x: number, y: number, z: number, count: number, c: Rgb, lifeS: number, speed: number, color: string): void {
    const n = Math.round(count * quality);
    for (let i = 0; i < n; i++) {
      // Fountain: mostly up, a little sideways, floating (bursts use a light gravity).
      const ang = rng.next() * Math.PI * 2;
      const r = speed * (0.3 + rng.next() * 0.7);
      bursts.spawn(
        x + Math.cos(ang) * 0.4, y + 0.4 + rng.next() * 0.8, z + Math.sin(ang) * 0.4,
        Math.cos(ang) * r, speed * (0.4 + rng.next()), Math.sin(ang) * r,
        lifeS * (0.6 + rng.next() * 0.8), 0.03 + rng.next() * 0.06,
        c.r, c.g, c.b, rng.next() * 6.28,
      );
    }
    fireRing(x, y + 0.03, z, 0.3, TUNING.FX_PICKUP_RING_M, 0.7, 0, TUNING.FX_PICKUP_RING_S, color, 1.5);
  }

  /** Stickers peel off the deck: a fan up and back, tumbling; shape and colour per particle. */
  function stickerBurst(x: number, y: number, z: number, count: number): void {
    const n = Math.round(count * quality);
    const s = TUNING.FX_STICKER_SPEED_MPS;
    const spin = TUNING.FX_STICKER_SPIN_RPS;
    const fx = lastFx;
    const fz = lastFz;
    const sx = -fz;
    const sz = fx;
    for (let i = 0; i < n; i++) {
      const c = cStickers[rng.int(cStickers.length)] as Rgb;
      const along = (rng.next() - 0.5) * 0.6;
      const back = s * (0.3 + rng.next() * 0.7);
      const side = (rng.next() - 0.5) * s * 0.8;
      const up = s * (0.5 + rng.next() * 0.7);
      stickers.spawn(
        x + fx * along, y + 0.06, z + fz * along,
        -fx * back + sx * side, up, -fz * back + sz * side,
        TUNING.FX_STICKER_LIFE_S * (0.7 + rng.next() * 0.6), TUNING.FX_STICKER_SIZE_M * (0.7 + rng.next() * 0.6),
        c.r, c.g, c.b, (rng.next() - 0.5) * 2 * spin, stickers.clock, rng.int(4),
      );
    }
  }

  function emitStickerTrickle(snapshot: SimSnapshot, dt: number): void {
    if (snapshot.special.activeId !== 'token_overflow') {
      stickerAcc = 0;
      return;
    }
    // A steady peel through the animation, a quarter of the burst per 100 ms.
    stickerAcc += TUNING.FX_STICKER_BURST_COUNT * 2.5 * dt;
    const n = Math.floor(stickerAcc);
    if (n <= 0) return;
    stickerAcc -= n;
    const p = snapshot.skater.pos;
    stickerBurst(p.x, p.y, p.z, n / Math.max(1e-3, quality));
  }

  function clearAll(): void {
    sparks.clear();
    chips.clear();
    dust.clear();
    stickers.clear();
    bursts.clear();
    trail.clear();
    trailCore.clear();
    ribbon.clear();
    contactGlow.hide();
    grindFlash.clear();
    for (const r of rings) r.clear();
    sparkAcc = 0;
    stickerAcc = 0;
    ledgeDustT = 0;
    setDeck('none');
  }

  const debug: FxDebug = {
    get sparksSpawned() {
      return sparks.spawned + chips.spawned;
    },
    get sparksAlive() {
      return sparks.alive + chips.alive;
    },
    get dustSpawned() {
      return dust.spawned;
    },
    get stickersSpawned() {
      return stickers.spawned;
    },
    get burstSpawned() {
      return bursts.spawned;
    },
    get sparkKind() {
      return sparkKind;
    },
    get speedLines() {
      return speedLines.strength;
    },
    get slowMo() {
      return slowMo.strength;
    },
    get aura() {
      return aura.strength;
    },
    get auraPop() {
      return aura.pop;
    },
    get flashActive() {
      return flash.active;
    },
    get flashAlpha() {
      return flash.alpha;
    },
    get flashRemainingS() {
      return flash.remainingS;
    },
    get cardActive() {
      return card.active;
    },
    get contactGlow() {
      return contactGlow.alpha;
    },
    get shotsActive() {
      let n = grindFlash.active ? 1 : 0;
      for (const r of rings) if (r.active) n += 1;
      return n;
    },
    get trailSamples() {
      return trail.samples;
    },
    get ribbonSamples() {
      return ribbon.samples;
    },
    get deckOverride() {
      return deckOverride;
    },
    get qualityMult() {
      return quality;
    },
  };

  const fx: FxRuntime = {
    group,
    debug,
    onEvent(e: SimEvent) {
      switch (e.type) {
        case 'land':
          dustBurst(e.pos.x, e.pos.y, e.pos.z, TUNING.DUST_BURST_COUNT, true);
          setDeck('none');
          break;
        case 'bail':
          dustBurst(e.pos.x, e.pos.y, e.pos.z, TUNING.DUST_BURST_COUNT * 0.5, false);
          setDeck('none');
          break;
        case 'grindStart': {
          sparkKind = e.railKind;
          const heavy = e.railKind === 'ledge';
          const pool = heavy ? chips : sparks;
          const c = heavy ? cChip : e.railKind === 'coping' ? cCoping : cRail;
          // A first fan at the snap so the stream has no gap on the contact frame, plus the flash disc.
          const fanN = TUNING.FX_GRIND_FAN_COUNT;
          const rMin = TUNING.FX_GRIND_FAN_SPEED_MIN;
          const upMin = TUNING.FX_GRIND_FAN_UP_MIN;
          for (let i = 0; i < fanN; i++) {
            const ang = rng.next() * Math.PI * 2;
            const r = rMin + rng.next() * (TUNING.FX_GRIND_FAN_SPEED_MAX - rMin);
            pool.spawn(
              e.pos.x, e.pos.y + 0.02, e.pos.z,
              Math.cos(ang) * r, upMin + rng.next() * (TUNING.FX_GRIND_FAN_UP_MAX - upMin), Math.sin(ang) * r,
              TUNING.FX_SPARK_LIFE_S, heavy ? TUNING.FX_CHIP_SIZE_M : TUNING.FX_SPARK_SIZE_M, c.r, c.g, c.b, heavy ? (rng.next() - 0.5) * TUNING.FX_CHIP_SPIN : 0,
            );
          }
          if (!heavy) grindFlash.fire(e.pos.x, e.pos.y + 0.05, e.pos.z, TUNING.FX_GRIND_FLASH_M * 0.5, TUNING.FX_GRIND_FLASH_M, 1, 0, TUNING.FX_GRIND_FLASH_S, TUNING.FX_GRIND_FLASH_HDR);
          setDeck('none');
          break;
        }
        case 'lipStart':
          setDeck('none');
          break;
        case 'letter':
          sparkleBurst(e.pos.x, e.pos.y, e.pos.z, TUNING.FX_LETTER_BURST_COUNT, cLetter, TUNING.FX_LETTER_LIFE_S, 2.5, LETTER);
          break;
        case 'macguffin':
          flash.fire(FLASH_WHITE, TUNING.FLASH_MACGUFFIN_MS / 1000, 1);
          sparkleBurst(e.pos.x, e.pos.y, e.pos.z, TUNING.FX_MACGUFFIN_BURST_COUNT, cMac, TUNING.FX_LETTER_LIFE_S * 1.5, 3.5, MACGUFFIN);
          hooks.freeze?.(e.hitstopTicks);
          break;
        case 'specialReady':
          aura.firePop(TUNING.FX_AURA_POP, TUNING.FX_AURA_POP_S);
          break;
        case 'specialUsed':
          if (e.specialId === 'kernel_panic') {
            flash.fire(FLASH_BLUE, TUNING.FX_FLASH_KERNEL_MS / 1000, TUNING.FX_FLASH_KERNEL_ALPHA);
            card.fire(TUNING.FX_FLASH_KERNEL_MS / 1000, TUNING.FX_KERNEL_CARD_ALPHA);
            setDeck('blueScreen');
          } else if (e.specialId === 'token_overflow') {
            stickerBurst(lastX, lastY, lastZ, TUNING.FX_STICKER_BURST_COUNT);
          }
          break;
        case 'runStart':
          clearAll();
          break;
        default:
          break;
      }
    },
    update(snapshot: SimSnapshot, dtS: number) {
      const dt = Math.max(0, Math.min(0.1, dtS));
      const worldDt = dt * (snapshot.timeScale > 0 ? snapshot.timeScale : 1);
      time += worldDt;
      const k = snapshot.skater;
      // Camera pose for billboards and the point-size scale.
      camera.getWorldPosition(camPos);
      const fovRad = camera.fov * Math.PI / 180;
      const viewportH = hooks.viewportHeightPx ? hooks.viewportHeightPx() : defaultViewportHeight();
      const pixelScale = viewportH / (2 * Math.tan(fovRad / 2));
      const aspect = camera.aspect > 0 ? camera.aspect : 16 / 9;

      // Teleport / respawn guard: a jump of more than FX_TELEPORT_WIPE_M between frames wipes the trails.
      if (haveLast) {
        tmp.set(k.pos.x - lastX, k.pos.y - lastY, k.pos.z - lastZ);
        if (tmp.lengthSq() > TUNING.FX_TELEPORT_WIPE_M * TUNING.FX_TELEPORT_WIPE_M) {
          trail.clear();
          trailCore.clear();
          ribbon.clear();
        }
      }
      lastX = k.pos.x;
      lastY = k.pos.y;
      lastZ = k.pos.z;
      if (Math.hypot(k.forward.x, k.forward.z) > 1e-3) {
        const l = Math.hypot(k.forward.x, k.forward.z);
        lastFx = k.forward.x / l;
        lastFz = k.forward.z / l;
      }
      haveLast = true;

      emitSparks(snapshot, worldDt);
      emitStickerTrickle(snapshot, worldDt);

      // Board motion trail during any special (REQ-FX-02): a ghost of the deck, nose to tail.
      const special = snapshot.special.activeId;
      if (special !== null) {
        if (special !== trailSpecial) {
          trailSpecial = special;
          trail.setColor(TRAIL_COLOR[special]);
          trailCore.setColor(TRAIL_COLOR[special]);
        }
        const h = TUNING.FX_TRAIL_DECK_HALF_M;
        trail.pushPair(
          k.pos.x + lastFx * h, k.pos.y + 0.06, k.pos.z + lastFz * h,
          k.pos.x - lastFx * h, k.pos.y + 0.06, k.pos.z - lastFz * h,
        );
        trailCore.push(k.pos.x, k.pos.y + 0.08, k.pos.z);
      }
      // Green ribbon along the rail for the special grind.
      if (k.grind && k.grind.type === 'gpu_slide' && k.state === 'Grind') ribbon.push(k.grind.contact.x, k.grind.contact.y + 0.03, k.grind.contact.z, 0.05);

      sparks.setLook(TUNING.FX_SPARK_STRETCH, TUNING.FX_SPARK_HDR, 1, TUNING.FX_SPARK_BODY_GAIN);
      chips.setLook(1, 1, 0.9);
      dust.setLook(1, 1, TUNING.FX_DUST_ALPHA);
      bursts.setLook(1, 1.6, 1);
      sparks.update(worldDt, TUNING.FX_SPARK_GRAVITY, pixelScale, aspect);
      chips.update(worldDt, TUNING.FX_SPARK_GRAVITY, pixelScale, aspect);
      dust.update(worldDt, TUNING.FX_DUST_GRAVITY, pixelScale, aspect);
      stickers.update(worldDt, TUNING.FX_SPARK_GRAVITY * TUNING.FX_STICKER_GRAVITY_MULT, pixelScale, aspect);
      bursts.update(worldDt, TUNING.FX_BURST_GRAVITY, pixelScale, aspect);
      trail.setLook(TUNING.FX_TRAIL_HDR, 0.9);
      trail.update(worldDt, 0, TUNING.FX_TRAIL_FADE_S, camPos);
      trailCore.setLook(TUNING.FX_TRAIL_HDR, 0.6);
      trailCore.update(worldDt, TUNING.FX_TRAIL_CORE_WIDTH_M, TUNING.FX_TRAIL_FADE_S, camPos);
      ribbon.update(worldDt, TUNING.FX_RIBBON_WIDTH_M, TUNING.FX_RIBBON_FADE_S, camPos);
      aura.update(
        dt, k.pos, k.up, TUNING.FX_AURA_HEIGHT_M, camera.quaternion,
        snapshot.special.glowing ? 1 : 0, TUNING.FX_AURA_FADE_S, TUNING.FX_AURA_RADIUS_M, TUNING.FX_AURA_PULSE_HZ,
        TUNING.FX_AURA_DEPTH_PUSH, TUNING.FX_AURA_MIN_VIEW_M, TUNING.FX_AURA_CORE_BACK_M, TUNING.FX_AURA_CORE_R,
        TUNING.FX_AURA_RIM_R, TUNING.FX_AURA_GROUND_CORE_R,
      );
      grindFlash.update(worldDt, camera.quaternion);
      for (const r of rings) r.update(worldDt, camera.quaternion);
      speedLines.update(dt, TUNING.FX_SPEEDLINE_STRENGTH * kickRamp(k.speedRatio), TUNING.FX_SPEEDLINE_FADE_S, aspect);
      slowMo.update(dt, special === 'inference_900ms' ? TUNING.FX_SLOWMO_STRENGTH : 0, TUNING.FX_SLOWMO_FADE_S, aspect);
      flash.update(dt);
      card.update(dt, aspect);
    },
    setQuality(q: QualitySettings) {
      quality = qualityMult(q.id);
    },
    dispose() {
      sparks.dispose();
      chips.dispose();
      dust.dispose();
      stickers.dispose();
      bursts.dispose();
      trail.dispose();
      trailCore.dispose();
      ribbon.dispose();
      aura.dispose();
      flash.dispose();
      card.dispose();
      speedLines.dispose();
      slowMo.dispose();
      contactGlow.dispose();
      grindFlash.flare.dispose();
      for (const r of rings) r.flare.dispose();
      group.clear();
    },
  };
  return fx;
}
