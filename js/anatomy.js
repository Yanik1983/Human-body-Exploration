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
// מהצירים המקומיים של R (השורות הן הצירים) אל העולם
const fromLocal = (R, p) => [0, 1, 2].map((k) => R[0][k] * p[0] + R[1][k] * p[1] + R[2][k] * p[2]);
// מראה בין הצדדים: הצד הימני (s = -1) מקבל את אותם הצירים בתמונת מראה, כך שהעיקום פונה לאותו כיוון
const mirrorBasis = (s, u, v) => basis([u[0], s * u[1], s * u[2]], [s * v[0], v[1], v[2]]);

// קפסולה שטוחה בין a ל־b: חתך אליפטי, ra בכיוון up ו־rb לצד (צלעות, עצם הבריח, קשתות החוליות)
function flat(a, b, ra, rb, up = [0, 1, 0]) {
  const ba = sub3(b, a), il2 = 1 / dot3(ba, ba);
  const [X, Y, Z] = basis(ba, up);
  const r0 = Math.min(ra, rb), m = Math.max(ra, rb);
  return {
    // אותה נוסחה כמו ב־ellipsoid, בלי מערכים זמניים: הצורה הזאת מחושבת הכי הרבה פעמים בשלד
    d: (x, y, z) => {
      let px = x - a[0], py = y - a[1], pz = z - a[2];
      const t = clamp((px * ba[0] + py * ba[1] + pz * ba[2]) * il2, 0, 1);
      px -= ba[0] * t;
      py -= ba[1] * t;
      pz -= ba[2] * t;
      const u = (px * X[0] + py * X[1] + pz * X[2]) / r0, v = (px * Y[0] + py * Y[1] + pz * Y[2]) / ra, w = (px * Z[0] + py * Z[1] + pz * Z[2]) / rb;
      const k0 = Math.sqrt(u * u + v * v + w * w), k1 = Math.sqrt((u / r0) ** 2 + (v / ra) ** 2 + (w / rb) ** 2);
      return k1 === 0 ? -r0 : (k0 * (k0 - 1)) / k1;
    },
    box: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m],
  };
}

// שרשרת קפסולות שטוחות לאורך מסלול חלק; ra ו־rb יכולים להיות פונקציות של t (0..1 לאורך המסלול)
function ribbon(points, ra, rb, up, steps = 4) {
  const pts = smoothPath(points, steps);
  const f = (r, t) => (typeof r === 'function' ? r(t) : r);
  return pts.slice(1).map((p, i) => {
    const t = (i + 0.5) / (pts.length - 1);
    return flat(pts[i], p, f(ra, t), f(rb, t), up);
  });
}

// שרשרת (ribbon, tube) כצורה אחת עם איחוד חד, כדי שחיבור רך לשאר לא ינפח כל מפרק בשרשרת לחרוזים
function merged(parts) {
  const box = [0, 1, 2].map((k) => Math.min(...parts.map((p) => p.box[k]))).concat([3, 4, 5].map((k) => Math.max(...parts.map((p) => p.box[k]))));
  return {
    d: (x, y, z) => {
      let m = 1;
      for (const { d, box: b } of parts) if (x > b[0] - 0.01 && x < b[3] + 0.01 && y > b[1] - 0.01 && y < b[4] + 0.01 && z > b[2] - 0.01 && z < b[5] + 0.01) m = Math.min(m, d(x, y, z));
      return m;
    },
    box,
  };
}

// גליל עם שוליים מעוגלים (גוף חוליה, דיסק): חתך אליפטי rx×rz, חצי גובה h, מוטה לפי R
function disc(c, rx, rz, h, [X, Y, Z]) {
  const e = Math.min(0.0025, h * 0.6);
  const a = rx - e, b = rz - e;
  const m = Math.hypot(rx, rz, h);
  return {
    d: (x, y, z) => {
      const px = x - c[0], py = y - c[1], pz = z - c[2];
      const u = (px * X[0] + py * X[1] + pz * X[2]) / a, w = (px * Z[0] + py * Z[1] + pz * Z[2]) / b;
      const k0 = Math.sqrt(u * u + w * w), k1 = Math.sqrt((u / a) ** 2 + (w / b) ** 2);
      const dr = k1 === 0 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1;
      const dy = Math.abs(px * Y[0] + py * Y[1] + pz * Y[2]) - h + e;
      return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) - e;
    },
    box: [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m],
  };
}

// לוח עצם (שכמה, כנף הכסל, עצם החזה): המצולע pts מוטל על המישור של R, בעובי 2t, ומתעקם כמו קערה לפי bend
function plate(c, R, pts, t, bend = 0) {
  const [X, Y, Z] = R;
  const P = pts.flatMap((p) => toLocal(R, sub3(p, c)).slice(0, 2));
  const n = P.length;
  const at = (u, v) => add3(c, fromLocal(R, [u, v, bend * u * u]));
  const us = P.filter((_, i) => i % 2 === 0), vs = P.filter((_, i) => i % 2 === 1);
  const corners = [Math.min(...us), 0, Math.max(...us)].flatMap((u) => [at(u, Math.min(...vs)), at(u, Math.max(...vs))]);
  return {
    d: (x, y, z) => {
      const px = x - c[0], py = y - c[1], pz = z - c[2];
      const u = px * X[0] + py * X[1] + pz * X[2], v = px * Y[0] + py * Y[1] + pz * Y[2], w = px * Z[0] + py * Z[1] + pz * Z[2];
      const wb = Math.abs(w - bend * u * u) / Math.sqrt(1 + 4 * bend * bend * u * u);
      if (wb - t > 0.02) return wb - t; // רחוק מהלוח: מספיק חסם תחתון, וחוסכים את המצולע
      // מרחק מסומן מהמצולע במישור
      let dd = Infinity, s = 1;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const pu = P[i], pv = P[i + 1], eu = P[j] - pu, ev = P[j + 1] - pv, wu = u - pu, wv = v - pv;
        const h = clamp((wu * eu + wv * ev) / (eu * eu + ev * ev), 0, 1);
        dd = Math.min(dd, (wu - eu * h) ** 2 + (wv - ev * h) ** 2);
        const c1 = v >= pv, c2 = v < P[j + 1], c3 = eu * wv > ev * wu;
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
      }
      return Math.hypot(Math.max(s * Math.sqrt(dd), 0), wb) - t;
    },
    box: [0, 1, 2].map((k) => Math.min(...corners.map((p) => p[k])) - t).concat([0, 1, 2].map((k) => Math.max(...corners.map((p) => p[k])) + t)),
    // הנקודה על פני הלוח המעוקם שמול p (בשביל שפה עבה לאורך הקצה)
    at: (p) => at(...toLocal(R, sub3(p, c)).slice(0, 2)),
  };
}

// עצם מפרק אצבע: בסיס רחב, גוף דק וראש מעוגל
const phalanx = (a, b, r) => [cone(a, lerp3(a, b, 0.22), r * 1.25, r * 0.82), cone(lerp3(a, b, 0.22), b, r * 0.82, r * 1.02)];

// צבעים (מוכפלים בחומר הלבן): עצם בגוון שנהב עם שינויים עדינים, סחוס ודיסקים בלבן־כחלחל
const CARTILAGE = [0.62, 0.74, 0.84];
function boneColor(x, y, z) {
  const n = 0.08 * noise(x * 60, y * 60, z * 60) + 0.04 * noise(x * 260 + 5, y * 260, z * 260);
  return [0.8 * (1 + n), 0.69 * (1 + n), 0.5 * (1 + 1.5 * n)];
}

// קשת השיניים, כמו השיניים והחניכיים שב־main.js: x = W·sin(t), z = Z0 + D·cos(t); השיניים נפגשות בגובה OCC
const TEETH_ARC = { W: 0.027, D: 0.042, Z0: 0.03, OCC: 1.56 };
const arcAt = (t, y, inset = 0) => [(TEETH_ARC.W - inset / 2) * Math.sin(t), y, TEETH_ARC.Z0 + (TEETH_ARC.D - inset) * Math.cos(t)];
// 16 שיניים בכל לסת; התחתונות על קשת קצת קטנה יותר, כך שהעליונות סוגרות עליהן מלפנים
const SKULL_TEETH = [[1, 0], [-1, 0.003]].flatMap(([up, inset]) => Array.from({ length: 16 }, (_, i) => {
  const t = -1.42 + (2.84 * i) / 15, front = Math.cos(t);
  const w = front > 0.85 ? 0.0031 : front > 0.5 ? 0.0034 : 0.0041;
  const R = basis([TEETH_ARC.W * front, 0, -TEETH_ARC.D * Math.sin(t)], [0, 1, 0]);
  return ellipsoid(arcAt(t, TEETH_ARC.OCC + up * 0.0065, inset), [w, 0.0072, w * (front > 0.5 ? 0.7 : 1)], R);
}));
// ארובות העיניים ופתח האף בצורת אגס: נחתכים מהגולגולת, ובצבע הם כהים כדי שייראו כמו חורים
const ORBITS = EYES.map((e) => ellipsoid([e.c[0] * 1.03, e.c[1] + 0.001, e.c[2] - 0.004], [0.017, 0.016, 0.02]));
const NOSE = [ellipsoid([0, 1.603, 0.08], [0.0115, 0.013, 0.03]), ellipsoid([0, 1.616, 0.088], [0.007, 0.012, 0.022])];

