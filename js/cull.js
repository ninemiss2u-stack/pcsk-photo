(function () {
  const cfg = window.APP_CONFIG || {};
  const Core = window.CullCore;
  const WM = window.PCSKWatermark;
  const $ = id => document.getElementById(id);

  const IMG_RE = /\.(jpe?g|png|webp)$/i;
  const RAW_RE = /\.(cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|dng|srw|x3f)$/i;
  const VIDEO_RE = /\.(mp4|mov|avi|mts|m2ts|mkv|3gp)$/i;
  const HEIC_RE = /\.(heic|heif)$/i;

  // ความไว: h = จำนวนบิตที่ต่างกันได้ (จาก 64), c = ความต่างของสีเฉลี่ย (0-255)
  const SENS = { 1: { h: 7, c: 16, label: 'น้อย (เฉพาะภาพที่เหมือนกันมาก)' },
    2: { h: 11, c: 24, label: 'ปานกลาง' },
    3: { h: 15, c: 32, label: 'มาก (รวมภาพที่คล้ายกันด้วย)' } };
  const MAX_GAP = 15 * 60 * 1000; // ภาพที่ถ่ายห่างกันเกิน 15 นาที ไม่นับเป็นภาพซ้ำ

  const state = {
    photos: [], byId: new Map(), raws: new Map(), groups: [], overrides: new Map(),
    settings: { keep: 1, sens: 2, dropBlur: true }, filter: 'all', view: [],
    cancelled: false, skipped: null, failed: 0, total: 0
  };
  const WM_DEFAULT = { on: true, style: 'corner', pos: 'br', size: 'm', opacity: 85 };
  const ENH_DEFAULT = { on: true, level: 'mid', look: 'natural' };
  try { Object.assign(state.settings, JSON.parse(localStorage.getItem('cull-settings') || '{}')); } catch (e) { /* ไม่มีที่เก็บก็ใช้ค่าเริ่มต้น */ }
  state.settings.wm = Object.assign({}, WM_DEFAULT, state.settings.wm);
  if (!WM.STYLES.includes(state.settings.wm.style)) state.settings.wm.style = WM_DEFAULT.style; // ค่าจากลายน้ำแบบเดิม
  state.settings.enh = Object.assign({}, ENH_DEFAULT, state.settings.enh);
  if (!PCSKEnhance.LOOKS.includes(state.settings.enh.look)) state.settings.enh.look = 'natural';
  delete state.settings.faces; // การคัดแบบมืออาชีพ (ตรวจใบหน้า) ทำงานทุกครั้ง ไม่มีให้ปิดแล้ว
  const wmOpts = () => (state.settings.wm.on ? state.settings.wm : null);
  const enhOpts = () => (state.settings.enh.on ? { level: state.settings.enh.level, look: state.settings.enh.look } : null);
  const saveSettings = () => { try { localStorage.setItem('cull-settings', JSON.stringify(state.settings)); } catch (e) { /* ignore */ } };

  // ---------- helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => n.toLocaleString('th-TH');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtTime = t => new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const relPath = f => f._path || f.webkitRelativePath || f.name;
  const stemKey = p => p.replace(/\.[^./\\]+$/, '').toLowerCase();
  const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB';

  function toast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, 4000);
  }
  const STEPS = ['stepStart', 'stepProgress', 'stepResults'];
  function show(step) {
    STEPS.forEach(id => { $(id).hidden = id !== step; });
    const at = STEPS.indexOf(step);
    document.querySelectorAll('#stepper li').forEach((li, i) => {
      li.classList.toggle('on', i === at);
      li.classList.toggle('done', i < at);
    });
    window.scrollTo(0, 0);
  }
  show('stepStart');

  // ---------- ตราโรงเรียนและลายน้ำตัวอย่าง ----------
  $('schoolName').textContent = cfg.SCHOOL_NAME || 'งานประชาสัมพันธ์';
  $('footSchool').textContent = cfg.SCHOOL_NAME || '';

  const sampleScene = WM.sampleScene(1200, 800);
  const drawSample = () => WM.renderPreview($('sampleCanvas'), sampleScene, state.settings.wm.on ? state.settings.wm : WM_DEFAULT);
  drawSample();
  WM.loadLogo('img/logo.webp').then(c => {
    // ใช้ตราที่ตัดขอบเป็นวงกลมแล้วแทนไฟล์ต้นฉบับทุกจุดบนหน้า
    const url = c.toDataURL('image/png');
    document.querySelectorAll('.logo-img').forEach(img => { img.src = url; img.classList.remove('raw'); });
    drawSample();
    if (!$('stepResults').hidden) drawWmPreview();
  }).catch(e => console.warn('ตัดขอบตราโรงเรียนไม่ได้ (ควรเปิดผ่าน serve.ps1)', e));
  WM.loadMark('img/pcsk-photo.webp').then(c => {
    // โลโก้ PCSK PHOTO พื้นโปร่งใส ใช้ทั้งในลายน้ำและบนหัวส่วนต้อนรับ
    const bm = $('brandMark');
    bm.src = c.toDataURL('image/png');
    bm.hidden = false;
    $('eyebrow').hidden = true;
    drawSample();
    if (!$('stepResults').hidden) drawWmPreview();
  }).catch(e => console.warn('ใช้โลโก้ลายน้ำไม่ได้ จะใช้ลายน้ำแบบตัวอักษรแทน (ควรเปิดผ่าน serve.ps1)', e));

  // ---------- เลือกไฟล์ ----------

  $('pickFolder').onclick = () => $('folderInput').click();
  $('pickFiles').onclick = () => $('fileInput').click();
  $('folderInput').onchange = e => { const f = [...e.target.files]; e.target.value = ''; startWith(f); };
  $('fileInput').onchange = e => { const f = [...e.target.files]; e.target.value = ''; startWith(f); };

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async e => {
    const entries = [...e.dataTransfer.items].filter(i => i.kind === 'file')
      .map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    const plain = [...e.dataTransfer.files];
    startWith(entries.length ? await filesFromEntries(entries) : plain);
  });

  async function filesFromEntries(entries) {
    const out = [];
    const walk = async (entry, path) => {
      if (entry.isFile) {
        const f = await new Promise((res, rej) => entry.file(res, rej));
        f._path = path + f.name;
        out.push(f);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const child of batch) await walk(child, path + entry.name + '/');
        } while (batch.length);
      }
    };
    for (const entry of entries) await walk(entry, '');
    return out;
  }

  async function startWith(files) {
    const seen = new Set();
    const images = [], heics = [];
    const skipped = { raw: 0, video: 0, heic: 0, other: 0 };
    state.raws = new Map();
    for (const f of files) {
      if (f.name.startsWith('.')) continue; // ไฟล์ระบบที่ซ่อนอยู่
      const p = relPath(f);
      const key = p + '|' + f.size;
      if (seen.has(key)) continue;
      seen.add(key);
      if (IMG_RE.test(f.name)) images.push(f);
      else if (HEIC_RE.test(f.name)) heics.push(f);
      else if (RAW_RE.test(f.name)) { skipped.raw++; state.raws.set(stemKey(p), f); }
      else if (VIDEO_RE.test(f.name)) skipped.video++;
      else skipped.other++;
    }
    if (heics.length) {
      const r = await convertHeics(heics);
      images.push(...r.out);
      skipped.heic = r.failed;
    }
    if (!images.length) {
      show('stepStart');
      toast(skipped.heic ? 'แปลงไฟล์ HEIC ไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'
        : skipped.raw ? 'พบเฉพาะไฟล์ RAW ระบบนี้ต้องใช้ไฟล์ JPG (ตั้งกล้องให้ถ่าย RAW+JPG)'
        : 'ไม่พบไฟล์รูป JPG, PNG, WebP หรือ HEIC', 'error');
      return;
    }
    state.skipped = skipped;
    return analyzeAll(images);
  }

  // แปลงไฟล์ HEIC จาก iPhone เป็น JPG ก่อนวิเคราะห์ (กดหยุดได้ ระบบจะใช้เฉพาะไฟล์ที่แปลงแล้ว)
  async function convertHeics(list) {
    resetResults();
    show('stepProgress');
    state.cancelled = false;
    const n = list.length;
    const out = [];
    let failed = 0;
    const t0 = performance.now();
    const update = i => {
      $('pTitle').textContent = 'กำลังแปลงไฟล์ HEIC จาก iPhone...';
      $('pBar').style.width = (i / n * 100) + '%';
      $('pText').textContent = `แปลงแล้ว ${num(i)} จาก ${num(n)} ไฟล์` + (failed ? ` (แปลงไม่ได้ ${failed})` : '');
      const left = i > 1 ? (performance.now() - t0) / i * (n - i) / 1000 : 0;
      $('pEta').textContent = i > 1 && i < n ? (left > 90 ? `เหลือประมาณ ${Math.ceil(left / 60)} นาที` : `เหลือประมาณ ${Math.ceil(left)} วินาที`) : '';
    };
    update(0);
    try { await PCSKHeic.load(); }
    catch (e) { toast(e.message, 'error'); return { out, failed: n }; }
    for (let i = 0; i < n && !state.cancelled; i++) {
      try { out.push(await PCSKHeic.toJpeg(list[i])); }
      catch (e) { failed++; console.warn('แปลง HEIC ไม่ได้', list[i].name, e); }
      update(i + 1);
    }
    return { out, failed: n - out.length };
  }

  // ---------- วิเคราะห์ (ใช้ Web Worker หลายตัวถ้าทำได้) ----------
  function makeWorkers(n) {
    const list = [];
    try { for (let i = 0; i < n; i++) list.push(new Worker('js/cull-worker.js')); }
    catch (e) { list.forEach(w => w.terminate()); return null; } // เช่น เปิดไฟล์ตรงจากเครื่อง (file://)
    return list.map(w => {
      let broken = false, seq = 0;
      const pending = new Map();
      w.onmessage = e => {
        const { id, ok, r, error } = e.data;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (ok) p.res(r); else p.rej(new Error(error));
      };
      w.onerror = e => {
        e.preventDefault();
        broken = true;
        pending.forEach(p => p.fallback());
        pending.clear();
      };
      return {
        terminate: () => w.terminate(),
        run(file) {
          if (broken) return Core.analyzeFile(file);
          return new Promise((res, rej) => {
            const id = ++seq;
            pending.set(id, { res, rej, fallback: () => Core.analyzeFile(file).then(res, rej) });
            w.postMessage({ id, file });
          });
        }
      };
    });
  }

  async function analyzeAll(files) {
    resetResults();
    show('stepProgress');
    $('pTitle').textContent = 'กำลังวิเคราะห์รูป...';
    state.cancelled = false;
    const total = files.length;
    const results = new Array(total);
    let done = 0, failed = 0, next = 0;
    const t0 = performance.now();

    const update = () => {
      $('pBar').style.width = (done / total * 100) + '%';
      $('pText').textContent = `วิเคราะห์แล้ว ${num(done)} จาก ${num(total)} รูป` + (failed ? ` (เปิดไม่ได้ ${failed})` : '');
      if (done > 3 && done < total) {
        const left = (performance.now() - t0) / done * (total - done) / 1000;
        $('pEta').textContent = left > 90 ? `เหลือประมาณ ${Math.ceil(left / 60)} นาที` : `เหลือประมาณ ${Math.ceil(left)} วินาที`;
      } else $('pEta').textContent = '';
    };
    update();

    const nWorkers = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 6);
    const workers = makeWorkers(nWorkers);
    const loop = async analyze => {
      while (!state.cancelled && next < total) {
        const i = next++;
        try { results[i] = await analyze(files[i]); }
        catch (e) { failed++; console.warn('analyze failed', files[i].name, e); }
        done++;
        update();
      }
    };
    await Promise.all(workers ? workers.map(w => loop(f => w.run(f))) : [loop(Core.analyzeFile), loop(Core.analyzeFile)]);
    if (workers) workers.forEach(w => w.terminate());

    results.forEach((r, i) => {
      if (!r) return;
      const f = files[i];
      const p = Object.assign({}, r, {
        id: i, file: f, name: f.name, path: relPath(f),
        time: r.taken || f.lastModified, thumbUrl: URL.createObjectURL(r.thumb)
      });
      delete p.thumb;
      state.photos.push(p);
      state.byId.set(i, p);
    });
    state.failed = failed;
    state.total = total;
    state.facesOff = false;
    if (state.photos.length && !state.cancelled) await detectFaces();

    if (!state.photos.length) {
      show('stepStart');
      return toast('อ่านรูปไม่ได้เลย ลองใช้ Chrome หรือ Edge รุ่นล่าสุด', 'error');
    }
    recompute();
    show('stepResults');
    renderAll();
  }
  $('cancel').onclick = () => { state.cancelled = true; };

  // ตรวจใบหน้าและคนหลับตา (ทำต่อจากการวิเคราะห์หลัก กดหยุดได้)
  async function detectFaces() {
    const P = state.photos, n = P.length;
    $('pTitle').textContent = 'กำลังตรวจใบหน้าและคนหลับตา...';
    $('pBar').style.width = '0%';
    $('pText').textContent = 'กำลังโหลดตัวตรวจใบหน้า...';
    $('pEta').textContent = '';
    try { await PCSKFaces.load(); }
    catch (e) {
      console.warn('โหลดตัวตรวจใบหน้าไม่ได้', e);
      toast('โหลดตัวตรวจใบหน้าไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต) จึงคัดรูปโดยไม่ตรวจหลับตา', 'error');
      state.facesOff = true;
      return;
    }
    const t0 = performance.now();
    for (let i = 0; i < n && !state.cancelled; i++) {
      try { Object.assign(P[i], await PCSKFaces.analyze(P[i].file)); }
      catch (e) { console.warn('ตรวจใบหน้าไม่ได้', P[i].name, e); }
      $('pBar').style.width = ((i + 1) / n * 100) + '%';
      $('pText').textContent = `ตรวจใบหน้าแล้ว ${num(i + 1)} จาก ${num(n)} รูป`;
      const left = (performance.now() - t0) / (i + 1) * (n - i - 1) / 1000;
      $('pEta').textContent = i > 1 && i < n - 1 ? (left > 90 ? `เหลือประมาณ ${Math.ceil(left / 60)} นาที` : `เหลือประมาณ ${Math.ceil(left)} วินาที`) : '';
    }
  }

  function resetResults() {
    state.photos.forEach(p => URL.revokeObjectURL(p.thumbUrl));
    state.photos = [];
    state.byId = new Map();
    state.groups = [];
    state.overrides = new Map();
    state.filter = 'all';
    wmPv.id = null;
    wmPv.bmp = null;
  }

  // ---------- จัดกลุ่มและให้คะแนน ----------
  function hamming(a, b) { let d = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) d++; return d; }
  // เทียบสีหลังปรับความสว่างให้เท่ากัน เพื่อให้ภาพเดียวกันที่ถ่ายมืด/สว่างต่างกันยังนับเป็นภาพซ้ำ
  function colorDist(a, b) {
    const ka = 128 / Math.max(8, a.mean), kb = 128 / Math.max(8, b.mean);
    let s = 0;
    for (let i = 0; i < a.colors.length; i++) s += Math.abs(Math.min(255, a.colors[i] * ka) - Math.min(255, b.colors[i] * kb));
    return s / a.colors.length;
  }
  function isSimilar(a, b, s) {
    if (Math.abs(a.time - b.time) > MAX_GAP) return false;
    return hamming(a.hash, b.hash) <= s.h && colorDist(a, b) <= s.c;
  }
  const byTime = (a, b) => a.time - b.time || a.path.localeCompare(b.path, undefined, { numeric: true });

  function recompute() {
    const P = state.photos;
    // ความคมชัดเทียบกับคอนทราสต์ของภาพ เพื่อไม่ให้ภาพมืดถูกมองว่าเบลอ
    P.forEach(p => { p.focus = p.sharp / (p.std * p.std + 25); });
    const sharps = P.map(p => p.focus).sort((a, b) => a - b);
    const med = sharps[Math.floor(sharps.length / 2)];
    const p90 = sharps[Math.min(sharps.length - 1, Math.floor(sharps.length * 0.9))];
    const lp90 = Math.log1p(p90) || 1;

    // ความคมของใบหน้า เทียบกันภายในชุดเดียวกัน (เฉพาะภาพที่มีหน้าคน)
    const fs = P.filter(p => p.mainFaces).map(p => p.faceSharp).sort((a, b) => a - b);
    const lfp90 = fs.length ? Math.log1p(fs[Math.min(fs.length - 1, Math.floor(fs.length * 0.9))]) || 1 : 1;

    for (const p of P) {
      scorePro(p, { med, lp90, lfp90, n: P.length });
    }

    // จัดกลุ่มตามลำดับเวลาที่ถ่าย: ภาพที่คล้ายกับภาพล่าสุดในกลุ่มจะถูกรวมเข้ากลุ่มเดียวกัน
    const s = SENS[state.settings.sens];
    const groups = [];
    let cur = null;
    for (const p of [...P].sort(byTime)) {
      if (cur && cur.slice(-4).some(q => isSimilar(p, q, s))) cur.push(p);
      else { cur = [p]; groups.push(cur); }
    }

    groups.forEach((g, gi) => {
      const ranked = [...g].sort((a, b) => b.score - a.score);
      let kept = 0;
      ranked.forEach((p, ri) => {
        p.group = gi;
        p.best = g.length > 1 && ri === 0;
        let auto = true, reason = '';
        if (state.settings.dropBlur && p.blurry) { auto = false; reason = 'ภาพเบลอ'; }
        else if (kept >= state.settings.keep) { auto = false; reason = p.closed ? 'มีคนหลับตา และมีภาพที่ดีกว่าในกลุ่มนี้' : 'ภาพซ้ำ มีภาพที่ดีกว่าในกลุ่มนี้'; }
        if (auto) kept++;
        p.auto = auto;
        p.reason = reason;
        p.keep = state.overrides.has(p.id) ? state.overrides.get(p.id) : auto;
      });
    });
    state.groups = groups;
  }

  // ---------- ให้คะแนนแบบช่างภาพมืออาชีพ 5 ด้าน ----------
  // คะแนนแต่ละด้าน 0-1 แล้วถ่วงน้ำหนักรวมเป็น 0-100 พร้อมรายการปัญหา (sev 2 = ควรตรวจ, 1 = เล็กน้อย) และจุดเด่น
  function scorePro(p, ctx) {
    const issues = [], goods = [];
    // short = ป้ายสั้นบนรูปย่อ, text = คำอธิบายเต็มตอนดูภาพใหญ่
    const SHORT = [['หน้าคนมืด', 'หน้ามืด'], ['หน้าคนสว่าง', 'หน้าสว่างจ้า'], ['โฟกัส', 'โฟกัสหลุด'], ['สั่นไหว', 'ภาพสั่น'], ['เอียง', 'ภาพเอียง'], ['ถูกตัด', 'หน้าถูกตัด'],
      ['ชิดขอบ', 'ชิดขอบ'], ['เล็กมาก', 'ตัวแบบเล็ก'], ['หันหน้า', 'หันหน้าหนี'], ['พูด', 'อ้าปาก'], ['noise', 'noise สูง'], ['จ้า', 'แสงรบกวน']];
    const add = (sev, text) => issues.push({ sev, text, short: (SHORT.find(([k]) => text.includes(k)) || [, text])[1] });
    const deg = Math.abs(p.tilt || 0);

    // 1) ความคมชัดและโฟกัส
    const sharpN = Math.min(1, Math.log1p(p.focus) / ctx.lp90);
    let focus = sharpN;
    if (p.mainFaces) {
      const faceN = Math.min(1, Math.log1p(p.faceSharp) / ctx.lfp90);
      focus = 0.4 * sharpN + 0.6 * faceN; // หน้าคนชัดสำคัญกว่าฉากหลัง
      // โฟกัสหลุด: หน้าคนเบลอกว่าภาพอื่นในชุดชัดเจน และฉากหลังชัดกว่าหน้ามาก
      if (p.focusRatio < 0.05 && faceN < 0.5) { focus *= 0.6; add(2, 'โฟกัสไม่อยู่ที่ใบหน้า (ฉากหลังชัดกว่า)'); }
      else if (faceN > 0.8) goods.push('หน้าคมชัด');
    }
    // เกรน/noise ทำให้ภาพดู "มีรายละเอียด" มากกว่าความจริง จึงหักออกจากคะแนนความคม
    if (p.noise > 3) focus *= Math.max(0.3, 1 - (p.noise - 3) * 0.1);
    p.blurry = ctx.n >= 5 && p.focus < ctx.med * 0.3; // คมน้อยกว่า 30% ของภาพส่วนใหญ่ในชุด
    // ภาพสั่น: คมน้อยกว่าภาพส่วนใหญ่ในชุดมาก และรายละเอียดหายไปทิศเดียว (อาคาร/เส้นตรงที่คมปกติจะไม่ถูกนับ)
    if (p.motion > 0.5 && p.focus < ctx.med * 0.4) { focus *= 0.75; add(2, 'ภาพสั่นไหว (กล้องหรือคนขยับ)'); }

    // 2) แสง
    let exposure = clamp(1 - Math.abs(p.mean - 120) / 160 - p.clipHi * 2 - p.clipLo * 1.5, 0, 1);
    p.dark = p.mean < 50 || p.clipLo > 0.4;
    p.bright = p.mean > 210 || p.clipHi > 0.25;
    if (p.mainFaces && p.faceLum) {
      // ภาพที่มีคน ช่างภาพดูแสงที่หน้าคนเป็นหลัก (ภาพพื้นหลังขาว/มืดแบบตั้งใจจึงไม่ถูกหักคะแนน)
      const faceExp = clamp(1 - Math.max(0, Math.abs(p.faceLum - 140) - 40) / 80, 0, 1);
      exposure = 0.7 * faceExp + 0.3 * exposure;
      if (faceExp > 0.7) { p.dark = false; p.bright = false; }
      else if (p.faceLum < 90) add(1, 'หน้าคนมืดเกินไป');
      else if (p.faceLum > 200) add(1, 'หน้าคนสว่างจ้าเกินไป');
    }
    const light = clamp(0.75 * exposure + 0.15 * Math.min(1, p.std / 60) + 0.1 * Math.min(1, p.colorful / 70), 0, 1);

    // 3) องค์ประกอบภาพ
    let comp = 1;
    // เตือนเฉพาะเมื่อมีเส้นตรงชัด (อาคาร เวที ขอบฟ้า) เอียงไปทางเดียวกัน และแทบไม่มีเส้นที่ตรงแนวเลย
    if (p.tiltConf >= 0.3 && p.tiltVsLevel >= 3 && deg >= 1.5 && deg <= 12) {
      comp -= Math.min(0.35, deg * 0.05);
      add(deg >= 3 ? 2 : 1, `ภาพเอียงประมาณ ${deg.toFixed(1)}°`);
    }
    if (p.cutFaces) { comp -= 0.2 * Math.min(2, p.cutFaces); add(2, `หน้าคนถูกตัดที่ขอบภาพ ${p.cutFaces} คน`); }
    const s = p.mainFaces ? p.faceCenter : p.subj;
    if (s) {
      // วางตัวแบบตรงกลาง หรือตามเส้นแบ่ง 3 ส่วน ถือว่าดี ชิดขอบเกินไปหักคะแนน
      const pts = [[0.5, 0.5], [1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]];
      const d = Math.min(...pts.map(([x, y]) => Math.hypot(s.x - x, s.y - y)));
      if (d > 0.24) { comp -= 0.15; add(1, 'ตัวแบบอยู่ชิดขอบภาพ'); }
      else if (p.mainFaces) goods.push('จัดวางตัวแบบดี');
    }
    if (p.mainFaces && p.faceSize < 0.04 && p.mainFaces <= 2) { comp -= 0.1; add(1, 'ตัวแบบเล็กมากในภาพ'); }
    comp = clamp(comp, 0, 1);

    // 4) ใบหน้าและท่าทาง
    let face = null;
    if (p.faces) {
      const mf = p.mainFaces || p.faces;
      face = 1 - 0.6 * (p.closed / p.faces) - 0.15 * (p.blink || 0) - 0.35 * ((p.lookAway || 0) / mf) - 0.15 * ((p.talking || 0) / mf) + 0.1 * Math.min(1, (p.smile || 0) * 1.5);
      face = clamp(face, 0, 1);
      if (p.lookAway) add(p.lookAway === mf ? 2 : 1, `หันหน้าหนีกล้อง ${p.lookAway} คน`);
      if (p.talking) add(1, `อ้าปาก/กำลังพูด ${p.talking} คน`);
      if (!p.closed) goods.push(p.faces > 1 ? 'ทุกคนลืมตา' : 'ลืมตา');
      if ((p.smile || 0) > 0.45) goods.push('ยิ้ม');
    }

    // 5) สิ่งรบกวน
    let clean = 1;
    if (p.noise > 4) { clean -= Math.min(0.5, (p.noise - 4) * 0.08); add(p.noise > 7 ? 2 : 1, 'มีเกรน/noise สูง (ISO สูง)'); }
    // จุดจ้าเฉพาะที่ขอบ (เช่น หน้าต่าง ไฟ) ไม่นับภาพพื้นหลังขาวทั้งภาพ ที่ตั้งใจถ่ายแบบสตูดิโอ
    if (p.edgeGlare > 0.04 && p.edgeGlare < 0.3 && p.midGlare < 0.02 && p.edgeGlare > p.midGlare * 3) { clean -= 0.25; add(1, 'มีจุดสว่างจ้ารบกวนที่ขอบภาพ'); }
    clean = clamp(clean, 0, 1);

    const w = face === null
      ? { focus: 0.42, light: 0.25, comp: 0.2, face: 0, clean: 0.13 }
      : { focus: 0.32, light: 0.2, comp: 0.16, face: 0.22, clean: 0.1 };
    p.parts = { focus, light, comp, face, clean };
    p.score = Math.round(100 * (w.focus * focus + w.light * light + w.comp * comp + w.face * (face || 0) + w.clean * clean));
    issues.sort((a, b) => b.sev - a.sev);
    p.issues = issues;
    p.goods = goods;
    p.review = issues.some(i => i.sev >= 2) || p.closed > 0 || p.blurry;
  }

  // ---------- แสดงผล ----------
  function counts() {
    const P = state.photos;
    const kept = P.filter(p => p.keep).length;
    const dupGroups = state.groups.filter(g => g.length > 1);
    return {
      all: P.length, kept, drop: P.length - kept,
      dupGroups: dupGroups.length, dupPhotos: dupGroups.reduce((a, g) => a + g.length, 0),
      blurry: P.filter(p => p.blurry).length,
      review: P.filter(p => p.keep && p.review).length
    };
  }

  function renderStats() {
    const c = counts();
    $('stats').innerHTML = [
      ['ทั้งหมด', c.all, ''],
      ['กลุ่มภาพซ้ำ', c.dupGroups, `${num(c.dupPhotos)} รูป`],
      ['เก็บไว้', c.kept, 'keep'],
      ['คัดออก', c.drop, 'drop'],
      ['ภาพเบลอ', c.blurry, '']
    ].map(([label, n, extra]) => `<div class="stat ${extra === 'keep' || extra === 'drop' ? extra : ''}">
        <span>${label}</span><strong>${num(n)}</strong>${extra && extra !== 'keep' && extra !== 'drop' ? `<small>${extra}</small>` : ''}</div>`).join('');

    const tabs = [['all', 'ทั้งหมด', c.all], ['dup', 'เฉพาะกลุ่มภาพซ้ำ', c.dupPhotos], ['keep', 'เก็บไว้', c.kept], ['review', 'ควรตรวจซ้ำ', c.review], ['drop', 'คัดออก', c.drop]];
    $('tabs').innerHTML = tabs.map(([f, label, n]) =>
      `<button type="button" role="tab" class="chip${state.filter === f ? ' on' : ''}" data-f="${f}" aria-selected="${state.filter === f}">${label} (${num(n)})</button>`).join('');

    $('exportCount').textContent = `เก็บไว้ ${num(c.kept)} จาก ${num(c.all)} รูป`;
    $('exportBtn').disabled = !c.kept || state.exporting;
  }

  function renderSkipNote() {
    const s = state.skipped || {};
    const parts = [];
    if (s.raw) parts.push(`ไฟล์ RAW ${num(s.raw)} ไฟล์ (คัดลอกตามคู่ JPG ได้ตอนบันทึก)`);
    if (s.video) parts.push(`วิดีโอ ${num(s.video)} ไฟล์`);
    if (s.heic) parts.push(`HEIC ที่แปลงไม่ได้ ${num(s.heic)} ไฟล์`);
    if (s.other) parts.push(`ไฟล์อื่น ${num(s.other)} ไฟล์`);
    if (state.failed) parts.push(`รูปที่เปิดไม่ได้ ${num(state.failed)} ไฟล์`);
    const notAnalyzed = state.total - state.photos.length - state.failed;
    if (notAnalyzed > 0) parts.push(`ยังไม่ได้วิเคราะห์ ${num(notAnalyzed)} รูป (กดหยุดไว้)`);
    let note = parts.length ? 'ไม่ได้นำมาคัด: ' + parts.join(', ') : '';
    const unchecked = state.photos.filter(p => p.faces === undefined).length;
    if (!state.facesOff && unchecked) note += (note ? ' · ' : '') + `ยังไม่ได้ตรวจใบหน้า ${num(unchecked)} รูป (กดหยุดไว้)`;
    else if (state.facesOff) note += (note ? ' · ' : '') + 'ไม่ได้ตรวจใบหน้าและคนหลับตาในรอบนี้';
    $('skipNote').textContent = note;
    $('rawWrap').hidden = !s.raw;
  }

  function badgesOf(p) {
    const badges = [];
    if (p.best) badges.push('<b class="bd best">ดีที่สุดในกลุ่ม</b>');
    if (p.closed) badges.push(`<b class="bd warn">หลับตา ${p.closed} คน</b>`);
    if (p.blurry) badges.push('<b class="bd warn">เบลอ</b>');
    if (p.dark) badges.push('<b class="bd warn">มืด</b>');
    if (p.bright) badges.push('<b class="bd warn">สว่างเกิน</b>');
    // ปัญหาจากการประเมินแบบมืออาชีพ แสดงไม่เกิน 2 อันที่สำคัญที่สุด
    (p.issues || []).slice(0, 2).forEach(i => badges.push(`<b class="bd ${i.sev >= 2 ? 'warn' : 'minor'}" title="${esc(i.text)}">${esc(i.short)}</b>`));
    return badges;
  }

  // แถบคะแนน 5 ด้าน + ปัญหา + จุดเด่น (ใช้ในหน้าดูภาพใหญ่และหน้าเทียบภาพ)
  function detailHtml(p, compact) {
    const P = p.parts || {};
    const rows = [['โฟกัส/ความคม', P.focus], ['แสง', P.light], ['องค์ประกอบ', P.comp], ['ใบหน้า/ท่าทาง', P.face], ['สิ่งรบกวน', P.clean]]
      .filter(([, v]) => v !== null && v !== undefined);
    const bars = rows.map(([label, v]) => {
      const pct = Math.round(v * 100);
      const tone = pct >= 75 ? 'good' : pct >= 50 ? 'mid' : 'low';
      return `<span class="meter ${tone}" title="${label} ${pct}/100"><span>${label}</span><i><b style="width:${pct}%"></b></i><em>${pct}</em></span>`;
    }).join('');
    const iss = (p.issues || []).map(i => `<span class="chip-i ${i.sev >= 2 ? 'warn' : 'minor'}">${esc(compact ? i.short : i.text)}</span>`);
    if (p.closed) iss.unshift(`<span class="chip-i warn">หลับตา ${p.closed} คน</span>`);
    if (p.blurry) iss.unshift('<span class="chip-i warn">เบลอ</span>');
    const good = (p.goods || []).map(g => `<span class="chip-i good">${esc(g)}</span>`);
    return `<div class="meters">${bars}</div><div class="chips-i">${iss.join('')}${good.join('')}</div>`;
  }

  function card(p) {
    const badges = badgesOf(p);
    const tip = `${p.name} · คะแนน ${p.score}` + (!p.keep && p.reason ? ` · ${p.reason}` : '');
    return `<div class="cp ${p.keep ? 'keep' : 'drop'}" data-id="${p.id}" title="${esc(tip)}">
      <img src="${p.thumbUrl}" alt="${esc(p.name)}" loading="lazy" draggable="false">
      <span class="cp-score" title="คะแนนความคมชัดและแสง">${p.score}</span>
      <button type="button" class="cp-zoom" aria-label="ดูภาพใหญ่"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4.5-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      <span class="cp-status">${p.keep ? '✓ เก็บ' : '✕ คัดออก'}</span>
      <span class="cp-badges">${badges.join('')}</span>
    </div>`;
  }

  function renderList() {
    const f = state.filter;
    const view = [];
    const grid = arr => { arr.forEach(p => view.push(p.id)); return `<div class="cp-grid">${arr.map(card).join('')}</div>`; };
    let html = '';

    if (f === 'keep' || f === 'drop' || f === 'review') {
      const arr = [...state.photos].sort(byTime).filter(p => (f === 'keep' ? p.keep : f === 'drop' ? !p.keep : p.keep && p.review));
      if (arr.length) html = (f === 'review' ? '<p class="muted small review-note">ภาพที่ระบบเก็บไว้ แต่พบปัญหาสำคัญ เช่น โฟกัสหลุด ภาพสั่น หลับตา หน้าถูกตัด ลองเปิดดูภาพใหญ่ก่อนตัดสินใจ</p>' : '') + grid(arr);
    } else {
      let singles = [];
      let dupNo = 0;
      const flush = () => {
        if (!singles.length) return;
        html += `<section class="grp single"><header><strong>ภาพเดี่ยว</strong><span class="muted">${num(singles.length)} รูป · ไม่มีภาพที่คล้ายกัน</span></header>${grid(singles)}</section>`;
        singles = [];
      };
      state.groups.forEach((g, gi) => {
        if (g.length === 1) { if (f === 'all') singles.push(g[0]); return; }
        flush();
        dupNo++;
        const k = g.filter(p => p.keep).length;
        html += `<section class="grp" data-g="${gi}"><header><strong>กลุ่มภาพซ้ำ ${dupNo}</strong>
          <span class="muted">${g.length} รูป · ${fmtTime(g[0].time)} · เก็บไว้ <b class="gk">${k}</b> รูป</span>
          <button type="button" class="btn btn-ghost btn-sm grp-cmp" data-g="${gi}">เทียบภาพในกลุ่ม</button></header>${grid(g)}</section>`;
      });
      flush();
    }
    state.view = view;
    $('list').innerHTML = html || '<div class="empty"><h2>ไม่มีรูปในหมวดนี้</h2></div>';
  }

  function renderAll() {
    $('setKeep').value = String(state.settings.keep);
    $('setSens').value = String(state.settings.sens);
    $('sensLabel').textContent = SENS[state.settings.sens].label;
    $('setBlur').checked = !!state.settings.dropBlur;
    renderSkipNote();
    renderStats();
    renderList();
    renderWmControls();
    drawWmPreview();
  }

  // ---------- ปรับภาพและลายน้ำ ----------
  const wmPv = { id: null, bmp: null, busy: null, holding: false };
  function exportLabel() {
    const w = state.settings.wm.on, e = state.settings.enh.on;
    const where = window.showDirectoryPicker ? 'ลงโฟลเดอร์' : ''; // มือถือเลือกโฟลเดอร์ไม่ได้
    if (w && e) return 'ปรับภาพ ใส่ลายน้ำ และบันทึก';
    if (w) return 'ใส่ลายน้ำและบันทึก' + where;
    if (e) return 'ปรับภาพและบันทึก' + where;
    return 'บันทึกรูปที่เก็บไว้' + where;
  }
  function renderWmControls() {
    const w = state.settings.wm, en = state.settings.enh;
    $('wmOn').checked = w.on;
    $('wmFields').classList.toggle('off', !w.on);
    $('enhOn').checked = en.on;
    $('enhFields').classList.toggle('off', !en.on);
    $('holdCompare').hidden = !en.on && !w.on;
    const nKept = state.photos.filter(p => p.keep).length;
    $('wmPrev').hidden = $('wmNext').hidden = nKept < 2;
    [['wmStyle', w.style], ['wmPos', w.pos], ['wmSize', w.size], ['enhLevel', en.level], ['enhLook', en.look]].forEach(([id, v]) => {
      $(id).querySelectorAll('button').forEach(b => {
        b.classList.toggle('on', b.dataset.v === v);
        b.setAttribute('aria-checked', b.dataset.v === v);
      });
    });
    $('wmPosWrap').hidden = w.style === 'center';
    $('wmOpacity').value = String(w.opacity);
    $('wmOpLabel').textContent = w.opacity + '%';
    if (!state.exporting) $('exportBtn').textContent = exportLabel(); // ระหว่างบันทึก ปุ่มแสดงความคืบหน้าอยู่
  }

  // รูปตัวอย่าง: รูปที่เก็บไว้ (ถ้าไม่มี ใช้ภาพทิวทัศน์สมมติ)
  async function drawWmPreview() {
    const canvas = $('wmCanvas');
    const kept = state.photos.filter(p => p.keep).sort(byTime);
    let p = state.byId.get(wmPv.id);
    if (!p || !p.keep) p = kept[0];
    // กดค้างปุ่มเทียบ = แสดงภาพต้นฉบับ ไม่ปรับ ไม่มีลายน้ำ
    const opts = wmPv.holding ? null : wmOpts();
    const enh = wmPv.holding ? null : enhOpts();
    $('pvTag').hidden = !wmPv.holding;
    const showInfo = info => {
      $('enhInfo').textContent = wmPv.holding ? '' : !enh ? '' : info && info.length
        ? 'ปรับภาพนี้: ' + info.join(' · ') : 'ภาพนี้สมดุลดีอยู่แล้ว ปรับเพียงเล็กน้อย';
    };
    if (!p) {
      wmPv.id = null;
      $('wmPreviewName').textContent = 'ยังไม่มีรูปที่เก็บไว้ แสดงภาพตัวอย่าง';
      return WM.renderPreview(canvas, sampleScene, opts, null).then(() => showInfo(null));
    }
    if (wmPv.id !== p.id || !wmPv.bmp) {
      wmPv.id = p.id;
      const id = p.id;
      const job = WM.decode(p.file).then(bmp => {
        // ย่อไว้เพื่อให้ปรับค่าแล้ววาดใหม่ได้เร็ว
        const sc = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        return c;
      });
      wmPv.busy = job;
      let src;
      try { src = await job; } catch (e) { return; }
      if (wmPv.id !== id) return; // ผู้ใช้เปลี่ยนภาพไปแล้ว
      wmPv.bmp = src;
    }
    $('wmPreviewName').textContent = `${p.name} · ${kept.indexOf(p) + 1}/${kept.length} รูปที่เก็บไว้`;
    showInfo(await WM.renderPreview(canvas, wmPv.bmp, opts, enh));
  }
  const onWm = () => { saveSettings(); renderWmControls(); drawWmPreview(); drawSample(); };
  $('wmOn').onchange = () => { state.settings.wm.on = $('wmOn').checked; onWm(); };
  $('enhOn').onchange = () => { state.settings.enh.on = $('enhOn').checked; onWm(); };
  [['wmStyle', 'wm', 'style'], ['wmPos', 'wm', 'pos'], ['wmSize', 'wm', 'size'], ['enhLevel', 'enh', 'level'], ['enhLook', 'enh', 'look']].forEach(([id, group, key]) => {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      state.settings[group][key] = b.dataset.v;
      onWm();
    });
  });
  // กดค้างเพื่อเทียบกับภาพก่อนปรับ
  const hold = on => { if (wmPv.holding === on) return; wmPv.holding = on; drawWmPreview(); };
  const hc = $('holdCompare');
  hc.addEventListener('pointerdown', e => { e.preventDefault(); hc.setPointerCapture(e.pointerId); hold(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => hc.addEventListener(ev, () => hold(false)));
  hc.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hold(true); } });
  hc.addEventListener('keyup', () => hold(false));
  hc.addEventListener('blur', () => hold(false));
  $('wmOpacity').oninput = () => { state.settings.wm.opacity = +$('wmOpacity').value; onWm(); };
  // ลูกศรซ้าย/ขวาบนภาพตัวอย่าง: เลื่อนดูรูปที่เก็บไว้
  const wmStep = d => {
    const kept = state.photos.filter(p => p.keep).sort(byTime);
    if (kept.length < 2) return toast('มีรูปที่เก็บไว้เพียงรูปเดียว');
    const i = Math.max(0, kept.findIndex(p => p.id === wmPv.id));
    wmPv.id = kept[(i + d + kept.length) % kept.length].id;
    wmPv.bmp = null;
    drawWmPreview();
  };
  $('wmPrev').onclick = () => wmStep(-1);
  $('wmNext').onclick = () => wmStep(1);

  // ---------- โต้ตอบ ----------
  function setKeep(p, keep) {
    p.keep = keep;
    if (keep === p.auto) state.overrides.delete(p.id); else state.overrides.set(p.id, keep);
    document.querySelectorAll(`.cp[data-id="${p.id}"]`).forEach(el => {
      el.className = 'cp ' + (keep ? 'keep' : 'drop');
      el.querySelector('.cp-status').textContent = keep ? '✓ เก็บ' : '✕ คัดออก';
    });
    const gk = document.querySelector(`.grp[data-g="${p.group}"] .gk`);
    if (gk) gk.textContent = state.groups[p.group].filter(x => x.keep).length;
    renderStats();
    renderWmControls();
    drawWmPreview();
  }

  $('list').addEventListener('click', e => {
    const cb = e.target.closest('.grp-cmp');
    if (cb) return openCompare(+cb.dataset.g);
    const el = e.target.closest('.cp');
    if (!el) return;
    const p = state.byId.get(+el.dataset.id);
    if (e.target.closest('.cp-zoom')) openPreview(p.id);
    else setKeep(p, !p.keep);
  });
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.filter = b.dataset.f;
    renderStats();
    renderList();
  });

  const onSetting = () => {
    state.settings.keep = +$('setKeep').value;
    state.settings.sens = +$('setSens').value;
    state.settings.dropBlur = $('setBlur').checked;
    saveSettings();
    recompute();
    renderAll();
  };
  $('setKeep').onchange = onSetting;
  $('setSens').oninput = onSetting;
  $('setBlur').onchange = onSetting;
  $('resetManual').onclick = () => { state.overrides.clear(); recompute(); renderAll(); toast('กลับไปใช้ผลที่ระบบเลือกแล้ว'); };
  $('restart').onclick = () => {
    if (state.overrides.size && !confirm('ยกเลิกผลการคัดนี้และเริ่มใหม่?')) return;
    resetResults();
    show('stepStart');
  };

  // ---------- ดูภาพใหญ่ ----------
  const pv = { el: $('preview'), img: $('pvImg'), idx: 0, url: null };
  function openPreview(id) {
    pv.idx = Math.max(0, state.view.indexOf(id));
    pv.el.hidden = false;
    document.body.classList.add('no-scroll');
    showPreview();
  }
  function showPreview() {
    const p = state.byId.get(state.view[pv.idx]);
    if (!p) return closePreview();
    if (pv.url) URL.revokeObjectURL(pv.url);
    pv.url = URL.createObjectURL(p.file);
    pv.img.src = p.thumbUrl;
    const full = new Image();
    const url = pv.url;
    full.onload = () => { if (pv.url === url) pv.img.src = url; };
    full.src = url;
    const notes = [];
    if (p.best) notes.push('ดีที่สุดในกลุ่ม');
    if (p.faces) notes.push(p.closed ? `${p.faces} หน้า หลับตา ${p.closed} คน` : `${p.faces} หน้า ลืมตาครบ`);
    if (!p.keep && p.reason) notes.push(p.reason);
    $('pvInfo').textContent = `${pv.idx + 1}/${state.view.length} · ${p.name} · ${fmtTime(p.time)} · คะแนน ${p.score}` + (notes.length ? ' · ' + notes.join(', ') : '');
    $('pvDetail').innerHTML = detailHtml(p, false);
    const t = $('pvToggle');
    t.textContent = p.keep ? '✓ เก็บไว้ (กดเพื่อคัดออก)' : '✕ คัดออก (กดเพื่อเก็บ)';
    t.className = 'btn btn-sm ' + (p.keep ? 'btn-keep' : 'btn-light');
  }
  function closePreview() {
    pv.el.hidden = true;
    pv.img.removeAttribute('src');
    if (pv.url) { URL.revokeObjectURL(pv.url); pv.url = null; }
    document.body.classList.remove('no-scroll');
  }
  const pvStep = d => { pv.idx = (pv.idx + d + state.view.length) % state.view.length; showPreview(); };
  const pvToggle = () => { const p = state.byId.get(state.view[pv.idx]); setKeep(p, !p.keep); showPreview(); };
  $('pvPrev').onclick = () => pvStep(-1);
  $('pvNext').onclick = () => pvStep(1);
  $('pvClose').onclick = closePreview;
  $('pvToggle').onclick = pvToggle;
  pv.el.addEventListener('click', e => { if (e.target.classList.contains('lb-stage')) closePreview(); });
  document.addEventListener('keydown', e => {
    if (pv.el.hidden) return;
    if (e.key === 'Escape') closePreview();
    else if (e.key === 'ArrowLeft') pvStep(-1);
    else if (e.key === 'ArrowRight') pvStep(1);
    else if (e.key === ' ' || e.key.toLowerCase() === 'k') { e.preventDefault(); pvToggle(); }
  });

  // ---------- เทียบภาพในกลุ่มแบบข้างกัน ----------
  const cmp = { gi: null, urls: [] };
  function openCompare(gi) {
    const g = [...state.groups[gi]].sort(byTime);
    cmp.gi = gi;
    cmp.urls = g.map(p => URL.createObjectURL(p.file));
    const n = g.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3;
    const grid = $('cmpGrid');
    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--rows', Math.min(Math.ceil(n / cols), 2));
    grid.innerHTML = g.map((p, i) => `<figure class="cmp-cell" data-id="${p.id}">
        <div class="cmp-img" title="คลิกเพื่อสลับ เก็บ / คัดออก"><img src="${cmp.urls[i]}" alt="${esc(p.name)}"></div>
        <figcaption></figcaption></figure>`).join('');
    renderCompare();
    $('compare').hidden = false;
    document.body.classList.add('no-scroll');
  }
  function renderCompare() {
    const g = state.groups[cmp.gi];
    if (!g) return closeCompare();
    const k = g.filter(p => p.keep).length;
    $('cmpTitle').textContent = `เทียบภาพในกลุ่ม · ${g.length} รูป · เก็บไว้ ${k} รูป · คลิกที่ภาพเพื่อสลับ เก็บ / คัดออก`;
    $('cmpGrid').querySelectorAll('.cmp-cell').forEach(el => {
      const p = state.byId.get(+el.dataset.id);
      el.className = 'cmp-cell ' + (p.keep ? 'keep' : 'drop');
      el.querySelector('figcaption').innerHTML = `
        <span class="cmp-name">${esc(p.name)} · คะแนน ${p.score}</span>
        <div class="cmp-detail">${detailHtml(p, true)}</div>
        <span class="cmp-btns">
          <button type="button" class="btn btn-sm ${p.keep ? 'btn-keep' : 'btn-light'}" data-act="toggle">${p.keep ? '✓ เก็บ' : '✕ คัดออก'}</button>
          <button type="button" class="btn btn-sm btn-ghost cmp-only" data-act="only">เก็บภาพนี้ภาพเดียว</button>
        </span>`;
    });
  }
  function closeCompare() {
    $('compare').hidden = true;
    $('cmpGrid').innerHTML = '';
    cmp.urls.forEach(u => URL.revokeObjectURL(u));
    cmp.urls = [];
    cmp.gi = null;
    document.body.classList.remove('no-scroll');
  }
  $('cmpGrid').addEventListener('click', e => {
    const cell = e.target.closest('.cmp-cell');
    if (!cell) return;
    const p = state.byId.get(+cell.dataset.id);
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'only') state.groups[cmp.gi].forEach(q => { if (q.keep !== (q.id === p.id)) setKeep(q, q.id === p.id); });
    else if (act || e.target.closest('.cmp-img')) setKeep(p, !p.keep);
    else return;
    renderCompare();
  });
  $('cmpClose').onclick = closeCompare;
  document.addEventListener('keydown', e => { if (!$('compare').hidden && e.key === 'Escape') closeCompare(); });

  // ---------- บันทึกรูปที่เก็บไว้ ----------
  function exportItems() {
    const withRaw = $('withRaw').checked && !$('rawWrap').hidden;
    const items = [];
    for (const p of state.photos.filter(x => x.keep).sort(byTime)) {
      const raw = withRaw ? state.raws.get(stemKey(p.path)) : null;
      items.push({ file: p.file, raw });
    }
    return items;
  }
  const splitName = n => { const d = n.lastIndexOf('.'); return d > 0 ? [n.slice(0, d), n.slice(d)] : [n, '']; };

  async function exists(dir, name) {
    try { await dir.getFileHandle(name); return true; } catch (e) { return false; }
  }
  // ตั้งชื่อไม่ให้ซ้ำ และไม่เขียนทับไฟล์ที่มีอยู่แล้วในโฟลเดอร์ปลายทาง
  async function uniqueStem(dir, stem, exts, used) {
    let n = 1, cand = stem;
    const taken = async c => {
      for (const ext of exts) {
        const name = (c + ext).toLowerCase();
        if (used.has(name)) return true;
        if (dir && await exists(dir, c + ext)) return true;
      }
      return false;
    };
    while (await taken(cand)) { n++; cand = `${stem} (${n})`; }
    exts.forEach(ext => used.add((cand + ext).toLowerCase()));
    return cand;
  }

  async function writeAll(items, writeFile, onProgress) {
    const used = new Set();
    let done = 0;
    // ใช้ค่าตั้งค่า ณ ตอนกดบันทึก ทุกรูปในชุดจึงได้ลายน้ำแบบเดียวกันแม้มีการปรับค่าระหว่างบันทึก
    const wm = wmOpts() ? Object.assign({}, wmOpts()) : null, enh = enhOpts();
    const asIs = []; // รูปที่ปรับ/ใส่ลายน้ำไม่ได้ จึงคัดลอกต้นฉบับไปแทน
    const totalFiles = items.reduce((a, it) => a + (it.raw ? 2 : 1), 0);
    for (const it of items) {
      let [stem, ext] = splitName(it.file.name);
      let data = it.file;
      if (wm || enh) {
        try {
          const r = await WM.renderFile(it.file, wm, enh);
          data = r.blob;
          ext = r.ext;
        } catch (e) {
          console.warn('ปรับภาพ/ใส่ลายน้ำไม่ได้ คัดลอกต้นฉบับแทน', it.file.name, e);
          asIs.push(it.file.name);
        }
      }
      const rawExt = it.raw ? splitName(it.raw.name)[1] : null;
      const finalStem = await uniqueStem(writeFile.dir, stem, rawExt ? [ext, rawExt] : [ext], used);
      await writeFile(finalStem + ext, data);
      onProgress(++done, totalFiles);
      if (it.raw) { await writeFile(finalStem + rawExt, it.raw); onProgress(++done, totalFiles); }
    }
    return { total: totalFiles, asIs };
  }
  const asIsNote = r => (r.asIs.length ? ` · ${num(r.asIs.length)} รูปปรับภาพไม่ได้ จึงบันทึกต้นฉบับแทน: ${r.asIs.slice(0, 3).join(', ')}${r.asIs.length > 3 ? ' ...' : ''}` : '');

  // ---------- บันทึกแบบไม่มีโฟลเดอร์ปลายทาง (มือถือ) ----------
  const save = { files: [], batches: [], bi: 0, busy: false };
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ZIP_MAX = 1.5e9;

  // แบ่งชุดสำหรับเมนูแชร์ของเครื่อง: Chrome บน Android รับได้ครั้งละไม่เกิน 10 ไฟล์ / 50 MB
  function shareBatches(files) {
    const maxN = IS_IOS ? 20 : 10, maxB = IS_IOS ? 200e6 : 45e6;
    const out = [];
    let cur = [], bytes = 0;
    for (const f of files) {
      if (cur.length && (cur.length >= maxN || bytes + f.size > maxB)) { out.push(cur); cur = []; bytes = 0; }
      cur.push(f);
      bytes += f.size;
    }
    if (cur.length) out.push(cur);
    return out;
  }
  function canShareAll(batches) {
    if (!navigator.share || !navigator.canShare) return false;
    try { return batches.every(b => navigator.canShare({ files: b })); } catch (e) { return false; }
  }
  function saveLabels() {
    const n = save.batches.length, cur = save.batches[save.bi]; // cur ว่างเมื่อส่งครบทุกชุดแล้ว
    $('saveShare').textContent = n > 1 && cur ? `บันทึกลงเครื่อง ชุดที่ ${num(save.bi + 1)}/${num(n)} (${num(cur.length)} ไฟล์)` : 'บันทึกลงเครื่อง';
    $('saveEach').textContent = 'ดาวน์โหลดแยกทีละไฟล์';
    $('saveZip').textContent = 'รวมเป็นไฟล์ .zip ไฟล์เดียว';
  }
  function openSave(files) {
    const size = files.reduce((a, f) => a + f.size, 0);
    save.files = files;
    save.batches = shareBatches(files);
    save.bi = 0;
    const share = canShareAll(save.batches);
    $('saveTitle').textContent = `พร้อมบันทึก ${num(files.length)} ไฟล์ (${fmtSize(size)})`;
    $('saveShare').hidden = !share;
    $('saveZip').hidden = !window.JSZip || size > ZIP_MAX;
    // จอสัมผัสใช้เมนูแชร์เป็นหลัก (เลือก "บันทึกรูปภาพ" เพื่อเข้าอัลบั้ม) คอมพิวเตอร์ใช้การดาวน์โหลด
    const shareFirst = share && (IS_IOS || matchMedia('(pointer: coarse)').matches);
    $('saveShare').classList.toggle('btn-ghost', !shareFirst);
    $('saveEach').classList.toggle('btn-ghost', shareFirst);
    $('saveHint').textContent = share
      ? (save.batches.length > 1
        ? `"บันทึกลงเครื่อง" จะเปิดเมนูแชร์ของเครื่อง ให้เลือก "บันทึกรูปภาพ" หรือแอปแกลเลอรี โดยแบ่งเป็น ${num(save.batches.length)} ชุด กดปุ่มซ้ำจนครบ`
        : '"บันทึกลงเครื่อง" จะเปิดเมนูแชร์ของเครื่อง ให้เลือก "บันทึกรูปภาพ" หรือแอปแกลเลอรี')
      : 'ไฟล์จะถูกบันทึกแยกทีละรูปลงโฟลเดอร์ดาวน์โหลด หากเบราว์เซอร์ถามเรื่องดาวน์โหลดหลายไฟล์ ให้กด "อนุญาต"';
    saveLabels();
    $('saveSheet').hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeSave() {
    if (save.busy) return;
    $('saveSheet').hidden = true;
    document.body.classList.remove('no-scroll');
    save.files = [];
    save.batches = [];
  }
  function saveBusy(on) {
    save.busy = on;
    ['saveShare', 'saveEach', 'saveZip'].forEach(id => { $(id).disabled = on; });
    if (!on) saveLabels();
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const saveFail = e => { console.error(e); toast('บันทึกไม่สำเร็จ: ' + ((e && e.message) || e), 'error'); };

  $('saveShare').onclick = async () => {
    if (save.busy) return;
    saveBusy(true);
    try {
      await navigator.share({ files: save.batches[save.bi] });
      save.bi++;
      if (save.bi >= save.batches.length) {
        const n = save.files.length;
        saveBusy(false);
        closeSave();
        toast(`ส่งออกครบ ${num(n)} ไฟล์แล้ว`);
        return;
      }
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast('เปิดเมนูแชร์ไม่สำเร็จ ลองใช้ "ดาวน์โหลดแยกทีละไฟล์" แทน', 'error'); }
    }
    saveBusy(false);
  };
  $('saveEach').onclick = async () => {
    if (save.busy) return;
    saveBusy(true);
    try {
      const n = save.files.length;
      for (let i = 0; i < n; i++) {
        $('saveEach').textContent = `กำลังดาวน์โหลด ${num(i + 1)}/${num(n)}`;
        download(save.files[i], save.files[i].name);
        await new Promise(r => setTimeout(r, 350)); // เว้นจังหวะ ไม่ให้เบราว์เซอร์ทิ้งไฟล์ที่สั่งถี่เกินไป
      }
      saveBusy(false);
      closeSave();
      toast(`ดาวน์โหลดแล้ว ${num(n)} ไฟล์ ดูได้ในโฟลเดอร์ดาวน์โหลดของเครื่อง`);
      return;
    } catch (e) { saveFail(e); }
    saveBusy(false);
  };
  $('saveZip').onclick = async () => {
    if (save.busy) return;
    saveBusy(true);
    try {
      $('saveZip').textContent = 'กำลังสร้างไฟล์ .zip...';
      const zip = new JSZip();
      save.files.forEach(f => zip.file(f.name, f));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      download(blob, state.settings.wm.on ? 'PCSK-PHOTO.zip' : 'รูปที่คัดแล้ว.zip');
      saveBusy(false);
      closeSave();
      return;
    } catch (e) { saveFail(e); }
    saveBusy(false);
  };
  $('saveClose').onclick = closeSave;
  $('saveSheet').addEventListener('click', e => { if (e.target === $('saveSheet')) closeSave(); });
  document.addEventListener('keydown', e => { if (!$('saveSheet').hidden && e.key === 'Escape') closeSave(); });

  $('exportBtn').onclick = async () => {
    const items = exportItems();
    if (!items.length) return;
    const btn = $('exportBtn');
    const verb = state.settings.enh.on ? 'กำลังปรับภาพและบันทึก' : state.settings.wm.on ? 'กำลังใส่ลายน้ำและบันทึก' : 'กำลังบันทึก';
    const progress = (d, t) => { btn.textContent = `${verb} ${num(d)}/${num(t)}`; };
    btn.textContent = verb + '...';
    btn.disabled = true;
    state.exporting = true;
    $('restart').disabled = true;
    try {
      if (window.showDirectoryPicker) {
        let dir;
        try { dir = await window.showDirectoryPicker({ id: 'cull-output', mode: 'readwrite', startIn: 'pictures' }); }
        catch (e) { if (e.name === 'AbortError') return; throw e; }
        const write = async (name, file) => {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(file);
          await w.close();
        };
        write.dir = dir;
        const r = await writeAll(items, write, progress);
        const extra = [state.settings.enh.on && 'ปรับแสงและสีแล้ว', state.settings.wm.on && 'มีลายน้ำ PCSK PHOTO'].filter(Boolean).join(' ');
        toast(`บันทึกแล้ว ${num(r.total)} ไฟล์${extra ? ` (${extra})` : ''} ลงโฟลเดอร์ "${dir.name}"${asIsNote(r)}`, r.asIs.length ? 'error' : '');
      } else {
        // เบราว์เซอร์ที่เลือกโฟลเดอร์ไม่ได้ (มือถือ, Firefox, Safari): เตรียมไฟล์แยกทีละรูป แล้วให้เลือกวิธีบันทึก
        const files = [];
        const write = async (name, data) => { files.push(new File([data], name, { type: data.type || '' })); };
        const r = await writeAll(items, write, progress);
        openSave(files);
        if (r.asIs.length) toast(asIsNote(r).slice(3), 'error');
      }
    } catch (e) {
      console.error(e);
      toast('บันทึกไม่สำเร็จ: ' + ((e && e.message) || e), 'error');
    } finally {
      state.exporting = false;
      $('restart').disabled = false;
      btn.disabled = false;
      btn.textContent = exportLabel();
    }
  };

  // ป้องกันการปิดหน้าโดยไม่ตั้งใจหลังคัดรูปแล้ว
  window.addEventListener('beforeunload', e => {
    if (state.photos.length) { e.preventDefault(); e.returnValue = ''; }
  });

  // สำหรับการทดสอบ
  window.__cull = { state, startWith };
})();
