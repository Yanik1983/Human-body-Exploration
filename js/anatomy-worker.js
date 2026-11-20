// בונה את צורות הגוף ברקע ושולח כל חלק ברגע שהוא מוכן
// (anatomy.js נטען עם אותו מספר גרסה שה־Worker קיבל, כדי שלא יתערבבו קבצים ישנים וחדשים)
const anatomy = import(`./anatomy.js${self.location.search}`);

self.onmessage = async ({ data: { q } }) => {
  const { PARTS, buildPart } = await anatomy;
  for (const part of PARTS) {
    const meshes = buildPart(part, q);
    self.postMessage({ id: part.id, meshes }, meshes.flatMap((m) => [m.position.buffer, m.normal.buffer, m.color.buffer, m.index.buffer]));
  }
  self.postMessage({ done: true });
};
