// הצורות של הגוף, השלד והאיברים, בנויות מ"שדות מרחק" (SDF): לכל נקודה במרחב מחשבים כמה היא רחוקה מפני השטח.
// צורות פשוטות (כדורים, אליפסואידים, קפסולות) מתחברות זו לזו בחיבור רך, כמו פלסטלינה,
// ואחר כך שיטת Surface Nets הופכת את השדה לרשת של משולשים.
// הקובץ רץ ב־Web Worker (anatomy-worker.js), כדי שהדף לא ייתקע בזמן הבנייה.

import {
  JOINT, FINGERS, VERTEBRAE, spineZ, HEAD, EYES, BRAIN, HEART, STOMACH, DUODENUM, COLON, KIDNEYS, BLADDER, LIVER, GALLBLADDER,
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

// אליפסואיד לאורך הקטע a→b (הציר y שלו בכיוון הקטע), בנקודה t על הקטע ועם הזזה off – לשרירים של הגפיים
const along = (a, b, t, off, r) => ellipsoid(add3(lerp3(a, b, t), off), r, basis(cross3(sub3(b, a), [0, 0, 1]), sub3(b, a)));

// הגו, הצוואר והראש, כקבוצות של [צורות, רכות החיבור]: מסות גדולות מתמזגות ברכות, ופרטים קטנים בחיבור חד יותר כדי שיישארו מוגדרים
function bodyShapes() {
  const torso = [
    ellipsoid(HEAD.c, HEAD.r), // הגולגולת
    ellipsoid([0, 1.625, -0.045], [0.066, 0.055, 0.062]), // העורף של הראש
    ellipsoid([0, 1.69, 0.04], [0.065, 0.05, 0.055]), // המצח
    cone([0, 1.42, -0.02], [0, 1.585, -0.012], 0.058, 0.05), // צוואר
    cone([0, 1.42, -0.04], [0, 1.6, -0.045], 0.04, 0.034),
    cone([0, 1.44, 0.018], [0, 1.545, 0.022], 0.032, 0.024), // גרון
    ellipsoid([0, 1.29, -0.004], [0.175, 0.165, 0.116]), // בית החזה
    ellipsoid([0, 1.155, -0.012], [0.16, 0.105, 0.107]),
    ellipsoid([0, 1.2, 0.05], [0.11, 0.05, 0.058]), // קשת הצלעות מלפנים
    rbox([0, 1.1, -0.005], [0.094, 0.06, 0.05], 0.045), // הבטן העליונה
    ellipsoid([0, 1.03, 0.0], [0.142, 0.1, 0.097]),
    ellipsoid([0, 0.94, -0.008], [0.165, 0.1, 0.105]), // אגן
    ellipsoid([0, 0.905, 0.025], [0.12, 0.085, 0.072]),
    ellipsoid([0, 1.36, -0.052], [0.16, 0.085, 0.058]), // הגב העליון, שהשכמות שטוחות עליו, רחב עד בית השחי
    ...MIRROR.flatMap((s) => [
      ellipsoid([s * 0.1, 1.325, -0.094], [0.058, 0.09, 0.022]), // השכמה
      ellipsoid([s * 0.065, 1.41, -0.07], [0.06, 0.06, 0.035]), // הטרפז שמכסה את ראש השכמה, כדי שלא יהיה מדף מעליה
      ellipsoid([s * 0.072, 0.885, -0.058], [0.072, 0.085, 0.07]), // ישבן; הרווח בין שניהם יוצר את הקפל
    ]),
  ];
  const muscles = [ellipsoid([0, 1.36, 0.075], [0.06, 0.06, 0.048])]; // עצם החזה
  // הפנים בשלוש רמות חיבור: המסות הרכות (לחיים, לסת), פרטים קטנים (גשר האף, שפתיים, סנטר), והאף עצמו
  const nose = [
    cone([0, 1.648, 0.092], [0, 1.607, 0.116], 0.007, 0.008), sphere([0, 1.601, 0.115], 0.0095),
    ellipsoid([0, 1.613, 0.096], [0.01, 0.028, 0.013]), // גוף האף, מחובר לפנים לכל אורכו
  ];
  const face = [
    ellipsoid([0, 1.665, 0.07], [0.06, 0.02, 0.028]), // קשת הגבות
    ellipsoid([0, 1.585, 0.04], [0.056, 0.055, 0.058]), // הלסת העליונה, עד קו הלסת
    ellipsoid([0, 1.565, 0.075], [0.034, 0.022, 0.024]), // סביב הפה
  ];
  const features = [
    ellipsoid([0, 1.628, 0.088], [0.011, 0.024, 0.012]), // גשר האף, שיורד בשיפוע אל הלחיים
    ellipsoid([0, 1.573, 0.096], [0.022, 0.0068, 0.009]), // שפתיים
    ellipsoid([0, 1.558, 0.094], [0.019, 0.0075, 0.009]),
    ellipsoid([0, 1.534, 0.088], [0.022, 0.017, 0.016]), // סנטר
  ];
  for (const s of MIRROR) {
    muscles.push(
      ellipsoid([s * 0.078, 1.35, 0.062], [0.08, 0.075, 0.048]), // שריר החזה
      cone([s * 0.054, 1.555, -0.008], [s * 0.042, 1.543, 0.021], 0.011), cone([s * 0.042, 1.543, 0.021], [s * 0.014, 1.53, 0.072], 0.011, 0.014), // קו הלסת
      ellipsoid([s * 0.075, 1.425, 0.0], [0.055, 0.035, 0.05]), // בסיס הצוואר, מעל קודקוד הריאה
      cone([s * 0.03, 1.36, -0.088], [s * 0.034, 0.98, -0.078], 0.026, 0.024), // שרירי הגב לאורך עמוד השדרה
      ellipsoid([s * 0.09, 1.22, -0.072], [0.065, 0.13, 0.038]), // הרחב הגבי, עד בית השחי
      ellipsoid([s * 0.036, 1.07, 0.075], [0.036, 0.12, 0.025]), // שרירי הבטן
      ellipsoid([s * 0.1, 0.97, 0.01], [0.055, 0.05, 0.075]), // המותן ועצם הכסל
      cone([s * 0.035, 1.49, -0.035], [s * 0.165, 1.425, -0.025], 0.032, 0.028), // הטרפז
      sphere([s * 0.15, 1.39, -0.025], 0.047),
      cone([s * 0.02, 1.425, 0.085], [s * 0.08, 1.437, 0.068], 0.0105), cone([s * 0.08, 1.437, 0.068], [s * 0.17, 1.43, -0.005], 0.0105, 0.012), // עצם הבריח
      cone([s * 0.06, 1.6, -0.03], [s * 0.022, 1.435, 0.068], 0.0095, 0.008), // השריר שמסובב את הראש
    );
    nose.push(ellipsoid([s * 0.0115, 1.599, 0.102], [0.0055, 0.0055, 0.008])); // כנפי האף
    face.push(
      ellipsoid([s * 0.034, 1.59, 0.03], [0.028, 0.05, 0.05]), // צד הפנים: הלחי ושריר הלעיסה
      ellipsoid([s * 0.046, 1.615, 0.055], [0.022, 0.013, 0.018]), // עצם הלחי
      ellipsoid([s * 0.05, 1.642, 0.052], [0.016, 0.022, 0.016]), // השוליים החיצוניים של ארובת העין
      ellipsoid([s * 0.05, 1.6, -0.005], [0.027, 0.04, 0.03]), // לפני האוזן: קשת עצם הלחי והלסת – כאן הפנים הכי רחבות
    );
  }
  return [[torso, 0.035], [muscles, 0.025], [face, 0.02], [features, 0.01], [nose, 0.006]];
}

function limbShapes(s) {
  const sh = JOINT.shoulder(s), el = JOINT.elbow(s), wr = JOINT.wrist(s);
  const kn = JOINT.knee(s), an = JOINT.ankle(s);
  const limbs = [
    cone(sh, el, 0.045, 0.034), // זרוע
    sphere(add3(el, [0, 0, -0.006]), 0.031), // מרפק
    cone(el, lerp3(el, wr, 0.5), 0.037, 0.028), // אמה
    cone(lerp3(el, wr, 0.5), wr, 0.027, 0.02),
    ellipsoid([s * 0.282, 0.89, 0.004], [0.019, 0.03, 0.03]), // שורש כף היד
    cone([s * 0.088, 0.9, -0.005], [s * 0.098, 0.56, 0.01], 0.083, 0.05), // ירך
    ellipsoid(add3(kn, [0, 0.005, -0.004]), [0.044, 0.04, 0.04]), // ברך
    cone(add3(kn, [0, -0.02, -0.004]), an, 0.043, 0.025), // שוק
    cone([s * 0.125, 0.3, -0.01], [s * 0.13, 0.09, -0.022], 0.014, 0.015), // עצם השוקית
    ellipsoid([s * 0.105, 0.036, -0.045], [0.03, 0.034, 0.04]), // עקב
    ellipsoid([s * 0.106, 0.062, 0.0], [0.034, 0.032, 0.045]),
    ellipsoid([s * 0.107, 0.033, 0.035], [0.046, 0.028, 0.06]), // כף הרגל, יורדת בשיפוע אל הבהונות
    along(kn, an, 0.3, [s * -0.004, 0, -0.024], [0.04, 0.11, 0.036]), // שריר התאומים
  ];
  const muscles = [
    along(sh, el, 0.1, [s * 0.012, 0, 0], [0.032, 0.065, 0.046]), // הכתף (הדלתא)
    along(sh, el, 0.55, [0, 0, 0.016], [0.026, 0.075, 0.026]), // הדו־ראשי
    along(sh, el, 0.4, [0, 0, -0.016], [0.028, 0.085, 0.028]), // התלת־ראשי
    along(el, wr, 0.25, [s * 0.004, 0, 0.004], [0.03, 0.08, 0.037]), // שרירי האמה
    ellipsoid([s * 0.1, 0.72, 0.03], [0.055, 0.15, 0.05]), // הארבע־ראשי
    ellipsoid([s * 0.074, 0.585, 0.028], [0.03, 0.05, 0.034]),
    ellipsoid([s * 0.13, 0.74, -0.008], [0.035, 0.15, 0.05]),
    ellipsoid([s * 0.095, 0.72, -0.04], [0.055, 0.15, 0.05]), // אחורי הירך
    ellipsoid([s * 0.05, 0.8, 0.0], [0.04, 0.08, 0.055]), // המקרבים
    ellipsoid([s * 0.1, 0.522, 0.056], [0.021, 0.025, 0.012]), // פיקת הברך
    cone([s * 0.1, 0.495, 0.05], [s * 0.101, 0.445, 0.038], 0.011),
    cone([s * 0.104, 0.22, -0.04], [s * 0.105, 0.05, -0.062], 0.012, 0.014), // גיד אכילס
  ];
  // כף היד (כף היד פונה אל הירך, האגודל קדימה) וכף הרגל
  const hands = [
    rbox([s * 0.29, 0.84, 0.004], [0.003, 0.03, 0.022], 0.013),
    ellipsoid([s * 0.282, 0.848, 0.022], [0.012, 0.024, 0.014]), // כרית האגודל
    ellipsoid([s * 0.283, 0.845, -0.02], [0.01, 0.022, 0.01]),
    ...FINGERS.map((f) => sphere([s * 0.296, 0.812, f.z], 0.0088)), // פרקי האצבעות
    ellipsoid([s * 0.106, 0.019, 0.088], [0.044, 0.019, 0.034]), // כרית כף הרגל
    ellipsoid([s * 0.108, 0.022, 0.1], [0.038, 0.016, 0.026]), // בסיס הבהונות
    sphere([s * 0.087, 0.088, -0.014], 0.016), sphere([s * 0.13, 0.078, -0.022], 0.015), // הקרסוליים
  ];
  // האצבעות והבהונות בחיבור כמעט חד, כדי שיהיו נפרדות
  const digits = [
    cone([s * 0.284, 0.86, 0.02], [s * 0.285, 0.826, 0.041], 0.0115, 0.0095), cone([s * 0.285, 0.826, 0.041], [s * 0.283, 0.797, 0.054], 0.0095, 0.0078), // אגודל
  ];
  for (const f of FINGERS) {
    const k = [s * 0.293, 0.81, f.z], tip = [s * 0.299, 0.81 - f.len + 0.002, f.z];
    digits.push(cone(k, lerp3(k, tip, 0.45), 0.0076, 0.007), cone(lerp3(k, tip, 0.45), tip, 0.007, 0.0066));
  }
  const toes = [];
  for (let t = 0; t < 5; t++) {
    const o = t === 0 ? -0.024 : -0.026 + t * 0.013, r = t === 0 ? 0.0105 : 0.008;
    toes.push(cone([s * (0.105 + o * 1.2), 0.019, 0.085], [s * (0.105 + o * 1.35), r + 0.003, (t === 0 ? 0.158 : 0.152 - t * 0.004) - r], t === 0 ? r * 1.1 : 0.0095, r)); // כרית הבוהן נוגעת ברצפה
  }
  return [[limbs, 0.03], [muscles, 0.025], [hands, 0.01], [digits, 0.0025], [toes, 0.004]];
}

function buildBody(cell) {
  const g = new Grid([-0.36, -0.01, -0.16], [0.36, 1.77, 0.2], cell);
  for (const [shapes, k] of [...bodyShapes(), ...MIRROR.flatMap(limbShapes)]) g.add(shapes, k);
  // ארובות העיניים עם גלגל העין, והאוזניים עם השקע שבתוכן
  g.sub(EYES.map((e) => sphere([e.c[0] * 1.06, e.c[1] + 0.002, e.c[2] + 0.013], 0.0095)), 0.008);
  g.add(EYES.map((e) => sphere(e.c, e.r + 0.002)), 0.008);
  for (const s of MIRROR) {
    const R = basis([s, 0, 0.3], [0, 1, -0.25]), c = [s * 0.079, 1.63, -0.032];
    // שפת האוזן (הסליל): צינור מלפנים־למעלה, מעל הראש של האוזן ומאחור עד התנוך
    const rim = [];
    for (let a = 0.7; a > -2.9; a -= 0.3) rim.push([0, 1, 2].map((i) => c[i] + R[0][i] * 0.006 + R[1][i] * 0.029 * Math.cos(a) + R[2][i] * s * 0.016 * Math.sin(a)));
    g.add([ellipsoid(c, [0.0095, 0.033, 0.019], R), sphere([s * 0.078, 1.6, -0.026], 0.0075)], 0.008);
    g.add(tube(rim, 0.0035), 0.006);
    g.sub(ellipsoid([s * 0.0895, 1.626, -0.028], [0.004, 0.012, 0.008], R), 0.006);
  }
  g.sub(sphere([0, 1.03, 0.106], 0.006), 0.01); // טבור
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
// צבעים נכתבים כמו בתוכנת ציור (sRGB) ונשמרים לינאריים, כי כך three.js קורא צבע לכל נקודה
const C = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];
const RED = C(0.84, 0.13, 0.12), BLUE = C(0.3, 0.36, 0.76), FAT = C(0.97, 0.84, 0.5);

// כתמים עדינים: מעבר בין שני גוונים לפי רעש בשתי רמות פירוט
const mottle = (a, b, f) => (x, y, z) => lerp3(a, b, clamp(0.5 + 0.45 * noise(x * f, y * f, z * f) + 0.3 * noise(x * f * 2.7 + 5, y * f * 2.7, z * f * 2.7), 0, 1));

// צבע בשכבות: על צבע הבסיס נצבעות שכבות [צורות, צבע], כל שכבה רק במרחק w מפני הצורות שלה
function paint(base, layers, w) {
  return (x, y, z) => {
    let c = typeof base === 'function' ? base(x, y, z) : base;
    for (const [shapes, col] of layers) {
      let d = FAR;
      for (const s of shapes) {
        const b = s.box;
        if (x > b[0] - w && x < b[3] + w && y > b[1] - w && y < b[4] + w && z > b[2] - w && z < b[5] + w) d = Math.min(d, s.d(x, y, z));
      }
      if (d < w) c = lerp3(c, col, 1 - sstep(0, w, d));
    }
    return c;
  };
}

// הנקודה שבה קרן מ־o (בתוך הצורה) בכיוון dir יוצאת מפני השטח של d (חיפוש בינארי)
function onSurface(d, o, dir, far = 0.08) {
  let a = 0, b = far;
  for (let i = 0; i < 22; i++) {
    const m = (a + b) / 2;
    if (d(...add3(o, mul3(dir, m))) < 0) a = m;
    else b = m;
  }
  return add3(o, mul3(dir, a));
}

// כלי דם גדול שנחתך בקצה b חיתוך ישר, עם החור שבאמצע (כמו באטלס)
function vesselEnd(G, a, b, r) {
  const n = norm3(sub3(b, a));
  G.add(cone(a, add3(b, mul3(n, r)), r), 0.004);
  G.map((v, x, y, z) => {
    const p = sub3([x, y, z], b), h = dot3(p, n);
    const rad = Math.hypot(p[0] - n[0] * h, p[1] - n[1] * h, p[2] - n[2] * h);
    return rad > r * 1.3 ? v : Math.max(v, h, Math.min(r * 0.72 - rad, h + 0.006));
  }, [b[0] - r * 2.2, b[1] - r * 2.2, b[2] - r * 2.2, b[0] + r * 2.2, b[1] + r * 2.2, b[2] + r * 2.2]);
}

// ---------- הלב ----------
// הצירים של הלב: X אל החוד (שמאלה, למטה וקדימה), Y – הפנים הקדמיות, Z – הצד הימני־תחתון
const HR = basis(sub3(HEART.apex, HEART.c), [0, 0, 1]);
const hw = (X, Y, Z) => add3(HEART.c, add3(add3(mul3(HR[0], X), mul3(HR[1], Y)), mul3(HR[2], Z)));

function heartShapes() {
  return [
    cone(hw(-0.012, -0.012, -0.01), hw(0.062, -0.002, -0.004), 0.031, 0.011), // חדר שמאל, עד החוד
    cone(hw(-0.01, 0.012, 0.014), hw(0.048, 0.01, 0.006), 0.029, 0.012), // חדר ימין, מלפנים
    ellipsoid(hw(-0.03, 0.0, 0.03), [0.022, 0.022, 0.02], HR), // עלייה ימנית
    ellipsoid(hw(-0.04, -0.018, -0.008), [0.018, 0.016, 0.03], HR), // עלייה שמאלית, מאחור
    ellipsoid(hw(-0.03, 0.022, 0.018), [0.01, 0.007, 0.016], HR), // אוזנית ימנית, ליד שורש אבי העורקים
    ellipsoid(hw(-0.026, 0.006, -0.03), [0.01, 0.007, 0.015], HR), // אוזנית שמאלית
  ];
}

// עורקים וורידים על פני הלב, ושומן צהוב בתלמים שלהם
const HEART_SURFACE = (() => {
  const S = heartShapes();
  const d = (x, y, z) => S.reduce((v, s) => smin(v, s.d(x, y, z), 0.012), FAR);
  // מסלול [X, זווית, רדיוס] (זווית 0 = קדימה, π/2 = ימינה־למטה, π = אחורה): מחליקים קודם, ואז מורידים כל נקודה
  // אל פני הלב, כדי שהצינור יצמד לשטח לכל אורכו. inset > 0 שוקע פנימה, < 0 יושב מעל (על השומן)
  const path = (list, inset) => {
    const pts = smoothPath(list, 4).map(([X, a, r]) => {
      const dir = add3(mul3(HR[1], Math.cos(a)), mul3(HR[2], Math.sin(a)));
      return [...sub3(onSurface(d, hw(X, -0.004, 0.002), dir, 0.06), mul3(dir, inset)), r];
    });
    return pts.slice(1).map((p, i) => cone(pts[i].slice(0, 3), p.slice(0, 3), pts[i][3], p[3]));
  };
  const ring = (X, a0, a1, r, inset) => path(Array.from({ length: 7 }, (_, i) => [X, a0 + ((a1 - a0) * i) / 6, r]), inset);
  return {
    fat: [
      ...ring(-0.018, -2.4, 2.6, 0.005, 0.0015),
      ...path([[-0.016, -0.75, 0.005], [0.005, -0.8, 0.0045], [0.03, -0.8, 0.0035], [0.05, -0.76, 0.0022]], 0.0015),
      ...path([[-0.016, 1.45, 0.0045], [0.01, 1.35, 0.0035], [0.03, 1.25, 0.0022]], 0.0013),
    ],
    arteries: [
      ...ring(-0.019, 0.25, 2.7, 0.0022, -0.0018), // העורק הכלילי הימני
      ...ring(-0.019, -0.45, -2.3, 0.002, -0.0018), // הענף הסובב
      ...path([[-0.019, -0.55, 0.0024], [-0.006, -0.72, 0.0022], [0.015, -0.78, 0.002], [0.035, -0.78, 0.0017], [0.055, -0.74, 0.0013], [0.066, -0.7, 0.001]], -0.0014), // היורד הקדמי
      ...path([[0.008, -0.8, 0.0016], [0.022, -1.05, 0.0015], [0.036, -1.3, 0.0012], [0.05, -1.5, 0.001]], -0.0003),
      ...path([[-0.017, 1.45, 0.0018], [0.005, 1.38, 0.0016], [0.025, 1.28, 0.0013], [0.042, 1.15, 0.001]], -0.0008),
    ],
    veins: [
      ...path([[0.05, -0.95, 0.0012], [0.03, -0.95, 0.0016], [0.008, -0.95, 0.0019], [-0.012, -1.0, 0.002], [-0.015, -1.4, 0.0021], [-0.015, -1.9, 0.0023], [-0.015, -2.4, 0.0024], [-0.016, -2.9, 0.0026]], -0.0012),
      ...path([[0.03, 0.62, 0.0011], [0.012, 0.55, 0.0014], [-0.01, 0.5, 0.0016]], -0.0003),
    ],
  };
})();

// כלי הדם הגדולים שיוצאים מלמעלה: [התחלה, קצה, רדיוס]
const AORTA = [[0.008, 1.262, 0.032], [0.011, 1.33, 0.037], 0.0125];
const PULMONARY = [[0.022, 1.29, 0.046], [0.032, 1.33, 0.046], 0.012];
const PULMONARY_LR = [[[0.034, 1.33, 0.044], [0.058, 1.336, 0.022], 0.0085], [[0.03, 1.333, 0.042], [0.012, 1.338, 0.017], 0.0085]];
const SVC = [[-0.02, 1.272, 0.027], [-0.021, 1.326, 0.025], 0.0095];

function heart(G) {
  G.add(heartShapes(), 0.012);
  G.map((v, x, y, z) => (Math.abs(v) > 0.003 ? v : v + 0.0005 * noise(x * 260, y * 260, z * 260))); // פני שטח לא חלקים לגמרי, כדי שהברק יישבר כמו על רקמה רטובה
  G.add(HEART_SURFACE.fat, 0.004);
  G.add([...HEART_SURFACE.arteries, ...HEART_SURFACE.veins], 0.0015);
  G.add(sphere([0.009, 1.284, 0.035], 0.0145), 0.006); // התפיחות בשורש אבי העורקים
  G.add(cone(...PULMONARY), 0.012); // יוצא מהחדר הימני כמו משפך
  for (const v of [AORTA, ...PULMONARY_LR, SVC]) vesselEnd(G, ...v);
}

const heartColor = paint(mottle(C(0.55, 0.14, 0.12), C(0.4, 0.08, 0.09), 70), [
  [heartShapes().slice(2), C(0.5, 0.13, 0.16)],
  [HEART_SURFACE.fat, FAT],
  [HEART_SURFACE.veins, BLUE],
  [HEART_SURFACE.arteries, RED],
  [[cone(...AORTA), sphere([0.009, 1.284, 0.035], 0.0145)], C(0.86, 0.24, 0.2)],
  [[cone(lerp3(PULMONARY[0], PULMONARY[1], 0.45), PULMONARY[1], PULMONARY[2]), ...PULMONARY_LR.map((v) => cone(...v))], C(0.36, 0.44, 0.8)],
  [[cone(...SVC)], C(0.33, 0.4, 0.78)],
], 0.0014);

// ---------- הריאות ----------
// הסרעפת: כיפה מתחת לכל ריאה. הכיפה הימנית גבוהה יותר, כי הכבד דוחף אותה למעלה
const dome = (s) => sphere([s * 0.08, s > 0 ? 1.018 : 1.03, 0.03], 0.15);

function lungs(G) {
  // ריאה צרה למעלה (הקודקוד מאחורי עצם הבריח) ורחבה למטה, כדי שתישאר בתוך הצלעות
  for (const s of MIRROR) {
    const e = ellipsoid([0, 1.265, 0], [0.062, 0.16, 0.087]);
    G.add({
      d: (x, y, z) => {
        const t = Math.max(0, y - 1.21), k = t * sstep(0, 0.04, t);
        return e.d((x - s * (0.072 - 0.2 * k)) * (1 + 6 * k - 8 * t * t), y, (z + 0.006) * (1 + 4 * t * t));
      },
      box: [s > 0 ? 0 : -0.14, 1.1, -0.1, s > 0 ? 0.14 : 0, 1.44, 0.08],
    });
  }
  G.sub(MIRROR.map(dome), 0.012);
  G.map((v, x) => smax(v, 0.016 - Math.abs(x), 0.01)); // הצד הפנימי ישר
  // מקום ללב ולכלי הדם הגדולים, גומה של הלב בריאה השמאלית, ושער הריאה שדרכו נכנסות הסימפונות
  const room = [...heartShapes(), ...[AORTA, PULMONARY, SVC].map((v) => cone(...v))].map((h) => ({ d: (x, y, z) => h.d(x, y, z) - 0.008, box: h.box.map((b, i) => b + (i < 3 ? -0.008 : 0.008)) }));
  G.sub([...room, sphere([0.05, 1.21, 0.075], 0.035)], 0.012);
  G.sub(MIRROR.map((s) => ellipsoid([s * 0.03, 1.3, -0.014], [0.014, 0.032, 0.022])), 0.01);
  // סדקים בין האונות: חריץ בצורת V רק ליד פני השטח, כדי שלא ייראו מדרגות בתוך הריאה השקופה
  const fissure = (s, p, n, keep = () => true) => G.map((v, x, y, z) => {
    if (Math.sign(x) !== s || v < -0.016 || v > 0.006 || !keep(x, y, z)) return v;
    return v + 0.0055 * Math.max(0, 1 - Math.abs(dot3(sub3([x, y, z], p), n)) / 0.0045);
  });
  const oblique = (s) => [[0, s > 0 ? 1.255 : 1.24, 0], norm3([0, 1, s > 0 ? 1.3 : 1.2])];
  for (const s of MIRROR) fissure(s, ...oblique(s));
  const [po, no] = oblique(-1);
  fissure(-1, [0, 1.3, 0], [0, 1, 0], (x, y, z) => dot3(sub3([x, y, z], po), no) > 0.002); // הסדק האופקי, רק באונה העליונה של הריאה הימנית
}

const lungBase = mottle(C(0.96, 0.67, 0.69), C(0.78, 0.6, 0.7), 45);
// ורוד עם כתמים אפורים־סגולים וקווים דקים של אונוניות (התאים הקטנים של הריאה)
function lungColor(x, y, z) {
  const f = 75;
  const X = x * f, Y = y * f, Z = z * f;
  const xi = Math.floor(X), yi = Math.floor(Y), zi = Math.floor(Z);
  let d1 = 9, d2 = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const a = xi + i, b = yi + j, c = zi + k;
    const d = Math.hypot(a + hash(a, b, c) - X, b + hash(a + 71, b, c) - Y, c + hash(a, b + 37, c) - Z);
    if (d < d1) [d1, d2] = [d, d1];
    else if (d < d2) d2 = d;
  }
  return lerp3(lungBase(x, y, z), C(0.8, 0.5, 0.57), 0.55 * (1 - sstep(0.03, 0.16, d2 - d1)));
}

