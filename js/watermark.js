// ลายน้ำ PCSK PHOTO: ใช้โลโก้กล้อง (img/pcsk-photo.webp) ที่ดึงเฉพาะเส้นสีขาว/เขียวออกมาเป็นพื้นโปร่งใส
// ขนาดทุกส่วนคิดเทียบกับด้านสั้นของรูป ภาพตัวอย่างกับไฟล์จริงจึงหน้าตาเหมือนกัน
(function (root) {
  const cfg = root.APP_CONFIG || {};
  const TEXT = cfg.WATERMARK_TEXT || 'PCSK PHOTO';
  const STYLES = ['corner', 'line', 'center'];

  let logo = null;  // ตราโรงเรียน (วงกลมพื้นขาว) ใช้บนหน้าเว็บ
  let mark = null;  // โลโก้ลายน้ำพื้นโปร่งใส

  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ตราโรงเรียน: หาขอบวงกลมจากพิกเซลที่ไม่ใช่สีขาว แล้วตัดเป็นวงกลม
  async function loadLogo(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = canvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += 2) {
      for (let xx = 0; xx < w; xx += 2) {
        const i = (y * w + xx) * 4;
        if (d[i + 3] > 40 && d[i] + d[i + 1] + d[i + 2] < 600) {
          if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error('ไม่พบตราในภาพโลโก้');
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const r = Math.max(x1 - x0, y1 - y0) / 2 * 1.04;
    const S = 512;
    const o = canvas(S, S);
    const ox = o.getContext('2d');
    ox.beginPath();
    ox.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ox.clip();
    ox.fillStyle = '#fff';
    ox.fillRect(0, 0, S, S);
    ox.imageSmoothingQuality = 'high';
    ox.drawImage(img, cx - r, cy - r, r * 2, r * 2, 0, 0, S, S);
    logo = o;
    return o;
  }

  // โลโก้ลายน้ำ: ตัดเฉพาะส่วนกลางภาพที่มีโลโก้ แล้วแยกเส้นสีขาว/เขียวออกจากพื้นเมฆสีเข้ม
  async function loadMark(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const sx = Math.round(W * 0.23), sy = Math.round(H * 0.28);
    const sw = Math.round(W * 0.545), sh = Math.round(H * 0.41);
    const c = canvas(sw, sh);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const id = x.getImageData(0, 0, sw, sh); // เปิดไฟล์ตรง ๆ (file://) จะใช้ไม่ได้ ลายน้ำจะเป็นตัวอักษรแทน
    const d = id.data;
    const BG = [30, 34, 32]; // สีพื้นเข้มโดยประมาณ ใช้แยกสีขอบตัวอักษรออกจากพื้น
    let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
    for (let y = 0, i = 0; y < sh; y++) {
      for (let xx = 0; xx < sw; xx++, i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b);
        const green = g > r + 30 && g > b + 30;
        let a = clamp((mx - (green ? 75 : 95)) / (green ? 95 : 125), 0, 1);
        if (a < 0.15) a = 0;
        a = a * a * (3 - 2 * a); // ขอบเนียน พื้นหลังหายสนิท
        if (a > 0) {
          d[i] = clamp((r - BG[0] * (1 - a)) / a, 0, 255);
          d[i + 1] = clamp((g - BG[1] * (1 - a)) / a, 0, 255);
          d[i + 2] = clamp((b - BG[2] * (1 - a)) / a, 0, 255);
          if (!green) d[i] = d[i + 1] = d[i + 2] = Math.max(d[i], d[i + 1], d[i + 2]); // ส่วนสีขาวให้ขาวล้วน
        }
        d[i + 3] = Math.round(a * 255);
        if (a > 0.4) {
          if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error('ไม่พบโลโก้ลายน้ำ');
    x.putImageData(id, 0, 0);
    const p = 4;
    x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p);
    x1 = Math.min(sw - 1, x1 + p); y1 = Math.min(sh - 1, y1 + p);
    const o = canvas(x1 - x0 + 1, y1 - y0 + 1);
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    mark = o;
    return o;
  }

  let fontsReady = null;
  function ready() {
    if (!fontsReady) {
      fontsReady = document.fonts && document.fonts.load
        ? document.fonts.load('600 40px Prompt').catch(() => {})
        : Promise.resolve();
    }
    return fontsReady;
  }
  const spacing = (ctx, px) => { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; };
  const shadow = (ctx, u, a) => { ctx.shadowColor = `rgba(0, 0, 0, ${a})`; ctx.shadowBlur = 10 * u; ctx.shadowOffsetY = 1.5 * u; };

  // ขนาดโลโก้ตามความกว้างที่ต้องการ (ถ้าไม่มีโลโก้ ใช้ตัวอักษรแทน)
  function markSize(ctx, w) {
    if (mark) return { w, h: w * mark.height / mark.width };
    const fp = w * 0.11;
    ctx.font = `600 ${fp}px Prompt, sans-serif`;
    spacing(ctx, fp * 0.35);
    const tw = ctx.measureText(TEXT).width;
    spacing(ctx, 0);
    return { w: tw, h: fp * 1.3, fp };
  }
  function drawMark(ctx, x, y, m) {
    if (mark) { ctx.drawImage(mark, x, y, m.w, m.h); return; }
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${m.fp}px Prompt, sans-serif`;
    spacing(ctx, m.fp * 0.35);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(TEXT, x, y + m.h / 2);
    spacing(ctx, 0);
  }

  // o = { style: 'corner' | 'line' | 'center', pos: 'bl' | 'bc' | 'br', size: 's' | 'm' | 'l', opacity: 40-100 }
  function draw(ctx, W, H, o) {
    const s = Math.min(W, H);
    const u = s / 1000;
    const k = { s: 0.75, m: 1, l: 1.35 }[o.size] || 1;
    const style = STYLES.includes(o.style) ? o.style : 'corner';
    ctx.save();
    ctx.globalAlpha = clamp((o.opacity || 85) / 100, 0.2, 1);
    ctx.imageSmoothingQuality = 'high';

    if (style === 'corner') {
      const m = markSize(ctx, Math.min(W * 0.45, 250 * u * k));
      const pad = 40 * u;
      const x = o.pos === 'bl' ? pad : o.pos === 'bc' ? (W - m.w) / 2 : W - pad - m.w;
      shadow(ctx, u, 0.5);
      drawMark(ctx, x, H - pad - m.h, m);
    } else if (style === 'line') {
      // กรอบเส้นเดียวบาง ๆ เว้นช่องตรงกลางขอบล่างให้โลโก้
      const inset = 30 * u;
      const m = markSize(ctx, Math.min(W * 0.4, 200 * u * k));
      const cx = W / 2, by = H - inset;
      const gapHalf = m.w / 2 + 18 * u;
      shadow(ctx, u, 0.35);
      ctx.strokeStyle = 'rgba(255, 255, 255, .85)';
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath();
      ctx.moveTo(cx + gapHalf, by);
      ctx.lineTo(W - inset, by);
      ctx.lineTo(W - inset, inset);
      ctx.lineTo(inset, inset);
      ctx.lineTo(inset, by);
      ctx.lineTo(cx - gapHalf, by);
      ctx.stroke();
      // ให้เส้นใต้ชื่อโรงเรียนในโลโก้อยู่แนวเดียวกับเส้นกรอบ ไม่ล้นขอบภาพ
      drawMark(ctx, cx - m.w / 2, Math.min(by - m.h * 0.62, H - m.h - 4 * u), m);
    } else {
      // กลางภาพจาง ๆ
      ctx.globalAlpha *= 0.45;
      shadow(ctx, u, 0.3);
      const m = markSize(ctx, Math.min(W * 0.8, s * 0.9 * k));
      drawMark(ctx, (W - m.w) / 2, (H - m.h) / 2, m);
    }
    ctx.restore();
  }

  async function decode(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { return await createImageBitmap(file); }
  }

  // ---------- เก็บข้อมูลกล้อง (EXIF) ของไฟล์ต้นฉบับไว้ในไฟล์ใหม่ ----------
  // วันเวลาที่ถ่าย รุ่นกล้อง ค่าการถ่าย ยังอยู่ครบ แต่ต้องแก้ 2 จุด:
  // 1) ตั้งการหมุนภาพ (Orientation) เป็นปกติ เพราะภาพถูกหมุนให้ตรงแล้ว ไม่งั้นจะหมุนซ้ำ
  // 2) ตัดรูปย่อเดิมที่ฝังไว้ (ไม่มีลายน้ำ/ยังไม่ปรับภาพ) ไม่ให้โปรแกรมดูรูปหยิบไปแสดง
  async function exifSegment(file) {
    if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null;
    const buf = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
    const v = new DataView(buf.buffer);
    if (buf.length < 12 || v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 <= buf.length) {
      const marker = v.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA || marker === 0xFFD9) return null;
      const len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && off + 10 <= buf.length && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
        if (off + 2 + len > buf.length) return null;
        const seg = buf.slice(off, off + 2 + len);
        return fixExif(seg) ? seg : null;
      }
      off += 2 + len;
    }
    return null;
  }
  function fixExif(seg) {
    const v = new DataView(seg.buffer);
    const t = 10; // จุดเริ่มข้อมูล TIFF ในส่วน APP1
    const bo = v.getUint16(t);
    if (bo !== 0x4949 && bo !== 0x4D4D) return false;
    const le = bo === 0x4949;
    const ifd = t + v.getUint32(t + 4, le);
    if (ifd + 2 > seg.length) return false;
    const n = v.getUint16(ifd, le);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > seg.length) return false;
      if (v.getUint16(e, le) === 0x0112) v.setUint16(e + 8, 1, le);
    }
    const next = ifd + 2 + n * 12;
    if (next + 4 > seg.length) return false;
    v.setUint32(next, 0, le); // ตัดลิงก์ไปยังรูปย่อ (IFD1)
    return true;
  }
  async function withExif(blob, seg) {
    const out = new Uint8Array(await blob.arrayBuffer());
    let rest = 2;
    if (out[2] === 0xFF && out[3] === 0xE0) rest = 4 + ((out[4] << 8) | out[5]); // ใช้ EXIF แทนส่วน JFIF แบบไฟล์จากกล้อง
    return new Blob([out.subarray(0, 2), seg, out.subarray(rest)], { type: 'image/jpeg' });
  }

  // สร้างไฟล์ใหม่ความละเอียดเต็ม: ปรับแสงและสี (ถ้าเปิด) แล้วใส่ลายน้ำ (ถ้าเปิด)
  async function renderFile(file, o, enhance) {
    await ready();
    const bmp = await decode(file);
    const c = canvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: !!enhance });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    if (enhance && root.PCSKEnhance) root.PCSKEnhance.apply(ctx, c.width, c.height, enhance);
    if (o) draw(ctx, c.width, c.height, o);
    const png = /png$/i.test(file.type);
    const type = png ? 'image/png' : 'image/jpeg';
    let blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('สร้างไฟล์รูปไม่สำเร็จ'))), type, 0.92));
    c.width = c.height = 0; // คืนหน่วยความจำทันที
    if (!png) {
      try { const seg = await exifSegment(file); if (seg) blob = await withExif(blob, seg); }
      catch (e) { /* อ่านข้อมูลกล้องไม่ได้ ใช้ไฟล์ที่ไม่มี EXIF */ }
    }
    return { blob, ext: png ? '.png' : '.jpg' };
  }

  // วาดภาพตัวอย่าง (source = ImageBitmap หรือ canvas) คืนค่าการปรับภาพที่ใช้ (ถ้ามี)
  async function renderPreview(cv, source, o, enhance) {
    await ready();
    const sc = Math.min(1, 960 / source.width);
    cv.width = Math.round(source.width * sc);
    cv.height = Math.round(source.height * sc);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, cv.width, cv.height);
    let info = null;
    if (enhance && root.PCSKEnhance) info = root.PCSKEnhance.apply(ctx, cv.width, cv.height, enhance);
    if (o) draw(ctx, cv.width, cv.height, o);
    return info;
  }

  // ภาพทิวทัศน์สมมติสำหรับโชว์ลายน้ำก่อนเลือกรูป
  function sampleScene(W, H) {
    const c = canvas(W, H);
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8fc3e8'); sky.addColorStop(0.55, '#e8f1d9'); sky.addColorStop(1, '#f6e7b8');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255, 240, 190, .9)';
    x.beginPath(); x.arc(W * 0.74, H * 0.3, H * 0.09, 0, Math.PI * 2); x.fill();
    const hill = (y0, amp, color, ph) => {
      x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i <= 40; i++) { const t = i / 40; x.lineTo(t * W, y0 + Math.sin(t * 5 + ph) * amp + Math.sin(t * 13 + ph) * amp * 0.25); }
      x.lineTo(W, H); x.closePath(); x.fillStyle = color; x.fill();
    };
    hill(H * 0.58, H * 0.05, '#7fae55', 0.4);
    hill(H * 0.7, H * 0.04, '#4f8a2c', 2.1);
    hill(H * 0.84, H * 0.03, '#2f6a12', 4.2);
    return c;
  }

  root.PCSKWatermark = {
    loadLogo, loadMark, ready, draw, renderFile, renderPreview, sampleScene, decode, STYLES,
    fixExif, insertExif: withExif, hasLogo: () => !!logo, hasMark: () => !!mark
  };
})(window);
