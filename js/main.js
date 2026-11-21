// מסע בגוף האדם: הסצנה התלת־ממדית, השכבות, הבחירה באיברים, ההקראה, המילון והסיור המודרך.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { Narrator, splitSentences, DEFAULT_SETTINGS } from './speech.js';
import { Presenter } from './kid-presenter.js';
import { STATIONS, TOUR_INTRO, TOUR_OUTRO } from './data.js';
import { GLOSSARY, GLOSSARY_FORMS, CONTINUE_QUESTION } from './glossary.js';
import {
  EYES, HEART, GALLBLADDER, KIDNEYS, TRACHEA, BRONCHI, ESOPHAGUS, ARTERIES, VEINS, SPINAL_CORD, NERVES,
} from './body-plan.js';
import { FINGERS } from './body-plan.js';

const $ = (id) => document.getElementById(id);
const V = (a) => new THREE.Vector3(...a);
const stationById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));
const phone = () => window.innerWidth <= 720;
const weakDevice = (navigator.hardwareConcurrency || 4) < 4 || (navigator.deviceMemory || 4) < 3;

// במכשיר חלש או בטלפון: בלי זוהר וברזולוציה נמוכה יותר, כדי שהתמונה תזוז חלק
const highQuality = !weakDevice && !phone();

// ---------- סצנה ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, highQuality ? 2 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// רקע: אור רך מאחורי הגוף שמתכהה לכחול עמוק בשוליים (לא שחור)
scene.background = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 105, 0, 128, 128, 200);
  grad.addColorStop(0, '#1a536e');
  grad.addColorStop(0.45, '#0d3149');
  grad.addColorStop(1, '#03101c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// סביבת סטודיו: חדר כהה עם לוחות אור רכים, שמשתקפים בברק הרטוב של האיברים. היא מסתובבת עם המצלמה, כמו האורות
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = (() => {
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: '#22384a', side: THREE.BackSide })));
  // [מיקום, רוחב, גובה, עוצמה]
  for (const [pos, w, h, k] of [[[3, 4, 6], 5, 5, 3], [[0, 8, 0], 8, 8, 1.5], [[-6, 1, 4], 3, 6, 1.2], [[-5, 2, -6], 2, 8, 2.5], [[5, 1, -6], 2, 8, 1.5]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(k), side: THREE.DoubleSide }));
    panel.position.set(...pos);
    panel.lookAt(0, 0, 0);
    room.add(panel);
  }
  return pmrem.fromScene(room, 0.02).texture;
})();
scene.environmentIntensity = 0.6;

