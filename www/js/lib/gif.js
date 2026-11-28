// Tiny animated-GIF encoder with 1-bit transparency (no dependencies).
// frames: array of Uint8ClampedArray RGBA (all w*h). Pixels with alpha < 128 become transparent.
// Returns a Uint8Array. delayCs = frame delay in 1/100 s.

function buildPalette(frames, w, h) {
  // 5-bit-per-channel histogram, then median cut to 255 colours (index 255 = transparent).
  const hist = new Uint32Array(32768);
  const step = Math.max(1, Math.floor((w * h * frames.length) / 60000));
  let n = 0;
  for (const f of frames) for (let i = 0; i < w * h; i += 1) {
    if ((n++ % step) !== 0) continue;
    const o = i * 4; if (f[o + 3] < 128) continue;
    hist[((f[o] >> 3) << 10) | ((f[o + 1] >> 3) << 5) | (f[o + 2] >> 3)]++;
  }
  const items = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) items.push([k >> 10, (k >> 5) & 31, k & 31, hist[k]]);
  let boxes = [items.length ? items : [[0, 0, 0, 1]]];
  const range = (b) => {
    let mn = [31, 31, 31], mx = [0, 0, 0];
    for (const it of b) for (let c = 0; c < 3; c++) { if (it[c] < mn[c]) mn[c] = it[c]; if (it[c] > mx[c]) mx[c] = it[c]; }
    return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  };
  while (boxes.length < 255) {
    let bi = -1, bs = 0, bc = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; const r = range(b); const m = Math.max(...r); if (m > bs) { bs = m; bi = i; bc = r.indexOf(m); } });
    if (bi < 0 || bs === 0) break;
    const b = boxes[bi].sort((a, z) => a[bc] - z[bc]);
    let tot = 0; for (const it of b) tot += it[3];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i][3]; if (acc >= tot / 2) { cut = i + 1; break; } cut = i + 1; }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  const pal = new Uint8Array(256 * 3);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, t = 0;
    for (const it of b) { r += it[0] * it[3]; g += it[1] * it[3]; bl += it[2] * it[3]; t += it[3]; }
    t = t || 1;
    pal[i * 3] = Math.min(255, Math.round((r / t) * 8 + 4)); pal[i * 3 + 1] = Math.min(255, Math.round((g / t) * 8 + 4)); pal[i * 3 + 2] = Math.min(255, Math.round((bl / t) * 8 + 4));
  });
  const count = boxes.length;
  // lookup table bin -> nearest palette entry
  const lut = new Uint8Array(32768);
  for (let k = 0; k < 32768; k++) {
    const r = ((k >> 10) << 3) + 4, g = (((k >> 5) & 31) << 3) + 4, b2 = ((k & 31) << 3) + 4;
    let best = 0, bd = 1e9;
    for (let i = 0; i < count; i++) { const dr = r - pal[i * 3], dg = g - pal[i * 3 + 1], db = b2 - pal[i * 3 + 2]; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = i; } }
    lut[k] = best;
  }
  return { pal, lut };
}

function lzw(idx) {
  const minCode = 8, clear = 256, eoi = 257;
  const out = [];
  let cur = 0, shift = 0, size = minCode + 1, next = eoi + 1;
  let table = new Map();
  const emit = (c) => { cur |= c << shift; shift += size; while (shift >= 8) { out.push(cur & 255); cur >>>= 8; shift -= 8; } };
  emit(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (prefix << 8) | k, v = table.get(key);
    if (v === undefined) {
      emit(prefix);
      if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; table = new Map(); }
      else { if (next >= (1 << size)) size++; table.set(key, next++); }
      prefix = k;
    } else prefix = v;
  }
  emit(prefix); emit(eoi);
  if (shift > 0) out.push(cur & 255);
  return out;
}

// Floyd–Steinberg dithering to the shared palette (smooth gradients instead of banding / blocks).
function quantize(f, w, h, lut, pal) {
  const idx = new Uint8Array(w * h);
  const buf = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { buf[i * 3] = f[i * 4]; buf[i * 3 + 1] = f[i * 4 + 1]; buf[i * 3 + 2] = f[i * 4 + 2]; }
  const clampB = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (f[i * 4 + 3] < 128) { idx[i] = 255; continue; }
      const r = clampB(buf[i * 3]), g = clampB(buf[i * 3 + 1]), b = clampB(buf[i * 3 + 2]);
      const k = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]; idx[i] = k;
      const er = r - pal[k * 3], eg = g - pal[k * 3 + 1], eb = b - pal[k * 3 + 2];
      const add = (j, wt) => { buf[j * 3] += er * wt; buf[j * 3 + 1] += eg * wt; buf[j * 3 + 2] += eb * wt; };
      if (x + 1 < w) add(i + 1, 7 / 16);
      if (y + 1 < h) { if (x > 0) add(i + w - 1, 3 / 16); add(i + w, 5 / 16); if (x + 1 < w) add(i + w + 1, 1 / 16); }
    }
  }
  return idx;
}

export function encodeGif(frames, w, h, delayCs = 10) {
  const { pal, lut } = buildPalette(frames, w, h);
  const bytes = [];
  const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
  bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
  u16(w); u16(h); bytes.push(0xF7, 0, 0);           // global colour table, 256 entries
  for (let i = 0; i < 768; i++) bytes.push(pal[i]);
  bytes.push(0x21, 0xFF, 0x0B, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0); // loop forever
  let prev = null;
  for (const f of frames) {
    bytes.push(0x21, 0xF9, 4, 0x05, delayCs & 255, (delayCs >> 8) & 255, 255, 0); // keep previous frame + transparent idx 255
    bytes.push(0x2C); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    const full = quantize(f, w, h, lut, pal);
    const idx = new Uint8Array(full);
    // unchanged pixels become "transparent" so they keep the previous frame (much smaller files)
    if (prev) for (let i = 0; i < idx.length; i++) if (idx[i] === prev[i]) idx[i] = 255;
    prev = full;
    bytes.push(8);
    const data = lzw(idx);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); bytes.push(n); for (let j = 0; j < n; j++) bytes.push(data[i + j]); }
    bytes.push(0);
  }
  bytes.push(0x3B);
  return new Uint8Array(bytes);
}