function skullColor(x, y, z) {
  if (Math.abs(y - TEETH_ARC.OCC) < 0.015 && z > 0.025 && SKULL_TEETH.some((t) => t.d(x, y, z) < 0.0008)) return [0.93, 0.91, 0.84];
  // התפרים בין עצמות הגולגולת: קווים דקים ועדינים, שלא ייראו כמו סדקים
  const wig = 0.0009 * noise(x * 280, y * 280, z * 280);
  const sut = Math.min(
    y > 1.7 && z < 0.022 && z > -0.088 ? Math.abs(x + wig) : 1,
    y > 1.635 && z > -0.02 ? Math.abs(z - 0.02 - (1.742 - y) * 0.2 + wig) : 1,
    z < -0.05 ? Math.abs(y - 1.712 + 1.67 * Math.abs(x) + wig) / 1.95 : 1,
  );
  const hole = Math.max(
    sstep(0.003, 0, Math.min(...ORBITS.map((o) => o.d(x, y, z)))) * sstep(0.074, 0.058, z),
    sstep(0.003, 0, Math.min(...NOSE.map((o) => o.d(x, y, z)))) * sstep(0.09, 0.074, z),
  );
  return boneColor(x, y, z).map((v) => v * (0.8 + 0.2 * sstep(0.0008, 0.002, sut)) * (1 - 0.9 * hole)); // הצבע לינארי: צריך הרבה כדי שייראה כהה
}

function skullShapes(G) {
  // הגולגולת: קמורה ורחבה מאחור, מצח זקוף, ובסיס שמחזיק את המוח הקטן
  G.add([
    ellipsoid([0, 1.668, -0.012], [0.069, 0.073, 0.085]),
    ellipsoid([0, 1.67, 0.022], [0.065, 0.066, 0.066]),
    ellipsoid([0, 1.626, -0.022], [0.062, 0.042, 0.06]),
    ellipsoid([0, 1.617, -0.052], [0.058, 0.037, 0.044]),
    ...MIRROR.flatMap((s) => [
      cone([s * 0.05, 1.603, -0.036], [s * 0.048, 1.588, -0.033], 0.006, 0.0035), // הזיז שמאחורי האוזן
      ellipsoid([s * 0.046, 1.648, 0.05], [0.012, 0.016, 0.014]), // הפינה החיצונית של המצח, מעל ארובת העין
    ]),
  ], 0.014);
  G.sub(MIRROR.map((s) => ellipsoid([s * 0.097, 1.628, 0.022], [0.03, 0.036, 0.04])), 0.012); // שקע הרקה, שם עובר שריר הלעיסה (רדוד, כדי שהמוח לא יבלוט)
  // הפנים: הלסת העליונה עם רכס השיניים, הגבות, גשר האף, עצמות הלחי והשוליים של ארובות העיניים
  const face = [
    // הלסת העליונה: קיר שעוטף את קשת השיניים, ורכס דק שבו נעוצות השיניים
    merged([...ribbon([-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map((t) => arcAt(t, 1.598, -0.002)), 0.023, 0.005, [0, 1, 0], 3), ...tube([-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map((t) => arcAt(t, 1.5735)), 0.004)]),
    // מתחת לארובות הלסת העליונה רחבה ושטוחה יותר מקשת השיניים, ונפגשת בעצמות הלחי
    merged(ribbon([[-0.043, 1.611, 0.05], [-0.03, 1.608, 0.066], [-0.015, 1.605, 0.076], [0, 1.603, 0.079], [0.015, 1.605, 0.076], [0.03, 1.608, 0.066], [0.043, 1.611, 0.05]], 0.016, 0.0045, [0, 1, 0], 3)),
    ellipsoid([0, 1.578, 0.046], [0.022, 0.0045, 0.026]), // החך
    ellipsoid([0, 1.603, 0.05], [0.02, 0.022, 0.014]), // חלל האף מאחורי הפתח
    ellipsoid([0, 1.661, 0.072], [0.055, 0.011, 0.015]),
    cone([0, 1.654, 0.083], [0, 1.623, 0.094], 0.0065, 0.0042),
  ];
  for (const s of MIRROR) {
    face.push(
      ellipsoid([s * 0.047, 1.617, 0.056], [0.011, 0.011, 0.0055], basis([0.8, 0, -s * 0.6], [0, 1, 0])), // עצם הלחי, פונה קדימה והצידה
      cone([s * 0.051, 1.622, 0.055], [s * 0.052, 1.652, 0.057], 0.0042, 0.0048), // השוליים החיצוניים של ארובת העין
      cone([s * 0.046, 1.613, 0.052], [s * 0.031, 1.58, 0.042], 0.0045, 0.0035), // העמוד שיורד מעצם הלחי אל השיניים האחוריות
    );
  }
  G.add(face, 0.006);
  // קשת עצם הלחי: מתעקלת מעט למטה, ומאחור נשענת על עצם הרקה מעל מפרק הלסת
  G.add(MIRROR.flatMap((s) => [merged(ribbon([[s * 0.053, 1.618, 0.048], [s * 0.064, 1.615, 0.024], [s * 0.061, 1.617, -0.005]], 0.005, 0.0022)), ellipsoid([s * 0.061, 1.617, -0.01], [0.006, 0.0055, 0.008])]), 0.004);
  // ארובות העיניים, פתח האף, השקעים לצדו, תעלות האוזניים והחור שדרכו יוצא חוט השדרה
  G.sub(ORBITS, 0.005);
  G.sub([...MIRROR.map((s) => ellipsoid([s * 0.025, 1.598, 0.08], [0.009, 0.01, 0.006])), ellipsoid([0, 1.585, -0.039], [0.012, 0.02, 0.019])], 0.006);
  G.sub(NOSE, 0.003);
  G.add([rbox([0, 1.603, 0.062], [0.0008, 0.011, 0.012], 0.0008), cone([0, 1.5905, 0.07], [0, 1.5915, 0.081], 0.0022, 0.0008)], 0.002); // המחיצה באמצע האף, והזיז הקטן שמתחתיה
  G.sub(MIRROR.map((s) => sphere([s * 0.063, 1.612, -0.026], 0.0045)), 0.002);
  G.add(SKULL_TEETH);
  // הלסת התחתונה: גוף בצורת פרסה שנושא את השיניים, סנטר בולט, ומכל צד ענף דק שעולה אל המפרק ואל הזיז הקדמי
  G.add(MIRROR.flatMap((s) => ribbon([arcAt(0, 1.535, 0.003), arcAt(s * 0.6, 1.5355, 0.003), arcAt(s * 1.1, 1.536, 0.003), arcAt(s * 1.45, 1.5365, 0.003), [s * 0.039, 1.544, 0.012], [s * 0.046, 1.552, 0.0]], (t) => 0.017 - 0.006 * t, 0.0046)));
  G.add(ellipsoid([0, 1.535, 0.071], [0.013, 0.0075, 0.0032]), 0.012); // הסנטר: בליטה רחבה ושטוחה
  // השפה התחתונה של הלסת ישרה, ועולה בהדרגה אל הזווית שמאחור
  G.map((v, x, y, z) => smax(v, 1.526 + Math.max(0, 0.06 - z) * 0.25 - y, 0.003), [-0.06, 1.5, -0.02, 0.06, 1.55, 0.09]);
  const jaw = [];
  for (const s of MIRROR) {
    const X = ([x, y, z]) => [s * x, y, z];
    // הזווית של הלסת פתוחה (כ־120 מעלות): השפה האחורית נוטה אחורה והשפה התחתונה עולה אליה
    const edge = [[0.045, 1.546, 0.008], [0.047, 1.545, -0.001], [0.05, 1.552, -0.008], [0.053, 1.57, -0.012], [0.055, 1.588, -0.0145], [0.056, 1.594, -0.009], [0.054, 1.585, -0.001], [0.053, 1.586, 0.004], [0.051, 1.602, 0.012], [0.049, 1.585, 0.016], [0.046, 1.567, 0.019], [0.043, 1.553, 0.021], [0.043, 1.548, 0.015]].map(X);
    const ramus = plate(X([0.05, 1.57, 0.004]), mirrorBasis(s, [0, 0, 1], [0.12, 1, 0]), edge, 0.0016);
    jaw.push(
      ramus,
      merged(tube([...edge, edge[0]].map(ramus.at), 0.0026)), // שפה מעוגלת סביב הענף
      cone(X([0.054, 1.586, -0.013]), X([0.055, 1.597, -0.013]), 0.0035, 0.0042), // צוואר המפרק
      ellipsoid(X([0.055, 1.6, -0.013]), [0.009, 0.0045, 0.0055]), // ראש המפרק, רחב מצד לצד
    );
  }
  G.add(jaw, 0.003);
}

// עמוד השדרה: גוף החוליה מקדימה, תעלה לחוט השדרה (באותו מקום כמו ב־body-plan), קשת, זיזים ודיסקים
const bodyH = (v) => (v.kind === 'c' ? 0.0145 : v.h);
const bodyDepth = (v) => v.w * (v.kind === 'c' ? 0.72 : v.kind === 'l' ? 0.7 : 0.82);
// הגוף זז קדימה כדי לא לגעת בחוט השדרה, אבל בגב התחתון רק מעט, כדי לא לדחוק את אבי העורקים שיורד לפניו
const bodyShift = (v) => Math.min(Math.max(0, bodyDepth(v) - 0.0115), v.y > 1.02 ? 0.002 + 0.006 * sstep(1.11, 1.2, v.y) : 1);
const spineTilt = (y) => basis([1, 0, 0], [0, 1, (spineZ(y + 0.01) - spineZ(y - 0.01)) / 0.02]);
const SACRUM_TOP = 0.967;
// הדיסקים: בין כל שתי חוליות (חוץ מבין שתי העליונות), והאחרון יושב על עצם העצה
const DISCS = VERTEBRAE.map((v, i) => {
  const below = VERTEBRAE[i + 1] || v;
  const lo = below === v ? SACRUM_TOP : below.y + bodyH(below) / 2, hi = v.y - bodyH(v) / 2;
  return { y: (lo + hi) / 2, h: (hi - lo) / 2 + 0.0005, w: Math.min(v.w, below.w) * 0.96, rz: bodyDepth(below) * 0.96, dz: bodyShift(below) };
}).slice(1);
// הדיסקים מוטים עם עמוד השדרה, ולכן בודקים את הגובה במערכת הצירים של כל דיסק
for (const d of DISCS) [d.c, d.up] = [[0, d.y, spineZ(d.y) + d.dz], spineTilt(d.y)[1]];
const spineColor = (x, y, z) => (DISCS.some((d) => Math.abs(dot3(sub3([x, y, z], d.c), d.up)) < d.h && z > spineZ(y) - 0.011) ? CARTILAGE : boneColor(x, y, z));

function spine(G) {
  VERTEBRAE.forEach((v, i) => {
    const zs = spineZ(v.y);
    const R = spineTilt(v.y);
    const W = (p) => add3([0, v.y, zs], fromLocal(R, p));
    const c = v.kind === 'c', l = v.kind === 'l', j = i - 7;
    const bh = bodyH(v);
    const rc = i === 0 ? 0.0118 : c ? 0.0098 : l ? 0.0095 : 0.0085; // רדיוס התעלה
    const pr = rc + 0.0024, zc = -0.02;
    const S = [];
    if (i === 0) {
      // האטלס: טבעת בלי גוף, עם קשת קדמית ושני גושים בצדדים שהגולגולת נשענת עליהם
      S.push(...ribbon([[-0.012, 0, -0.009], [-0.007, 0, 0.003], [0, 0, 0.0065], [0.007, 0, 0.003], [0.012, 0, -0.009]].map(W), 0.0042, 0.0025, R[1], 3));
      for (const s of MIRROR) S.push(ellipsoid(W([s * 0.0118, 0, -0.011]), [0.0055, 0.006, 0.0085], R));
    } else S.push(disc(W([0, 0, bodyShift(v)]), v.w, bodyDepth(v), bh / 2, R));
    if (i === 1) S.push(cone(W([0, bh / 2, 0.001]), W([0, bh / 2 + 0.014, 0]), 0.0048, 0.0038)); // השן של החוליה השנייה
    const pw = rc * 0.8;
    G.add(ribbon([[-pw, 0, -0.0105], [-pr, 0, zc], [0, 0, zc - pr], [pr, 0, zc], [pw, 0, -0.0105]].map(W), c ? 0.0045 : l ? 0.0075 : 0.0065, 0.0024, R[1], 2));
    // הזיז האחורי: קצר ומפוצל בצוואר, ארוך ומשופע כלפי מטה בחזה, רחב וישר במותניים
    const drop = [0.012, 0.016, 0.02, 0.024, 0.026, 0.027, 0.027, 0.026, 0.022, 0.018, 0.012, 0.008][j];
    const tip = c ? [0, i === 6 ? -0.008 : -0.004, zc - pr - (i === 6 ? 0.015 : i === 0 ? 0.003 : 0.011)] : l ? [0, -0.003, zc - pr - 0.021] : [0, -drop, zc - pr - (j < 3 ? 0.018 : 0.024) + drop * 0.35];
    S.push(flat(W([0, 0, zc - pr]), W(tip), 0.0022, l ? 0.0085 : c ? 0.0035 : 0.0042, R[0]));
    if (c && i > 0 && i < 6) for (const s of MIRROR) S.push(sphere(W([s * 0.0035, tip[1] - 0.001, tip[2]]), 0.0028));
    else S.push(sphere(W(tip), l ? 0.0045 : 0.0038));
    for (const s of MIRROR) {
      // הזיזים לצדדים: בחזה הם נוגעים בצלע, במותניים הם ארוכים ודקים
      if (c) S.push(flat(W([s * v.w * 0.7, 0, -0.004]), W([s * (i === 0 ? 0.034 : v.w + 0.011), -0.001, i === 0 ? -0.013 : -0.006]), 0.003, 0.0032, R[1]));
      else if (l) S.push(flat(W([s * pr, 0, -0.016]), W([s * 0.035, 0.001, -0.02]), 0.0048, 0.0027, R[1]));
      else S.push(flat(W([s * pr, 0.001, zc]), W([s * 0.03, 0.002, -0.029]), 0.0042, 0.003, R[1]), sphere(W([s * 0.03, 0.002, -0.029]), 0.0042));
      // הזיזים המפרקיים: יוצרים עמודה של מפרקים קטנים לאורך הגב
      const k = l ? 1.3 : 1;
      if (c) S.push(ellipsoid(W([s * pr * 0.95, 0, zc + 0.001]), [0.0042, bh * 0.62, 0.0062], R));
      else S.push(ellipsoid(W([s * pr * 0.85, bh * 0.5, zc - 0.002]), [0.0034 * k, 0.0055, 0.0042 * k], R), ellipsoid(W([s * pr * 0.72, -bh * 0.55, zc - pr * 0.6]), [0.003 * k, 0.0055, 0.0038 * k], R));
    }
    G.add(S, 0.002);
  });
  for (const d of DISCS) G.add(disc(d.c, d.w, d.rz, d.h, spineTilt(d.y)));
}

// הצלעות: [רוחב, עומק מאחור, עומק מלפנים, ירידה עד הקצה, זווית הקצה]; העליונות צרות, כי בית החזה צר למעלה כמו חרוט,
// והתחתונות משאירות בצדדים מקום לשרירים ולשומן שמתחת לעור
const RIBS = [
  [0.09, 0.062, 0.062, 0.017, 1.823], [0.122, 0.075, 0.078, 0.0275, 1.757], [0.145, 0.083, 0.085, 0.036, 1.741], [0.153, 0.09, 0.085, 0.0485, 1.694],
  [0.147, 0.094, 0.077, 0.068, 1.583], [0.141, 0.096, 0.074, 0.0875, 1.455], [0.138, 0.096, 0.074, 0.107, 1.305], [0.144, 0.095, 0.073, 0.096, 1.227],
  [0.143, 0.093, 0.072, 0.0955, 1.108], [0.139, 0.09, 0.07, 0.08, 0.928], [0.132, 0.086, 0.082, 0.055, 0.25], [0.124, 0.08, 0.08, 0.035, -0.55],
];
function ribPath(i, s) {
  const [lat, az, azf, drop, end] = RIBS[i];
  const cx = lat * 0.47, ax = lat * 0.53;
  const v = VERTEBRAE[7 + i];
  const zs = spineZ(v.y);
  const a0 = -Math.acos((0.032 - cx) / ax);
  const z0 = zs - 0.025 - az * Math.sin(a0);
  const pts = [[s * (v.w + 0.003), v.y + 0.003, zs - 0.009]];
  for (let k = 0; k <= 10; k++) {
    const a = a0 + ((end - a0) * k) / 10;
    // הצלע יורדת בעיקר בחלק הקדמי שלה
    pts.push([s * (cx + ax * Math.cos(a)), v.y - drop * (k / 10) ** 1.5, z0 + (a < 0 ? az : azf) * Math.sin(a)]);
  }
  return pts;
}

// החתך של הצלע [גובה, עובי]: הראשונה שטוחה ורחבה, השאר גבוהות ודקות
const ribR = (i) => (i === 0 ? [0.003, 0.0065] : i === 1 ? [0.0045, 0.0038] : [0.0058, 0.0026]);

function ribs(G, s) {
  for (let i = 0; i < 12; i++) {
    const [ra, rb] = ribR(i);
    const neck = (r) => (t) => 0.0042 + (r - 0.0042) * sstep(0, 0.12, t); // ליד החוליה הצלע עגולה
    const pts = ribPath(i, s);
    G.add(ribbon(pts, neck(ra), neck(rb), [0, 1, 0], 4));
    G.add(sphere(pts[0], 0.0045), 0.003);
  }
}

// עצם החזה: הידית, הגוף והזיז דמוי החרב (חצי אחד של המתאר, מלמעלה למטה)
const sternumZ = (y) => 0.083 + (1.415 - y) * 0.065;
const STERNUM = (() => {
  const half = [[0, 1.407], [0.008, 1.413], [0.02, 1.416], [0.027, 1.407], [0.027, 1.392], [0.018, 1.376], [0.016, 1.369], [0.016, 1.35], [0.018, 1.31], [0.019, 1.28], [0.017, 1.255], [0.012, 1.24], [0.007, 1.233], [0.005, 1.215], [0, 1.203]];
  const pts = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x, y, sternumZ(y)]);
  return plate([0, 1.31, sternumZ(1.31)], basis([1, 0, 0], [0, 1, -0.065]), pts, 0.0045);
})();
// איפה הסחוס של כל אחת משבע הצלעות העליונות פוגש את עצם החזה: [גובה, מרחק מהאמצע]
const COSTAL = [[1.398, 0.025], [1.371, 0.015], [1.35, 0.015], [1.325, 0.0165], [1.297, 0.0175], [1.268, 0.017], [1.243, 0.012]];