// ---------- המוח ----------
// הפיתולים: 0 בתוך חריץ (לאורך הקווים שבהם רעש מעוות עובר דרך אפס) ו־1 בראש הפיתול. השורש נותן חריץ צר ופיתול מעוגל
function gyri(x, y, z) {
  const w = 0.006 * noise(x * 40 + 9, y * 40, z * 40);
  return Math.sqrt(Math.min(1, Math.abs(noise((x + w) * 105, (y - w) * 105 + 3, z * 88)) / 0.45));
}

function cerebrum(G) {
  const main = ellipsoid(BRAIN.c, BRAIN.r);
  // בסיס שטוח שעולה קדימה (האונה המצחית יושבת מעל ארובות העיניים)
  G.add({ d: (x, y, z) => smax(main.d(x, y, z), 1.643 + 0.12 * (z - 0.02) - y, 0.01), box: main.box });
  // האונות הרקתיות בצדדים, למטה. החיבור החד ביניהן לבין שאר המוח הוא הסדק הצידי (של סילביוס)
  G.add(MIRROR.map((s) => ellipsoid([s * 0.047, 1.642, 0.0], [0.047, 0.023, 0.026], basis([0, -0.22, 1], [0, 1, 0]))), 0.005);
  // החריץ המרכזי: מקודקוד הראש למטה וקצת קדימה, בין אונת המצח לאונה הקודקודית
  const cs = (s) => [[0.06, -0.014], [0.5, -0.009], [0.95, -0.001], [1.3, 0.009]].map(([a, z]) => [...onSurface(main.d, [0, 1.66, z], [s * Math.sin(a), Math.cos(a), 0]), 0.0021]);
  G.sub(MIRROR.flatMap((s) => tube(cs(s), 0)), 0.0015);
  // הסדק בין שתי ההמיספרות
  G.map((v, x, y) => (y > BRAIN.c[1] - 0.03 ? smax(v, 0.0026 - Math.abs(x), 0.002) : v));
  G.map((v, x, y, z) => (Math.abs(v) > 0.009 ? v : v + 0.002 - 0.004 * gyri(x, y, z)));
}