// במה: צל רך מתחת לכפות הרגליים ועיגול אור עדין סביבן
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(0.75, 64),
  new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    map: (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      // כתם רך במטרים: מרכז הקנבס הוא מרכז הבמה, וקדימה (+z) הוא למטה בקנבס
      const spot = (x, z, rx, rz, rgb, a) => {
        g.setTransform(rx * 340, 0, 0, rz * 340, 256 + x * 340, 256 + z * 340);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        grad.addColorStop(0, `rgba(${rgb},${a})`);
        grad.addColorStop(0.45, `rgba(${rgb},${a * 0.5})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = grad;
        g.fillRect(-1, -1, 2, 2);
      };
      spot(0, 0, 0.75, 0.75, '70,190,240', 0.2);
      spot(0, 0.03, 0.32, 0.36, '0,6,12', 0.5);
      for (const s of [1, -1]) spot(s * 0.105, 0.045, 0.065, 0.14, '0,4,8', 0.75);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = 'rgba(150,225,255,0.28)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(256, 256, 0.62 * 340, 0, 7);
      g.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
  }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.02, 30);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.25;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.92;
controls.autoRotateSpeed = 0.6;

// תאורת סטודיו שנעה עם המצלמה, כדי שכל תחנה תהיה מוארת יפה מכל זווית: ראשי חם, מילוי קריר, ושני אורות מאחור לקווי המתאר
scene.add(new THREE.HemisphereLight('#d2e8ff', '#1c2a36', 0.45));
scene.add(camera);
const aim = new THREE.Object3D();
aim.position.z = -2;
camera.add(aim);
for (const [color, intensity, pos] of [['#fff1e2', 2.7, [1.5, 2, 1]], ['#bcd9ff', 0.5, [-2.5, 0, 0.5]], ['#8fd3ff', 1.9, [-2, 1.2, -4.5]], ['#ffd9c4', 1.0, [2.2, 0.6, -4.5]]]) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(...pos);
  light.target = aim;
  camera.add(light);
}

// זוהר רק לאותות בעצבים ובדם: רק הם מצוירים לתמונה קטנה שמטושטשת ומתווספת, כך שהעור השקוף והאיברים לא עוברים עיבוד ונשארים חדים וזולים
let glow = null;
if (highQuality) {
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1, 0.2, 0);
  glow = {
    scene: new THREE.Scene(),
    target: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }),
    items: [],
    bloom,
    // מוסיפים רק את ההילה המטושטשת, כי הצינורות עצמם כבר בתמונה הרגילה
    quad: new FullScreenQuad(new THREE.MeshBasicMaterial({ map: bloom.renderTargetsHorizontal[0].texture, toneMapped: false, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor })),
  };
}
// הצינור של החלק מצויר גם בתמונת הזוהר, עם אותם פסים זורמים
function addGlow(e, color, map) {
  if (!glow) return;
  const mesh = new THREE.Mesh(e.mesh.geometry, new THREE.MeshBasicMaterial({ color, map, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  glow.scene.add(mesh);
  glow.items.push({ e, mesh });
}
function renderGlow() {
  let any = false;
  for (const { e, mesh } of glow.items) {
    mesh.visible = e.mesh.visible;
    mesh.material.opacity = e.cur * e.cur; // שכבה מעומעמת כמעט לא זוהרת
    any ||= mesh.visible;
  }
  if (!any) return;
  renderer.setRenderTarget(glow.target);
  renderer.render(glow.scene, camera);
  glow.bloom.render(renderer, null, glow.target, 0, false);
  renderer.setRenderTarget(null);
  renderer.autoClear = false;
  glow.quad.render(renderer);
  renderer.autoClear = true;
}

// ---------- חומרים ----------
// איברים פנימיים (wetMat): רטובים ומבריקים. הזוהר וה"קטיפה" מוכפלים בצבע של כל נקודה, כדי שאיבר כהה (כמו הכבד) לא ייראה חלבי.
// (מחלקה ולא onBeforeCompile על המופע, כי clone() לא מעתיק אותו)
class OrganMaterial extends THREE.MeshPhysicalMaterial {
  onBeforeCompile(sh) {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#if defined(USE_COLOR) && defined(USE_SHEEN)\nmaterial.sheenColor *= vColor;\n#endif');
  }
}
const organMat = (color, extra = {}, M = THREE.MeshPhysicalMaterial) => new M({ color, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.35, sheen: 0.3, sheenColor: new THREE.Color(color).offsetHSL(0, 0, 0.2), ...extra });
const wetMat = (color, extra = {}) => organMat(color, { roughness: 0.55, clearcoatRoughness: 0.2, ...extra }, OrganMaterial);

// העור: זכוכית שקופה עם שוליים זוהרים, או עור אמיתי (uSolid = 1) בתחנה של העור
const skinUniforms = { uSolid: { value: 0 }, uOpacity: { value: 1 } };
const skinMat = new THREE.MeshPhysicalMaterial({ color: '#e3a888', vertexColors: true, roughness: 0.5, ior: 1.4, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ff9f80'), transparent: true, depthWrite: false });
// הפרטים הקטנים מצוירים לפי המיקום על הגוף (חדים יותר מהרשת): עיניים, גבות, שפתיים, ציפורניים, ואדמומיות בלחיים, באוזניים, בברכיים ובפרקים
const v3 = (a) => `vec3(${a.map((n) => n.toFixed(4)).join(', ')})`;
const SKIN_GLSL = `uniform float uSolid;
uniform float uOpacity;
varying vec3 vPos;
float eyeM = 0.0, nailM = 0.0;
vec3 eyeC = vec3(0.0);
float blob(vec3 p, vec3 c, vec3 r) { vec3 q = (p - c) / r; return exp(-dot(q, q)); }
float nail(vec3 p, vec3 c, vec3 n, vec3 w) {
  vec3 d = p - c;
  float h = dot(d, n);
  return smoothstep(1.0, 0.8, length((d - h * n) / w)) * smoothstep(0.002, 0.004, h);
}
vec3 skinPaint(vec3 p) {
  vec3 a = vec3(abs(p.x), p.yz);
  float red = 0.2 * blob(a, vec3(0.047, 1.605, 0.07), vec3(0.02)) + 0.5 * blob(a, vec3(0.0, 1.6, 0.12), vec3(0.012))
    + 0.6 * blob(a, vec3(0.085, 1.63, -0.03), vec3(0.012, 0.035, 0.025)) + 0.6 * blob(a, vec3(0.1, 0.515, 0.07), vec3(0.03))
    + 0.5 * blob(a, vec3(0.24, 1.13, -0.07), vec3(0.025)) + 0.6 * blob(a, vec3(0.3, 0.78, 0.004), vec3(0.015, 0.045, 0.045))
    + 0.5 * blob(a, vec3(0.11, 0.02, 0.13), vec3(0.045, 0.02, 0.035));
  vec3 c = mix(vec3(1.0), vec3(1.0, 0.75, 0.72), min(red, 1.0));
  c *= 1.0 + 0.03 * sin(p.x * 173.0 + sin(p.y * 61.0) * 2.0) * sin(p.y * 157.0 + p.z * 91.0) * sin(p.z * 137.0 + p.x * 53.0);
  c = mix(c, vec3(0.86, 0.68, 0.64), smoothstep(0.009, 0.006, length(a.xy - vec2(0.09, 1.29))) * smoothstep(0.076, 0.084, a.z));
  float t = a.x / 0.024, ml = 1.566 + 0.001 * t * t, front = smoothstep(0.081, 0.089, a.z);
  float lip = smoothstep(1.0, 0.9, t) * front * smoothstep(-0.0006, 0.0006, ml + 0.0072 * (1.0 - t * t) - 0.0012 * exp(-a.x * a.x / 1.6e-5) - a.y)
    * smoothstep(-0.0006, 0.0006, a.y - ml + 0.0085 * (1.0 - t * t));
  c = mix(c, vec3(0.85, 0.55, 0.6), 0.8 * lip);
  c *= 1.0 - 0.6 * smoothstep(1.05, 0.9, t) * smoothstep(0.0011, 0.0, abs(a.y - ml)) * front;
  float bu = (a.x - 0.034) / 0.024;
  float brow = smoothstep(1.0, 0.7, abs(bu)) * smoothstep(0.0035 - 0.0012 * bu, 0.0, abs(a.y - 1.6575 - 0.003 * (1.0 - bu * bu) + 0.001 * bu)) * smoothstep(0.056, 0.064, a.z);
  c = mix(c, vec3(0.36, 0.25, 0.18), 0.65 * brow);
  vec3 q = a - ${v3(EYES[0].c)};
  float u = q.x / 0.0145, up = 0.0058 * (1.0 - u * u) + 0.001 * u, lo = -0.0042 * (1.0 - u * u) + 0.0006 * u;
  eyeM = smoothstep(-0.0005, 0.0005, up - q.y) * smoothstep(-0.0005, 0.0005, q.y - lo) * step(abs(u), 1.0) * step(0.0, q.z);
  float r = length(normalize(q).xy);
  // העין והציפורניים מקבלות צבע משלהן (בגוונים ליניאריים), לא גוון של עור
  vec3 iris = vec3(0.07, 0.17, 0.36) * (0.7 + 0.5 * smoothstep(0.42, 0.2, r));
  eyeC = mix(mix(vec3(0.75, 0.72, 0.7), iris, smoothstep(0.5, 0.47, r)), vec3(0.003), smoothstep(0.2, 0.17, r));
  float lid = 0.85 * smoothstep(0.0011, 0.0002, abs(q.y - up)) * smoothstep(1.06, 0.95, abs(u)) * step(0.0, q.z);
  c = mix(c, vec3(0.18, 0.11, 0.09), lid);
  eyeC *= 1.0 - lid;
  nailM = ${[...FINGERS.map((f) => `nail(a, ${v3([0.299, 0.81 - f.len + 0.0035, f.z])}, vec3(1.0, 0.0, 0.0), vec3(1.0, 0.006, 0.0038))`),
    'nail(a, vec3(0.2835, 0.8, 0.0535), vec3(0.857, 0.0, 0.514), vec3(0.0042, 0.006, 0.0042))',
    // הבהונות: אותו קצה כמו ב־limbShapes שב־anatomy.js
    ...[0, 1, 2, 3, 4].map((t) => {
      const o = t ? -0.026 + t * 0.013 : -0.024, r = t ? 0.008 : 0.0105;
      return `nail(a, ${v3([0.105 + o * 1.35, r + 0.003, (t ? 0.152 - t * 0.004 : 0.158) - r - 0.0025])}, vec3(0.0, 1.0, 0.0), ${v3(t ? [0.0035, 1, 0.0035] : [0.0065, 1, 0.0075])})`;
    })].join('\n    + ')};
  return c;
}
`;
skinMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, skinUniforms);
  sh.vertexShader = 'varying vec3 vPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;');
  sh.fragmentShader = SKIN_GLSL + sh.fragmentShader
    // הצללה בקפלים אדמדמה, כמו אור שעובר דרך העור; בזכוכית מדלגים על הציור, כי הוא נבלע
    .replace('#include <color_fragment>', `vec3 paint = uSolid > 0.001 ? skinPaint(vPos) : vec3(1.0);
    diffuseColor.rgb = mix(mix(diffuseColor.rgb * paint, vec3(0.7, 0.4, 0.36), nailM), eyeC, eyeM) * pow(vColor, vec3(0.85, 1.0, 1.1));`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, eyeM);')
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.22, 0.07, 0.03) * (1.0 - eyeM);')
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
    float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.2);
    vec3 glass = vec3(0.45, 0.85, 1.0) * (0.12 + 1.1 * fres);
    gl_FragColor.rgb = mix(glass, gl_FragColor.rgb, uSolid);
    gl_FragColor.a = mix(0.06 + 0.6 * fres, 1.0, uSolid) * uOpacity;`,
    );
};

// השרירים: הצבע של כל נקודה מקודד (anatomy.js, fiberCode): r = הצללה, g ו־b = כיוון הסיבים, או לבן = גיד
const muscleMat = organMat('#92231b', { clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.25, vertexColors: true });
muscleMat.onBeforeCompile = (sh) => {
  sh.vertexShader = 'varying vec3 vPos;\nvarying vec3 vObjN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;\nvObjN = normal;');
  sh.fragmentShader = `varying vec3 vPos;
varying vec3 vObjN;
// פסים לאורך הסיבים: מישורים מקבילים לכיוון הסיב; נעלמים כשהם צפופים מפיקסל או כמעט מקבילים לפני השטח
float fiber(vec3 a, vec3 n, float k) {
  float ph = dot(vPos, a) * k;
  return (1.0 - dot(n, a) * dot(n, a)) * (1.0 - smoothstep(0.7, 1.8, fwidth(ph))) * cos(ph); // cos: אותו פס גם כשכיוון הסיב מתהפך
}
` + sh.fragmentShader.replace(
    '#include <color_fragment>',
    `float ao = max(vColor.r, 0.02);
    vec2 code = vColor.gb / ao;
    float tendon = smoothstep(0.45, 1.0, min(code.x, code.y));
    vec2 q = clamp(floor((code - 0.045) / 0.045 + 0.5), 0.0, 14.0) / 7.0 - 1.0;
    vec3 d = normalize(vec3(q.x, -sqrt(max(0.0, 1.0 - dot(q, q))), q.y));
    vec3 u = normalize(cross(d, abs(d.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 v = cross(d, u);
    vec3 n = normalize(vObjN);
    float fib = (0.6 * (fiber(u, n, 1600.0) + fiber(v, n, 1800.0)) + 0.4 * (fiber(u, n, 430.0) + fiber(v, n, 470.0))) * step(dot(q, q), 1.5); // ‎|q|>1: השכבה העמוקה, בלי סיבים
    fib *= 1.0 - smoothstep(0.015, 0.05, fwidth(code.x) + fwidth(code.y)); // במעבר בין שני כיוונים הפסים משתבשים
    float shade = 0.94 + 0.12 * fract(sin(dot(abs(q), vec2(12.99, 78.23))) * 43758.5);
    diffuseColor.rgb = mix(diffuseColor.rgb * shade * (1.0 + 0.2 * fib), vec3(0.88, 0.83, 0.79), tendon) * ao;`,
  );
};

// פסים שזורמים לאורך צינור (דם, אותות בעצבים, טבעות בקנה הנשימה)
function stripeTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
// זרימה: גל שמתחזק לאט ונגמר בחזית חדה, כמו דחיפה של הלב. בעצבים: אות קצר, ומעט זוהר תמידי בין האותות
const flowStops = [[0, '#000'], [0.5, '#000'], [0.9, '#fff'], [1, '#000']];
const arteryMat = organMat('#a8101c', { roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2, emissive: '#ff3326', emissiveMap: stripeTexture(flowStops), emissiveIntensity: 0.25 });
const veinMat = organMat('#2443a8', { roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2, emissive: '#5f7fff', emissiveMap: stripeTexture(flowStops), emissiveIntensity: 0.25 });
const nerveMat = organMat('#e6b52e', { roughness: 0.4, emissive: '#fff0a0', emissiveMap: stripeTexture([[0, '#121212'], [0.86, '#121212'], [0.94, '#fff'], [1, '#121212']]), emissiveIntensity: 1.3 });
const ringTex = stripeTexture([[0, '#fff'], [0.5, '#fff'], [0.6, '#d49a9a'], [0.9, '#d49a9a'], [1, '#fff']]);
const tracheaMat = wetMat('#f3c9c9', { map: ringTex, bumpMap: ringTex, bumpScale: 3 }); // טבעות הסחוס בולטות

