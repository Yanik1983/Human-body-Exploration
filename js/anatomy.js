// הצורות של הגוף, השלד והאיברים, בנויות מ"שדות מרחק" (SDF): לכל נקודה במרחב מחשבים כמה היא רחוקה מפני השטח.
// צורות פשוטות (כדורים, אליפסואידים, קפסולות) מתחברות זו לזו בחיבור רך, כמו פלסטלינה,
// ואחר כך שיטת Surface Nets הופכת את השדה לרשת של משולשים.
// הקובץ רץ ב־Web Worker (anatomy-worker.js), כדי שהדף לא ייתקע בזמן הבנייה.

import {
  JOINT, FINGERS, VERTEBRAE, spineZ, HEAD, EYES, BRAIN, HEART, STOMACH, DUODENUM, COLON, KIDNEYS, BLADDER, LIVER,
} from './body-plan.js';

// ---------- מתמטיקה ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => mul3(a, 1 / Math.hypot(a[0], a[1], a[2]));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) {
  return -smin(-a, -b, k);
}

// רעש חלק (value noise) בתלת־ממד – בשביל הקפלים של המוח
function hash(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    r += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r * 2 - 1;
}

// מטריצת סיבוב מבסיס של שלושה צירים (השורות הן הצירים המקומיים)
function basis(u, v) {
  const x = norm3(u);
  const z = norm3(cross3(x, v));
  const y = cross3(z, x);
  return [x, y, z];
}
const toLocal = (R, p) => [dot3(R[0], p), dot3(R[1], p), dot3(R[2], p)];

// ---------- צורות בסיס ----------
// לכל צורה: d(x, y, z) – המרחק, ו־box – התיבה שמכילה אותה (כדי לחשב רק בסביבה שלה)
function sphere(c, r) {
  return { d: (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r, box: [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r] };
}

function ellipsoid(c, r, R = null) {
  const m = Math.max(...r);
  return {
    d: (x, y, z) => {
      let p = [x - c[0], y - c[1], z - c[2]];
      if (R) p = toLocal(R, p);
      const a = p[0] / r[0], b = p[1] / r[1], e = p[2] / r[2];
      const k0 = Math.sqrt(a * a + b * b + e * e);
      const k1 = Math.sqrt((a / r[0]) ** 2 + (b / r[1]) ** 2 + (e / r[2]) ** 2);
      return k1 === 0 ? -m : (k0 * (k0 - 1)) / k1;
    },
    box: [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m],
  };
}

// קפסולה מתחדדת בין a ל־b (רדיוס r1 ב־a ו־r2 ב־b)
function cone(a, b, r1, r2 = r1) {
  const ba = sub3(b, a);
  const l2 = dot3(ba, ba);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const sg = Math.sign(rr);
  const m = Math.max(r1, r2);
  return {
    d: (x, y, z) => {
      const pa0 = x - a[0], pa1 = y - a[1], pa2 = z - a[2];
      const yy = pa0 * ba[0] + pa1 * ba[1] + pa2 * ba[2];
      const zz = yy - l2;
      const xv0 = pa0 * l2 - ba[0] * yy, xv1 = pa1 * l2 - ba[1] * yy, xv2 = pa2 * l2 - ba[2] * yy;
      const x2 = xv0 * xv0 + xv1 * xv1 + xv2 * xv2;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = sg * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    },
    box: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m],
  };
}

// תיבה עם פינות עגולות, אפשר מסובבת
function rbox(c, half, r, R = null) {
  const m = Math.hypot(...half) + r;
  return {
    d: (x, y, z) => {
      let p = [x - c[0], y - c[1], z - c[2]];
      if (R) p = toLocal(R, p);
      const q0 = Math.abs(p[0]) - half[0], q1 = Math.abs(p[1]) - half[1], q2 = Math.abs(p[2]) - half[2];
      return Math.hypot(Math.max(q0, 0), Math.max(q1, 0), Math.max(q2, 0)) + Math.min(Math.max(q0, q1, q2), 0) - r;
    },
    box: [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m],
  };
}

// צינור לאורך שרשרת נקודות [x, y, z, r?] – קפסולות מחוברות. radius(t) אופציונלי (t = 0..1 לאורך הצינור)
function tube(points, r, radius = null) {
  const pts = smoothPath(points, 6);
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(...sub3(pts[i], pts[i - 1]).slice(0, 3)));
  const L = lens[lens.length - 1];
  const parts = [];
  for (let i = 1; i < pts.length; i++) {
    const ra = radius ? radius(lens[i - 1] / L, lens[i - 1]) : pts[i - 1][3] ?? r;
    const rb = radius ? radius(lens[i] / L, lens[i]) : pts[i][3] ?? r;
    parts.push(cone(pts[i - 1].slice(0, 3), pts[i].slice(0, 3), ra, rb));
  }
  return parts;
}