const cerebrumBase = mottle(C(0.94, 0.78, 0.74), C(0.9, 0.7, 0.68), 90);
const cerebrumColor = (x, y, z) => lerp3(C(0.72, 0.48, 0.5), cerebrumBase(x, y, z), gyri(x, y, z));

// המוח הקטן עם קפלים דקים (פוליה) שמתעקלים סביבו, וגזע המוח שממשיך לחוט השדרה
const STEM = [cone([0, 1.648, -0.018], [0, 1.618, -0.02], 0.011, 0.012), ellipsoid([0, 1.607, -0.014], [0.0145, 0.012, 0.011]), cone([0, 1.6, -0.022], [0, 1.568, -0.044], 0.0082, 0.0062)];

function cerebellum(G) {
  G.add([...MIRROR.map((s) => ellipsoid([s * 0.022, 1.607, -0.06], [0.03, 0.024, 0.033])), ellipsoid([0, 1.604, -0.062], [0.012, 0.024, 0.033])], 0.008);
  G.map((v, x, y, z) => (Math.abs(v) > 0.004 ? v : v + 0.0013 * (0.5 + 0.5 * Math.cos(Math.hypot(x * 0.7, y - 1.628, z + 0.04) * 1300))), [-0.06, 1.57, -0.1, 0.06, 1.64, -0.02]);
  G.add(STEM, 0.006);
}