// ---------- החלקים של הגוף ----------
// לכל חלק: הרשת, השכבה שלו, התחנה שלו, והשקיפות הנוכחית (שמשתנה בהדרגה)
const entries = [];
const pickable = [];
const animated = {};

function addEntry(obj, layer, station, { pick = true } = {}) {
  // לכל חלק עותק משלו של החומרים, כדי שאפשר יהיה לשנות לו את השקיפות לבד
  const e = { mesh: obj, layer, station, cur: 0, mats: [] };
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material !== skinMat) o.material = o.material.clone();
    e.mats.push(o.material);
    o.userData.entry = e;
    if (pick) pickable.push(o);
  });
  scene.add(obj);
  entries.push(e);
  return e;
}

// צינור לאורך נקודות; מספר רביעי בנקודה הוא הרדיוס שם, כדי שהצינור יצטמצם. ה־UV לאורך הצינור במטרים, כדי שהפסים בכל הצינורות באותו גודל
function tubeGeometry(points, radius, stripe = 0.05) {
  const curve = new THREE.CatmullRomCurve3(points.map(V));
  const len = curve.getLength();
  const rs = points.map((p) => p[3] ?? radius);
  const rMax = Math.max(...rs);
  const n = Math.max(8, Math.round(len / 0.008));
  const sides = rMax > 0.004 ? 16 : 8;
  const geo = new THREE.TubeGeometry(curve, n, rMax, sides);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const c = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    curve.getPointAt(i / n, c);
    const t = curve.getUtoTmapping(i / n) * (rs.length - 1);
    const k = Math.min(rs.length - 2, Math.floor(t));
    const f = (rs[k] + (rs[k + 1] - rs[k]) * (t - k)) / rMax;
    for (let j = 0; j <= sides; j++) {
      const v = i * (sides + 1) + j;
      p.fromBufferAttribute(pos, v).sub(c).multiplyScalar(f).add(c);
      pos.setXYZ(v, p.x, p.y, p.z);
      uv.setX(v, (i / n) * (len / stripe));
    }
  }
  return geo;
}
const tubes = (list, radius, stripe) => mergeGeometries(list.map((pts) => tubeGeometry(pts, radius, stripe)));

// מצייר טקסטורה על קנבס בגודל n×n
function canvasTexture(n, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  draw(c.getContext('2d'), n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// הקשתית: סיבים שיוצאים מהאישון, טבעת בהירה סביבו (צווארון), נקודות כהות וטבעת כהה בשוליים
const irisTexture = () => canvasTexture(256, (g, n) => {
  const c = n / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0.32, '#6e5a34');
  grad.addColorStop(0.38, '#a87c3c');
  grad.addColorStop(0.45, '#3a74ac');
  grad.addColorStop(0.85, '#2f6fa8');
  grad.addColorStop(0.95, '#285f95');
  grad.addColorStop(1, '#13253a');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2, r0 = c * (0.32 + Math.random() * 0.1), r1 = c * (0.7 + Math.random() * 0.3);
    g.strokeStyle = Math.random() < 0.5 ? `rgba(175,215,245,${0.08 + Math.random() * 0.18})` : `rgba(20,30,40,${0.1 + Math.random() * 0.2})`;
    g.lineWidth = 0.6 + Math.random() * 1.4;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    g.quadraticCurveTo(c + Math.cos(a + 0.08) * (r0 + r1) / 2, c + Math.sin(a + 0.08) * (r0 + r1) / 2, c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = c * (0.5 + Math.random() * 0.35);
    g.fillStyle = 'rgba(25,30,35,0.35)';
    g.beginPath();
    g.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, 2 + Math.random() * 4, 1.5, a, 0, 7);
    g.fill();
  }
  g.strokeStyle = 'rgba(225,190,120,0.45)';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2, r = c * (0.41 + 0.02 * Math.sin(i * 1.7));
    g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  g.stroke();
  g.fillStyle = '#050608';
  g.beginPath();
  g.arc(c, c, c * 0.32, 0, 7);
  g.fill();
});

// עיניים: לובן העין, קשתית ואישון מתחת לקרנית השקופה והמבריקה, ועצב הראייה שיוצא מאחור אל המוח
function buildEyes() {
  const g = new THREE.Group();
  const cap = 0.5; // הזווית של פתח הלובן, שבו יושבות הקשתית והקרנית
  const white = wetMat('#f4f0e8', { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
  // הקשתית זוהרת מעט בצבעים של עצמה (emissiveMap), וכך גם ההדגשה של התחנה לא מלבינה אותה
  const tex = irisTexture();
  const iris = wetMat('#ffffff', { map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12, roughness: 0.6, clearcoat: 0, sheen: 0 });
  // הקרנית מוסיפה רק השתקפויות (חיבור צבעים), כך שהקשתית נראית דרכה גם כשהעין אטומה
  const cornea = new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.05, specularIntensity: 0.4, clearcoat: 1, clearcoatRoughness: 0.02, blending: THREE.AdditiveBlending, depthWrite: false });
  const nerve = wetMat('#eddcbc', { clearcoat: 0.4 });
  for (const e of EYES) {
    const s = Math.sign(e.c[0]);
    const ball = new THREE.Group();
    ball.position.copy(V(e.c));
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(e.r, 40, 28, 0, Math.PI * 2, cap, Math.PI - cap).rotateX(Math.PI / 2), white);
    const ir = new THREE.Mesh(new THREE.CircleGeometry(e.r * Math.sin(cap), 40), iris);
    ir.position.z = e.r * Math.cos(cap);
    const rc = e.r * 0.62;
    const cor = new THREE.Mesh(new THREE.SphereGeometry(rc, 32, 12, 0, Math.PI * 2, 0, Math.asin((e.r * Math.sin(cap)) / rc)).rotateX(Math.PI / 2), cornea);
    cor.position.z = e.r * Math.cos(cap) - Math.sqrt(rc * rc - (e.r * Math.sin(cap)) ** 2);
    cor.renderOrder = 1;
    ball.add(sclera, ir, cor);
    const on = new THREE.Mesh(tubeGeometry([[e.c[0] - s * 0.003, e.c[1], e.c[2] - e.r * 0.9], [s * 0.022, 1.643, 0.036], [s * 0.012, 1.645, 0.02], [0, 1.646, 0.012], [-s * 0.016, 1.648, 0.0]], 0.0022), nerve); // שני העצבים מצטלבים (ההצטלבות) וממשיכים למוח
    g.add(ball, on);
  }
  return g;
}