function chestFront(G) {
  G.add(STERNUM);
  // הסחוסים: מקצה הצלע אל עצם החזה, ובצלעות 8–10 אל הסחוס של הצלע שמעליה
  for (const s of MIRROR) {
    let prev;
    for (let i = 0; i < 10; i++) {
      const pts = ribPath(i, s);
      const e = pts[pts.length - 1], back = lerp3(pts[pts.length - 2], e, 0.85);
      const t = i < 7 ? [s * COSTAL[i][1], COSTAL[i][0], sternumZ(COSTAL[i][0])] : add3(lerp3(prev[0], prev[2], 0.5), [0, -0.004, 0.002]);
      const m = add3(lerp3(e, t, 0.5), [0, 0, 0.006]);
      // הסחוס ממשיך את הצלע מהקצה שלה, קצת דק ממנה, כך שהמפגש חלק ובלי משטחים שחותכים זה את זה
      const [ra, rb] = ribR(i), [ca, cb] = i === 0 ? [0.0055, 0.004] : [0.0048, 0.003];
      const grow = (r, c) => (u) => r * 0.92 + (c - r * 0.92) * sstep(0.15, 0.5, u);
      G.add(merged(ribbon([back, e, m, t], grow(ra, ca), grow(rb, cb), [0, 1, 0], 4)), 0.004);
      prev = [e, m, t];
    }
  }
}
const chestColor = (x, y, z) => (STERNUM.d(x, y, z) < 0.0015 ? boneColor(x, y, z) : CARTILAGE);