const cerebellumColor = paint(mottle(C(0.9, 0.68, 0.66), C(0.84, 0.6, 0.6), 120), [[STEM, C(0.9, 0.72, 0.68)]], 0.002);

// ---------- הקיבה ----------
// צינור לאורך הקיבה, עם קיבה עליונה (פונדוס) שמתנפחת מעל הכניסה, וטבעת השוער ביציאה
function stomachShapes() {
  return [...tube(STOMACH, 0), sphere([0.062, 1.17, -0.006], 0.029), sphere(STOMACH[STOMACH.length - 1], 0.0145)];
}

function stomach(G) {
  G.add(stomachShapes(), 0.012);
  // קצה הוושט שנכנס מלמעלה, ותחילת התריסריון אחרי השוער – חתוכים, כמו באטלס
  vesselEnd(G, STOMACH[0].slice(0, 3), [0.03, 1.215, -0.008], 0.0085);
  vesselEnd(G, STOMACH[STOMACH.length - 1].slice(0, 3), [-0.041, 1.067, 0.035], 0.011);
}

// פס כלי הדם לאורך הקימור הגדול (הצד החיצוני של הקיבה), רחב ורך כדי שלא ייראה כמו שריטה
const STOMACH_VESSELS = (() => {
  const S = stomachShapes();
  const d = (x, y, z) => S.reduce((v, s) => smin(v, s.d(x, y, z), 0.012), FAR);
  return tube(STOMACH.slice(1, -1).map((p) => [...onSurface(d, p, norm3(add3(norm3(sub3(p, [0.03, 1.125, 0.025])), [0, 0, 0.5]))), 0.0022]), 0);
})();
const stomachColor = paint(mottle(C(0.93, 0.64, 0.58), C(0.86, 0.52, 0.5), 50), [[STOMACH_VESSELS, C(0.86, 0.42, 0.4)]], 0.0035);

