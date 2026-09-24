/**
 * src/core/tuning/render.ts (render track): the render track's own tunables. Only the render track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:render").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 *
 * The DESIGN M numbers (RENDER_EXPOSURE, BLOOM_THRESHOLD, VIGNETTE, CHROMATIC_ABERRATION,
 * RAIL_EMISSIVE_RIM, SHADOW_BOX_M, SUN_ELEVATION_DEG, FPS_PROBE_S, QUALITY_FPS_*, MENU_FLYTHROUGH_S)
 * live in the frozen "render" section of src/core/tuning.ts. The keys below are the look numbers:
 * RSKY_ = sky and IBL, RLIT_ = lights and shadows, RPOST_ = post chain, RMAT_ = materials,
 * RLV_ = level view pickups and signs, RMENU_ = the menu flythrough path.
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const RENDER_TUNING = {
  // --- sky and image-based lighting (REQ-REN-02) ------------------------------------------------
  RSKY_SUN_AZIMUTH_DEG: [250, 0, 360, 1, 'deg', 'REQ-REN-02', 'Street sun azimuth'], // REQ-REN-02, 0 to 360 deg clockwise from north: 250 = west-south-west, a late afternoon sun that throws long shadows across the plaza.
  RSKY_TURBIDITY: [1.8, 1, 20, 0.5, 'ratio', 'REQ-REN-02', 'Sky turbidity'], // REQ-REN-02, 1 to 20 (three Sky shader): haze; 1.8 keeps a deep blue zenith and a pale-blue (not white) horizon (2.5 measured horizon saturation 0.03 in the polish-1 audit).
  RSKY_RAYLEIGH: [2.4, 0, 4, 0.1, 'ratio', 'REQ-REN-02', 'Sky rayleigh'], // REQ-REN-02, 0 to 4 (three Sky shader): scattering; 2.4 with the low turbidity gives the saturated skate-video sky of SPEC section 10 without the milky band 3.2 made at the horizon.
  RSKY_MIE: [0.004, 0, 0.1, 0.001, 'ratio', 'REQ-REN-02', 'Sky mie coefficient'], // REQ-REN-02, 0 to 0.1 (three Sky shader): sun glow width; 0.004 keeps the glow tight so the horizon does not wash to white.
  RSKY_RADIANCE: [0.34, 0.05, 2, 0.01, 'ratio', 'REQ-REN-02', 'Sky radiance scale'], // REQ-REN-02, 0.05 to 2: the three Sky shader is authored for exposure 0.5; this scales its HDR output before the PMREM bake and the background so the plaza is not blown out.
  RSKY_ENV_INTENSITY: [0.45, 0.1, 3, 0.05, 'ratio', 'REQ-REN-02', 'IBL intensity'], // REQ-REN-02, 0.1 to 3: envMapIntensity of every registry material (x ENV_SCALE); it only took effect once the registry set envMap explicitly (three 0.186 used scene.environmentIntensity = 1 before), 0.45 gives a sunlit / shadow luminance of about 1.7 : 1 on the marble.
  RSKY_ROOM_SCALE: [0.35, 0.05, 2, 0.05, 'ratio', 'REQ-REN-02', 'Woodshed room light scale'], // REQ-REN-02, 0.05 to 2: RoomEnvironment's lights are authored for showroom exposure; scaled down so the shed's key light and shadows read.
  // --- lights and shadows (REQ-REN-03) -----------------------------------------------------------
  RLIT_CAMPUS_MOON_INTENSITY: [3.2, 0.2, 10, 0.1, 'ratio', 'REQ-REN-03', 'Lab Campus moon intensity'], // REQ-REN-03, 0.2 to 10 (Lab Campus, 2026-09-23): the night key light with the shadow map.
  RLIT_CAMPUS_SKY_INTENSITY: [0.9, 0, 3, 0.05, 'ratio', 'REQ-REN-03', 'Lab Campus sky fill'], // REQ-REN-03, 0 to 3 (Lab Campus): blue-violet hemisphere so shade is readable at night.
  RLIT_CAMPUS_FILL_INTENSITY: [0.35, 0, 2, 0.05, 'ratio', 'REQ-REN-03', 'Lab Campus neon fill'], // REQ-REN-03, 0 to 2 (Lab Campus): violet ambient bounce from the signage.
  RLIT_SUN_INTENSITY: [14, 0.5, 20, 0.1, 'ratio', 'REQ-REN-03', 'Street sun intensity'], // REQ-REN-03, 0.5 to 20: DirectionalLight intensity under physically based lights; at 18 deg elevation the floor gets 0.31 of it, so 14 keeps the warm sun 4 to 5x the cool sky fill and the long shadows read with a warm / cool split.
  RLIT_HEMI_INTENSITY: [0.15, 0, 2, 0.05, 'ratio', 'REQ-REN-03', 'Hemisphere fill intensity'], // REQ-REN-03, 0 to 2: sky / ground fill so shadows are never black; kept low so shadow sides stay cool blue, not grey.
  RLIT_SKYFILL_INTENSITY: [2.5, 0, 4, 0.05, 'ratio', 'REQ-REN-03', 'Street shade skylight'], // REQ-REN-03, 0 to 4: the cool diffuse-only hemisphere fill from the side opposite the sun; lifts the shade faces of ledges and blocks out of black (polish round 2: planter shade faces measured 0,0,0) while cast shadows on the floor stay blue.
  RLIT_SKYFILL_ELEVATION_DEG: [-25, -60, 30, 1, 'deg', 'REQ-REN-03', 'Street skylight axis elevation'], // REQ-REN-03, -60 to 30 deg: the fill hemisphere's axis; below the horizon, so a wall facing it gets 0.95 of the light and a floor only 0.29.
  RLIT_SKYFILL_AZIMUTH_OFFSET_DEG: [-40, -90, 90, 5, 'deg', 'REQ-REN-03', 'Street skylight azimuth offset'], // REQ-REN-03, -90 to 90 deg: added to the anti-sun azimuth; -40 swings it toward north so both the north and the east shade faces get some.
  RLIT_WOODSHED_KEY_INTENSITY: [7, 0.2, 12, 0.1, 'ratio', 'REQ-REN-03', 'Woodshed key light intensity'], // REQ-REN-03, 0.2 to 12: the high window key inside the shed; 7 over a 0.5 fill so the shed has shadow contrast.
  RLIT_WOODSHED_FILL_INTENSITY: [0.5, 0, 3, 0.05, 'ratio', 'REQ-REN-02', 'Woodshed warm fill intensity'], // REQ-REN-02, 0 to 3: the warm interior fill next to the RoomEnvironment IBL; 0.9 turned the shed into orange mush.
  RLIT_WOODSHED_SKY_INTENSITY: [0.35, 0, 2, 0.05, 'ratio', 'REQ-REN-02', 'Woodshed cool skylight intensity'], // REQ-REN-02, 0 to 2: cool hemisphere from the high windows, the counterpoint to the warm key and fill.
  RLIT_SHADOW_BIAS: [-0.0004, -0.005, 0.005, 0.0001, 'ratio', 'REQ-REN-03', 'Shadow bias'], // REQ-REN-03, -0.005 to 0.005: small negative bias with a normal bias kills acne without peter-panning.
  RLIT_SHADOW_NORMAL_BIAS: [0.02, 0, 0.2, 0.005, 'm', 'REQ-REN-03', 'Shadow normal bias'], // REQ-REN-03, 0 to 0.2 m: pushes samples along the normal; scaled with the texel size.
  RLIT_SHADOW_DEPTH_M: [80, 30, 200, 5, 'm', 'REQ-REN-03', 'Shadow frustum depth'], // REQ-REN-03, 30 to 200 m: near-to-far range of the ortho shadow camera along the sun.
  // --- post chain (REQ-REN-04) -------------------------------------------------------------------
  RPOST_BLOOM_INTENSITY: [0.8, 0, 2, 0.05, 'ratio', 'REQ-REN-04', 'Bloom intensity'], // REQ-REN-04, 0 to 2: strength of the mipmap bloom above BLOOM_THRESHOLD; bloom is selective (BLOOM_LAYER only), so 0.8 lights the neon without touching sunlit plywood.
  RPOST_BLOOM_SMOOTHING: [0.15, 0, 0.5, 0.01, 'ratio', 'REQ-REN-04', 'Bloom threshold smoothing'], // REQ-REN-04, 0 to 0.5: soft knee around the luminance threshold.
  RPOST_AO_RADIUS_M: [2.5, 0.2, 5, 0.1, 'm', 'REQ-REN-04', 'N8AO radius'], // REQ-REN-04, 0.2 to 5 m: world-space occlusion radius; 2.5 puts a visible contact shadow under ledges and boxes (1.2 measured as 1 luminance point).
  RPOST_AO_INTENSITY: [7, 0, 10, 0.1, 'ratio', 'REQ-REN-04', 'N8AO intensity'], // REQ-REN-04, 0 to 10: exponent on the raw occlusion (N8AO default 5); below 3 the contact shadows vanish.
  RPOST_AO_FALLOFF: [0.5, 0.1, 4, 0.1, 'ratio', 'REQ-REN-04', 'N8AO distance falloff'], // REQ-REN-04, 0.1 to 4: how fast occlusion fades with depth difference.
  RPOST_SATURATION: [0.26, 0, 0.5, 0.01, 'ratio', 'REQ-REN-04', 'Grade saturation'], // REQ-REN-04, 0 to 0.5: HueSaturationEffect after tone mapping for the saturated late-90s skate video look of SPEC section 10 (mean HSV saturation of the Street spawn view 0.29, was 0.17).
  RPOST_CONTRAST: [0.2, 0, 0.5, 0.01, 'ratio', 'REQ-REN-04', 'Grade contrast'], // REQ-REN-04, 0 to 0.5: SoftContrastEffect after tone mapping (src/render/lib/softContrast.ts), the S-curve AgX's flat response needs; midtone slope 1 + k, black and white stay pinned (the old BrightnessContrastEffect clipped every linear value under 0.07 to black).
  RPOST_AO_FLOOR: [0.3, 0, 0.9, 0.05, 'ratio', 'REQ-REN-04', 'N8AO darkening floor'], // REQ-REN-04, 0 to 0.9: the AO term is lerped toward 1 by this much, so full occlusion keeps 30 % of the light; at 0 a Street shade face in a crease went to pure 0,0,0 (polish round 2 audit).
  RPOST_CA_MODULATION_OFFSET: [0.5, 0, 1, 0.05, 'ratio', 'REQ-REN-04', 'Aberration clear centre'], // REQ-REN-04, 0 to 1: radial distance (0 centre, 1 edge midpoint) before the glowing aberration starts; 0.5 keeps the middle of the frame clean (0.25 fringed rails at the centre).
  // --- materials (REQ-MAT-01..04) ----------------------------------------------------------------
  RMAT_SHEET_M: [2.4, 2.4, 2.4, 0.1, 'm', 'REQ-MAT-01', 'Maple sheet seam spacing'], // REQ-MAT-01, fixed 2.4 m (spec §10): plywood sheet seams in world UVs.
  RMAT_TEXTURE_PX: [512, 128, 1024, 64, 'px', 'REQ-MAT-05', 'Procedural texture size'], // REQ-MAT-05, 128 to 1024 px: generation size for tiling maps; 512 keeps first playable under 5 s.
  RMAT_NEON_EMISSIVE: [3.5, 1, 8, 0.1, 'ratio', 'REQ-MAT-04', 'Neon sign emissive intensity'], // REQ-MAT-04, 1 to 8: above BLOOM_THRESHOLD so only signage blooms.
  RMAT_WINDOW_LIT_RATIO: [0.12, 0, 1, 0.05, 'ratio', 'REQ-MAT-03', 'Glass tower lit windows'], // REQ-MAT-03, 0 to 1: fraction of tower windows lit in the window pattern; 0.12 by day (0.55 read as an opaque mosaic), a dusk preset may raise it.
  RMAT_GLASS_EMISSIVE: [0.4, 0, 3, 0.05, 'ratio', 'REQ-MAT-03', 'Glass tower window glow'], // REQ-MAT-03, 0 to 3: emissive strength of lit windows; below the bloom threshold on purpose.
  RMAT_SKYLINE_LIT_RATIO: [0.14, 0, 0.6, 0.02, 'ratio', 'REQ-MAT-03', 'Skyline lit windows'], // REQ-MAT-03, 0 to 0.6: fraction of the distant blocks' windows lit (read when the texture is generated); a scatter by day.
  RMAT_SKYLINE_WINDOW_EMISSIVE: [0.5, 0, 2, 0.05, 'ratio', 'REQ-MAT-03', 'Skyline window glow'], // REQ-MAT-03, 0 to 2: emissive of the lit skyline windows; the skyline is never on the bloom layer, so this only tints the panes warm.
  RMAT_SKYLINE_HAZE_BLUE: [0.4, 0, 1, 0.05, 'ratio', 'REQ-REN-02', 'Skyline haze toward sky blue'], // REQ-REN-02, 0 to 1: how far the skyline's aerial haze shifts from the warm horizon fog toward blue (0 = the scene fog, which read as a neutral grey on the blocks).
  RMAT_RAIL_MIN_PX: [3.5, 0, 6, 0.5, 'px', 'REQ-MAT-02', 'Rail minimum screen width'], // REQ-MAT-02, 0 to 6 px: the drawn rail / coping pipe is inflated along its normal so it never drops under this many pixels (the sim and collider are untouched); 0 disables. Rails were a single pixel at 25 m and gone at 70 m.
  RMAT_RAIL_RIM_GAIN: [3, 0, 8, 0.5, 'ratio', 'REQ-MAT-02', 'Rail rim edge gain'], // REQ-MAT-02, 0 to 8: how much the fresnel edge multiplies the RAIL_EMISSIVE_RIM emissive (face-on stays at 0.5x), a warm bright edge on the dark gunmetal bar.
  RSKY_ENV_SUN_BLOB: [0.08, 0, 0.5, 0.01, 'ratio', 'REQ-REN-02', 'IBL sun highlight radiance'], // REQ-REN-02, 0 to 0.5: radiance (as a fraction of RLIT_SUN_INTENSITY) of the soft 6 deg sun blob baked ONLY into the reflection environment so chrome shows a highlight; small so it never fills the shadows.
  RSKY_ENV_GROUND: [0.35, 0, 1, 0.05, 'ratio', 'REQ-REN-02', 'IBL ground radiance'], // REQ-REN-02, 0 to 1: radiance of the warm ground disc baked into the reflection environment so metals reflect a horizon line.
  // --- level view (REQ-LVL-08 pickups, REQ-MAT-04 signs) ----------------------------------------
  RLV_PICKUP_SPIN_DPS: [90, 0, 360, 5, 'deg/s', 'REQ-LVL-08', 'Pickup spin speed'], // REQ-LVL-08, 0 to 360 deg/s: letters and the MacGuffin spin so they read as pickups.
  RLV_PICKUP_BOB_M: [0.12, 0, 0.5, 0.01, 'm', 'REQ-LVL-08', 'Pickup bob amplitude'], // REQ-LVL-08, 0 to 0.5 m: slow vertical bob.
  RLV_PICKUP_EMISSIVE: [2.5, 0.5, 6, 0.1, 'ratio', 'REQ-LVL-08', 'Pickup emissive intensity'], // REQ-LVL-08, 0.5 to 6: letters glow past the bloom threshold.
  RLV_SIGN_PULSE_HZ: [0.4, 0, 3, 0.05, 'Hz', 'REQ-MAT-04', 'Neon sign pulse rate'], // REQ-MAT-04, 0 to 3 Hz: slow emissive breathing on neon boxes.
  RLV_SIGN_PULSE_DEPTH: [0.12, 0, 0.5, 0.01, 'ratio', 'REQ-MAT-04', 'Neon sign pulse depth'], // REQ-MAT-04, 0 to 0.5: neon emissive swings +-12 % around RMAT_NEON_EMISSIVE, a breath, not a flicker.
  RLV_SIGN_EMISSIVE: [1.2, 0, 4, 0.05, 'ratio', 'REQ-MAT-04', 'Plain billboard emissive'], // REQ-MAT-04, 0 to 4: emissive of a non-neon billboard face; above 1 so wordmarks read in shade, never on the bloom layer.
  RLV_PICKUP_BOB_HZ: [0.27, 0, 1, 0.01, 'Hz', 'REQ-LVL-08', 'Pickup bob rate'], // REQ-LVL-08, 0 to 1 Hz: slow bob (0.27 Hz = the old 1.7 rad/s).
  // --- backdrops: the Woodshed room and the Street skyline (DESIGN G.2, SPEC section 10) ------------
  RLV_SHED_WINDOW_EMISSIVE: [1.7, 0, 6, 0.1, 'ratio', 'REQ-REN-03', 'Shed clerestory glow'], // REQ-REN-03, 0 to 6: the high window band that motivates the shed key light; past BLOOM_THRESHOLD so the panes glow softly.
  RLV_SHED_LAMP_EMISSIVE: [4, 0, 10, 0.1, 'ratio', 'REQ-REN-03', 'Shed high-bay lamp glow'], // REQ-REN-03, 0 to 10: the hanging lamps under the trusses (bloom layer).
  // --- menu flythrough (REQ-MNU-01) --------------------------------------------------------------
  RMENU_CAM_HEIGHT_M: [9, 2, 30, 0.5, 'm', 'REQ-MNU-01', 'Flythrough camera height'], // REQ-MNU-01, 2 to 30 m: mean height of the spline over the park floor.
  RMENU_CAM_INSET: [0.22, 0.05, 0.45, 0.01, 'ratio', 'REQ-MNU-01', 'Flythrough path inset'], // REQ-MNU-01, 0.05 to 0.45: the loop sits this fraction of the park size inside its bounds.
  RMENU_LOOK_AHEAD_S: [1.5, 0.2, 5, 0.1, 's', 'REQ-MNU-01', 'Flythrough look-ahead'], // REQ-MNU-01, 0.2 to 5 s: the camera looks at the path point this many seconds ahead.
  RMENU_FOV_DEG: [55, 35, 90, 1, 'deg', 'REQ-MNU-01', 'Flythrough FOV'], // REQ-MNU-01, 35 to 90 deg: a slightly long lens flatters the park.
  RMENU_FRAME_YAW_DEG: [18, 0, 30, 1, 'deg', 'REQ-MNU-01', 'Flythrough framing yaw'], // REQ-MNU-01, 0 to 30 deg: the tour camera looks this far left of its hero feature so the feature sits in the right third, clear of the menu panel (18 deg at 55 deg vertical FOV and 16:9 = one third right of centre).
} satisfies TrackTuningSpec;