// האגן: עצם העצה ועצם הזנב באמצע, ומכל צד עצם הירך־אגן: כנף הכסל, השקע של מפרק הירך, עצם השת ועצם החיק
function pelvis(G) {
  // חמש חוליות מאוחות שהולכות וקטנות, עם כנפיים לצדדים: [y, z, רוחב, עומק, כנף]
  const SAC = [[0.959, -0.05, 0.022, 0.015, 0.05], [0.94, -0.062, 0.017, 0.012, 0.042], [0.922, -0.069, 0.013, 0.0095, 0.032], [0.905, -0.073, 0.0105, 0.008, 0.022], [0.89, -0.075, 0.0085, 0.0065, 0.013]];
  const sac = [];
  SAC.forEach(([y, z, rx, rz, ala], k) => {
    const a = SAC[Math.max(0, k - 1)], b = SAC[Math.min(4, k + 1)];
    const R = basis([1, 0, 0], [0, a[0] - b[0], a[1] - b[1]]);
    sac.push(k ? ellipsoid([0, y, z], [rx, 0.011, rz], R) : disc([0, y, z], rx, rz, 0.0085, R), ellipsoid([0, y - 0.001, z - 0.004], [ala, 0.0125, 0.009], R), sphere([0, y - 0.002, z - rz - 0.003], 0.0035 - k * 0.0005));
  });
  // עצם הזנב: ארבע חוליות קטנות שמתעקלות קדימה
  [[0.876, -0.075, 0.0055], [0.867, -0.072, 0.0045], [0.86, -0.068, 0.0038], [0.855, -0.063, 0.003]].forEach(([y, z, r]) => sac.push(sphere([0, y, z], r)));
  G.add(sac, 0.008);
  G.sub(SAC.slice(0, 4).flatMap(([y, z, rx], k) => MIRROR.map((s) => cone([s * (rx + 0.004), y - 0.009, z + 0.02], [s * (rx + 0.004), y - 0.009, z - 0.03], 0.0028 - k * 0.0003))), 0.001); // החורים של העצבים
  for (const s of MIRROR) {
    const X = ([x, y, z]) => [s * x, y, z];
    const H = JOINT.hip(s);
    const o = norm3([s, -0.85, 0.4]); // שקע מפרק הירך פונה הצידה, למטה וקדימה
    // כנף הכסל: לוח מעוקם, שקוע מבפנים, עם שפה עבה למעלה
    const rim = [[0.12, 0.985, 0.05], [0.128, 1.0, 0.035], [0.134, 1.01, 0.012], [0.132, 1.014, -0.012], [0.122, 1.012, -0.035], [0.1, 1.0, -0.058], [0.075, 0.99, -0.07], [0.058, 0.975, -0.075]];
    const wing = plate(X([0.1215, 0.98, -0.0277]), mirrorBasis(s, [0.433, 0, 0.901], [0.38, 1, 0]), [...rim, [0.052, 0.95, -0.066], [0.075, 0.93, -0.04], [0.09, 0.938, -0.02], [0.1, 0.94, 0.018], [0.108, 0.955, 0.036], [0.112, 0.968, 0.04]].map(X), 0.003, 5);
    const crest = rim.map((p) => wing.at(X(p)));
    const psis = crest[7];
    G.add(wing);
    G.add(merged(tube(crest, 0, (t) => 0.0045 + 0.0012 * Math.cos(t * 6.3))), 0.002);
    // עצם השת ועצם החיק: לוח אחד סביב החור הגדול (במקום צינורות), עם עצם החיק מקדימה
    const [A, B, C] = [[0.08, 0.925, 0.022], [0.02, 0.897, 0.077], [0.075, 0.852, -0.02]].map(X);
    const frame = plate(lerp3(A, lerp3(B, C, 0.5), 0.5), basis(sub3(B, A), sub3(C, A)), [[0.08, 0.925, 0.022], [0.045, 0.906, 0.058], [0.02, 0.897, 0.077], [0.01, 0.875, 0.08], [0.018, 0.86, 0.072], [0.04, 0.851, 0.045], [0.062, 0.849, 0.005], [0.075, 0.852, -0.02], [0.088, 0.885, -0.022], [0.09, 0.915, -0.005]].map(X), 0.0045);
    G.add([
      cone(psis, X([0.052, 0.948, -0.064]), 0.008), // אל המפרק עם עצם העצה
      ellipsoid(X([0.06, 0.96, -0.062]), [0.018, 0.03, 0.015]), // החלק האחורי העבה של הכסל, שנשען על עצם העצה
      ellipsoid(X([0.097, 0.952, -0.002]), [0.014, 0.02, 0.026]), // גוף הכסל מעל השקע
      sphere(sub3(H, mul3(o, 0.012)), 0.0275),
      cone(X([0.06, 0.945, -0.06]), X([0.084, 0.928, -0.026]), 0.009), // השפה של החריץ הגדול
      cone(X([0.085, 0.915, -0.02]), X([0.075, 0.868, -0.028]), 0.012), // עצם השת
      ellipsoid(X([0.074, 0.862, -0.026]), [0.011, 0.013, 0.012]), // עצם הישיבה
      cone(X([0.072, 0.9, -0.035]), X([0.058, 0.894, -0.047]), 0.005, 0.0022),
      frame,
      ellipsoid(X([0.012, 0.882, 0.078]), [0.009, 0.017, 0.0085]), // עצם החיק
      sphere(X([0.026, 0.897, 0.08]), 0.0045),
    ], 0.012);
    G.sub(ellipsoid(X([0.051, 0.877, 0.027]), [0.024, 0.0145, 0.02], basis(sub3(X([0.03, 0.862, 0.055]), X([0.07, 0.895, 0.0])), sub3(B, A))), 0.003); // החור הגדול (החור החוסם)
  }
  G.add(ellipsoid([0, 0.882, 0.078], [0.005, 0.015, 0.0075])); // הסחוס בין שתי עצמות החיק
  // השקע של מפרק הירך: חלל לראש עצם הירך, פתוח לכיוון שהשקע פונה אליו
  G.sub(MIRROR.flatMap((s) => [sphere(JOINT.hip(s), 0.0245), sphere(add3(JOINT.hip(s), mul3(norm3([s, -0.85, 0.4]), 0.032)), 0.03)]), 0.003);
}
const pelvisColor = (x, y, z) => (Math.abs(x) < 0.0035 && z > 0.065 ? CARTILAGE : boneColor(x, y, z));

// עצם הבריח: מתעקלת כמו S, עבה ועגולה ליד עצם החזה ושטוחה ליד הכתף
function clavicle(G, s) {
  const pts = [[0.022, 1.424, 0.078], [0.05, 1.43, 0.076], [0.085, 1.436, 0.062], [0.13, 1.438, 0.027], [0.152, 1.437, 0.012], [0.168, 1.435, 0.003]].map(([x, y, z]) => [s * x, y, z]);
  G.add(ribbon(pts, (t) => 0.0072 - 0.0036 * t, (t) => 0.0068 + 0.0025 * sstep(0.6, 1, t), [0, 1, 0]));
  G.add(sphere(pts[0], 0.0085), 0.004);
}

// השכמה: משולש מעוקם שצמוד לגב של בית החזה, עם רכס, זיז הכתף, הזיז דמוי המקור ושקע למפרק הכתף
function scapula(G, s) {
  const X = ([x, y, z]) => [s * x, y, z];
  const R = mirrorBasis(s, [0.9, 0, 0.44], [0, 1, 0.05]);
  const blade = plate(X([0.105, 1.33, -0.095]), R, [[0.066, 1.392, -0.094], [0.095, 1.398, -0.09], [0.118, 1.402, -0.078], [0.135, 1.4, -0.062], [0.15, 1.402, -0.048], [0.148, 1.372, -0.05], [0.13, 1.32, -0.072], [0.112, 1.275, -0.088], [0.094, 1.24, -0.1], [0.08, 1.27, -0.103], [0.068, 1.33, -0.101], [0.064, 1.36, -0.099]].map(X), 0.0024, 7);
  const on = (p) => blade.at(X(p));
  const back = (p) => sub3(on(p), mul3(R[2], 0.005));
  G.add(blade);
  G.add([
    ...tube([[0.148, 1.372, -0.05], [0.13, 1.32, -0.072], [0.112, 1.275, -0.088], [0.094, 1.242, -0.1]].map(on), 0, (t) => 0.0045 - 0.0012 * t), // השפה העבה בצד
    ...ribbon([back([0.066, 1.358, -0.1]), back([0.1, 1.372, -0.094]), back([0.13, 1.39, -0.075]), X([0.155, 1.41, -0.058]), X([0.172, 1.426, -0.034])], (t) => 0.0045 + 0.0015 * t, 0.0026, R[2]), // הרכס
    ...ribbon([X([0.165, 1.42, -0.045]), X([0.176, 1.432, -0.026]), X([0.178, 1.436, -0.012]), X([0.173, 1.437, -0.003])], 0.0032, 0.0082), // זיז הכתף
    ...tube([[0.138, 1.402, -0.06], [0.142, 1.412, -0.038], [0.15, 1.408, -0.015], [0.158, 1.4, -0.004]].map(X), 0, (t) => 0.0048 - 0.001 * t),
  ]);
  G.add([
    sphere(on([0.094, 1.242, -0.1]), 0.004),
    cone(X([0.138, 1.385, -0.058]), X([0.156, 1.39, -0.04]), 0.009, 0.0095), // צוואר השכמה
    ellipsoid(X([0.161, 1.39, -0.036]), [0.008, 0.019, 0.013], mirrorBasis(s, [0.8, 0, 0.6], [0, 1, 0])),
  ], 0.005);
  G.sub(sphere(JOINT.shoulder(s), 0.0235), 0.002);
}