// ---------- הכבד ----------
// מעטפת הכבד; מעליה חותכת כיפת הסרעפת, ומלמטה המשטח שפונה אל הקיבה והמעיים
export function liverShapes() {
  return ellipsoid(LIVER.c, [0.11, 0.072, 0.07]);
}

function liver(G) {
  G.add(liverShapes());
  const dr = dome(-1), dl = sphere([0, 1.004, 0.035], 0.162);
  G.map((v, x, y, z) => smax(v, Math.min(dr.d(x, y, z), dl.d(x, y, z)) + 0.006, 0.012));
  // השפה התחתונה חדה ועולה שמאלה: האונה הימנית גבוהה ועבה, השמאלית דקה
  const n = norm3([0.4, -1, 0.25]), p0 = [-0.04, 1.097, 0.07];
  G.map((v, x, y, z) => smax(v, dot3(sub3([x, y, z], p0), n), 0.006));
  // מקום לקיבה ולכיס המרה, וחריץ קטן של הרצועה שבין שתי האונות
  G.sub([...stomachShapes().map((h) => ({ d: (x, y, z) => h.d(x, y, z) - 0.004, box: h.box })), cone(add3(GALLBLADDER.c, [0.004, 0.016, -0.03]), GALLBLADDER.c, 0.012, 0.011)], 0.01);
  G.map((v, x, y, z) => (z > 0.02 && v > -0.006 ? smax(v, Math.min(0.0016 - Math.abs(x - 0.004), v + 0.004), 0.0015) : v));
  G.map((v, x, y, z) => (Math.abs(v) > 0.003 ? v : v + 0.0004 * noise(x * 150, y * 150, z * 150)));
}