// מחליק שרשרת נקודות (Catmull-Rom), כולל רדיוס אם יש
function smoothPath(points, steps) {
  if (points.length < 3) return points;
  const out = [];
  const n = points[0].length;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const q = [];
      for (let k = 0; k < n; k++) {
        q.push(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
      }
      out.push(q);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// ---------- רשת הערכים ----------
const FAR = 1;

class Grid {
  constructor(min, max, cell) {
    this.min = min;
    this.cell = cell;
    this.n = [0, 1, 2].map((k) => Math.ceil((max[k] - min[k]) / cell) + 1);
    this.v = new Float32Array(this.n[0] * this.n[1] * this.n[2]).fill(FAR);
  }

  // מריץ fn על כל נקודות הרשת שבתוך התיבה (ועוד שוליים)
  each(box, pad, fn) {
    const { min, cell, n, v } = this;
    const lo = [0, 1, 2].map((k) => clamp(Math.floor((box[k] - pad - min[k]) / cell), 0, n[k] - 1));
    const hi = [0, 1, 2].map((k) => clamp(Math.ceil((box[k + 3] + pad - min[k]) / cell), 0, n[k] - 1));
    for (let k = lo[2]; k <= hi[2]; k++) {
      const z = min[2] + k * cell;
      for (let j = lo[1]; j <= hi[1]; j++) {
        const y = min[1] + j * cell;
        let idx = lo[0] + n[0] * (j + n[1] * k);
        for (let i = lo[0]; i <= hi[0]; i++, idx++) v[idx] = fn(v[idx], min[0] + i * cell, y, z);
      }
    }
  }

  add(shapes, k = 0) {
    for (const s of [].concat(shapes)) {
      this.each(s.box, k + this.cell * 3, k > 0 ? (cur, x, y, z) => smin(cur, s.d(x, y, z), k) : (cur, x, y, z) => Math.min(cur, s.d(x, y, z)));
    }
    return this;
  }

  sub(shapes, k = 0) {
    for (const s of [].concat(shapes)) {
      this.each(s.box, k + this.cell * 3, k > 0 ? (cur, x, y, z) => smax(cur, -s.d(x, y, z), k) : (cur, x, y, z) => Math.max(cur, -s.d(x, y, z)));
    }
    return this;
  }

  // שינוי כללי של הערכים (למשל קפלים או חיתוך)
  map(fn, box = null) {
    const { min, n, cell } = this;
    const b = box || [min[0], min[1], min[2], min[0] + (n[0] - 1) * cell, min[1] + (n[1] - 1) * cell, min[2] + (n[2] - 1) * cell];
    this.each(b, 0, fn);
    return this;
  }

  sample(x, y, z) {
    const { min, cell, n, v } = this;
    const fx = clamp((x - min[0]) / cell, 0, n[0] - 1.001), fy = clamp((y - min[1]) / cell, 0, n[1] - 1.001), fz = clamp((z - min[2]) / cell, 0, n[2] - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const nx = n[0], nxy = n[0] * n[1];
    const o = i + nx * j + nxy * k;
    const c00 = v[o] * (1 - tx) + v[o + 1] * tx;
    const c10 = v[o + nx] * (1 - tx) + v[o + nx + 1] * tx;
    const c01 = v[o + nxy] * (1 - tx) + v[o + nxy + 1] * tx;
    const c11 = v[o + nxy + nx] * (1 - tx) + v[o + nxy + nx + 1] * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  }
}

// ---------- Surface Nets: מהשדה לרשת משולשים ----------
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

// colorFn(x, y, z) → [r, g, b] (0..1) צובע כל נקודה; בלי צבע מקבלים לבן. בכל מקרה הצבע מוכפל בהצללה של
// הקפלים והשקעים (Ambient Occlusion), שמחושבת מהשדה עצמו: כמה פני השטח "סגורים" סביב הנקודה
function surfaceNet(grid, iso = 0, colorFn = null) {
  const { n, v, min, cell } = grid;
  const [nx, ny, nz] = n;
  const nxy = nx * ny;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const val = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const o = i + nx * j + nxy * k;
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const C = CORNERS[c];
      val[c] = v[o + C[0] + nx * C[1] + nxy * C[2]] - iso;
      if (val[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of EDGES) {
      const va = val[a], vb = val[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const A = CORNERS[a], B = CORNERS[b];
      sx += A[0] + (B[0] - A[0]) * t;
      sy += A[1] + (B[1] - A[1]) * t;
      sz += A[2] + (B[2] - A[2]) * t;
      cnt++;
    }
    cellVert[i + cx * (j + cy * k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / cnt) * cell, min[1] + (j + sy / cnt) * cell, min[2] + (k + sz / cnt) * cell);
  }
  // כל צלע של הרשת שחוצה את פני השטח הופכת לריבוע בין ארבעת התאים שמסביבה
  const idx = [];
  const cv = (i, j, k) => cellVert[i + cx * (j + cy * k)];
  const quad = (a, b, c, d, flip) => {
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const o = i + nx * j + nxy * k;
    const inside = v[o] - iso < 0;
    if (j > 0 && k > 0 && (v[o + 1] - iso < 0) !== inside) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !inside);
    if (i > 0 && k > 0 && (v[o + nx] - iso < 0) !== inside) quad(cv(i - 1, j, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i - 1, j, k), inside);
    if (i > 0 && j > 0 && (v[o + nxy] - iso < 0) !== inside) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !inside);
  }
  // נורמלים מהשיפוע של השדה (פני שטח חלקים גם ברשת גסה)
  const nor = new Float32Array(pos.length);
  const h = cell * 0.75;
  for (let q = 0; q < pos.length; q += 3) {
    const x = pos[q], y = pos[q + 1], z = pos[q + 2];
    const gx = grid.sample(x + h, y, z) - grid.sample(x - h, y, z);
    const gy = grid.sample(x, y + h, z) - grid.sample(x, y - h, z);
    const gz = grid.sample(x, y, z + h) - grid.sample(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    nor[q] = gx / l;
    nor[q + 1] = gy / l;
    nor[q + 2] = gz / l;
  }
  const col = new Uint8Array(pos.length);
  for (let q = 0; q < pos.length; q += 3) {
    const x = pos[q], y = pos[q + 1], z = pos[q + 2];
    let occ = 0;
    for (let s = 1, w = 0.5; s <= 4; s++, w *= 0.5) {
      const d = cell * 1.6 * s;
      occ += w * Math.max(0, d - (grid.sample(x + nor[q] * d, y + nor[q + 1] * d, z + nor[q + 2] * d) - iso)) / d;
    }
    const ao = clamp(1 - 1.4 * occ, 0.35, 1);
    const c = colorFn ? colorFn(x, y, z) : [1, 1, 1];
    for (let k = 0; k < 3; k++) col[q + k] = Math.round(clamp(c[k] * ao, 0, 1) * 255);
  }
  return { position: new Float32Array(pos), normal: nor, color: col, index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
}

// ---------- הגוף ----------
const MIRROR = [1, -1];

function bodyShapes() {
  const S = [];
  const [hx, hy, hz] = HEAD.c;
  S.push(ellipsoid(HEAD.c, HEAD.r));
  S.push(ellipsoid([0, 1.565, 0.03], [0.058, 0.055, 0.062])); // לסת וסנטר
  S.push(cone([0, 1.648, 0.098], [0, 1.607, 0.113], 0.008, 0.013)); // אף
  for (const s of MIRROR) S.push(ellipsoid([s * 0.077, 1.632, -0.004], [0.012, 0.028, 0.018])); // אוזניים
  S.push(cone([0, 1.42, -0.008], [0, 1.57, -0.002], 0.055)); // צוואר
  S.push(ellipsoid([0, 1.29, -0.005], [0.165, 0.17, 0.11])); // חזה
  S.push(ellipsoid([0, 1.17, 0.0], [0.15, 0.1, 0.105]));
  S.push(ellipsoid([0, 1.06, 0.0], [0.135, 0.1, 0.095])); // מותניים
  S.push(ellipsoid([0, 0.985, 0.012], [0.145, 0.09, 0.1])); // בטן
  S.push(ellipsoid([0, 0.93, -0.005], [0.165, 0.095, 0.1])); // אגן
  for (const s of MIRROR) {
    S.push(ellipsoid([s * 0.07, 0.885, -0.05], [0.075, 0.075, 0.06])); // ישבן
    S.push(cone([s * 0.03, 1.43, -0.015], [s * 0.17, 1.41, -0.015], 0.045)); // כתפיים
    S.push(sphere([s * 0.178, 1.385, -0.012], 0.053));
  }
  return S;
}

function limbShapes(s) {
  const S = [];
  const sh = JOINT.shoulder(s), el = JOINT.elbow(s), wr = JOINT.wrist(s);
  S.push(cone(sh, el, 0.046, 0.036));
  S.push(cone(el, lerp3(el, wr, 0.35), 0.039, 0.033));
  S.push(cone(lerp3(el, wr, 0.35), wr, 0.033, 0.024));
  // כף היד והאצבעות (האגודל קדימה)
  const R = basis([0, 0, 1], [0, 1, 0]);
  S.push(rbox([s * 0.29, 0.838, 0.004], [0.006, 0.036, 0.03], 0.009, R));
  for (const f of FINGERS) S.push(cone([s * 0.292, 0.81, f.z], [s * 0.299, 0.81 - f.len, f.z * 0.92], 0.0085, 0.0068));
  S.push(cone([s * 0.285, 0.86, 0.028], [s * 0.283, 0.8, 0.052], 0.011, 0.008));
  const hp = JOINT.hip(s), kn = JOINT.knee(s), an = JOINT.ankle(s);
  S.push(cone(hp, kn, 0.085, 0.052));
  S.push(sphere(kn, 0.05));
  S.push(cone(kn, an, 0.048, 0.03));
  S.push(ellipsoid([s * 0.1, 0.36, -0.016], [0.045, 0.09, 0.043])); // שריר התאומים
  S.push(sphere([s * 0.105, 0.035, -0.035], 0.035)); // עקב
  S.push(ellipsoid([s * 0.11, 0.032, 0.05], [0.042, 0.032, 0.085]));
  S.push(cone([s * 0.11, 0.026, 0.1], [s * 0.115, 0.02, 0.15], 0.022, 0.017));
  return S;
}

function buildBody(cell) {
  const g = new Grid([-0.36, -0.01, -0.16], [0.36, 1.77, 0.2], cell);
  g.add(bodyShapes(), 0.045);
  for (const s of MIRROR) g.add(limbShapes(s), 0.018);
  g.map((v, x, y) => Math.max(v, 0.002 - y)); // כפות רגליים שטוחות
  return g;
}

// ---------- השלד ----------
function skullShapes(G) {
  G.add(ellipsoid([0, 1.655, -0.004], [0.071, 0.083, 0.094]));
  G.add([ellipsoid([0, 1.6, 0.042], [0.054, 0.04, 0.048]), ...MIRROR.map((s) => cone([s * 0.05, 1.615, 0.05], [s * 0.066, 1.62, 0.0], 0.007))], 0.012);
  // הלסת התחתונה: צורת U
  const jaw = [];
  for (const s of MIRROR) {
    jaw.push(cone([s * 0.046, 1.545, 0.02], [s * 0.012, 1.534, 0.07], 0.009, 0.01));
    jaw.push(cone([s * 0.046, 1.545, 0.02], [s * 0.06, 1.553, -0.006], 0.009));
    jaw.push(cone([s * 0.06, 1.553, -0.006], [s * 0.063, 1.605, -0.012], 0.008));
  }
  jaw.push(sphere([0, 1.533, 0.072], 0.011));
  G.add(jaw, 0.008);
  G.sub(EYES.map((e) => sphere([e.c[0], e.c[1], e.c[2] - 0.004], 0.019)), 0.006);
  G.sub(ellipsoid([0, 1.605, 0.086], [0.011, 0.017, 0.02]), 0.004);
}

function torsoBones(G) {
  // חוליות עמוד השדרה
  for (const v of VERTEBRAE) {
    const z = spineZ(v.y);
    const d = v.w * 0.8;
    G.add(ellipsoid([0, v.y, z], [v.w, v.h / 2, d]));
    const back = z - d;
    const tip = v.kind === 't' ? [0, v.y - 0.02, back - 0.03] : [0, v.y - 0.006, back - (v.kind === 'c' ? 0.018 : 0.03)];
    G.add([cone([0, v.y, back + 0.004], tip, 0.0045, 0.004), ...MIRROR.map((s) => cone([s * v.w * 0.5, v.y, back], [s * (v.w + 0.018), v.y, back - 0.008], 0.004, 0.0035))], 0.004);
  }
  // עצם העצה והזנב
  G.add(ellipsoid([0, 0.93, -0.062], [0.038, 0.05, 0.016], basis([1, 0, 0], [0, 1, 0.45])));
  G.add(cone([0, 0.885, -0.078], [0, 0.862, -0.068], 0.006, 0.004));
  // עצם החזה
  G.add(rbox([0, 1.395, 0.09], [0.022, 0.018, 0.004], 0.004), 0.004);
  G.add(rbox([0, 1.3, 0.097], [0.014, 0.075, 0.004], 0.004, basis([1, 0, 0], [0, 1, 0.12])), 0.006);
  // צלעות
  const A = [0.07, 0.095, 0.112, 0.125, 0.135, 0.142, 0.146, 0.147, 0.145, 0.14, 0.128, 0.115];
  const B = [0.06, 0.072, 0.082, 0.09, 0.095, 0.098, 0.1, 0.1, 0.098, 0.095, 0.09, 0.085];
  const DROP = [0.03, 0.05, 0.065, 0.075, 0.085, 0.09, 0.095, 0.1, 0.1, 0.095, 0.06, 0.04];
  for (let i = 0; i < 12; i++) {
    const yb = 1.405 - i * 0.0255;
    const zs = spineZ(yb);
    const end = i < 10 ? 0.78 * Math.PI : (i === 10 ? 0.55 : 0.45) * Math.PI;
    for (const s of MIRROR) {
      const pts = [[s * 0.014, yb, zs - 0.006]];
      for (let f = 0.3; f <= end + 1e-6; f += (end - 0.3) / 10) {
        pts.push([s * A[i] * Math.sin(f), yb - DROP[i] * sstep(0, end, f), -0.005 - B[i] * Math.cos(f)]);
      }
      G.add(tube(pts, 0.0058), 0.004);
      if (i < 10) {
        // סחוס: מקצה הצלע אל עצם החזה (שבע הראשונות) או אל הסחוס של הצלע שמעליה
        const last = pts[pts.length - 1];
        const target = i < 7 ? [s * 0.016, 1.375 - i * 0.026, 0.093] : [s * (0.035 + 0.012 * (i - 6)), 1.2 - 0.022 * (i - 6), 0.088];
        G.add(tube([last, lerp3(last, target, 0.5).map((c, k) => (k === 2 ? c + 0.01 : c)), target], 0.005), 0.004);
      }
    }
  }
  for (const s of MIRROR) {
    // עצם הבריח
    G.add(tube([[s * 0.02, 1.42, 0.085], [s * 0.08, 1.432, 0.065], [s * 0.165, 1.428, -0.008]], 0.0065), 0.004);
    // השכמה
    const R = basis([s * 0.9, 0, -s * 0.45], [0, 1, 0]);
    G.add([ellipsoid([s * 0.1, 1.335, -0.088], [0.045, 0.062, 0.005], R), cone([s * 0.05, 1.37, -0.098], [s * 0.165, 1.415, -0.045], 0.005), cone([s * 0.135, 1.36, -0.075], [s * 0.165, 1.39, -0.03], 0.01)], 0.008);
    // האגן
    const ilium = basis([s * 0.1, 0, 0.1], [0, 1, 0]);
    G.add([ellipsoid([s * 0.08, 0.99, -0.02], [0.07, 0.05, 0.009], ilium), sphere([s * 0.082, 0.935, 0.005], 0.03),
      cone([s * 0.075, 0.925, 0.03], [s * 0.01, 0.9, 0.062], 0.011), cone([s * 0.075, 0.915, -0.01], [s * 0.06, 0.868, -0.022], 0.013),
      cone([s * 0.06, 0.868, -0.022], [s * 0.01, 0.884, 0.055], 0.008)], 0.012);
    G.sub(sphere([s * 0.082, 0.935, 0.005], 0.022));
  }
}

function armBones(G, s) {
  G.add([sphere([s * 0.178, 1.39, -0.018], 0.022), cone([s * 0.183, 1.37, -0.02], [s * 0.235, 1.15, -0.03], 0.011, 0.012), ellipsoid([s * 0.24, 1.13, -0.03], [0.026, 0.012, 0.016])], 0.01);
  G.add([cone([s * 0.236, 1.14, -0.04], [s * 0.272, 0.89, -0.008], 0.011, 0.007), sphere([s * 0.236, 1.145, -0.046], 0.012)], 0.006);
  G.add(cone([s * 0.25, 1.12, -0.02], [s * 0.283, 0.89, 0.012], 0.008, 0.011));
  G.add(ellipsoid([s * 0.287, 0.87, 0.005], [0.011, 0.013, 0.021]));
  for (const f of FINGERS) {
    const base = [s * 0.29, 0.858, f.z * 0.7], k = [s * 0.293, 0.81, f.z], tip = [s * 0.299, 0.81 - f.len + 0.006, f.z * 0.92];
    G.add([cone(base, k, 0.004, 0.0045), cone(k, lerp3(k, tip, 0.5), 0.0042, 0.0038), cone(lerp3(k, tip, 0.5), tip, 0.0036, 0.003)], 0.002);
  }
  G.add([cone([s * 0.286, 0.86, 0.018], [s * 0.285, 0.825, 0.04], 0.0048), cone([s * 0.285, 0.825, 0.04], [s * 0.283, 0.795, 0.053], 0.0042)], 0.002);
}

function legBones(G, s) {
  G.add([sphere([s * 0.082, 0.935, 0.005], 0.021), cone([s * 0.082, 0.935, 0.005], [s * 0.12, 0.905, 0.0], 0.012), sphere([s * 0.13, 0.915, -0.005], 0.015),
    cone([s * 0.122, 0.9, 0.0], [s * 0.103, 0.54, 0.012], 0.013, 0.014), sphere([s * 0.083, 0.515, 0.008], 0.02), sphere([s * 0.118, 0.515, 0.008], 0.02)], 0.012);
  G.add(ellipsoid([s * 0.1, 0.52, 0.052], [0.018, 0.023, 0.009]));
  G.add([ellipsoid([s * 0.1, 0.48, 0.008], [0.034, 0.012, 0.027]), cone([s * 0.1, 0.475, 0.01], [s * 0.104, 0.11, -0.012], 0.015, 0.012), sphere([s * 0.087, 0.085, -0.012], 0.012)], 0.012);
  G.add([cone([s * 0.128, 0.47, 0.0], [s * 0.13, 0.09, -0.02], 0.007, 0.006), sphere([s * 0.128, 0.08, -0.02], 0.011)], 0.006);
  G.add([sphere([s * 0.105, 0.06, -0.012], 0.019), ellipsoid([s * 0.105, 0.03, -0.042], [0.017, 0.019, 0.03]), ellipsoid([s * 0.11, 0.045, 0.028], [0.03, 0.015, 0.028])], 0.01);
  for (let t = 0; t < 5; t++) {
    const o = -0.024 + t * 0.012;
    const m0 = [s * (0.105 + o), 0.036, 0.045], m1 = [s * (0.105 + o * 1.3), 0.018, 0.11], toe = [s * (0.105 + o * 1.35), 0.014, t === 0 ? 0.15 : 0.142 - t * 0.004];
    const r = t === 0 ? 0.0075 : 0.0055;
    G.add([cone(m0, m1, r), cone(m1, toe, r * 0.9, r * 0.75)], 0.003);
  }
}

// ---------- האיברים ----------
function brain(G) {
  const R = BRAIN.r;
  G.add(ellipsoid(BRAIN.c, R));
  // הסדק בין שתי ההמיספרות
  G.map((v, x, y) => (y > BRAIN.c[1] - 0.025 ? smax(v, 0.0028 - Math.abs(x), 0.002) : v));
  // הקפלים: תלמים לאורך הקווים שבהם הרעש עובר דרך אפס
  G.map((v, x, y, z) => {
    if (Math.abs(v) > 0.008) return v;
    const nn = noise(x * 55 + 3, y * 55, z * 55) + 0.5 * noise(x * 110, y * 110 + 7, z * 110);
    return v + 0.0032 * sstep(0.72, 1, 1 - Math.abs(nn));
  });
  // המוח הקטן וגזע המוח
  const cb = ellipsoid([0, 1.607, -0.058], [0.048, 0.026, 0.034]);
  G.add(cb, 0.006);
  G.map((v, x, y, z) => (cb.d(x, y, z) < 0.004 && y < 1.625 ? v + 0.0012 * (0.5 + 0.5 * Math.sin(y * 900)) : v), [-0.06, 1.57, -0.1, 0.06, 1.64, -0.02]);
  G.add(cone([0, 1.63, -0.03], [0, 1.52, -0.034], 0.013, 0.01), 0.008);
}

function heartShapes() {
  const c = HEART.c;
  const down = norm3(sub3(HEART.apex, c));
  const R = basis([1, 0, 0.2], mul3(down, -1));
  const w = (p) => add3(c, [R[0][0] * p[0] + R[1][0] * p[1] + R[2][0] * p[2], R[0][1] * p[0] + R[1][1] * p[1] + R[2][1] * p[2], R[0][2] * p[0] + R[1][2] * p[1] + R[2][2] * p[2]]);
  // שני חדרים גדולים למטה (החדר הימני בולט קדימה), שתי עליות למעלה, וחוד שפונה שמאלה ולמטה
  return [
    cone(w([0.006, 0.008, 0]), w([0.004, -0.05, 0.004]), 0.034, 0.01),
    cone(w([-0.012, 0.004, 0.014]), w([-0.002, -0.042, 0.012]), 0.03, 0.012),
    sphere(w([0.024, 0.03, -0.014]), 0.024),
    sphere(w([-0.026, 0.026, -0.006]), 0.026),
  ];
}

function lungs(G) {
  for (const s of MIRROR) {
    const c = [s * 0.083, 1.295, -0.008];
    const shape = [ellipsoid(c, [0.066, 0.13, 0.086]), ellipsoid([s * 0.072, 1.39, -0.01], [0.04, 0.05, 0.045])];
    G.add(shape, 0.03);
  }
  // בסיס קעור מעל הסרעפת, צד פנימי ישר, ומקום ללב
  for (const s of MIRROR) G.sub(sphere([s * 0.083, 1.03, 0.0], 0.14), 0.01);
  G.map((v, x) => smax(v, 0.018 - Math.abs(x), 0.01));
  G.sub(heartShapes().map((h) => ({ d: (x, y, z) => h.d(x, y, z) - 0.008, box: h.box.map((b, i) => b + (i < 3 ? -0.008 : 0.008)) })), 0.01);
  // סדקים בין האונות: שתיים בריאה הימנית, אחת בשמאלית
  // רק חריץ על פני השטח (לא חיתוך דרך כל הריאה), כדי שלא ייווצרו מדרגות בתוך הריאה השקופה
  const fissure = (s, p, nrm) => G.map((v, x, y, z) => (Math.sign(x) === s && v > -0.012 ? smax(v, Math.min(0.005 - Math.abs(dot3(sub3([x, y, z], p), nrm)), v + 0.012), 0.002) : v));
  fissure(1, [0.08, 1.29, 0], norm3([0, 1, 0.9]));
  fissure(-1, [-0.08, 1.31, 0], norm3([0, 1, 0.9]));
  fissure(-1, [-0.08, 1.26, 0.05], norm3([0, 1, -0.3]));
}

function stomachShapes() {
  return tube(STOMACH, 0);
}

export function liverShapes() {
  return ellipsoid(LIVER.c, LIVER.r);
}

function liver(G) {
  G.add(liverShapes());
  // האונה השמאלית דקה יותר: חותכים במישור שיורד לכיוון שמאל
  const n = norm3([0.35, 1, 0]);
  const p0 = [-0.035, 1.19, 0.02];
  G.map((v, x, y, z) => smax(v, dot3(sub3([x, y, z], p0), n), 0.02));
  G.sub(stomachShapes().map((h) => ({ d: (x, y, z) => h.d(x, y, z) - 0.004, box: h.box })), 0.01);
  G.sub(sphere([-0.083, 1.06, 0.0], 0.13), 0.01); // מתחת לסרעפת
}

function smallIntestine(G) {
  G.add(tube(DUODENUM, 0.012), 0.004);
  // המעי הדק מתקפל הלוך ושוב בשתי שכבות, עם גלים קטנים
  const pts = [DUODENUM[DUODENUM.length - 1]];
  let dir = 1;
  for (const z of [0.03, 0.062]) {
    for (let row = 0; row < 5; row++) {
      const y = 0.99 - row * 0.02 - (z > 0.05 ? 0.01 : 0);
      for (let q = 0; q <= 12; q++) {
        const t = q / 12;
        const x = (dir > 0 ? -0.07 + t * 0.14 : 0.07 - t * 0.14) * (1 - row * 0.04);
        pts.push([x, y + 0.008 * Math.sin(q * 2.2 + row), z + 0.01 * Math.cos(q * 1.7 + row)]);
      }
      dir = -dir;
    }
  }
  pts.push([-0.075, 0.915, 0.04], COLON[0]);
  G.add(tube(pts, 0.0105), 0.003);
}

function colon(G) {
  // המעי הגס עם "כיסים" (הוסטרות) לאורכו
  G.add(tube(COLON, 0, (t, l) => (t > 0.85 ? 0.017 : 0.021) * (1 + 0.12 * Math.sin(l * 2 * Math.PI / 0.032))), 0.004);
  G.add(cone([-0.082, 0.905, 0.038], [-0.078, 0.885, 0.04], 0.02, 0.012), 0.006); // התוספתן ותחילת המעי
  G.add(cone([-0.078, 0.885, 0.04], [-0.07, 0.865, 0.03], 0.004), 0.003);
}

function kidneys(G) {
  for (const k of KIDNEYS) {
    const R = basis([1, 0, 0], [-k.s * 0.18, 1, 0]);
    G.add(ellipsoid(k.c, [0.026, 0.05, 0.02], R));
    G.sub(sphere(k.hilum, 0.013), 0.008);
  }
}

// ---------- רשימת החלקים ----------
// cell – גודל התא ברשת (קטן יותר = יותר פרטים, יותר עבודה). q מאפשר להגדיל את כולם במכשיר חלש
export const PARTS = [
  { id: 'body', grids: [{ min: [-0.36, -0.01, -0.16], max: [0.36, 1.77, 0.2], cell: 0.005, build: null }] },
  { id: 'heart', grids: [{ min: [-0.06, 1.17, -0.04], max: [0.1, 1.34, 0.12], cell: 0.0025, build: (G) => G.add(heartShapes(), 0.014) }] },
  { id: 'lungs', grids: [{ min: [-0.17, 1.13, -0.11], max: [0.17, 1.46, 0.1], cell: 0.0035, build: lungs }] },
  { id: 'brain', grids: [{ min: [-0.075, 1.5, -0.1], max: [0.075, 1.74, 0.085], cell: 0.0022, build: brain }] },
  { id: 'stomach', grids: [{ min: [-0.05, 1.0, -0.05], max: [0.13, 1.21, 0.1], cell: 0.003, build: (G) => G.add(stomachShapes(), 0.02) }] },
  { id: 'liver', grids: [{ min: [-0.16, 1.06, -0.07], max: [0.1, 1.22, 0.11], cell: 0.0035, build: liver }] },
  { id: 'smallIntestine', grids: [{ min: [-0.1, 0.88, -0.01], max: [0.1, 1.08, 0.09], cell: 0.0028, build: smallIntestine }] },
  { id: 'colon', grids: [{ min: [-0.13, 0.83, -0.06], max: [0.14, 1.07, 0.1], cell: 0.0032, build: colon }] },
  { id: 'kidneys', grids: [{ min: [-0.11, 0.99, -0.08], max: [0.11, 1.13, -0.01], cell: 0.0025, build: kidneys }] },
  { id: 'bladder', grids: [{ min: [-0.05, 0.83, 0.0], max: [0.05, 0.92, 0.08], cell: 0.003, build: (G) => G.add(ellipsoid(BLADDER.c, BLADDER.r)) }] },
  { id: 'skeleton', grids: [
    { min: [-0.085, 1.5, -0.11], max: [0.085, 1.75, 0.1], cell: 0.003, build: skullShapes },
    { min: [-0.2, 0.84, -0.12], max: [0.2, 1.58, 0.12], cell: 0.0032, build: torsoBones },
    ...MIRROR.flatMap((s) => [
      { min: [s > 0 ? 0.15 : -0.33, 0.7, -0.08], max: [s > 0 ? 0.33 : -0.15, 1.43, 0.08], cell: 0.003, build: (G) => armBones(G, s) },
      { min: [s > 0 ? 0.04 : -0.17, -0.005, -0.08], max: [s > 0 ? 0.17 : -0.04, 0.96, 0.17], cell: 0.0035, build: (G) => legBones(G, s) },
    ]),
  ] },
];

// בונה חלק אחד ומחזיר את הרשתות שלו. q = מכפיל לגודל התא
export function buildPart(part, q = 1) {
  const out = [];
  for (const spec of part.grids) {
    if (part.id === 'body') {
      const G = buildBody(spec.cell * q);
      out.push({ ...surfaceNet(G), layer: 'skin' });
      out.push({ ...surfaceNet(G, -0.0045), layer: 'muscles' }); // השרירים: אותה צורה, קצת פנימה
      continue;
    }
    const G = new Grid(spec.min, spec.max, spec.cell * q);
    spec.build(G);
    out.push(surfaceNet(G, 0, spec.color));
  }
  return out;
}