// עצם הזרוע: ראש עגול, שני הבליטות, גוף ארוך, ובמרפק – גלגלת, ראש קטן ושתי בליטות לצדדים
function humerus(G, s) {
  const X = ([x, y, z]) => [s * x, y, z];
  G.add(tube([[0.196, 1.38, -0.016], [0.214, 1.29, -0.02], [0.236, 1.165, -0.028]].map(X), 0, (t) => 0.0122 - 0.0025 * t));
  G.add([
    sphere(JOINT.shoulder(s), 0.0225),
    ellipsoid(X([0.203, 1.392, -0.006]), [0.011, 0.016, 0.013]),
    sphere(X([0.19, 1.388, 0.008]), 0.007),
    ellipsoid(X([0.219, 1.29, -0.017]), [0.0075, 0.018, 0.007]),
    ellipsoid(X([0.239, 1.152, -0.03]), [0.022, 0.016, 0.0095]),
    sphere(X([0.219, 1.143, -0.033]), 0.0062),
    sphere(X([0.261, 1.143, -0.03]), 0.005),
    ellipsoid(X([0.232, 1.13, -0.026]), [0.0105, 0.0095, 0.0105]),
    sphere(X([0.252, 1.132, -0.022]), 0.0088),
  ], 0.009);
  G.sub(ellipsoid(X([0.238, 1.148, -0.041]), [0.009, 0.01, 0.004]), 0.003); // השקע של המרפק מאחור
}

// האמה: עצם הגומד (המרפק מאחור, צד הזרת) ועצם החישור (צד האגודל), שמתרחבת ליד שורש כף היד
function forearm(G, s) {
  const X = ([x, y, z]) => [s * x, y, z];
  G.add([...tube([[0.238, 1.12, -0.034], [0.258, 1.0, -0.024], [0.276, 0.905, -0.014]].map(X), 0, (t) => 0.0088 - 0.0035 * t), ...tube([[0.252, 1.1, -0.019], [0.262, 1.0, -0.004], [0.278, 0.915, 0.009]].map(X), 0, (t) => 0.0062 + 0.0035 * t * t)]);
  G.add([
    sphere(X([0.236, 1.148, -0.047]), 0.0105),
    cone(X([0.236, 1.15, -0.045]), X([0.238, 1.118, -0.034]), 0.01, 0.0085),
    sphere(X([0.232, 1.122, -0.017]), 0.006),
    sphere(X([0.278, 0.898, -0.013]), 0.0072),
    cone(X([0.279, 0.895, -0.016]), X([0.2803, 0.8895, -0.0165]), 0.003, 0.0022), // הזיז הקטן של הגומד
  ], 0.005);
  G.add([
    disc(X([0.252, 1.118, -0.022]), 0.0098, 0.0098, 0.0045, basis([1, 0, 0], [0, 1, 0])),
    cone(X([0.252, 1.112, -0.021]), X([0.252, 1.095, -0.018]), 0.0058, 0.0062),
    sphere(X([0.249, 1.095, -0.014]), 0.0066),
    ellipsoid(X([0.28, 0.9, 0.009]), [0.0105, 0.0095, 0.0155]),
    sphere(X([0.279, 0.887, 0.021]), 0.004),
  ], 0.005);
}

// כף היד: שמונה עצמות קטנות בשתי שורות, עצמות המסרק, ושלוש עצמות בכל אצבע (שתיים באגודל)
function hand(G, s) {
  const X = ([x, y, z]) => [s * x, y, z];
  const carpals = [
    [[0.288, 0.879, 0.017], [0.0065, 0.006, 0.008]],
    [[0.289, 0.881, 0.004], [0.007, 0.0064, 0.006]],
    [[0.29, 0.879, -0.008], [0.0064, 0.006, 0.0058]],
    [[0.282, 0.876, -0.012], [0.0045, 0.0045, 0.0045]],
    [[0.286, 0.865, 0.026], [0.0065, 0.0065, 0.0065]],
    [[0.289, 0.862, 0.015], [0.006, 0.006, 0.0052]],
    [[0.29, 0.861, 0.003], [0.0068, 0.0085, 0.0062]],
    [[0.29, 0.862, -0.009], [0.0064, 0.0075, 0.0058]],
  ];
  G.add(carpals.map(([c, r]) => rbox(X(c), r.map((v) => v * 0.42), 0.0035)), 0.002); // כמו חלוקי נחל צמודים זה לזה
  const MB = [0.016, 0.006, -0.005, -0.014];
  FINGERS.forEach((f, k) => {
    const base = X([0.29, 0.853, MB[k]]), head = X([0.293, 0.8145, f.z * 0.95]);
    const k0 = X([0.294, 0.8085, f.z]), tip = X([0.299, 0.81 - f.len + 0.007, f.z]);
    G.add([
      sphere(base, 0.0042), cone(base, head, 0.0034, 0.0029), sphere(head, 0.0045),
      ...phalanx(k0, lerp3(k0, tip, 0.47), 0.0033),
      ...phalanx(lerp3(k0, tip, 0.5), lerp3(k0, tip, 0.75), 0.0028),
      ...phalanx(lerp3(k0, tip, 0.78), tip, 0.0024),
    ], 0.0012);
  });
  const t0 = X([0.286, 0.855, 0.028]), t1 = X([0.285, 0.829, 0.04]), t2 = X([0.284, 0.811, 0.0475]), t3 = X([0.2832, 0.7985, 0.053]);
  G.add([...phalanx(t0, t1, 0.0036), ...phalanx(lerp3(t1, t2, 0.1), t2, 0.0034), ...phalanx(lerp3(t2, t3, 0.12), t3, 0.0029)], 0.0012);
}

// עצם הירך: ראש בתוך שקע האגן, צוואר, שני הטרוכנטרים, גוף מעט מקושת, ושני עיבויים בברך; ופיקת הברך
function femur(G, s) {
  const X = ([x, y, z]) => [s * x, y, z];
  const H = JOINT.hip(s);
  G.add(tube([[0.125, 0.9, -0.004], [0.117, 0.78, 0.008], [0.109, 0.64, 0.008], [0.104, 0.55, 0.006]].map(X), 0, (t) => 0.0135 - 0.003 * Math.sin(t * Math.PI) + 0.004 * sstep(0.8, 1, t)));
  G.add([
    sphere(H, 0.0225),
    cone(H, X([0.12, 0.905, -0.003]), 0.0135, 0.0155),
    ellipsoid(X([0.133, 0.915, -0.01]), [0.0125, 0.019, 0.016]),
    sphere(X([0.112, 0.868, -0.017]), 0.0072),
    cone(X([0.131, 0.9, -0.017]), X([0.113, 0.87, -0.018]), 0.0065),
    cone(X([0.104, 0.6, 0.006]), X([0.1, 0.535, 0.004]), 0.0145, 0.028),
    ellipsoid(X([0.083, 0.512, 0.0]), [0.0145, 0.02, 0.024]),
    ellipsoid(X([0.118, 0.514, 0.0]), [0.0145, 0.019, 0.024]),
    ellipsoid(X([0.1, 0.53, 0.016]), [0.024, 0.02, 0.012]),
  ], 0.008);
  G.sub(ellipsoid(X([0.1, 0.496, -0.014]), [0.0065, 0.016, 0.016]), 0.004);
  G.add(ellipsoid(X([0.1, 0.522, 0.034]), [0.0175, 0.021, 0.0075]));
}

// השוק: עצם השוק העבה (עם הקרסול הפנימי) ועצם השוקית הדקה בצד (עם הקרסול החיצוני)
function shin(G, s) {
  const X = ([x, y, z]) => [s * x, y, z];
  G.add([...tube([[0.1, 0.47, 0.006], [0.099, 0.3, -0.002], [0.1, 0.12, -0.012]].map(X), 0, (t) => 0.0155 - 0.005 * sstep(0, 0.35, t) + 0.0015 * sstep(0.75, 1, t)), ...tube([[0.132, 0.455, -0.01], [0.13, 0.28, -0.014], [0.128, 0.1, -0.02]].map(X), 0.0055)]);
  // שני משטחי המפרק בראש השוק נמזגים בעדינות אל הגוף, בלי שוליים שבולטים כמו כובע
  G.add([
    ellipsoid(X([0.084, 0.474, 0.004]), [0.019, 0.016, 0.02]),
    ellipsoid(X([0.118, 0.474, 0.002]), [0.018, 0.016, 0.02]),
    cone(X([0.1, 0.455, 0.004]), X([0.1, 0.4, 0.004]), 0.026, 0.0135),
  ], 0.012);
  G.add([
    ellipsoid(X([0.1, 0.452, 0.024]), [0.008, 0.014, 0.006]),
    cone(X([0.1, 0.44, 0.02]), X([0.099, 0.16, 0.003]), 0.005, 0.004),
    ellipsoid(X([0.1, 0.1, -0.015]), [0.016, 0.013, 0.015]),
    cone(X([0.085, 0.1, -0.015]), X([0.084, 0.072, -0.016]), 0.0072, 0.006),
  ], 0.008);
  G.add([
    ellipsoid(X([0.131, 0.458, -0.01]), [0.0085, 0.01, 0.0085]),
    cone(X([0.131, 0.45, -0.01]), X([0.131, 0.39, -0.011]), 0.0075, 0.0055),
    ellipsoid(X([0.128, 0.078, -0.021]), [0.0072, 0.016, 0.0085]),
  ], 0.005);
}