const liverBase = mottle(C(0.5, 0.17, 0.12), C(0.38, 0.11, 0.08), 60);
const liverColor = (x, y, z) => lerp3(liverBase(x, y, z), C(0.8, 0.62, 0.52), 0.6 * (1 - sstep(0.001, 0.004, Math.abs(x - 0.004))) * sstep(0.02, 0.04, z));

// ---------- המעיים ----------
// מסלול שממלא שטח בלי לחצות את עצמו (עקומת הילברט 4×4), מוזז קצת ברעש כדי שהלולאות ייראו טבעיות
function hilbert(d) {
  let x = 0, y = 0;
  for (let s = 1, t = d; s < 4; s *= 2, t >>= 2) {
    const rx = (t >> 1) & 1, ry = (t ^ rx) & 1;
    if (!ry) {
      if (rx) [x, y] = [s - 1 - x, s - 1 - y];
      [x, y] = [y, x];
    }
    x += s * rx;
    y += s * ry;
  }
  return [x, y];
}

function smallIntestine(G) {
  G.add(tube(DUODENUM, 0.012), 0.004);
  // שתי שכבות של לולאות: האחורית מתחילה למעלה משמאל, הקדמית נגמרת למטה מימין, ליד המעי העיוור
  const pts = [DUODENUM[DUODENUM.length - 1], [0.03, 1.02, 0.024]];
  const jit = (p, a) => [p[0] + a * noise(p[0] * 90, p[1] * 90, 1), p[1] + a * noise(p[0] * 90, 3, p[2] * 90), p[2] + 1.5 * a * noise(5, p[1] * 90, p[0] * 90)];
  const layer = (at) => {
    for (let d = 0; d < 16; d++) {
      const p = at(...hilbert(d));
      // בין שתי נקודות – נקודה באמצע שזזה הצידה, כדי שהצינור יתפתל
      if (d) pts.push(jit(lerp3(pts[pts.length - 1], p, 0.5), 0.012));
      pts.push(jit(p, 0.005));
    }
  };
  layer((i, j) => [0.06 - i * 0.04, 1.0 - j * 0.028, 0.03]);
  layer((i, j) => [-0.06 + j * 0.04, 0.985 - i * 0.028, 0.057]);
  pts.push([-0.075, 0.91, 0.045], COLON[0]);
  G.add(tube(pts, 0.011), 0.003);
  G.add(ellipsoid([0, 0.952, 0.02], [0.07, 0.05, 0.011]), 0.004); // הקרום שמאחורי הלולאות (המזנטריום), כדי שלא ייראו חורים ביניהן
}

