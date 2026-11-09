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
    let edgeHi = 0, edgeN = 0, midHi = 0, midN = 0; // แสงจ้าที่ขอบภาพ เทียบกับกลางภาพ
    const colors = new Float32Array(48), cnt = new Float32Array(16);

    for (let y = 0, i = 0; y < H; y++) {
      const cy = Math.min(3, (y * 4 / H) | 0);
      const yEdge = y < H * 0.1 || y > H * 0.9;
      for (let x = 0; x < W; x++, i++) {
        const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
        const l = 0.299 * r + 0.587 * gg + 0.114 * b;
        g[i] = l; sum += l; sumSq += l * l;
        if (l >= 250) hi++; else if (l <= 6) lo++;
        if (yEdge || x < W * 0.1 || x > W * 0.9) { edgeN++; if (l >= 250) edgeHi++; }
        else { midN++; if (l >= 250) midHi++; }
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
    const dirE = new Float64Array(T * 4); // พลังงานรายละเอียด 4 ทิศ (นอน ตั้ง ทแยง 2 ทาง) ต่อช่อง
    const TB = 0.5, TR = 12, NB = (2 * TR) / TB + 1;
    const tiltH = new Float64Array(NB); // ฮิสโตแกรมมุมของเส้นตรงที่เกือบนอน/เกือบตั้ง
    for (let y = 1; y < H - 1; y++) {
      const ty = Math.min(TILES - 1, (y * TILES / H) | 0);
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
        const t = ty * TILES + Math.min(TILES - 1, (x * TILES / W) | 0);
        tS[t] += L; tSS[t] += L * L; tN[t]++;
        const gx = g[i + 1] - g[i - 1], gy = g[i + W] - g[i - W];
        const d1 = g[i + W + 1] - g[i - W - 1], d2 = g[i + W - 1] - g[i - W + 1];
        dirE[t * 4] += gx * gx; dirE[t * 4 + 1] += gy * gy; dirE[t * 4 + 2] += d1 * d1 * 0.5; dirE[t * 4 + 3] += d2 * d2 * 0.5;
      }
    }

    // ภาพเอียง: หาเส้นตรงยาวที่สม่ำเสมอ (ขอบประตู ผนัง เส้นขอบฟ้า) ด้วย structure tensor
    // ช่วงที่เป็นลวดลาย/ผิว/ผ้า ทิศทางไม่สม่ำเสมอจะถูกตัดออก เหลือเฉพาะเส้นตรงจริง
    {
      const Iw = W + 1;
      const Sxx = new Float64Array(Iw * (H + 1)), Syy = new Float64Array(Iw * (H + 1)), Sxy = new Float64Array(Iw * (H + 1));
      for (let y = 0; y < H; y++) {
        let rxx = 0, ryy = 0, rxy = 0;
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const gx = x > 0 && x < W - 1 ? g[i + 1] - g[i - 1] : 0;
          const gy = y > 0 && y < H - 1 ? g[i + W] - g[i - W] : 0;
          rxx += gx * gx; ryy += gy * gy; rxy += gx * gy;
          const o = (y + 1) * Iw + x + 1;
          Sxx[o] = Sxx[o - Iw] + rxx; Syy[o] = Syy[o - Iw] + ryy; Sxy[o] = Sxy[o - Iw] + rxy;
        }
      }
      const R = 4;
      const box = (S, x0, y0, x1, y1) => S[y1 * Iw + x1] - S[y0 * Iw + x1] - S[y1 * Iw + x0] + S[y0 * Iw + x0];
      for (let y = R; y < H - R; y += 2) {
        for (let x = R; x < W - R; x += 2) {
          const a = box(Sxx, x - R, y - R, x + R + 1, y + R + 1);
          const b = box(Syy, x - R, y - R, x + R + 1, y + R + 1);
          const c = box(Sxy, x - R, y - R, x + R + 1, y + R + 1);
          const tr = a + b;
          if (tr < 81 * 900) continue; // ขอบต้องชัดพอ
          const coh = Math.sqrt((a - b) * (a - b) + 4 * c * c) / tr; // 1 = ทิศทางเดียวกันทั้งช่อง
          if (coh < 0.85) continue;
          let ang = 0.5 * Math.atan2(2 * c, a - b) * 57.29578; // ทิศของ gradient
          ang = ((ang % 90) + 90) % 90;
          if (ang > 45) ang -= 90; // มุมเบี่ยงจากแนวนอน/แนวตั้ง
          if (ang >= -TR && ang <= TR) tiltH[Math.round((ang + TR) / TB)] += coh ** 4 * Math.sqrt(tr);
        }
      }
    }
    const tiles = [];
    for (let t = 0; t < T; t++) if (tN[t]) { const m = tS[t] / tN[t]; tiles.push({ t, v: tSS[t] / tN[t] - m * m }); }
    tiles.sort((a, b) => b.v - a.v);
    const top = tiles.slice(0, Math.max(1, Math.round(tiles.length * 0.2)));
    const sharp = top.reduce((a, b) => a + b.v, 0) / top.length;

    // ภาพสั่นไหว: ในส่วนที่คมที่สุด รายละเอียดเหลืออยู่ทิศเดียว (0 = ปกติ, 1 = สั่นมาก)
    const e = [0, 0, 0, 0];
    for (const { t } of top) for (let k = 0; k < 4; k++) e[k] += dirE[t * 4 + k];
    const motion = (Math.max(...e) - Math.min(...e)) / (Math.max(...e) + Math.min(...e) + 1e-9);

    // ภาพเอียง: เส้นตรงในภาพส่วนใหญ่เบี่ยงไปทางเดียวกัน
    let pk = 0;
    for (let k = 1; k < NB; k++) if (tiltH[k] > tiltH[pk]) pk = k;
    let mass = 0, near = 0, wsum = 0;
    for (let k = 0; k < NB; k++) {
      mass += tiltH[k];
      if (Math.abs(k - pk) <= 2) { near += tiltH[k]; wsum += tiltH[k] * (k * TB - TR); }
    }
    const tilt = near ? wsum / near : 0;
    const tiltConf = mass ? near / mass : 0;
    // เทียบกับปริมาณเส้นที่ตรงแนวพอดี (±1°) ภาพที่ไม่เอียงจะมีเส้นตรงแนวมากกว่าหรือพอ ๆ กัน
    const z0 = Math.round(TR / TB);
    let zero = 0;
    for (let k = z0 - 2; k <= z0 + 2; k++) zero += tiltH[k];
    const tiltVsLevel = near / (zero + 1e-9);

    // ตำแหน่งตัวแบบโดยประมาณ: จุดศูนย์กลางของช่องที่มีรายละเอียดคมมาก
    let sx = 0, sy = 0, sw = 0;
    const vmax = tiles.length ? tiles[0].v : 0;
    for (const { t, v } of tiles) if (v >= vmax * 0.5) { sx += ((t % TILES) + 0.5) / TILES * v; sy += (((t / TILES) | 0) + 0.5) / TILES * v; sw += v; }
    const subj = sw ? { x: sx / sw, y: sy / sw } : { x: 0.5, y: 0.5 };

    // ลายนิ้วมือภาพ (difference hash 64 บิต)
    const small = boxResize(g, W, H, 9, 8);
    const hash = new Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash[y * 8 + x] = small[y * 9 + x] > small[y * 9 + x + 1] ? 1 : 0;

    return {
      sharp, mean, std, clipHi: hi / n, clipLo: lo / n, colorful, hash, colors: Array.from(colors),
      motion, tilt, tiltConf, tiltVsLevel, subj,
      edgeGlare: edgeN ? edgeHi / edgeN : 0, midGlare: midN ? midHi / midN : 0
    };
  }

  // ระดับเกรน/noise (ส่วนเบี่ยงเบนในระดับสีเทา 0-255) วัดจากภาพความละเอียดเต็ม เฉพาะบริเวณเรียบ
  // ใช้วิธีของ Immerkær (1996) ที่แยก noise ออกจากรายละเอียดจริงของภาพ
  function noiseOf(px, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    let s = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, c = g[i];
        if (c < 12 || c > 243) continue; // ส่วนมืดสนิท/ขาวจ้าไม่มี noise ให้วัด
        const l = g[i - 1], r = g[i + 1], u = g[i - w], d = g[i + w];
        if (Math.abs(r - l) + Math.abs(d - u) > 40) continue; // ข้ามขอบวัตถุ
        s += Math.abs(4 * c - 2 * (l + r + u + d) + g[i - w - 1] + g[i - w + 1] + g[i + w - 1] + g[i + w + 1]);
        n++;
      }
    }
    return n > 1500 ? { sigma: Math.sqrt(Math.PI / 2) * s / (6 * n), n } : null;
  }
  function noiseFromBitmap(bmp) {
    const cs = Math.min(384, bmp.width, bmp.height);
    const c = makeCanvas(cs, cs);
    const x = c.getContext('2d', { willReadFrequently: true });
    let tot = 0, wsum = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.5, 0.8]]) {
      const sx = Math.max(0, Math.min(bmp.width - cs, Math.round(bmp.width * fx - cs / 2)));
      const sy = Math.max(0, Math.min(bmp.height - cs, Math.round(bmp.height * fy - cs / 2)));
      x.drawImage(bmp, sx, sy, cs, cs, 0, 0, cs, cs); // ขนาดจริง 1:1 ไม่ย่อ
      const r = noiseOf(x.getImageData(0, 0, cs, cs).data, cs, cs);
      if (r) { tot += r.sigma * r.n; wsum += r.n; }
    }
    return wsum ? tot / wsum : null;
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
    let noise = null;
    try { noise = noiseFromBitmap(bmp); } catch (e) { noise = null; }
    bmp.close();
    const px = ctx.getImageData(0, 0, W, H).data;

    const ts = Math.min(1, THUMB_MAX / Math.max(W, H));
    const tc = makeCanvas(Math.round(W * ts), Math.round(H * ts));
    const tctx = tc.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(c, 0, 0, tc.width, tc.height);
    const thumb = await canvasToBlob(tc, 'image/jpeg', 0.8);

    return Object.assign({ taken, width, height, thumb, noise }, measure(px, W, H));
  }

  root.CullCore = { analyzeFile };
})(typeof self !== 'undefined' ? self : window);
