// วิเคราะห์รูปแต่ละใบ: วันเวลาที่ถ่าย, ลายนิ้วมือภาพ (ใช้หาภาพซ้ำ), ความคมชัด, แสง, สีสัน
// ใช้ได้ทั้งใน Web Worker และในหน้าเว็บโดยตรง
(function (root) {
  const ANALYZE_MAX = 640;  // ย่อรูปเหลือด้านยาวเท่านี้ก่อนวิเคราะห์
  const THUMB_MAX = 360;    // รูปย่อสำหรับแสดงผล
  const TILES = 6;          // แบ่งภาพเป็น 6x6 ช่องเพื่อหาส่วนที่คมที่สุด

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function canvasToBlob(c, type, quality) {
    if (c.convertToBlob) return c.convertToBlob({ type, quality });
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), type, quality));
  }

  // ---------- EXIF: วันเวลาที่ถ่าย ----------
  function readExifDate(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 12 || v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 10 <= v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA || marker === 0xFFD9) return null;
      const len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
        return readTiffDate(v, off + 10);
      }
      off += 2 + len;
    }
    return null;
  }
  function readTiffDate(v, t) {
    const le = v.getUint16(t) === 0x4949;
    const u16 = o => v.getUint16(o, le);
    const u32 = o => v.getUint32(o, le);
    const entries = ifd => {
      const out = {};
      const base = t + ifd;
      if (base + 2 > v.byteLength) return out;
      const n = u16(base);
      for (let i = 0; i < n; i++) {
        const e = base + 2 + i * 12;
        if (e + 12 > v.byteLength) break;
        out[u16(e)] = e;
      }
      return out;
    };
    const ascii = e => {
      const count = u32(e + 4);
      const o = count > 4 ? t + u32(e + 8) : e + 8;
      if (o + count > v.byteLength) return null;
      let s = '';
      for (let i = 0; i < count; i++) {
        const c = v.getUint8(o + i);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s;
    };
    const ifd0 = entries(u32(t + 4));
    let s = null;
    if (ifd0[0x8769]) {
      const exif = entries(u32(ifd0[0x8769] + 8));
      if (exif[0x9003]) s = ascii(exif[0x9003]);   // DateTimeOriginal
    }
    if (!s && ifd0[0x0132]) s = ascii(ifd0[0x0132]); // DateTime
    const m = s && s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m || +m[1] < 1990) return null;
    const d = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    return isNaN(d) ? null : d;
  }

  // ---------- วัดค่าต่าง ๆ จากพิกเซล ----------
  function boxResize(src, W, H, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * H / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * W / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / w));
        let s = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += src[yy * W + xx];
        out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
      }
    }
    return out;
  }

  function measure(px, W, H) {
    const n = W * H;
    const g = new Float32Array(n);
    let sum = 0, sumSq = 0, hi = 0, lo = 0;
    let rgS = 0, rgSS = 0, ybS = 0, ybSS = 0;
    const colors = new Float32Array(48), cnt = new Float32Array(16);

    for (let y = 0, i = 0; y < H; y++) {
      const cy = Math.min(3, (y * 4 / H) | 0);
      for (let x = 0; x < W; x++, i++) {
        const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
        const l = 0.299 * r + 0.587 * gg + 0.114 * b;
        g[i] = l; sum += l; sumSq += l * l;
        if (l >= 250) hi++; else if (l <= 6) lo++;
        const rg = r - gg, yb = 0.5 * (r + gg) - b;
        rgS += rg; rgSS += rg * rg; ybS += yb; ybSS += yb * yb;
        const cell = cy * 4 + Math.min(3, (x * 4 / W) | 0);
        colors[cell * 3] += r; colors[cell * 3 + 1] += gg; colors[cell * 3 + 2] += b; cnt[cell]++;
      }
    }
    for (let k = 0; k < 16; k++) for (let j = 0; j < 3; j++) colors[k * 3 + j] = cnt[k] ? colors[k * 3 + j] / cnt[k] : 0;

    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    const rgM = rgS / n, ybM = ybS / n;
    const colorful = Math.sqrt(Math.max(0, rgSS / n - rgM * rgM) + Math.max(0, ybSS / n - ybM * ybM))
      + 0.3 * Math.sqrt(rgM * rgM + ybM * ybM);

    // ความคมชัด: ความแปรปรวนของ Laplacian ในแต่ละช่อง แล้วเฉลี่ย 20% ของช่องที่คมที่สุด
    // (ภาพหน้าชัดหลังเบลอจะไม่ถูกมองว่าเบลอ)
    const T = TILES * TILES;
    const tS = new Float64Array(T), tSS = new Float64Array(T), tN = new Float64Array(T);
    for (let y = 1; y < H - 1; y++) {
      const ty = Math.min(TILES - 1, (y * TILES / H) | 0);
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
        const t = ty * TILES + Math.min(TILES - 1, (x * TILES / W) | 0);
        tS[t] += L; tSS[t] += L * L; tN[t]++;
      }
    }
    const vars = [];
    for (let t = 0; t < T; t++) if (tN[t]) { const m = tS[t] / tN[t]; vars.push(tSS[t] / tN[t] - m * m); }
    vars.sort((a, b) => b - a);
    const top = vars.slice(0, Math.max(1, Math.round(vars.length * 0.2)));
    const sharp = top.reduce((a, b) => a + b, 0) / top.length;

    // ลายนิ้วมือภาพ (difference hash 64 บิต)
    const small = boxResize(g, W, H, 9, 8);
    const hash = new Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash[y * 8 + x] = small[y * 9 + x] > small[y * 9 + x + 1] ? 1 : 0;

    return { sharp, mean, std, clipHi: hi / n, clipLo: lo / n, colorful, hash, colors: Array.from(colors) };
  }

  async function decode(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { return await createImageBitmap(file); }
  }

  async function analyzeFile(file) {
    let taken = null;
    try { taken = readExifDate(await file.slice(0, 262144).arrayBuffer()); } catch (e) { taken = null; }

    const bmp = await decode(file);
    const width = bmp.width, height = bmp.height;
    const s = Math.min(1, ANALYZE_MAX / Math.max(width, height));
    const W = Math.max(16, Math.round(width * s)), H = Math.max(16, Math.round(height * s));
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, W, H);
    bmp.close();
    const px = ctx.getImageData(0, 0, W, H).data;

    const ts = Math.min(1, THUMB_MAX / Math.max(W, H));
    const tc = makeCanvas(Math.round(W * ts), Math.round(H * ts));
    const tctx = tc.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(c, 0, 0, tc.width, tc.height);
    const thumb = await canvasToBlob(tc, 'image/jpeg', 0.8);

    return Object.assign({ taken, width, height, thumb }, measure(px, W, H));
  }

  root.CullCore = { analyzeFile };
})(typeof self !== 'undefined' ? self : window);
