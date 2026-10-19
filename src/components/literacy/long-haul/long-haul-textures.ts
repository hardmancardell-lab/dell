import * as THREE from "three";
import { PAL } from "./long-haul-palette";
import { FACADE } from "./long-haul-geometry";

/**
 * Procedural canvas textures for "The Long Haul" (no image files). Browser only: needs document.createElement("canvas").
 * Every texture is created through `tex()` so the caller's ResourceBin can free it.
 */

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const hex = (n: number): string => "#" + n.toString(16).padStart(6, "0");

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas 2D is not available");
  return { c, g };
}

export interface TexOpts {
  repeat?: [number, number];
  srgb?: boolean;
  anisotropy?: number;
  mipmaps?: boolean;
  wrap?: boolean;
}

function tex(c: HTMLCanvasElement, o: TexOpts = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (o.wrap) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  if (o.anisotropy) t.anisotropy = o.anisotropy;
  if (o.mipmaps === false) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  t.needsUpdate = true;
  return t;
}

/** Subtle tarmac: dark blue-grey, fine speckle, a few patched squares and tar seams. Tiles every ~8 m. */
export function makeAsphaltTexture(anisotropy: number): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  const rnd = mulberry32(11);
  g.fillStyle = hex(PAL.asphalt);
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(10,14,20,${0.08 + rnd() * 0.18})` : `rgba(170,190,215,${0.03 + rnd() * 0.08})`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  for (let i = 0; i < 4; i++) {
    g.fillStyle = `rgba(8,12,18,${0.1 + rnd() * 0.1})`;
    g.fillRect(rnd() * 200, rnd() * 200, 30 + rnd() * 50, 20 + rnd() * 40);
  }
  g.strokeStyle = "rgba(6,9,14,0.5)";
  g.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    let x = rnd() * 256;
    let y = 0;
    g.moveTo(x, y);
    while (y < 256) {
      x += (rnd() - 0.5) * 14;
      y += 10 + rnd() * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return tex(c, { wrap: true, anisotropy });
}

/** The rough back road: brown, pebbly, with two darker wheel ruts and tufts of scrub. Returns the colour map and a matching bump map. */
export function makeDirtTextures(anisotropy: number): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 256;
  const H = 256;
  const col = canvas(W, H);
  const bmp = canvas(W, H);
  const rnd = mulberry32(23);
  col.g.fillStyle = hex(PAL.dirt);
  col.g.fillRect(0, 0, W, H);
  bmp.g.fillStyle = "#808080";
  bmp.g.fillRect(0, 0, W, H);
  // mottling
  for (let i = 0; i < 90; i++) {
    const r = 6 + rnd() * 22;
    const x = rnd() * W;
    const y = rnd() * H;
    col.g.fillStyle = rnd() < 0.5 ? `rgba(40,26,14,${0.08 + rnd() * 0.12})` : `rgba(190,150,100,${0.05 + rnd() * 0.1})`;
    col.g.beginPath();
    col.g.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
    col.g.fill();
  }
  // wheel ruts: two darker, lower stripes with a raised ridge between them
  for (const rx of [W * 0.3, W * 0.7]) {
    const grad = col.g.createLinearGradient(rx - 22, 0, rx + 22, 0);
    grad.addColorStop(0, "rgba(30,20,10,0)");
    grad.addColorStop(0.5, "rgba(30,20,10,0.38)");
    grad.addColorStop(1, "rgba(30,20,10,0)");
    col.g.fillStyle = grad;
    col.g.fillRect(rx - 22, 0, 44, H);
    const bg = bmp.g.createLinearGradient(rx - 22, 0, rx + 22, 0);
    bg.addColorStop(0, "rgba(60,60,60,0)");
    bg.addColorStop(0.5, "rgba(40,40,40,0.8)");
    bg.addColorStop(1, "rgba(60,60,60,0)");
    bmp.g.fillStyle = bg;
    bmp.g.fillRect(rx - 22, 0, 44, H);
  }
  // pebbles
  for (let i = 0; i < 700; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 0.8 + rnd() * 2.4;
    const shade = 90 + Math.floor(rnd() * 90);
    col.g.fillStyle = `rgba(${shade + 20},${shade},${shade - 25},${0.5 + rnd() * 0.4})`;
    col.g.beginPath();
    col.g.arc(x, y, r, 0, Math.PI * 2);
    col.g.fill();
    bmp.g.fillStyle = `rgba(${200 + rnd() * 50},${200 + rnd() * 50},${200 + rnd() * 50},0.9)`;
    bmp.g.beginPath();
    bmp.g.arc(x, y, r, 0, Math.PI * 2);
    bmp.g.fill();
    col.g.fillStyle = "rgba(0,0,0,0.25)";
    col.g.beginPath();
    col.g.arc(x + 1, y + 1, r, 0, Math.PI * 2);
    col.g.fill();
  }
  // scrub tufts
  for (let i = 0; i < 40; i++) {
    col.g.strokeStyle = `rgba(${70 + rnd() * 30},${80 + rnd() * 30},40,0.7)`;
    col.g.lineWidth = 1;
    const x = rnd() * W;
    const y = rnd() * H;
    for (let k = 0; k < 5; k++) {
      col.g.beginPath();
      col.g.moveTo(x, y);
      col.g.lineTo(x + (k - 2) * 1.6, y - 4 - rnd() * 3);
      col.g.stroke();
    }
  }
  return { map: tex(col.c, { wrap: true, anisotropy }), bump: tex(bmp.c, { wrap: true, srgb: false, anisotropy }) };
}

/** Vertical fade used as the alpha map of the gravel that spills onto the asphalt at each end of the dirt lane. */
export function makeFadeTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(8, 64);
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#000000");
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 64);
  return tex(c, { srgb: false, mipmaps: false });
}

/** Painted gore between the two lanes: double yellow centre line, white edge lines and forward-pointing chevrons. 4 m wide, tiles every 8 m. */
export function makeHatchTexture(anisotropy: number): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = hex(PAL.asphaltDark);
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(233,238,245,0.92)";
  g.lineWidth = 9;
  g.lineCap = "butt";
  for (let y = 0; y <= H + 64; y += 64) {
    g.beginPath();
    g.moveTo(10, y + 56);
    g.lineTo(W / 2 - 8, y + 6);
    g.stroke();
    g.beginPath();
    g.moveTo(W - 10, y + 56);
    g.lineTo(W / 2 + 8, y + 6);
    g.stroke();
  }
  g.fillStyle = hex(PAL.paintYellow);
  g.fillRect(W / 2 - 7, 0, 3.5, H);
  g.fillRect(W / 2 + 3.5, 0, 3.5, H);
  g.fillStyle = hex(PAL.paint);
  g.fillRect(2, 0, 5, H);
  g.fillRect(W - 7, 0, 5, H);
  return tex(c, { wrap: true, anisotropy });
}

/**
 * Facade textures. One colour map shared by all buildings (pale wall with dark glass, tinted per building by the instance colour) and
 * three emissive maps with different random patterns of lit windows (mostly dark, a few warm amber, a few cool), so it reads as dusk.
 * Each is COLS x ROWS cells; the first cell's corner is solid wall (roofs map to it).
 */
export function makeFacadeTextures(anisotropy: number): { diffuse: THREE.CanvasTexture; emissive: THREE.CanvasTexture[] } {
  const cell = 64;
  const W = FACADE.cols * cell;
  const H = FACADE.rows * cell;
  const inset = 11;
  const diffuse = canvas(W, H);
  diffuse.g.fillStyle = "#c9d3df";
  diffuse.g.fillRect(0, 0, W, H);
  for (let r = 0; r < FACADE.rows; r++) {
    for (let k = 0; k < FACADE.cols; k++) {
      const x = k * cell;
      const y = r * cell;
      diffuse.g.fillStyle = "rgba(60,75,95,0.18)"; // floor band under each window row
      diffuse.g.fillRect(x, y + cell - 8, cell, 8);
      diffuse.g.fillStyle = "#1a2230"; // glass
      diffuse.g.fillRect(x + inset, y + inset - 2, cell - inset * 2, cell - inset * 2 - 6);
      diffuse.g.fillStyle = "rgba(160,185,215,0.25)"; // sill highlight
      diffuse.g.fillRect(x + inset - 1, y + cell - inset - 8, cell - inset * 2 + 2, 2);
      diffuse.g.fillStyle = "rgba(160,185,215,0.12)"; // mullion
      diffuse.g.fillRect(x + cell / 2 - 1, y + inset - 2, 2, cell - inset * 2 - 6);
    }
  }
  const emissive: THREE.CanvasTexture[] = [];
  for (let variant = 0; variant < 3; variant++) {
    const rnd = mulberry32(101 + variant * 17);
    const em = canvas(W, H);
    em.g.fillStyle = "#000000";
    em.g.fillRect(0, 0, W, H);
    for (let r = 0; r < FACADE.rows; r++) {
      for (let k = 0; k < FACADE.cols; k++) {
        if (r === 0 && k === 0) continue; // keep the roof texel dark
        const lit = rnd();
        if (lit > 0.22) continue;
        const kind = rnd();
        const color = kind < 0.74 ? hex(PAL.verdict) : kind < 0.88 ? "#fff0c8" : "#8fe9dc";
        const x = k * cell;
        const y = r * cell;
        const full = rnd() < 0.7;
        em.g.fillStyle = color;
        em.g.globalAlpha = 0.65 + rnd() * 0.35;
        const wh = cell - inset * 2 - 6;
        em.g.fillRect(x + inset, y + inset - 2 + (full ? 0 : wh * 0.45), cell - inset * 2, full ? wh : wh * 0.55);
        em.g.globalAlpha = 1;
      }
    }
    emissive.push(tex(em.c, { wrap: true, anisotropy }));
  }
  return { diffuse: tex(diffuse.c, { wrap: true, anisotropy }), emissive };
}

/** Equirectangular dusk sky: stars, a warm glow low in the direction of travel (-z), and a far skyline fading into the fog colour. */
export function makeSkyTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const { c, g } = canvas(W, H);
  const hz = H / 2;
  g.fillStyle = hex(PAL.horizon);
  g.fillRect(0, 0, W, H);
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, hex(PAL.zenith));
  sky.addColorStop(0.5, "#0a1322");
  sky.addColorStop(0.86, "#14233a");
  sky.addColorStop(1, hex(PAL.horizon));
  g.fillStyle = sky;
  g.fillRect(0, 0, W, hz);
  const rnd = mulberry32(5);
  // stars
  for (let i = 0; i < 900; i++) {
    const y = Math.pow(rnd(), 1.5) * hz * 0.78;
    const size = 0.8 + rnd() * 1.4;
    const a = 0.25 + rnd() * 0.6;
    const tint = rnd();
    g.fillStyle = tint < 0.12 ? `rgba(120,240,222,${a})` : tint < 0.2 ? `rgba(240,200,150,${a})` : `rgba(225,235,250,${a})`;
    g.beginPath();
    g.arc(rnd() * W, y, size, 0, Math.PI * 2);
    g.fill();
  }
  // dusk glow straight ahead (-z is u = 0.75) and a faint cool counter-glow behind
  const glow = (u: number, rx: number, ry: number, color: string, alpha: number) => {
    g.save();
    g.translate(u * W, hz);
    g.scale(rx, ry);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    rg.addColorStop(0, `rgba(${color},${alpha})`);
    rg.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = rg;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  };
  glow(0.75, 520, 150, "240,168,104", 0.4);
  glow(0.75, 260, 70, "255,200,140", 0.25);
  glow(0.25, 520, 110, "79,232,208", 0.12);
  glow(0.5, 420, 90, "240,168,104", 0.1);
  glow(0.0, 420, 90, "240,168,104", 0.1);
  // skyline: two layers of silhouettes sinking into the fog colour at the horizon
  for (const layer of [{ max: 52, color: "#0f1a29", seed: 7, windows: 0 }, { max: 34, color: "#0a121c", seed: 9, windows: 1 }]) {
    const r2 = mulberry32(layer.seed);
    const grad = g.createLinearGradient(0, hz - layer.max, 0, hz + 2);
    grad.addColorStop(0, layer.color);
    grad.addColorStop(1, hex(PAL.horizon));
    g.fillStyle = grad;
    let x = 0;
    while (x < W) {
      const w = 14 + r2() * 40;
      const h = 8 + r2() * layer.max;
      g.fillRect(x, hz - h, w - 2, h + 2);
      if (layer.windows) {
        for (let k = 0; k < 6; k++) {
          if (r2() < 0.5) continue;
          g.fillStyle = `rgba(240,168,104,${0.3 + r2() * 0.4})`;
          g.fillRect(x + 3 + r2() * (w - 8), hz - h + 4 + r2() * Math.max(2, h - 10), 1.5, 1.5);
        }
        g.fillStyle = grad;
      }
      if (h > layer.max * 0.85) {
        g.fillStyle = "rgba(232,99,122,0.8)";
        g.fillRect(x + w / 2 - 1, hz - h - 3, 2, 2);
        g.fillStyle = grad;
      }
      x += w + r2() * 10;
    }
  }
  return tex(c, { mipmaps: false });
}

export interface SignLine {
  text: string;
  size: number;
  color: string;
  y: number;
  weight?: number;
  align?: CanvasTextAlign;
  x?: number;
}

/** A flat sign: background, optional border, and lines of text. Size in pixels; the plane it is applied to sets the real size. */
export function makeSignTexture(w: number, h: number, bg: string, border: string | null, lines: SignLine[], anisotropy = 4): THREE.CanvasTexture {
  const { c, g } = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(4, w / 90);
    g.strokeRect(g.lineWidth * 1.2, g.lineWidth * 1.2, w - g.lineWidth * 2.4, h - g.lineWidth * 2.4);
  }
  g.textBaseline = "middle";
  for (const l of lines) {
    g.font = `${l.weight ?? 700} ${l.size}px ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif`;
    g.fillStyle = l.color;
    g.textAlign = l.align ?? "center";
    g.fillText(l.text, l.x ?? w / 2, l.y);
  }
  return tex(c, { anisotropy });
}

/** Checkered strip for the finish line: `cols` x `rows` squares. */
export function makeCheckerTexture(cols: number, rows: number, anisotropy: number): THREE.CanvasTexture {
  const s = 20;
  const { c, g } = canvas(cols * s, rows * s);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      g.fillStyle = (r + k) % 2 === 0 ? hex(PAL.text0) : hex(PAL.ink950);
      g.fillRect(k * s, r * s, s, s);
    }
  }
  return tex(c, { anisotropy });
}

/** Soft round glow (white centre to transparent edge) for lamp flares, light pools and dust. */
export function makeGlowTexture(power = 2): THREE.CanvasTexture {
  const { c, g } = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  const stops = 8;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    grad.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, power).toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return tex(c, { mipmaps: false });
}

/** Light cast on the road by the headlights: a bright patch fading with distance (texture "up" = forward). */
export function makeHeadlightPoolTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 256);
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, "rgba(255,246,220,0.0)");
  grad.addColorStop(0.1, "rgba(255,246,220,0.85)");
  grad.addColorStop(1, "rgba(255,246,220,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(46, 256);
  g.lineTo(0, 0);
  g.lineTo(128, 0);
  g.lineTo(82, 256);
  g.closePath();
  g.fill();
  // soften the sides
  g.globalCompositeOperation = "destination-in";
  const side = g.createLinearGradient(0, 0, 128, 0);
  side.addColorStop(0, "rgba(0,0,0,0)");
  side.addColorStop(0.3, "rgba(0,0,0,1)");
  side.addColorStop(0.7, "rgba(0,0,0,1)");
  side.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = side;
  g.fillRect(0, 0, 128, 256);
  return tex(c, { mipmaps: false });
}

/** Dark soft blob for the shadow under the car. */
export function makeBlobShadowTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(64, 128);
  g.save();
  g.translate(32, 64);
  g.scale(1, 2);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  rg.addColorStop(0, "rgba(0,0,0,0.75)");
  rg.addColorStop(0.6, "rgba(0,0,0,0.45)");
  rg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rg;
  g.fillRect(-32, -32, 64, 64);
  g.restore();
  return tex(c, { mipmaps: false });
}

/** Lit shop front for the gas station's convenience store. */
export function makeStorefrontTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 96);
  g.fillStyle = "#1c2430";
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = hex(PAL.signal);
  g.fillRect(0, 0, 256, 10);
  const rnd = mulberry32(31);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = "#ffe2ae";
    g.fillRect(10 + i * 62, 22, 52, 56);
    g.fillStyle = "rgba(240,168,104,0.55)";
    for (let k = 0; k < 4; k++) g.fillRect(14 + i * 62, 28 + k * 12, 44, 3 + rnd() * 3);
  }
  return tex(c, { anisotropy: 4 });
}
