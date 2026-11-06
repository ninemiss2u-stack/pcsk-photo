// ปรับแสงและสีอัตโนมัติ ให้ทุกภาพในชุดมีความสว่างและโทนสีใกล้เคียงกัน
// 1) แก้สีเพี้ยน (white balance) จากพื้นที่สีเทา/ขาวในภาพ
// 2) ยืดช่วงแสงให้ดำเป็นดำ ขาวเป็นขาว (ไม่ตัดรายละเอียดมากเกินไป)
// 3) ปรับความสว่างเฉลี่ยเข้าหาค่ากลาง  4) เพิ่มคอนทราสต์เฉพาะภาพที่ดูจืด  5) เพิ่มสีสันแบบนุ่มนวล
(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const LEVELS = { low: 0.5, mid: 0.8, high: 1 };

  // วิเคราะห์จากภาพย่อ ผลจึงเหมือนกันทั้งภาพตัวอย่างและไฟล์ความละเอียดเต็ม
  function analyze(src, W, H) {
    const sc = Math.min(1, 320 / Math.max(W, H));
    const w = Math.max(8, Math.round(W * sc)), h = Math.max(8, Math.round(H * sc));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const n = w * h;

    // white balance ขั้นที่ 1: ค่าเฉลี่ยทั้งภาพ (gray world) ใช้เป็นค่าคาดการณ์คร่าว ๆ
    let ar = 0, ag = 0, ab = 0;
    for (let i = 0; i < d.length; i += 4) { ar += d[i]; ag += d[i + 1]; ab += d[i + 2]; }
    ar /= n; ag /= n; ab /= n;
    const a0 = (ar + ag + ab) / 3;
    const g0 = [a0 / Math.max(1, ar), a0 / Math.max(1, ag), a0 / Math.max(1, ab)];
    // ขั้นที่ 2: หาพิกเซลที่ควรเป็นสีเทา/ขาว (ผนัง เสื้อขาว พื้นปูน) แม้ภาพจะติดสีอยู่
    // ต้องไม่อิ่มสีมากในภาพเดิม จึงไม่เอาสนามหญ้าหรือท้องฟ้ามาคิด
    let nr = 0, ng = 0, nb = 0, nn = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 30 || mx > 250 || (mx - mn) / mx > 0.5) continue;
      const cr = r * g0[0], cg = g * g0[1], cb = b * g0[2];
      if (Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 40) { nr += r; ng += g; nb += b; nn++; }
    }
    let mr, mg, mb, wbS, lim;
    if (nn > n * 0.03) { mr = nr / nn; mg = ng / nn; mb = nb / nn; wbS = 0.85; lim = [0.8, 1.35]; }
    else { mr = ar; mg = ag; mb = ab; wbS = 0.15; lim = [0.95, 1.05]; } // ภาพสนามหญ้า/ท้องฟ้าเต็มเฟรม แทบไม่แตะสี
    const avg = (mr + mg + mb) / 3;
    const gain = [mr, mg, mb].map(m => clamp(1 + (avg / Math.max(1, m) - 1) * wbS, lim[0], lim[1]));

    // ช่วงแสงหลังแก้สี
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] * gain[0] + 0.587 * d[i + 1] * gain[1] + 0.114 * d[i + 2] * gain[2];
      hist[Math.min(255, Math.round(l))]++;
    }
    const pct = p => { let acc = 0; const t = n * p; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v; } return 255; };
    // จุดดำ: ดึงเงาลงแค่ครึ่งทาง ภาพที่ไม่มีส่วนดำสนิท (เช่น สนามหญ้า) จะไม่มืดลง
    const bp = Math.min(pct(0.004), 22) * 0.5;
    // ภาพมืด (ถ่ายแสงน้อย) ยืดให้ส่วนที่สว่างที่สุดเป็นขาวได้ แต่ไม่เกิน 1.6 เท่า กันภาพกลางคืนสว่างจนผิดธรรมชาติ
    const wp = clamp(pct(0.996), bp + 160, 255);

    let m = 0, s2 = 0, m0 = 0;
    for (let v = 0; v < 256; v++) { const t = clamp((v - bp) / (wp - bp), 0, 1); m += t * hist[v]; s2 += t * t * hist[v]; m0 += v / 255 * hist[v]; }
    m /= n; m0 /= n;
    const std = Math.sqrt(Math.max(0, s2 / n - m * m));
    // ความสว่าง: ภาพที่เฉลี่ยอยู่ในช่วง 40-60% ถือว่าพอดี ไม่แตะ ภาพที่มืด/สว่างเกินดันเข้าหาช่วงนี้
    // (ปรับแค่ 80% เผื่อภาพที่ตั้งใจถ่ายมืดหรือสว่าง)
    const target = m < 0.4 ? 0.45 : m > 0.6 ? 0.57 : m;
    let gamma = target === m ? 1 : Math.log(target) / Math.log(clamp(m, 0.05, 0.95));
    gamma = clamp(1 + (gamma - 1) * 0.8, 0.66, 1.35);
    const contrast = clamp((0.22 - std) * 1.2, 0, 0.22);

    // ประมาณความสว่างหลังปรับ เพื่อบอกผู้ใช้ให้ตรงกับที่เกิดขึ้นจริง
    let mF = 0;
    for (let v = 0; v < 256; v++) {
      let t = Math.pow(clamp((v - bp) / (wp - bp), 0, 1), gamma);
      t += contrast * (t * t * (3 - 2 * t) - t);
      mF += t * hist[v];
    }
    return { gain, bp, wp, gamma, contrast, dMean: mF / n - m0 };
  }

  function buildLuts(p, s) {
    const L = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
    for (let ch = 0; ch < 3; ch++) {
      for (let v = 0; v < 256; v++) {
        let t = clamp((v * p.gain[ch] - p.bp) / (p.wp - p.bp), 0, 1);
        t = Math.pow(t, p.gamma);
        t += p.contrast * (t * t * (3 - 2 * t) - t);
        L[ch][v] = Math.round(v + (t * 255 - v) * s);
      }
    }
    return L;
  }

  // ปรับภาพบน canvas ตรงนั้นเลย level = 'low' | 'mid' | 'high'
  function apply(ctx, W, H, level) {
    const s = LEVELS[level] || 0;
    if (!s) return null;
    const p = analyze(ctx.canvas, W, H);
    const [LR, LG, LB] = buildLuts(p, s);
    const vib = 0.2 * s;
    const band = Math.max(1, Math.floor(4e6 / W)); // ทำทีละแถบ ไม่กินหน่วยความจำมากกับรูปใหญ่
    for (let y = 0; y < H; y += band) {
      const h = Math.min(band, H - y);
      const img = ctx.getImageData(0, y, W, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = LR[d[i]], g = LG[d[i + 1]], b = LB[d[i + 2]];
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const f = vib * (1 - (mx - mn) / 255); // เพิ่มสีให้ส่วนที่สีจืดมากกว่าส่วนที่สีจัดอยู่แล้ว
        const l = (r + g + b) / 3;
        d[i] = r + (r - l) * f;
        d[i + 1] = g + (g - l) * f;
        d[i + 2] = b + (b - l) * f;
      }
      ctx.putImageData(img, 0, y);
    }
    return describe(p);
  }

  // สรุปสิ่งที่ปรับเป็นคำอ่านง่าย
  function describe(p) {
    const out = [];
    if (p.dMean > 0.04) out.push('เพิ่มความสว่าง');
    else if (p.dMean < -0.04) out.push('ลดความสว่าง');
    const [r, g, b] = p.gain;
    if (b > 1.05 && b >= r) out.push('แก้สีอมเหลือง');
    else if (b < 0.95) out.push('แก้สีอมฟ้า');
    if (g < 0.95) out.push('แก้สีอมเขียว');
    else if (g > 1.05) out.push('แก้สีอมม่วง');
    if (p.bp > 6 || p.wp < 245) out.push('ปรับช่วงแสง');
    if (p.contrast > 0.05) out.push('เพิ่มคอนทราสต์');
    return out;
  }

  root.PCSKEnhance = { apply, analyze };
})(window);
