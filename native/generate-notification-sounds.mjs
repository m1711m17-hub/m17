import fs from 'node:fs';
import path from 'node:path';

const presets = {
  soft: [[659,.38],[784,.38],[988,.52],[784,.38],[659,.38],[784,.38],[988,.52],[1175,.72]],
  crystal: [[784,.32],[988,.32],[1175,.42],[1319,.62],[1175,.32],[988,.32],[1175,.42],[1568,.82]],
  pulse: [[523,.42],[659,.42],[784,.58],[659,.42],[523,.42],[659,.42],[880,.58],[784,.72]],
  classic: [[880,.48],[784,.38],[698,.38],[784,.48],[880,.48],[988,.58],[880,.48],[784,.82]],
  calm: [[523,.48],[587,.42],[659,.48],[784,.72],[659,.48],[587,.42],[523,.58],[659,.82]],
  moonlight: [[523,.42],[659,.42],[784,.55],[1047,.72],[988,.42],[784,.42],[659,.55],[587,.42],[659,.55],[784,.85]],
  cinema: [[392,.55],[523,.45],[659,.55],[784,.8],[698,.55],[659,.45],[523,.65],[587,.5],[784,.65],[880,1]],
  piano: [[659,.3],[784,.35],[880,.55],[784,.35],[659,.45],[587,.4],[659,.35],[784,.5],[988,.65],[880,.9]],
  arabesque: [[440,.42],[494,.32],[587,.52],[659,.65],[587,.38],[523,.42],[494,.32],[440,.58],[523,.42],[587,.9]],
  sunrise: [[587,.4],[659,.4],[784,.48],[880,.55],[1047,.8],[880,.45],[784,.45],[659,.55],[784,.5],[988,.95]]
};
const sampleRate = 22050;
const output = 'android/app/src/main/res/raw';
fs.mkdirSync(output, { recursive: true });
for (const [name, notes] of Object.entries(presets)) {
  const samples = [];
  for (const [freq, seconds] of notes) {
    const count = Math.floor(seconds * sampleRate);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const fadeIn = Math.min(1, i / (sampleRate * .025));
      const fadeOut = Math.min(1, (count - i) / (sampleRate * .08));
      const env = Math.min(fadeIn, fadeOut);
      const fundamental = Math.sin(2 * Math.PI * freq * t);
      const harmonic = Math.sin(2 * Math.PI * freq * 2 * t) * .18;
      samples.push(Math.max(-1, Math.min(1, (fundamental + harmonic) * .48 * env)));
    }
    for (let i = 0; i < Math.floor(sampleRate * .065); i++) samples.push(0);
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(v * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(output, 'nexora_' + name + '.wav'), Buffer.concat([header, data]));
}
console.log('Generated ' + Object.keys(presets).length + ' NEXORA notification sounds.');