// כף הרגל: הקרסול ועצם העקב, חמש עצמות באמצע, חמש עצמות מסרק, ועצמות הבהונות
function foot(G, s) {
  const X = ([x, y, z]) => [s * x, y, z];
  G.add([
    ellipsoid(X([0.106, 0.068, -0.018]), [0.0155, 0.0125, 0.019]),
    cone(X([0.104, 0.064, -0.006]), X([0.099, 0.058, 0.014]), 0.0105, 0.0095),
    cone(X([0.107, 0.036, -0.057]), X([0.114, 0.034, 0.0]), 0.0155, 0.0115),
    ellipsoid(X([0.108, 0.042, -0.03]), [0.013, 0.016, 0.02]),
    ellipsoid(X([0.095, 0.05, -0.018]), [0.008, 0.005, 0.01]),
  ], 0.006);
  G.add([
    ellipsoid(X([0.097, 0.056, 0.03]), [0.0135, 0.0095, 0.0068]),
    ellipsoid(X([0.124, 0.036, 0.024]), [0.011, 0.0105, 0.0135]),
    ellipsoid(X([0.089, 0.049, 0.046]), [0.0075, 0.0115, 0.0095]),
    ellipsoid(X([0.102, 0.052, 0.044]), [0.0058, 0.0095, 0.0075]),
    ellipsoid(X([0.113, 0.048, 0.045]), [0.0065, 0.0095, 0.0085]),
  ], 0.0015);
  const BASE = [[0.089, 0.047, 0.056], [0.102, 0.05, 0.054], [0.113, 0.046, 0.056], [0.122, 0.038, 0.04], [0.133, 0.032, 0.034]];
  const HEAD = [[0.079, 0.018, 0.104], [0.093, 0.016, 0.104], [0.106, 0.0155, 0.1], [0.119, 0.015, 0.095], [0.131, 0.015, 0.09]];
  for (let t = 0; t < 5; t++) {
    const o = -0.024 + t * 0.012, big = t === 0;
    const b = X(BASE[t]), h = X(HEAD[t]);
    const st = add3(h, [0, 0, 0.009]), tip = X([0.105 + o * 1.35, 0.0155, (big ? 0.15 : 0.142 - t * 0.004) - 0.006]);
    const r = big ? 0.0055 : 0.0034 - t * 0.0002;
    const toes = big ? [...phalanx(st, lerp3(st, tip, 0.56), r), ...phalanx(lerp3(st, tip, 0.6), tip, r * 0.9)]
      : [...phalanx(st, lerp3(st, tip, 0.5), r), ...phalanx(lerp3(st, tip, 0.54), lerp3(st, tip, 0.76), r * 0.85), ...phalanx(lerp3(st, tip, 0.8), tip, r * 0.8)];
    G.add([sphere(b, big ? 0.0075 : 0.0045), cone(b, h, big ? 0.0062 : 0.0034, big ? 0.0055 : 0.003), sphere(h, big ? 0.0075 : 0.0045), ...toes], 0.0015);
  }
  G.add(sphere(X([0.138, 0.03, 0.03]), 0.0055)); // הבליטה של עצם המסרק החמישית
}

// גבולות הרשת לצד אחד: בצד הימני x מתהפך
const side = (s, min, max) => (s > 0 ? { min, max } : { min: [-max[0], min[1], min[2]], max: [-min[0], max[1], max[2]] });

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
  // הצד החיצוני נצמד מבפנים לקשת הצלעות (חתך אליפטי) שמצטופפת למעלה, והקודקוד כיפה מעוגלת מעל הצלע הראשונה (ציר הריאה נוטה פנימה)
  const w = (y) => smax(0.052, smin(0.131, 0.131 - 0.46 * (y - 1.24), 0.03), 0.02);
  for (const s of MIRROR) {
    const e = ellipsoid([s * 0.066, 1.27, -0.006], [0.07, 0.165, 0.087], basis([1, s * 0.25, 0], [0, 1, 0]));
    G.add({ d: (x, y, z) => smax(e.d(x, y, z), (Math.hypot(x / w(y), (z + 0.005) / 0.1) - 1) * w(y), 0.012), box: [s > 0 ? 0 : -0.14, 1.1, -0.1, s > 0 ? 0.14 : 0, 1.45, 0.08] });
  }
  G.sub(MIRROR.map(dome), 0.012);
  G.map((v, x) => smax(v, 0.016 - Math.abs(x), 0.01)); // הצד הפנימי ישר
  // מקום ללב, לכלי הדם הגדולים ולקיבה שמתחת לסרעפת, גומה של הלב בריאה השמאלית, ושער הריאה שדרכו נכנסות הסימפונות
  const room = [...heartShapes(), ...stomachShapes(), ...[AORTA, PULMONARY, SVC].map((v) => cone(...v))].map((h) => ({ d: (x, y, z) => h.d(x, y, z) - 0.008, box: h.box.map((b, i) => b + (i < 3 ? -0.008 : 0.008)) }));
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
const stomachColor = paint(mottle(C(0.93, 0.64, 0.58), C(0.86, 0.52, 0.5), 50), [[STOMACH_VESSELS, C(0.88, 0.5, 0.47)]], 0.006);

// ---------- הכבד ----------
// מעטפת הכבד; מעליה חותכת כיפת הסרעפת, ומלמטה המשטח שפונה אל הקיבה והמעיים
function liver(G) {
  G.add(ellipsoid(LIVER.c, LIVER.r));
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

const liverBase = mottle(C(0.42, 0.15, 0.11), C(0.3, 0.1, 0.07), 60);
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
  layer((i, j) => [0.051 - i * 0.034, 1.0 - j * 0.027, 0.03]);
  layer((i, j) => [-0.051 + j * 0.034, 0.985 - i * 0.027, 0.057]);
  pts.push([-0.075, 0.91, 0.045], COLON[0]);
  G.add(tube(pts, 0.0135), 0.003);
  G.add(ellipsoid([0, 0.952, 0.02], [0.07, 0.05, 0.011]), 0.004); // הקרום שמאחורי הלולאות (המזנטריום), כדי שלא ייראו חורים ביניהן
}

const intestineColor = mottle(C(0.97, 0.68, 0.64), C(0.9, 0.55, 0.55), 55);

function colon(G) {
  // המעי הגס עם "כיסים" (הוסטרות): שקיות תפוחות עם קפלים צרים ביניהן. בסוף (המעי החלחולי) הוא חלק יותר
  G.add(tube(smoothPath(COLON, 3), 0, (t, l) => (t > 0.85 ? 0.016 : 0.021) * (1 - (t > 0.85 ? 0.04 : 0.26) * (1 - Math.abs(Math.sin((l * Math.PI) / 0.03)) ** 0.6))), 0.0015);
  G.add(ellipsoid([-0.08, 0.896, 0.038], [0.022, 0.022, 0.02]), 0.008); // המעי העיוור
  G.add(tube([[-0.074, 0.884, 0.03], [-0.068, 0.87, 0.026], [-0.058, 0.865, 0.03], [-0.05, 0.87, 0.037]], 0.0036), 0.004); // התוספתן
}

const colonColor = mottle(C(0.86, 0.6, 0.5), C(0.74, 0.5, 0.44), 45);

