// מדפיס (כ־JSON) את כל המשפטים שהקריין מקריא, באותה חלוקה שבה משתמש האתר.
// משמש את tools/generate_audio.py.
import { splitSentences } from '../js/speech.js';
import { STATIONS, TOUR_INTRO, TOUR_OUTRO } from '../js/data.js';
import { GLOSSARY, CONTINUE_QUESTION } from '../js/glossary.js';

const texts = [
  ...[...TOUR_INTRO, ...STATIONS, TOUR_OUTRO].map((d) => d.narration),
  ...STATIONS.map((s) => s.bridge),
  ...GLOSSARY.map((g) => g.text),
  CONTINUE_QUESTION,
];
const sentences = [...new Set(texts.flatMap(splitSentences))];
process.stdout.write(JSON.stringify(sentences, null, 2));
