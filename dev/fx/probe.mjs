// dev/fx/probe.mjs (fx track): projects a particle pool of the running harness into the rig camera and
// reports how many alive particles are in frame. node dev/fx/probe.mjs <url> [poolIndex]
import { chromium } from "@playwright/test";
const url = process.argv[2];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 40000 });
const out = await page.evaluate((poolIndex) => {
  const fx = window.__fx; const rig = window.__rig;
  const pts = fx.group.children[poolIndex];
  const g = pts.geometry; const u = pts.material.uniforms;
  const pos = g.getAttribute('position').array, vel = g.getAttribute('vel').array, birth = g.getAttribute('birth').array, life = g.getAttribute('life').array, size = g.getAttribute('size').array;
  const t0 = u.uTime.value, grav = u.uGravity.value;
  const cam = rig.camera; cam.updateMatrixWorld();
  const res = { alive: 0, inFrame: 0, samples: [], uTime: t0, ranges: g.getAttribute('position').updateRanges, ps: [] };
  const gl = document.querySelector('canvas').getContext('webgl2');
  res.pointRange = gl ? Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)) : null;
  for (let i = 0; i < life.length; i++) {
    const t = t0 - birth[i]; if (!(life[i] > 0 && t >= 0 && t <= life[i])) continue; res.alive++;
    const p = { x: pos[i*3] + vel[i*3]*t, y: pos[i*3+1] + vel[i*3+1]*t - 0.5*grav*t*t, z: pos[i*3+2] + vel[i*3+2]*t };
    const v = new (Object.getPrototypeOf(cam.position).constructor)(p.x, p.y, p.z).project(cam);
    const inside = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
    if (inside) res.inFrame++;
    if (res.samples.length < 6) res.samples.push({ t: +t.toFixed(2), ndc: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(3)], size: +size[i].toFixed(3) });
  }
  return res;
}, Number(process.argv[3] ?? 3));
console.log(JSON.stringify(out));
await browser.close();