// ---------- הכליות ----------
// שעועית עם שקע פנימי (השער), אגן הכליה שהופך לשופכן, יותרת הכליה על הקוטב העליון, ועורק ווריד קצרים
const KIDNEY_PARTS = KIDNEYS.map((k) => {
  const s = k.s, h = k.hilum;
  return {
    k,
    R: basis([1, 0, 0], [-s * 0.18, 1, 0]),
    pelvis: [cone(lerp3(k.c, h, 0.55), [s * 0.041, h[1] - 0.018, h[2] + 0.003], 0.0095, 0.003)],
    adrenal: [ellipsoid([s * 0.047, k.c[1] + 0.046, k.c[2] + 0.002], [0.017, 0.0065, 0.008], basis([s, 0.6, 0], [0, 0, 1]))], // כיפה שטוחה שעוטפת את הקוטב העליון מהצד הפנימי
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

// ---------- השרירים ----------
// כל שריר הוא אזור על פני הגוף. בתוך האזור השריר עולה כמעט עד העור, ובשוליים יורד לשכבה העמוקה, כך שבין שרירים
// שכנים נשאר חריץ. הנקודות נמדדות על העור עצמו (buildBody), ולכן השרירים תמיד מתאימים לצורת הגוף.
// הצבע של כל נקודה מקודד את כיוון הסיבים (main.js מצייר לפיו פסים); לבן = גיד, פאסיה או עצם שמתחת לעור.
const DEEP = 0.009; // עומק השכבה העמוקה מתחת לעור
const CORE = [1, 0.045, 0.045]; // קוד של כיוון שלא קיים (x ו־z שניהם ‎-1): השכבה העמוקה, בלי סיבים
const coreDepth = (y) => DEEP - (DEEP - 0.0042) * sstep(1.5, 1.56, y); // בראש השכבה רדודה, כדי שהפנים ישמרו על צורתן
let muscleSet = null; // נשמר בזמן הבנייה, בשביל הצבע

// כיוון הסיבים בשני ערכים (x ו־z של הכיוון כשהוא מופנה למטה), מעוגלים ל־15 רמות כדי שבתוך שריר הוא יהיה קבוע בדיוק
function fiberCode(d) {
  const k = d[1] > 0 ? -1 : 1;
  const q = (v) => 0.045 + 0.045 * Math.round((clamp(v * k, -1, 1) + 1) * 7);
  return [1, q(d[0]), q(d[2])];
}

function muscleShapes(skin) {
  // נקודה על העור: יוצאים מ־c בכיוון d עד שעוברים את העור
  const hit = (c, d) => {
    let t = 0;
    while (t < 0.3 && skin(c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t) < 0) t += 0.002;
    return add3(c, mul3(d, t));
  };
  const out = (c, d) => hit(c, norm3(d));
  const P = [];
  // רצועה לאורך נקודות על העור (r – רדיוס, או רדיוס לכל נקודה); לכל קטע כיוון סיבים משלו
  const strap = (pts, r, o = {}) => {
    const R = (i) => (Array.isArray(r) ? r[i] : r);
    for (let i = 1; i < pts.length; i++) {
      P.push({ shape: cone(pts[i - 1], pts[i], R(i - 1), R(i)), dir: sub3(pts[i], pts[i - 1]), w: Math.min(0.014, 0.6 * Math.min(R(i - 1), R(i))), top: 0.0025, ...o });
    }
  };
  const patch = (shape, o) => P.push({ shape, w: 0.012, top: 0.0025, ...o });
  // אליפסואיד עם תיבה צמודה (לא קובייה סביב הרדיוס הגדול), כדי לחשב פחות נקודות
  const ell = (c, r) => ({ ...ellipsoid(c, r), box: [c[0] - r[0], c[1] - r[1], c[2] - r[2], c[0] + r[0], c[1] + r[1], c[2] + r[2]] });
  // טבעת (קליפה של כדור): כשהיא חותכת את הפנים נוצרת טבעת סביב העין או הפה
  const ring = (c, R, r) => ({ d: (x, y, z) => Math.abs(Math.hypot(x - c[0], y - c[1], z - c[2]) - R) - r, box: [c[0] - R - r, c[1] - R - r, c[2] - R - r, c[0] + R + r, c[1] + R + r, c[2] + R + r] });
  const W = { white: true, top: 0.002 };
  const DOWN = [0, -1, 0];
  const T0 = (y, a) => hit([0, y, -0.005], [0, 0, a]); // קו האמצע: a = 1 מלפנים, ‎-1 מאחור

  // קו האמצע: פאסיה על הקודקוד, השריר הטבעתי של הפה, עצם החזה, הקו הלבן בבטן, הפאסיה בעורף ובגב התחתון
  patch(ell([0, 1.745, -0.02], [0.095, 0.05, 0.12]), { ...W, top: 0.0028 });
  patch(ring(T0(1.578, 1), 0.013, 0.008), { ring: T0(1.578, 1), top: 0.0026 });
  strap([T0(1.415, 1), T0(1.215, 1)], 0.0065, { ...W, top: 0.0035 });
  patch(ell([0, 1.07, 0.08], [0.068, 0.2, 0.06]), { ...W, top: 0.0045 });
  patch(ell([0, 1.425, -0.08], [0.018, 0.04, 0.04]), { ...W, top: 0.0018 });
  patch(ell([0, 1.0, -0.1], [0.05, 0.11, 0.05]), { ...W, top: 0.0032 }); // הפאסיה בגב התחתון

  for (const s of MIRROR) {
    const dirA = (a) => [s * Math.sin((a * Math.PI) / 180), 0, Math.cos((a * Math.PI) / 180)];
    // a במעלות: 0 קדימה, 90 החוצה, 180 אחורה, ‎-90 פנימה
    const T = (y, a) => hit([0, y, -0.005], dirA(a));
    const V = (x, y, z) => [s * x, y, z];
    const arm = [JOINT.shoulder(s), JOINT.elbow(s), JOINT.wrist(s)], leg = [JOINT.hip(s), JOINT.knee(s), JOINT.ankle(s)];
    // t לאורך היד או הרגל: 0 כתף/ירך, 1 מרפק/ברך, 2 שורש כף היד/קרסול
    const on = (j, t, a) => hit(t <= 1 ? lerp3(j[0], j[1], t) : lerp3(j[1], j[2], t - 1), dirA(a));
    const A = (t, a) => on(arm, t, a), L = (t, a) => on(leg, t, a);

    // ----- פנים וצוואר -----
    // בפנים השרירים דקים: רק בליטה קלה, והסיבים מראים איפה כל שריר
    patch(ell(T(1.7, 20), [0.035, 0.032, 0.03]), { dir: DOWN, top: 0.0026, w: 0.014 }); // מצח
    patch(ell(T(1.67, 165), [0.035, 0.03, 0.03]), { dir: DOWN, top: 0.0026, w: 0.014 }); // עורף
    patch(ell(T(1.67, 78), [0.03, 0.035, 0.04]), { to: T(1.612, 72), top: 0.0025, w: 0.014 }); // רקה
    strap([T(1.612, 64), T(1.556, 80)], [0.015, 0.013], { top: 0.002 }); // שריר הלעיסה
    patch(ring(T(1.64, 18), 0.013, 0.007), { ring: T(1.64, 18), top: 0.0025 }); // סביב העין, והעפעף בפנים
    patch(sphere(T(1.64, 18), 0.008), { ring: T(1.64, 18), top: 0.0036 });
    strap([T(1.624, 50), T(1.582, 22)], 0.006, { top: 0.0028 }); // שריר החיוך
    strap([T(1.425, 8), T(1.5, 48), T(1.6, 118)], [0.013, 0.017, 0.013], { top: 0.0015 }); // הצוואר האלכסוני
    strap([T(1.432, 30), T(1.5, 55)], 0.008, { top: 0.002 });
    strap([T(1.43, 4), T(1.535, 10)], 0.007, { top: 0.003 });

    // ----- כתף וחזה -----
    const ACR = out(V(0.165, 1.4, -0.02), [0, 1, 0]);
    const ROOT = T(1.37, 155);
    strap([T(1.425, 12), T(1.44, 40), ACR], 0.0085, { ...W, top: 0.0016 }); // עצם הבריח
    strap([ROOT, out(V(0.15, 1.41, -0.035), [s * 0.3, 0.3, -1])], 0.006, { ...W, top: 0.0016 }); // עמוד השכמה
    // הטרפזיוס: סיבים עליונים ואמצעיים אל הכתף, תחתונים אל השכמה
    strap([T(1.6, 172), T(1.5, 135), ACR], [0.018, 0.028, 0.014], { to: ACR });
    for (const [y, r] of [[1.43, 0.04], [1.36, 0.04]]) patch(cone(T(y, 180), ACR, r, 0.014), { to: ACR });
    for (const [y, r] of [[1.28, 0.035], [1.2, 0.025], [1.13, 0.012]]) patch(cone(T(y, 180), ROOT, r, 0.01), { to: ROOT });
    const DIN = A(0.42, 95);
    patch(cone(V(0.185, 1.395, -0.015), DIN, 0.06, 0.012), { to: DIN, top: 0.0018, w: 0.014 }); // הכתף (דלתא)
    const PIN = A(0.2, -25);
    patch(ell(V(0.08, 1.35, 0.09), [0.07, 0.07, 0.06]), { to: PIN, w: 0.015 }); // החזה: מניפה שנאספת אל הזרוע
    patch(ell(V(0.06, 1.275, 0.1), [0.052, 0.065, 0.06]), { to: PIN, w: 0.015 });
    patch(cone(V(0.12, 1.33, 0.075), PIN, 0.04, 0.014), { to: PIN, w: 0.015 });
    for (const y of [1.245, 1.21, 1.175, 1.14]) strap([T(y + 0.015, 95), T(y - 0.025, 62)], 0.012, { top: 0.0035 }); // המשוננים

    // ----- בטן -----
    for (const [y1, y2, x1] of [[1.25, 1.172, 0.062], [1.168, 1.092, 0.06], [1.088, 1.002, 0.057]]) {
      const c = out(V((0.006 + x1) / 2, (y1 + y2) / 2, 0), [0, 0, 1]);
      patch(rbox(c, [(x1 - 0.006) / 2 - 0.006, (y1 - y2) / 2 - 0.006, 0.02], 0.01), { dir: DOWN, top: 0.0015 }); // קוביות הבטן
    }
    strap([out(V(0.034, 0.997, 0), [0, 0, 1]), out(V(0.02, 0.89, 0), [0, 0, 1])], [0.021, 0.011], { dir: DOWN, top: 0.0015 });
    patch(ell(T(1.1, 62), [0.075, 0.12, 0.07]), { dir: [-s * 0.4, -0.75, 0.5], top: 0.0035, w: 0.03 }); // האלכסוני החיצוני

    // ----- גב -----
    const AX = V(0.155, 1.31, -0.05);
    for (const [y, a, r] of [[1.22, 165, 0.035], [1.1, 150, 0.045], [1.02, 115, 0.035]]) patch(cone(T(y, a), AX, r, 0.025), { to: AX, w: 0.014 }); // הרחב הגבי
    patch(ell(T(1.31, 150), [0.045, 0.045, 0.045]), { to: V(0.17, 1.38, -0.05), top: 0.0035, w: 0.02 }); // מתחת לשכמה
    strap([T(1.27, 140), out(V(0.17, 1.31, -0.04), dirA(180))], 0.013); // העגול הגדול

    // ----- זרוע -----
    strap([A(0.22, 0), A(0.55, 0), A(0.86, 5)], [0.015, 0.023, 0.013], { top: 0.0018 }); // הדו־ראשי
    strap([A(0.84, 5), A(1.08, 15)], 0.006, W);
    strap([A(0.95, 0), A(1.12, -40)], 0.007, W);
    strap([A(0.5, 55), A(0.95, 35)], 0.014, { top: 0.0035 });
    strap([A(0.55, -55), A(0.95, -35)], 0.012, { top: 0.0035 });
    strap([A(0.15, 195), A(0.45, 195), A(0.72, 185)], [0.018, 0.022, 0.016]); // התלת־ראשי
    strap([A(0.22, 145), A(0.45, 150), A(0.7, 170)], [0.016, 0.02, 0.014]);
    strap([A(0.55, 235), A(0.88, 210)], 0.013, { top: 0.003 });
    strap([A(0.72, 180), A(0.97, 180)], [0.008, 0.013], { ...W, top: 0.0035 });
    patch(sphere(A(1.0, 180), 0.008), W); // המרפק
    // אמה: כופפים פונים פנימה (כף היד אל הירך), פושטים החוצה
    strap([A(0.78, 75), A(1.18, 40), A(1.6, 20)], [0.012, 0.018, 0.01]);
    strap([A(1.58, 20), A(1.96, 15)], 0.0065, W);
    strap([A(0.92, 100), A(1.2, 95), A(1.55, 75)], [0.012, 0.015, 0.01]);
    strap([A(1.53, 75), A(1.97, 60)], 0.0065, W);
    strap([A(1.05, 125), A(1.6, 110)], [0.014, 0.011]);
    strap([A(1.58, 110), A(1.98, 100)], 0.006, W);
    strap([A(1.05, 160), A(1.7, 150)], [0.011, 0.008]);
    strap([A(1.68, 150), A(1.98, 150)], 0.0055, W);
    strap([A(1.45, 115), A(1.82, 40)], [0.009, 0.007], { top: 0.0015 });
    strap([A(1.05, -150), A(1.75, -140)], [0.013, 0.009]);
    strap([A(1.73, -140), A(1.98, -130)], 0.0055, W);
    strap([A(1.02, -70), A(1.3, -65), A(1.62, -60)], [0.018, 0.02, 0.012]);
    strap([A(1.6, -60), A(1.98, -60)], 0.012, W);
    strap([A(1.0, -75), A(1.38, 20)], [0.011, 0.008], { top: 0.002 });
    patch(cone(V(0.29, 0.845, 0.004), V(0.298, 0.75, 0.004), 0.042, 0.04), { dir: DOWN, top: 0.0018, w: 0.015 }); // כף היד

    // ----- אגן וירך -----
    patch(ell(V(0.085, 0.885, -0.1), [0.08, 0.085, 0.07]), { dir: [s * 0.65, -0.75, 0.1], w: 0.02 }); // הישבן
    patch(ell(V(0.12, 0.96, -0.06), [0.045, 0.04, 0.05]), { to: V(0.14, 0.9, -0.01), top: 0.0035 });
    strap([L(-0.08, 65), L(0.22, 95)], [0.013, 0.016]);
    strap([L(0.18, 95), L(0.6, 100), L(1.0, 105)], [0.016, 0.014, 0.013], W); // הרצועה בצד הירך
    strap([L(-0.1, 45), L(0.3, 0), L(0.65, -55), L(0.95, -95)], 0.011, { top: 0.0015 }); // החייט
    strap([L(0.95, -95), L(1.1, -80)], 0.006, W);
    strap([L(0.05, 15), L(0.45, 5), L(0.85, 0)], [0.016, 0.028, 0.016]); // הארבע־ראשי
    strap([L(0.12, 80), L(0.5, 70), L(0.9, 35)], [0.03, 0.038, 0.02], { top: 0.003 });
    strap([L(0.45, -45), L(0.78, -45), L(0.93, -25)], [0.016, 0.03, 0.018], { top: 0.002 });
    strap([L(0.86, 0), L(0.95, 0)], 0.014, W);
    patch(sphere(L(1.0, 0), 0.017), { ...W, top: 0.0015 }); // פיקת הברך
    strap([L(1.03, 0), L(1.16, 5)], 0.007, W);
    strap([L(0.05, -40), L(0.45, -75)], [0.012, 0.02]); // המקרבים
    strap([L(0.3, -110), L(0.8, -125)], [0.025, 0.018]);
    strap([L(0.3, -95), L(0.95, -110)], 0.01, { top: 0.002 });
    strap([L(0.25, 185), L(0.6, 160), L(0.92, 130)], [0.018, 0.022, 0.012]); // שרירי הירך האחוריים
    strap([L(0.9, 130), L(1.08, 120)], 0.006, W);
    strap([L(0.25, 190), L(0.6, 205), L(0.88, 225)], [0.016, 0.02, 0.012]);
    strap([L(0.86, 225), L(1.1, 245)], 0.006, W);
    strap([L(0.5, 215), L(0.9, 230)], 0.016, { top: 0.0035 });

    // ----- שוק וכף רגל -----
    strap([L(1.12, -30), L(1.55, -35), L(1.92, -45)], 0.008, { ...W, top: 0.002 }); // השוקה מתחת לעור
    strap([L(1.1, 25), L(1.4, 25), L(1.62, 20)], [0.014, 0.017, 0.01]);
    strap([L(1.6, 15), L(1.95, -10), out(V(0.095, 0.05, 0.06), [0, 1, 0])], 0.005, W);
    strap([L(1.12, 60), L(1.65, 50)], [0.01, 0.008]);
    strap([L(1.08, 100), L(1.45, 105), L(1.7, 115)], [0.012, 0.013, 0.008]);
    strap([L(1.68, 120), L(1.95, 145)], 0.005, W);
    strap([L(1.0, -155), L(1.25, -150), L(1.48, -165)], [0.016, 0.028, 0.012], { top: 0.0015 }); // התאומים
    strap([L(1.0, 150), L(1.22, 145), L(1.4, 165)], [0.014, 0.024, 0.01], { top: 0.0015 });
    patch(cone(L(1.25, 180), L(1.75, 180), 0.05, 0.03), { dir: DOWN, top: 0.0035 });
    strap([L(1.5, 180), L(1.8, 180), out(V(0.105, 0.04, -0.035), [0, 0, -1])], [0.016, 0.01, 0.01], W); // גיד אכילס
    patch(sphere(L(1.97, -95), 0.012), W);
    patch(sphere(L(2.0, 95), 0.012), W);
    patch(cone(V(0.105, 0.05, 0.0), V(0.112, 0.025, 0.14), 0.05, 0.04), { dir: [0, 0, 1], top: 0.0022, w: 0.015 });
    for (const o of [-0.024, -0.012, 0, 0.012, 0.024]) {
      strap([L(1.97, 15), out(V(0.105 + o, 0.03, 0.09), [0, 1, 0]), out(V(0.105 + o * 1.35, 0.015, 0.14), [0, 1, 0])], 0.004, { ...W, top: 0.0016 });
    }
  }
  return P;
}

function muscles(G) {
  const B = buildBody(G.cell);
  const skin = (x, y, z) => B.sample(x, y, z);
  // לרשת של השרירים אותן נקודות כמו לרשת של העור, ולכן בנקודות הרשת קוראים את העור ישירות (מהר יותר)
  const { min, cell, n, v } = B;
  const atNode = G.v.length === v.length ? (x, y, z) => v[Math.round((x - min[0]) / cell) + n[0] * (Math.round((y - min[1]) / cell) + n[1] * Math.round((z - min[2]) / cell))] : skin;
  const P = muscleShapes(skin);
  // לצבע: כל שריר רשום ברצועות הגובה (5 ס"מ) שהתיבה שלו עוברת בהן
  const bins = Array.from({ length: 36 }, () => []);
  for (const p of P) {
    if (p.dir) p.code = fiberCode(norm3(p.dir));
    for (let i = Math.max(0, Math.floor(p.shape.box[1] / 0.05)); i <= Math.min(35, Math.floor(p.shape.box[4] / 0.05)); i++) bins[i].push(p);
  }
  muscleSet = { skin, bins };
  G.map((_, x, y, z) => atNode(x, y, z) + coreDepth(y));
  G.add(P.map((p) => ({ box: p.shape.box, d: (x, y, z) => {
    const sd = atNode(x, y, z);
    if (sd < -0.02) return 1; // עמוק בפנים: השכבה העמוקה כבר ממלאת
    const r = p.shape.d(x, y, z);
    return r > 0.012 ? r : liftMuscle(p, r, sd);
  } })), 0.0015);
}

function liftMuscle(p, r, skinD) {
  const t = clamp(-r / p.w, 0, 1);
  return Math.max(skinD + DEEP - (DEEP - p.top) * t * (2 - t), r);
}

// הצבע של כל נקודה: השריר הקרוב ביותר וכיוון הסיבים שלו. בין שריר לגיד – מעבר רך לפי המרחקים,
// כדי שהגבול הלבן לא יהיה משונן לפי משולשי הרשת
function muscleColor(x, y, z) {
  const { skin, bins } = muscleSet;
  const sd = skin(x, y, z);
  let red = null, rd = sd + coreDepth(y), wd = 1;
  for (const p of bins[clamp(Math.floor(y / 0.05), 0, 35)]) {
    const b = p.shape.box;
    if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) continue;
    const d = liftMuscle(p, p.shape.d(x, y, z), sd);
    if (p.white) wd = Math.min(wd, d);
    else if (d < rd) {
      rd = d;
      red = p;
    }
  }
  const c = !red ? CORE : red.to ? fiberCode(norm3(sub3(red.to, [x, y, z]))) : red.ring ? fiberCode(norm3(cross3([0, 0, 1], sub3([x, y, z], red.ring)))) : red.code;
  const t = sstep(-0.0015, 0.0015, rd - wd);
  return c.map((v) => v + (1 - v) * t);
}

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
    { min: [-0.076, 1.517, -0.102], max: [0.076, 1.746, 0.1], cell: 0.0021, build: skullShapes, color: skullColor },
    { min: [-0.044, 0.96, -0.112], max: [0.044, 1.572, -0.008], cell: 0.0022, build: spine, color: spineColor },
    { min: [-0.13, 1.075, 0.025], max: [0.13, 1.425, 0.11], cell: 0.0019, build: chestFront, color: chestColor },
    { min: [-0.152, 0.842, -0.1], max: [0.152, 1.025, 0.092], cell: 0.0026, build: pelvis, color: pelvisColor },
    ...MIRROR.flatMap((s) => [
      [[0.005, 1.08, -0.106], [0.162, 1.422, 0.105], 0.0019, ribs],
      [[0.006, 1.405, -0.02], [0.185, 1.455, 0.092], 0.0024, clavicle],
      [[0.05, 1.228, -0.116], [0.192, 1.448, 0.012], 0.0024, scapula],
      [[0.162, 1.115, -0.05], [0.275, 1.428, 0.02], 0.0026, humerus],
      [[0.215, 0.875, -0.062], [0.295, 1.168, 0.03], 0.0024, forearm],
      [[0.268, 0.732, -0.034], [0.31, 0.892, 0.062], 0.0016, hand],
      [[0.055, 0.485, -0.04], [0.15, 0.96, 0.06], 0.003, femur],
      [[0.06, 0.055, -0.045], [0.148, 0.502, 0.04], 0.003, shin],
      [[0.062, 0.0, -0.078], [0.146, 0.088, 0.152], 0.002, foot],
    ].map(([min, max, cell, build]) => ({ ...side(s, min, max), cell, build: (G) => build(G, s), color: boneColor }))),
  ] },
  // אותה תיבה כמו הגוף, כדי שנקודות הרשת יהיו בדיוק במקומות שבהם נמדד העור
  { id: 'muscles', grids: [{ min: [-0.36, -0.01, -0.16], max: [0.36, 1.77, 0.2], cell: 0.004, build: muscles, color: muscleColor }] },
];

// בונה חלק אחד ומחזיר את הרשתות שלו. q = מכפיל לגודל התא
export function buildPart(part, q = 1) {
  const out = [];
  for (const spec of part.grids) {
    if (part.id === 'body') {
      const G = buildBody(spec.cell * q);
      out.push({ ...surfaceNet(G), layer: 'skin' });
      continue;
    }
    const G = new Grid(spec.min, spec.max, spec.cell * q);
    spec.build(G);
    out.push(surfaceNet(G, 0, spec.color));
  }
  return out;
}