// שן לפי סוג: כדור שעובר עיצוב לכתר מרובע עם חוד (ניב), שפה חדה (חותכת) או פסגות ותלמים (טוחנת). הכתר כלפי +y
function toothGeometry(type, w, h, d) {
  const geo = new THREE.SphereGeometry(1, 16, 12);
  const p = geo.attributes.position;
  const sq = (v) => Math.sign(v) * Math.abs(v) ** 0.7;
  for (let i = 0; i < p.count; i++) {
    let x = sq(p.getX(i)), y = p.getY(i), z = sq(p.getZ(i));
    const top = Math.max(0, y);
    const neck = 0.8 + 0.2 * THREE.MathUtils.smoothstep(y, -1, 0); // צוואר השן צר יותר
    if (type === 'incisor') z *= 1 - 0.65 * top;
    if (type === 'canine') {
      z *= 1 - 0.4 * top;
      y += 0.45 * top * (1 - Math.abs(x)) ** 2;
    }
    if (type === 'premolar') y -= 0.3 * top * Math.exp(-((z / 0.35) ** 2));
    if (type === 'molar') y -= 0.28 * top * Math.min(1, Math.exp(-((z / 0.3) ** 2)) + Math.exp(-((x / 0.3) ** 2)));
    p.setXYZ(i, x * neck * w * 0.5, (y + 1) * h * 0.5, z * neck * d * 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}

// שיניים מסוגים שונים לאורך קשת הלסת, חניכיים ורודות סביב הצווארים, ולשון עם פטמות טעם
function buildMouth() {
  // מהאמצע החוצה: חותכת מרכזית, חותכת צידית, ניב, שתי מלתעות ושתי טוחנות. [סוג, רוחב, גובה, עובי] במטרים
  const TEETH = [['incisor', 0.0082, 0.0095, 0.0065], ['incisor', 0.0064, 0.0085, 0.006], ['canine', 0.0074, 0.0098, 0.0075], ['premolar', 0.0068, 0.0078, 0.0085], ['premolar', 0.0064, 0.0074, 0.0085], ['molar', 0.0098, 0.0068, 0.0102], ['molar', 0.009, 0.0066, 0.0098]];
  const W = 0.027, D = 0.042, Z0 = 0.03, OCC = 1.56; // הקשת: x = W·sin(t), z = Z0 + D·cos(t); OCC – הגובה שבו השיניים נפגשות
  const at = (t) => new THREE.Vector3(W * Math.sin(t), 0, Z0 + D * Math.cos(t));
  const len = [0];
  for (let i = 1; i <= 150; i++) len.push(len[i - 1] + at((i * 1.55) / 150).distanceTo(at(((i - 1) * 1.55) / 150)));
  const tAt = (l) => (len.findIndex((v) => v >= l) * 1.55) / 150;
  const teeth = [], gums = [];
  for (const up of [1, -1]) {
    const row = TEETH.map(([type, w, h, d], i) => [type, up < 0 && i < 2 ? w * 0.72 : w, h, d]); // החותכות התחתונות צרות יותר
    const k = (len[150] * 0.96) / row.reduce((a, r) => a + r[1], 0);
    let l = 0;
    const slots = row.map(([type, w, h, d]) => ({ type, h, d, w: w * k, l0: l, l1: (l += w * k) }));
    for (const s of [1, -1]) {
      for (const q of slots) {
        const t = s * tAt((q.l0 + q.l1) / 2);
        const n = new THREE.Vector3(D * Math.sin(t), 0, W * Math.cos(t)).normalize();
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(n.z, 0, -n.x), new THREE.Vector3(0, -up, 0), n.clone().multiplyScalar(-up));
        m.setPosition(at(t).setY(OCC + up * (q.h + 0.0005)));
        teeth.push(toothGeometry(q.type, q.w * 0.96, q.h, q.d).applyMatrix4(m));
      }
    }
    // החניכיים: קשת שעוטפת את צווארי השיניים מבחוץ ומבפנים. השוליים מתקרבים אל קצה השן בין השיניים, כמו באמת
    const pos = [], idx = [], N = 72, M = 10;
    for (let i = 0; i <= N; i++) {
      const t = -1.52 + (3.04 * i) / N;
      const l = len[Math.round((Math.abs(t) / 1.55) * 150)];
      const q = slots.find((v) => l <= v.l1) || slots[slots.length - 1];
      const margin = OCC + up * (q.h * 0.62 + 0.0016 * Math.sin((Math.PI * (l - q.l0)) / q.w));
      const n = new THREE.Vector3(D * Math.sin(t), 0, W * Math.cos(t)).normalize();
      const e = Math.min(1, (1.52 - Math.abs(t)) / 0.06); // בקצוות הקשת החניכיים נסגרות
      for (let j = 0; j <= M; j++) {
        const f = (Math.PI * j) / M;
        const p = at(t).addScaledVector(n, Math.cos(f) * (q.d * 0.5 + 0.0012) * e);
        pos.push(p.x, margin + up * Math.sin(f) * 0.008 * e, p.z);
        if (i < N && j < M) idx.push(i * (M + 1) + j, (i + 1) * (M + 1) + j, i * (M + 1) + j + 1, (i + 1) * (M + 1) + j, (i + 1) * (M + 1) + j + 1, i * (M + 1) + j + 1);
      }
    }
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    gums.push(geo);
  }
  const toothMat = wetMat('#f6f1e2', { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0 });
  const gumMat = wetMat('#e8959b', { roughness: 0.5, side: THREE.DoubleSide });
  const tongue = new THREE.Mesh(tongueGeometry(), wetMat('#d9737d', { roughness: 0.65, clearcoat: 0.6, bumpMap: papillae(), bumpScale: 2 }));
  tongue.position.set(0, 1.55, 0.034);
  return [new THREE.Mesh(mergeGeometries(teeth), toothMat), new THREE.Mesh(mergeGeometries(gums), gumMat), tongue];
}

// הלשון: רחבה ועבה מאחור, מתחדדת לקצה מעוגל מלפנים, עם תלם באמצע
function tongueGeometry() {
  const geo = new THREE.SphereGeometry(1, 48, 32);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const front = Math.max(0, z);
    x *= 1 - 0.35 * front * front;
    if (y > 0) y = y * 0.75 - 0.22 * Math.exp(-((x / 0.15) ** 2)) * y * (0.4 + 0.6 * front);
    else y *= 0.6;
    p.setXYZ(i, x * 0.019, y * 0.009 - 0.005 * Math.min(0, z) ** 2, z * (z < 0 ? 0.02 : 0.032)); // השורש קצר, עגול ויורד מעט אל הגרון, בלי חוד
  }
  geo.computeVertexNormals();
  return geo;
}