const intestineColor = mottle(C(0.97, 0.68, 0.64), C(0.9, 0.55, 0.55), 55);

function colon(G) {
  // המעי הגס עם "כיסים" (הוסטרות): שקיות תפוחות עם קפלים צרים ביניהן. בסוף (המעי החלחולי) הוא חלק יותר
  G.add(tube(smoothPath(COLON, 3), 0, (t, l) => (t > 0.85 ? 0.016 : 0.021) * (1 - (t > 0.85 ? 0.04 : 0.28) * (1 - Math.sqrt(Math.abs(Math.sin((l * Math.PI) / 0.03)))))), 0.004);
  G.add(ellipsoid([-0.08, 0.896, 0.038], [0.022, 0.022, 0.02]), 0.008); // המעי העיוור
  G.add(tube([[-0.074, 0.884, 0.03], [-0.068, 0.87, 0.026], [-0.058, 0.865, 0.03], [-0.05, 0.87, 0.037]], 0.0036), 0.004); // התוספתן
}

const colonColor = mottle(C(0.88, 0.67, 0.54), C(0.78, 0.55, 0.47), 45);

// ---------- הכליות ----------
// שעועית עם שקע פנימי (השער), אגן הכליה שהופך לשופכן, יותרת הכליה על הקוטב העליון, ועורק ווריד קצרים
const KIDNEY_PARTS = KIDNEYS.map((k) => {
  const s = k.s, h = k.hilum;
  return {
    k,
    R: basis([1, 0, 0], [-s * 0.18, 1, 0]),
    pelvis: [cone(lerp3(k.c, h, 0.55), [s * 0.041, h[1] - 0.018, h[2] + 0.003], 0.0095, 0.003)],
    adrenal: [ellipsoid([s * 0.058, k.c[1] + 0.052, k.c[2] + 0.003], [0.014, 0.009, 0.0055], basis([s, -0.7, 0], [0, 0, 1]))],
    artery: [add3(h, [0, 0.004, -0.004]), [s * 0.03, h[1] + 0.006, -0.036], 0.003],
    vein: [add3(h, [0, 0, 0.004]), [s * 0.03, h[1] + 0.001, -0.03], 0.0038],
  };
});