// פטמות הטעם: נקודות קטנות ובולטות (מפת בליטות)
const papillae = () => canvasTexture(256, (g, n) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, n, n);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.5})`;
    g.beginPath();
    g.arc(Math.random() * n, Math.random() * n, 0.6 + Math.random() * 1.3, 0, 7);
    g.fill();
  }
});

// כיס המרה: אגס ירוק שהתחתית שלו מציצה מתחת לשפת הכבד, והצוואר פונה למעלה ואחורה
function buildGallbladder() {
  const prof = [[0, 0], [0.006, 0.001], [0.0105, 0.006], [0.0115, 0.014], [0.0105, 0.024], [0.007, 0.034], [0.0035, 0.041], [0.0025, 0.046]];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24);
  const fundus = V(GALLBLADDER.c).add(V([-0.002, -0.006, 0.006]));
  const neck = V(GALLBLADDER.c).add(V([0.004, 0.016, -0.03]));
  const mesh = new THREE.Mesh(geo, wetMat('#5d8f3e', { clearcoat: 1, clearcoatRoughness: 0.1 }));
  mesh.position.copy(fundus);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), neck.sub(fundus).normalize());
  return mesh;
}

function addRuntimeParts() {
  addEntry(buildEyes(), 'organs', 'eyes');
  for (const m of buildMouth()) addEntry(m, 'organs', 'mouth');
  addEntry(new THREE.Mesh(tubeGeometry(ESOPHAGUS, 0.0075), wetMat('#e9a3a0')), 'organs', 'mouth');
  // הסימפונות של האונות העליונות מתקרבים לאמצע, כי קודקוד הריאה יושב בתוך הצלע הראשונה הצרה (כדי שלא יבלטו מחוץ לריאה)
  const bronchi = BRONCHI.map((b) => b.map(([x, y, z]) => [x * (1 - 6 * Math.max(0, y - 1.33)), y, z]));
  addEntry(new THREE.Mesh(mergeGeometries([tubeGeometry(TRACHEA, 0.0085, 0.008), tubes(bronchi, 0.005, 0.008)]), tracheaMat), 'organs', 'lungs');
  addEntry(buildGallbladder(), 'organs', 'liver');
  const ureters = KIDNEYS.map((k) => [k.hilum, [k.s * 0.04, 0.98, -0.03], [k.s * 0.03, 0.91, 0.015], [k.s * 0.014, 0.885, 0.025]]);
  addEntry(new THREE.Mesh(tubes(ureters, 0.0025), wetMat('#ead3a0')), 'organs', 'kidneys');
  addGlow(addEntry(new THREE.Mesh(tubes(ARTERIES, 0.001), arteryMat), 'blood', 'blood'), new THREE.Color('#ff2a1c').multiplyScalar(0.3), arteryMat.emissiveMap);
  addGlow(addEntry(new THREE.Mesh(tubes(VEINS, 0.001), veinMat), 'blood', 'blood'), new THREE.Color('#3f62ff').multiplyScalar(0.3), veinMat.emissiveMap);
  const nerves = mergeGeometries([tubeGeometry(SPINAL_CORD, 0, 0.12), tubes(NERVES, 0.0009, 0.12)]);
  addGlow(addEntry(new THREE.Mesh(nerves, nerveMat), 'nerves', 'nerves'), new THREE.Color('#ffd23a').multiplyScalar(0.8), nerveMat.emissiveMap);
}

// החלקים שנבנים ב־Worker (anatomy.js)
const PART_INFO = {
  // הצבע האמיתי של האיברים מגיע מ־anatomy.js (צבע לכל נקודה), ולכן כאן לבן
  heart: ['organs', 'heart', '#ffffff'],
  lungs: ['organs', 'lungs', '#ffffff'],
  brain: ['organs', 'brain', '#ffffff'],
  stomach: ['organs', 'stomach', '#ffffff'],
  liver: ['organs', 'liver', '#ffffff'],
  smallIntestine: ['organs', 'intestines', '#ffffff'],
  colon: ['organs', 'intestines', '#ffffff'],
  kidneys: ['organs', 'kidneys', '#ffffff'],
  bladder: ['organs', 'kidneys', '#ffffff'],
  skeleton: ['skeleton', 'skeleton', '#efe6d2'],
};

function meshFrom(m, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.color, 3, true)); // צבע לכל נקודה + הצללה בקפלים
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, material);
}

// הלב והריאות זזים סביב המרכז שלהם, ולכן הם בתוך קבוצה שהמרכז שלה במקום הנכון
function pivoted(mesh, center) {
  const g = new THREE.Group();
  g.position.copy(center);
  mesh.position.sub(center);
  g.add(mesh);
  return g;
}

let loadedParts = 0;
function onPart({ id, meshes }) {
  if (id === 'body' || id === 'muscles') {
    for (const m of meshes) {
      if (m.layer === 'skin') {
        const mesh = meshFrom(m, skinMat);
        mesh.renderOrder = 10;
        addEntry(mesh, 'skin', 'skin');
      } else addEntry(meshFrom(m, muscleMat), 'muscles', 'muscles').mats[0].onBeforeCompile = muscleMat.onBeforeCompile; // השכפול לא שומר את onBeforeCompile
    }
  } else {
    const [layer, station, color] = PART_INFO[id];
    // לשלד חומר לבן: הגוון (שנהב, סחוס כחלחל, שיניים) מגיע מהצבע של כל נקודה, ונראה כמו עצם מט ולא מבריק
    const material = id === 'skeleton' ? organMat('#fff', { roughness: 0.58, clearcoat: 0.12, clearcoatRoughness: 0.6, sheen: 0.25, sheenColor: new THREE.Color('#fff2dc') }) : wetMat(color);
    const geos = meshes.map((m) => meshFrom(m, material).geometry);
    material.vertexColors = true; // רק לחלקים מ־anatomy.js יש צבע לכל נקודה
    let mesh = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], material);
    if (id === 'heart') mesh = animated.heart = pivoted(mesh, V(HEART.c));
    if (id === 'lungs') mesh = animated.lungs = pivoted(mesh, new THREE.Vector3(0, 1.3, 0));
    addEntry(mesh, layer, station);
  }
  loadedParts++;
  $('loading').textContent = `בונים את הגוף… ${Math.round((loadedParts / 12) * 100)}%`;
}

// אותו מספר גרסה כמו main.js, כדי שאחרי עדכון ה־Worker לא ייטען מהמטמון הישן
const worker = new Worker(new URL(`./anatomy-worker.js${new URL(import.meta.url).search}`, import.meta.url), { type: 'module' });
worker.onmessage = ({ data }) => {
  if (data.done) {
    worker.terminate(); // משחרר את הזיכרון של הבנייה
    $('loading').hidden = true;
    addRuntimeParts();
    return;
  }
  onPart(data);
};
worker.postMessage({ q: weakDevice || phone() ? 1.3 : 1 });

// ---------- שכבות ----------
const LAYERS = [
  ['skin', '🧍', 'עור'],
  ['muscles', '💪', 'שרירים'],
  ['skeleton', '🦴', 'שלד'],
  ['organs', '🫀', 'איברים'],
  ['blood', '🩸', 'דם'],
  ['nerves', '⚡', 'עצבים'],
];
const DEFAULT_LAYERS = ['skin', 'organs'];
const layersOn = new Set(DEFAULT_LAYERS);
for (const [id, emoji, name] of LAYERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-small layer-btn';
  b.dataset.layer = id;
  b.innerHTML = `<span aria-hidden="true">${emoji}</span> ${name}`;
  b.addEventListener('click', () => {
    if (layersOn.has(id)) layersOn.delete(id);
    else layersOn.add(id);
    syncLayerButtons();
  });
  $('layers').appendChild(b);
}
function syncLayerButtons() {
  for (const b of $('layers').querySelectorAll('[data-layer]')) {
    const on = layersOn.has(b.dataset.layer);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
function setLayers(list) {
  layersOn.clear();
  list.forEach((l) => layersOn.add(l));
  syncLayerButtons();
}
syncLayerButtons();

// ---------- תצוגה לכל תחנה ----------
// t – לאן מסתכלים, d – מרחק, az – זווית סביב הגוף (0 = מלפנים, π = מאחור), layers – אילו שכבות דולקות
const OVERVIEW = { t: [0, 0.95, 0], d: 3.1, az: 0.3 };
const VIEWS = {
  skin: { t: [0, 0.95, 0], d: 3.1, az: 0.35, layers: ['skin'], solid: true },
  skeleton: { t: [0, 0.95, 0], d: 3.1, az: 0.4, layers: ['skin', 'skeleton'] },
  muscles: { t: [0, 0.98, 0], d: 3.0, az: -0.35, layers: ['muscles'] },
  brain: { t: [0, 1.65, 0], d: 0.62, az: 0.7, layers: ['skin', 'organs'] },
  nerves: { t: [0, 0.95, 0], d: 3.1, az: 2.6, layers: ['skin', 'nerves', 'skeleton'] },
  eyes: { t: [0, 1.64, 0.04], d: 0.42, az: 0.45, layers: ['skin', 'organs'] },
  lungs: { t: [0, 1.29, 0], d: 0.95, az: 0.25, layers: ['skin', 'organs'] },
  heart: { t: [0.015, 1.26, 0.03], d: 0.62, az: 0.35, layers: ['skin', 'organs', 'blood'] },
  blood: { t: [0, 0.95, 0], d: 3.1, az: 0.3, layers: ['skin', 'blood'] },
  mouth: { t: [0, 1.53, 0.03], d: 0.6, az: 1.1, layers: ['skin', 'organs'] },
  stomach: { t: [0.03, 1.1, 0.03], d: 0.75, az: 0.35, layers: ['skin', 'organs'] },
  liver: { t: [-0.03, 1.12, 0.03], d: 0.75, az: -0.4, layers: ['skin', 'organs'] },
  intestines: { t: [0, 0.97, 0.03], d: 0.8, az: 0.2, layers: ['skin', 'organs'] },
  kidneys: { t: [0, 1.0, -0.03], d: 0.95, az: Math.PI - 0.3, layers: ['skin', 'organs'] },
};

let focus = null; // התחנה שמודגשת עכשיו
let solidSkin = false;
let tween = null;

function viewDistance(d) {
  // במסך צר (טלפון לאורך) צריך להתרחק כדי שהגוף ייכנס
  return d * Math.max(1, 0.75 / camera.aspect);
}

function flyTo(view, duration = 1.4) {
  const t = V(view.t);
  const d = viewDistance(view.d);
  const off = new THREE.Vector3(Math.sin(view.az) * Math.cos(0.12), Math.sin(0.12), Math.cos(view.az) * Math.cos(0.12)).multiplyScalar(d);
  // מסתובבים בדרך הקצרה סביב הגוף
  const from = camera.position.clone().sub(controls.target);
  tween = { t0: performance.now(), dur: duration * 1000, fromT: controls.target.clone(), toT: t, fromS: new THREE.Spherical().setFromVector3(from), toS: new THREE.Spherical().setFromVector3(off) };
  let dth = tween.toS.theta - tween.fromS.theta;
  dth = ((dth + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  tween.toS.theta = tween.fromS.theta + dth;
  controls.autoRotate = false;
}

function updateTween() {
  if (!tween) return;
  const k = Math.min(1, (performance.now() - tween.t0) / tween.dur);
  const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
  controls.target.lerpVectors(tween.fromT, tween.toT, e);
  // המרחק משתנה בסולם לוגריתמי, כמו זום
  const r = Math.exp(Math.log(tween.fromS.radius) + (Math.log(tween.toS.radius) - Math.log(tween.fromS.radius)) * e);
  const s = new THREE.Spherical(r, tween.fromS.phi + (tween.toS.phi - tween.fromS.phi) * e, tween.fromS.theta + (tween.toS.theta - tween.fromS.theta) * e);
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
  if (k >= 1) tween = null;
}

function focusStation(id) {
  focus = id;
  const view = id ? VIEWS[id] : null;
  setLayers(view?.layers || DEFAULT_LAYERS);
  solidSkin = !!view?.solid;
  flyTo(view || OVERVIEW);
  markActive(id);
}

// השקיפות של כל חלק נקבעת לפי השכבות והתחנה, ומשתנה בהדרגה
function updateEntries(dt) {
  const k = 1 - Math.exp(-dt * 6);
  for (const e of entries) {
    let target = layersOn.has(e.layer) ? 1 : 0;
    // בתחנה: מה ששייך לה מודגש, ושאר האיברים מתעמעמים כדי לא להסתיר
    if (target && focus && e.station !== focus && e.layer !== 'skin') target = e.layer === 'organs' ? 0.22 : 0.18;
    e.cur += (target - e.cur) * k;
    if (Math.abs(target - e.cur) < 0.002) e.cur = target;
    e.mesh.visible = e.cur > 0.01;
    if (e.layer === 'skin') continue;
    const transparent = e.cur < 0.99;
    // הדגשה עדינה של מה שמסבירים עכשיו
    const glow = focus && e.station === focus ? 0.12 + 0.08 * Math.sin(performance.now() / 300) : 0;
    for (const m of e.mats) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = e.cur;
      if (m.emissive && !m.emissiveMap) m.emissive.copy(m.color).multiplyScalar(glow);
    }
  }
  const skin = entries.find((e) => e.layer === 'skin');
  if (skin) {
    skinUniforms.uOpacity.value = skin.cur;
    skinUniforms.uSolid.value += ((solidSkin ? 1 : 0) - skinUniforms.uSolid.value) * k;
    skinMat.depthWrite = skinUniforms.uSolid.value > 0.98;
  }
}

// ---------- תנועה: לב פועם, נשימה, דם זורם, אותות בעצבים ----------
const BPM = 90; // בערך הדופק של ילד
const BREATHS = 20;
const startTime = performance.now();
function updateLife(t, dt) {
  const focusBoost = (id) => (focus === id ? 1.8 : 1);
  if (animated.heart) {
    const ph = (t * BPM) / 60 % 1;
    const beat = Math.exp(-((ph - 0.08) ** 2) / 0.002) + 0.5 * Math.exp(-((ph - 0.3) ** 2) / 0.003);
    animated.heart.scale.setScalar(1 + 0.04 * focusBoost('heart') * beat);
  }
  if (animated.lungs) {
    const br = 0.5 - 0.5 * Math.cos((t * BREATHS * 2 * Math.PI) / 60);
    const a = 0.025 * focusBoost('lungs');
    animated.lungs.scale.set(1 + a * br, 1 + a * 0.6 * br, 1 + a * br);
  }
  arteryMat.emissiveMap.offset.x -= dt * 1.2;
  veinMat.emissiveMap.offset.x -= dt * 0.7;
  nerveMat.emissiveMap.offset.x -= dt * 3;
  updateLive();
}

// מונה חי בחלון: כמה פעמים הלב פעם (או כמה נשימות) מאז שנכנסתם
function updateLive() {
  const live = selectedStation?.live;
  const el = $('panel-live');
  el.hidden = !live || $('panel').hidden;
  if (el.hidden) return;
  const minutes = (performance.now() - startTime) / 60000;
  el.textContent = live === 'beats'
    ? `❤️ מאז שנכנסתם לאתר, הלב שלכם פעם בערך ${Math.round(minutes * BPM).toLocaleString('he-IL')} פעמים`
    : `🫁 מאז שנכנסתם לאתר, נשמתם בערך ${Math.round(minutes * BREATHS).toLocaleString('he-IL')} פעמים`;
}

// ---------- בחירה בעכבר או במגע ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickable.filter((m) => m.userData.entry.cur > 0.15 && m.userData.entry.mesh.visible), false);
  // העור השקוף לא "תופס" לחיצות, אלא אם אין שום דבר אחר מאחוריו
  const solid = hits.find((h) => entryOf(h.object).layer !== 'skin' && entryOf(h.object).cur > 0.5) || hits.find((h) => entryOf(h.object).layer !== 'skin');
  return (solid || hits[0]) ? entryOf((solid || hits[0]).object).station : null;
}
const entryOf = (o) => o.userData.entry;

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
  controls.autoRotate = false;
  tween = null;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const id = pick(e);
  if (id) userSelect(id);
});
let hoverAt = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons) return ($('hover').hidden = true);
  const now = performance.now();
  if (now - hoverAt < 80) return;
  hoverAt = now;
  const id = pick(e);
  $('hover').hidden = !id;
  renderer.domElement.style.cursor = id ? 'pointer' : '';
  if (id) {
    $('hover').textContent = `${stationById[id].emoji} ${stationById[id].name}`;
    $('hover').style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
  }
});
renderer.domElement.addEventListener('pointerleave', () => ($('hover').hidden = true));

// ---------- בורר האיברים בתחתית ----------
for (const s of STATIONS) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.dataset.id = s.id;
  chip.innerHTML = `<span class="ball-emoji" aria-hidden="true">${s.emoji}</span><span>${s.name}</span>`;
  chip.addEventListener('click', () => userSelect(s.id));
  $('chooser').appendChild(chip);
}
{
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.innerHTML = '<span class="ball-emoji" aria-hidden="true">📖</span><span>מילון</span>';
  chip.addEventListener('click', () => openGlossary());
  $('chooser').appendChild(chip);
}
function markActive(id) {
  for (const c of $('chooser').querySelectorAll('.chip[data-id]')) c.classList.toggle('active', c.dataset.id === id);
  $('chooser').querySelector('.chip.active')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

// ---------- הקריין ואופק ----------
const narrator = new Narrator();
let voiceOn = true;
const presenterEl = $('presenter');
const presenter = new Presenter(presenterEl);
presenter.setSize(presenterEl.clientWidth, presenterEl.clientHeight);
let guideOn = true;
let lookSide = 0;
let presenterPos = '';

const chooserTop = () => {
  const c = $('chooser');
  return c.offsetParent ? c.getBoundingClientRect().top - 4 : window.innerHeight - 8;
};

// ממקם את אופק ליד מה שהוא מסביר: כרטיס הפתיחה, חלון ההסבר, או בפינה
function placePresenter() {
  const w = window.innerWidth;
  const pw = presenterEl.clientWidth, ph = presenterEl.clientHeight;
  let x, y;
  lookSide = 0;
  if (!$('intro').hidden) {
    const r = document.querySelector('.intro-card').getBoundingClientRect();
    if (!phone() && r.left > pw - 20) {
      x = r.left - pw + 20;
      y = r.bottom - ph;
      lookSide = 1;
    } else {
      x = r.right - pw + 4;
      y = r.top - ph + 34;
    }
  } else if (infoBox()) {
    const r = infoBox().getBoundingClientRect();
    if (phone()) {
      x = w - pw - 4;
      y = r.top - ph + 18;
    } else {
      y = Math.min(r.bottom, chooserTop()) - ph;
      if (r.right - 6 + pw <= w + 20) {
        x = r.right - 6;
        lookSide = -1;
      } else {
        x = r.left - pw + 6;
        lookSide = 1;
      }
    }
  } else if (phone()) {
    x = w - pw - 4;
    y = chooserTop() - ph + 14;
  } else {
    x = 12;
    y = chooserTop() - ph;
  }
  const pos = `translate(${Math.round(x)}px, ${Math.round(Math.max(0, y))}px)`;
  if (pos !== presenterPos) presenterEl.style.transform = presenterPos = pos;
}

$('btn-guide').addEventListener('click', () => {
  guideOn = !guideOn;
  presenterEl.hidden = !guideOn;
  $('btn-guide').setAttribute('aria-pressed', String(guideOn));
  $('btn-guide').textContent = guideOn ? '👦 הסתרת אופק המדריך' : '👦 הצגת אופק המדריך';
});

// מצב קצר (ברירת המחדל): בכל תחנה מוקראים רק המשפטים שב־short, ובחלון יש כפתור "לשמוע עוד".
let shortMode = true;
try {
  shortMode = localStorage.getItem('narrationLength') !== 'full';
} catch {}
function setShortMode(on) {
  shortMode = on;
  try {
    localStorage.setItem('narrationLength', on ? 'short' : 'full');
  } catch {}
  for (const b of document.querySelectorAll('.mode-toggle [data-mode]')) {
    const pressed = (b.dataset.mode === 'short') === on;
    b.classList.toggle('btn-primary', pressed);
    b.setAttribute('aria-pressed', String(pressed));
  }
}
for (const b of document.querySelectorAll('.mode-toggle [data-mode]')) b.addEventListener('click', () => setShortMode(b.dataset.mode === 'short'));
setShortMode(shortMode);

// ---------- חלון ההסבר ----------
let panelFull = null;
let currentText = '';
let currentSentence = 0;
let lastOnEnd = null;
let selectedStation = null;

function renderPanelText(text, funFact) {
  const used = new Set();
  $('panel-text').replaceChildren(
    ...splitSentences(text).flatMap((s) => {
      const span = document.createElement('span');
      span.append(...linkTerms(s, used));
      return [span, ' '];
    }),
  );
  $('panel-fun').replaceChildren(...linkTerms(funFact, used));
}

function showPanel({ title, subtitle = '', emoji = '', text, short = null, facts = [], funFact = '' }) {
  $('panel').hidden = false;
  document.body.classList.add('panel-open');
  $('panel-title').textContent = title;
  $('panel-subtitle').textContent = subtitle;
  $('panel-emoji').textContent = emoji;
  $('panel-emoji').hidden = !emoji;
  dismissTerm();
  hideAsk();
  const all = splitSentences(text);
  const useShort = shortMode && short?.length && short.length < all.length;
  panelFull = useShort ? { text, all, short, funFact } : null;
  if (useShort) text = short.map((i) => all[i]).join(' ');
  renderPanelText(text, funFact);
  $('panel-more').hidden = !useShort;
  $('panel-facts').replaceChildren(
    ...facts.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  $('panel').scrollTop = 0;
  currentText = text;
  $('panel').classList.remove('swap');
  void $('panel').offsetWidth;
  $('panel').classList.add('swap');
}

function speakCurrent(onEnd, from = 0) {
  const spans = [...$('panel-text').querySelectorAll(':scope > span')];
  const all = splitSentences(currentText);
  const idx = Array.isArray(from) ? from : all.map((_, i) => i).slice(from);
  lastOnEnd = onEnd;
  setListening(true);
  narrator.speak(idx.map((i) => all[i]).join(' '), {
    onSentence: (k) => {
      const i = idx[k];
      currentSentence = i;
      if (i > 0 && /!\s*$/.test(spans[i]?.textContent || '')) presenter.play('open', 2);
      else if (k === 0 && selectedStation) presenter.play('show', 2.6);
      spans.forEach((s, j) => s.classList.toggle('speaking', i === j));
      spans[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    onEnd: () => {
      spans.forEach((s) => s.classList.remove('speaking'));
      setListening(false);
      onEnd?.();
    },
  });
}

function showMore() {
  if (!panelFull) return;
  const { text, all, short, funFact } = panelFull;
  const onEnd = lastOnEnd;
  if (tour) clearTimeout(tour.timer);
  stopSpeaking();
  panelFull = null;
  currentText = text;
  renderPanelText(text, funFact);
  $('panel-more').hidden = true;
  const rest = all.map((_, i) => i).filter((i) => !short.includes(i));
  if (voiceOn) speakCurrent(onEnd, rest);
}
$('panel-more').addEventListener('click', showMore);

function stopSpeaking() {
  narrator.stop();
  $('panel-text').querySelectorAll('span').forEach((s) => s.classList.remove('speaking'));
  setListening(false);
}

let listening = false;
function setListening(on) {
  listening = on;
  $('btn-listen').textContent = on ? '⏹ עצירה' : '🔊 הקשיבו';
}
$('btn-listen').addEventListener('click', () => {
  hideAsk();
  if (listening) stopSpeaking();
  else speakCurrent();
});

function showStation(id) {
  const s = stationById[id];
  selectedStation = s;
  focusStation(id);
  showPanel({ title: s.name, subtitle: s.subtitle, emoji: s.emoji, text: s.narration, short: s.short, facts: s.facts, funFact: s.funFact });
}

function userSelect(id) {
  if (tour) endTour();
  narrator.unlock();
  showStation(id);
  if (voiceOn) speakCurrent();
}

function closePanel() {
  stopSpeaking();
  $('panel').hidden = true;
  document.body.classList.remove('panel-open');
  selectedStation = null;
  focusStation(null);
}
$('panel-close').addEventListener('click', () => {
  if (tour) endTour();
  closePanel();
});
$('btn-overview').addEventListener('click', () => {
  if (tour) endTour();
  if (!$('panel').hidden) closePanel();
  else focusStation(null);
});

// ---------- מילון מושגים ----------
const isLetter = (ch) => !!ch && /[א-ת]/.test(ch);

function linkTerms(text, used) {
  const nodes = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    let match = null;
    if (!isLetter(text[i - 1])) {
      match = GLOSSARY_FORMS.find(({ form }) => text.startsWith(form, i) && !isLetter(text[i + form.length]));
    }
    if (!match || used.has(match.term.id)) {
      if (match) {
        plain += match.form;
        i += match.form.length;
      } else plain += text[i++];
      continue;
    }
    if (plain) nodes.push(plain);
    plain = '';
    used.add(match.term.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'term';
    btn.textContent = match.form;
    btn.title = `מה זה ${match.term.title}?`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTerm(match.term);
    });
    nodes.push(btn);
    i += match.form.length;
  }
  if (plain) nodes.push(plain);
  return nodes;
}

const infoBox = () => (!$('term-card').hidden ? $('term-card') : !$('panel').hidden ? $('panel') : null);
let termState = null;
let currentTerm = null;
let termSpeaking = false;

function captureForTerm() {
  if (termState) return;
  termState = {
    resume: listening && !$('panel').hidden ? { index: currentSentence, onEnd: lastOnEnd } : null,
    tourWaiting: !!(tour && !listening),
  };
  if (tour) clearTimeout(tour.timer);
  stopSpeaking();
}

function openTerm(term, from = 'panel') {
  captureForTerm();
  termState.from = from;
  currentTerm = term;
  $('term-card').hidden = false;
  document.body.classList.add('term-open');
  $('term-view').hidden = false;
  $('term-list').hidden = true;
  $('term-emoji').textContent = term.emoji;
  $('term-title').textContent = term.title;
  $('term-text').replaceChildren(
    ...splitSentences(term.text).flatMap((s) => {
      const span = document.createElement('span');
      span.textContent = s;
      return [span, ' '];
    }),
  );
  $('term-back').textContent = from === 'list' ? 'חזרה למילון' : $('panel').hidden ? 'סגירה' : 'חזרה להסבר';
  $('term-card').scrollTop = 0;
  presenter.play('open', 2.4);
  if (voiceOn) speakTerm();
  else narrator.stop();
}

function speakTerm() {
  const spans = [...$('term-text').querySelectorAll('span')];
  termSpeaking = true;
  $('term-listen').textContent = '⏹ עצירה';
  narrator.speak(currentTerm.text, {
    onSentence: (i) => spans.forEach((s, j) => s.classList.toggle('speaking', i === j)),
    onEnd: () => {
      spans.forEach((s) => s.classList.remove('speaking'));
      termSpeaking = false;
      $('term-listen').textContent = '🔊 שוב';
    },
  });
}

function openGlossary() {
  captureForTerm();
  termState.from = 'list';
  narrator.stop();
  termSpeaking = false;
  $('term-card').hidden = false;
  document.body.classList.add('term-open');
  $('term-view').hidden = true;
  $('term-list').hidden = false;
  $('term-card').scrollTop = 0;
  presenter.play('open', 2);
}

for (const term of [...GLOSSARY].sort((a, b) => a.title.localeCompare(b.title, 'he'))) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = `${term.emoji} ${term.title}`;
  btn.addEventListener('click', () => openTerm(term, 'list'));
  $('term-grid').appendChild(btn);
}

// חוזרים מהמושג להסבר הכללי. אם אופק היה באמצע הסבר או סיור, הוא שואל אם להמשיך.
let pendingResume = null;
function closeTerm() {
  const st = termState;
  dismissTerm();
  if (!st || $('panel').hidden) return;
  const canResume = st.resume || (st.tourWaiting && tour && tour.index < tourSteps.length - 1);
  if (!canResume) return;
  pendingResume = st;
  $('ask-continue').hidden = false;
  $('panel').scrollTop = 0;
  presenter.play('open', 2);
  if (voiceOn) narrator.speak(CONTINUE_QUESTION);
}
function hideAsk() {
  $('ask-continue').hidden = true;
  pendingResume = null;
}
$('ask-yes').addEventListener('click', () => {
  const st = pendingResume;
  hideAsk();
  if (!st) return;
  if (st.resume) speakCurrent(st.resume.onEnd, st.resume.index);
  else if (tour && tour.index < tourSteps.length - 1) goToStep(tour.index + 1);
});
$('ask-no').addEventListener('click', () => {
  hideAsk();
  narrator.stop();
  presenter.play('wave', 1.5);
});
function dismissTerm() {
  if ($('term-card').hidden) return;
  if (termSpeaking) narrator.stop();
  termSpeaking = false;
  $('term-card').hidden = true;
  document.body.classList.remove('term-open');
  termState = null;
}
$('term-close').addEventListener('click', closeTerm);
$('term-back').addEventListener('click', () => (termState?.from === 'list' ? openGlossary() : closeTerm()));
$('term-all').addEventListener('click', openGlossary);
$('term-listen').addEventListener('click', () => {
  if (termSpeaking) {
    narrator.stop();
    termSpeaking = false;
    $('term-listen').textContent = '🔊 שוב';
    $('term-text').querySelectorAll('span').forEach((s) => s.classList.remove('speaking'));
  } else speakTerm();
});

// ---------- קול והגדרות ----------
$('btn-voice').addEventListener('click', () => {
  voiceOn = !voiceOn;
  $('btn-voice').textContent = voiceOn ? '🔊' : '🔇';
  $('btn-voice').title = voiceOn ? 'קריין פועל' : 'קריין כבוי';
  $('btn-voice').setAttribute('aria-pressed', String(voiceOn));
  if (!voiceOn) stopSpeaking();
});

const settingsEl = $('settings');
const percent = (v) => `${Math.round(v * 100)}%`;
function showSettings() {
  const { pitch, speed } = narrator.settings;
  $('pitch').value = pitch;
  $('rate').value = speed;
  $('pitch-value').textContent = percent(pitch);
  $('rate-value').textContent = percent(speed);
  const voice = narrator.hasRecordings ? 'הקול של אופק (קבצים מוקלטים)' : 'קול הדפדפן';
  const last = { files: 'הקול של אופק', browser: 'קול הדפדפן', none: 'בלי קול' }[narrator.status];
  $('voice-status').textContent = `קול זמין: ${voice}` + (last ? ` · הושמע לאחרונה: ${last}` : '') + (narrator.lastError ? ` · שגיאה: ${narrator.lastError}` : '');
}
function toggleSettings(open = settingsEl.hidden) {
  settingsEl.hidden = !open;
  $('btn-settings').setAttribute('aria-expanded', String(open));
  if (open) {
    showSettings();
    settingsEl.style.top = `${$('btn-settings').getBoundingClientRect().bottom + 8}px`;
  }
}
$('btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSettings();
});
document.addEventListener('pointerdown', (e) => {
  if (!settingsEl.hidden && !settingsEl.contains(e.target) && e.target !== $('btn-settings')) toggleSettings(false);
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && !settingsEl.hidden && toggleSettings(false));
$('pitch').addEventListener('input', () => {
  narrator.setSettings({ pitch: +$('pitch').value });
  showSettings();
});
$('rate').addEventListener('input', () => {
  narrator.setSettings({ speed: +$('rate').value });
  showSettings();
});
$('settings-reset').addEventListener('click', () => {
  narrator.setSettings(DEFAULT_SETTINGS);
  showSettings();
});
$('settings-test').addEventListener('click', () => {
  if (tour) endTour();
  stopSpeaking();
  narrator.unlock();
  presenter.play('wave', 2);
  narrator.speak(splitSentences(TOUR_INTRO[0].narration).slice(0, 2).join(' '));
});
// גובה הקול ומהירות הדיבור מוסתרים מהילדים: מופיעים אחרי חמש לחיצות מהירות על הכותרת "הגדרות" (או עם ‎?dev=1‎)
const devBox = $('dev-settings');
devBox.hidden = !new URLSearchParams(location.search).has('dev');
let devTaps = [];
settingsEl.querySelector('h2').addEventListener('click', () => {
  const now = performance.now();
  devTaps = [...devTaps.filter((t) => now - t < 4000), now];
  if (devTaps.length >= 5) {
    devTaps = [];
    devBox.hidden = false;
  }
});

// ---------- סיור מודרך ----------
const tourSteps = [...TOUR_INTRO.map((intro) => ({ intro })), ...STATIONS.map((s) => ({ station: s.id })), { intro: TOUR_OUTRO }];
let tour = null;

function startTour() {
  tour = { index: 0, timer: null };
  $('tourbar').hidden = false;
  document.body.classList.add('touring');
  goToStep(0);
}

function goToStep(i) {
  if (!tour) return;
  clearTimeout(tour.timer);
  $('layers').classList.remove('glow');
  tour.index = Math.max(0, Math.min(tourSteps.length - 1, i));
  const step = tourSteps[tour.index];
  $('tour-step').textContent = `${tour.index + 1} מתוך ${tourSteps.length}`;
  $('tour-prev').disabled = tour.index === 0;
  $('tour-next').textContent = tour.index === tourSteps.length - 1 ? 'סיום' : 'הבא ←';
  if (step.station) showStation(step.station);
  else {
    selectedStation = null;
    focusStation(null);
    presenter.play(step.intro === TOUR_OUTRO ? 'wave' : 'open', 2.6);
    showPanel({ title: step.intro.title, text: step.intro.narration, short: step.intro.short });
    if (step.intro.id === 'how') $('layers').classList.add('glow');
  }
  const advance = () => {
    if (!tour || tour.index === tourSteps.length - 1) return;
    tour.timer = setTimeout(() => goToStep(tour.index + 1), 700);
  };
  // משפט המעבר נאמר בזמן שהמצלמה זזה, וההסבר מתחיל רק אחרי שהגענו
  const bridge = step.station && stationById[step.station].bridge;
  if (voiceOn && bridge) {
    const index = tour.index;
    setListening(true);
    narrator.speak(bridge, {
      onEnd: () => {
        const go = () => {
          if (tour?.index !== index) return;
          if (tween) tour.timer = setTimeout(go, 100);
          else speakCurrent(advance);
        };
        go();
      },
    });
  } else if (voiceOn) speakCurrent(advance);
  else stopSpeaking();
}

function endTour() {
  if (!tour) return;
  clearTimeout(tour.timer);
  tour = null;
  $('layers').classList.remove('glow');
  $('tourbar').hidden = true;
  document.body.classList.remove('touring');
  stopSpeaking();
}
$('btn-tour').addEventListener('click', () => {
  narrator.unlock();
  startTour();
});
$('tour-prev').addEventListener('click', () => goToStep(tour.index - 1));
$('tour-next').addEventListener('click', () => {
  if (tour.index === tourSteps.length - 1) {
    endTour();
    closePanel();
  } else goToStep(tour.index + 1);
});
$('tour-stop').addEventListener('click', () => {
  endTour();
  closePanel();
});

// ---------- מסך פתיחה ----------
function closeIntro() {
  $('intro').hidden = true;
  setTimeout(() => narrator.preload(STATIONS.map((s) => s.narration)), 3000);
}
$('start-tour').addEventListener('click', () => {
  closeIntro();
  narrator.unlock();
  startTour();
});
$('start-free').addEventListener('click', () => {
  closeIntro();
  narrator.unlock();
  controls.autoRotate = true;
});
$('intro').addEventListener('click', (e) => {
  if (!e.target.closest('.intro-card')) $('start-free').click();
});
function updateVoiceNote() {
  const note = $('voice-note');
  note.hidden = narrator.hasHebrew;
  if (note.hidden) return;
  note.textContent = narrator.supported
    ? 'לא מצאנו במכשיר הזה קול שמדבר עברית, אז ההסברים יופיעו כטקסט בלבד. אפשר להוסיף קול עברי בהגדרות המכשיר (שפה ודיבור), או לנסות בדפדפן כרום.'
    : 'הדפדפן הזה לא תומך בהקראה, אז ההסברים יופיעו כטקסט בלבד.';
}
narrator.onVoiceChange = updateVoiceNote;
setTimeout(updateVoiceNote, 1200);

// ---------- המסך נשאר דולק בזמן ההסברים ----------
let wakeLock = null;
async function keepScreenOn() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {
    // לא נתמך או נחסם – המסך יתנהג כרגיל
  }
}
document.addEventListener('visibilitychange', keepScreenOn);
document.addEventListener('pointerdown', keepScreenOn, { passive: true });
keepScreenOn();

// ---------- לולאה ----------
// כשחלון ההסבר פתוח במחשב, מזיזים את מרכז התמונה הצידה, כדי שהגוף לא יסתתר מאחוריו
let viewShift = 0;
function updateViewOffset(dt) {
  const box = infoBox();
  let target = 0;
  if (box && !phone()) {
    const r = box.getBoundingClientRect();
    const center = window.innerWidth / 2;
    target = r.left > center ? -(r.width / 2) : r.width / 2; // החלון מימין – מזיזים שמאלה, ולהפך
    target *= 0.9;
  }
  viewShift += (target - viewShift) * (1 - Math.exp(-dt * 5));
  const w = window.innerWidth, h = window.innerHeight;
  if (Math.abs(viewShift) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(w, h, -viewShift, 0, w, h);
}

camera.position.set(0, 1.2, 4);
flyTo(OVERVIEW, 0.01);
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  updateTween();
  if (!tween) controls.update();
  updateEntries(dt);
  updateLife(t, dt);
  updateViewOffset(dt);
  scene.environmentRotation.y = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  renderer.render(scene, camera);
  if (glow) renderGlow();
  if (guideOn) {
    if (!$('intro').hidden && presenter.time > 0.5 && !presenter.gestureTime && Math.random() < dt / 5) presenter.play('wave', 2.5);
    placePresenter();
    presenter.update(dt, narrator.speaking, lookSide);
  }
  requestAnimationFrame(frame);
}
frame();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (glow) {
    const r = renderer.getPixelRatio() / 2;
    glow.target.setSize(w * r, h * r);
    glow.bloom.setSize(w * r, h * r);
  }
  presenter.setSize(presenterEl.clientWidth, presenterEl.clientHeight);
}
resize();
window.addEventListener('resize', resize);
presenter.play('wave', 3);

// גישה נוחה לבדיקות מהקונסול
window.body = { entries, narrator, presenter, showStation, focusStation };