function kidneys(G) {
  for (const p of KIDNEY_PARTS) {
    G.add(ellipsoid(p.k.c, [0.027, 0.053, 0.02], p.R));
    G.sub(sphere(p.k.hilum, 0.013), 0.008);
    G.add(p.pelvis, 0.005);
    G.add(p.adrenal, 0.003);
    for (const v of [p.artery, p.vein]) vesselEnd(G, ...v);
  }
}

const kidneyColor = paint(mottle(C(0.64, 0.22, 0.18), C(0.52, 0.15, 0.14), 70), [
  [KIDNEY_PARTS.flatMap((p) => p.pelvis), C(0.94, 0.86, 0.68)],
  [KIDNEY_PARTS.flatMap((p) => p.adrenal), C(0.93, 0.68, 0.3)],
  [KIDNEY_PARTS.map((p) => cone(...p.artery)), RED],
  [KIDNEY_PARTS.map((p) => cone(...p.vein)), BLUE],
], 0.0015);

// ---------- רשימת החלקים ----------
// cell – גודל התא ברשת (קטן יותר = יותר פרטים, יותר עבודה). q מאפשר להגדיל את כולם במכשיר חלש
export const PARTS = [
  { id: 'body', grids: [{ min: [-0.36, -0.01, -0.16], max: [0.36, 1.77, 0.2], cell: 0.005, build: null }] },
  { id: 'heart', grids: [{ min: [-0.065, 1.165, -0.035], max: [0.1, 1.356, 0.12], cell: 0.002, build: heart, color: heartColor }] },
  { id: 'lungs', grids: [{ min: [-0.15, 1.1, -0.11], max: [0.15, 1.45, 0.095], cell: 0.003, build: lungs, color: lungColor }] },
  { id: 'brain', grids: [
    { min: [-0.082, 1.6, -0.095], max: [0.082, 1.735, 0.08], cell: 0.0019, build: cerebrum, color: cerebrumColor },
    { min: [-0.06, 1.555, -0.1], max: [0.06, 1.665, 0], cell: 0.0016, build: cerebellum, color: cerebellumColor },
  ] },
  { id: 'stomach', grids: [{ min: [-0.055, 1.0, -0.05], max: [0.13, 1.225, 0.1], cell: 0.0028, build: stomach, color: stomachColor }] },
  { id: 'liver', grids: [{ min: [-0.16, 1.045, -0.07], max: [0.09, 1.19, 0.1], cell: 0.003, build: liver, color: liverColor }] },
  { id: 'smallIntestine', grids: [{ min: [-0.1, 0.87, -0.01], max: [0.1, 1.095, 0.09], cell: 0.0028, build: smallIntestine, color: intestineColor }] },
  { id: 'colon', grids: [{ min: [-0.13, 0.83, -0.06], max: [0.14, 1.08, 0.1], cell: 0.0029, build: colon, color: colonColor }] },
  { id: 'kidneys', grids: [{ min: [-0.11, 0.99, -0.08], max: [0.11, 1.14, -0.01], cell: 0.0022, build: kidneys, color: kidneyColor }] },
  { id: 'bladder', grids: [{ min: [-0.05, 0.82, 0.0], max: [0.05, 0.92, 0.08], cell: 0.0028, build: (G) => G.add([ellipsoid(BLADDER.c, BLADDER.r), cone([0, 0.858, 0.038], [0, 0.836, 0.032], 0.012, 0.004)], 0.01), color: mottle(C(0.94, 0.76, 0.64), C(0.88, 0.64, 0.58), 60) }] },
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
