// ตรวจใบหน้าและคนหลับตาในรูป ด้วย MediaPipe Face Landmarker (ของ Google)
// ตัวตรวจทำงานในเบราว์เซอร์บนเครื่องนี้ ไม่มีการส่งรูปออกไป แต่ต้องต่ออินเทอร์เน็ตครั้งแรกเพื่อโหลดตัวตรวจ
(function (root) {
  const VER = '0.10.14';
  const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const MAX_SIDE = 1600;      // ย่อรูปเหลือด้านยาวเท่านี้ก่อนตรวจ
  const MIN_FACE = 0.03;      // ไม่นับหน้าที่เล็กกว่า 3% ของด้านยาว (คนไกล ๆ ฉากหลัง ตรวจตาไม่แม่น)
  const CLOSED = 0.5;         // ค่าการหลับตาเฉลี่ยสองข้างที่ถือว่าหลับตา (0-1)

  let lm = null, loading = null;
  function load() {
    if (lm) return Promise.resolve(lm);
    if (!loading) {
      loading = (async () => {
        const vision = await import(`${BASE}/vision_bundle.mjs`);
        const files = await vision.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
        const make = delegate => vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: 'IMAGE',
          numFaces: 20,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5
        });
        try { lm = await make('GPU'); } catch (e) { lm = await make('CPU'); }
        return lm;
      })().catch(e => { loading = null; throw e; });
    }
    return loading;
  }

  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // ตรวจรูปหนึ่งรูป: คืนจำนวนหน้า และจำนวนคนที่หลับตา
  async function analyze(file) {
    const L = await load();
    const bmp = await root.PCSKWatermark.decode(file);
    const sc = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const W = Math.round(bmp.width * sc), H = Math.round(bmp.height * sc);
    const img = canvas(W, H);
    img.getContext('2d').drawImage(bmp, 0, 0, W, H);
    bmp.close();

    const faces = [];
    const run = (sx, sy, sw, sh) => {
      const t = sx || sy || sw !== W || sh !== H ? canvas(sw, sh) : img;
      if (t !== img) t.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const r = L.detect(t);
      (r.faceLandmarks || []).forEach((pts, i) => {
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
        const box = { x: sx + x0 * sw, y: sy + y0 * sh, w: (x1 - x0) * sw, h: (y1 - y0) * sh };
        if (Math.max(box.w, box.h) < MIN_FACE * Math.max(W, H)) return;
        const cats = (r.faceBlendshapes && r.faceBlendshapes[i] && r.faceBlendshapes[i].categories) || [];
        const score = name => { const c = cats.find(c => c.categoryName === name); return c ? c.score : 0; };
        const bl = score('eyeBlinkLeft'), br = score('eyeBlinkRight');
        box.closed = (bl + br) / 2 > CLOSED && Math.min(bl, br) > 0.3;
        // ระดับการหรี่/หลับตา 0-1 ใช้เทียบภาพถ่ายรัวที่คล้ายกัน ให้เลือกภาพที่ตาเปิดกว้างกว่า
        box.blink = Math.max(0, Math.min(1, ((bl + br) / 2 - 0.3) / 0.4));
        box.smile = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2;
        box.jaw = score('jawOpen');
        // หันหน้า: เทียบระยะจากปลายจมูกถึงหางตาสองข้าง (0 = หน้าตรง, 1 = หันข้างเต็มที่)
        const nose = pts[1], le = pts[33], re = pts[263];
        if (nose && le && re) {
          const dl = Math.abs(nose.x - le.x), dr = Math.abs(re.x - nose.x);
          box.yaw = Math.abs(dr - dl) / (dr + dl + 1e-6);
        } else box.yaw = 0;
        // หน้าเดียวกันที่เจอซ้ำจากหลายรอบ (ทั้งภาพ + แบ่งส่วน) นับครั้งเดียว ใช้ผลรอบแรกที่เจอ
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        if (faces.some(f => Math.abs(f.x + f.w / 2 - cx) < Math.max(f.w, box.w) * 0.5 && Math.abs(f.y + f.h / 2 - cy) < Math.max(f.h, box.h) * 0.5)) return;
        faces.push(box);
      });
    };
    // แบ่งภาพ 4 ส่วน (ซ้อนกันเล็กน้อย) ก่อน เพื่อให้เห็นหน้าคนในภาพหมู่ชัดขึ้น แล้วตรวจทั้งภาพอีกรอบ
    const tw = Math.round(W * 0.58), th = Math.round(H * 0.58);
    for (const [ox, oy] of [[0, 0], [W - tw, 0], [0, H - th], [W - tw, H - th]]) run(ox, oy, tw, th);
    run(0, 0, W, H);
    if (!faces.length) return { faces: 0, closed: 0, blink: 0 };

    // ความคมชัดบริเวณดวงตา เทียบกับส่วนที่คมที่สุดของทั้งภาพ (ดูว่าโฟกัสอยู่ที่หน้าคน หรือหลุดไปฉากหลัง)
    const gray = grayOf(img);
    const best = sharpestArea(gray, W, H);
    for (const f of faces) {
      const x0 = f.x + f.w * 0.1, x1 = f.x + f.w * 0.9;
      const y0 = f.y + f.h * 0.2, y1 = f.y + f.h * 0.55;
      f.sharp = lapNorm(gray, W, H, x0, y0, x1, y1);
      f.lum = meanIn(gray, W, H, f.x + f.w * 0.2, f.y + f.h * 0.25, f.x + f.w * 0.8, f.y + f.h * 0.8);
      // หน้าถูกตัดที่ขอบซ้าย/ขวา/ล่างของภาพ
      f.cut = f.x < W * 0.02 || f.x + f.w > W * 0.98 || f.y + f.h > H * 0.98;
    }

    // ตัวแบบหลัก = หน้าที่ใหญ่อย่างน้อยครึ่งหนึ่งของหน้าที่ใหญ่ที่สุด (ไม่นับคนเดินผ่านฉากหลัง)
    const big = Math.max(...faces.map(f => f.h));
    const main = faces.filter(f => f.h >= big * 0.5);
    const avg = (arr, k) => arr.reduce((a, f) => a + f[k], 0) / arr.length;
    const cx = main.reduce((a, f) => a + f.x + f.w / 2, 0) / main.length / W;
    const cy = main.reduce((a, f) => a + f.y + f.h / 2, 0) / main.length / H;
    return {
      faces: faces.length,
      closed: faces.filter(f => f.closed).length,
      blink: avg(faces, 'blink'),
      mainFaces: main.length,
      faceSharp: Math.max(...main.map(f => f.sharp)),
      focusRatio: best ? Math.max(...main.map(f => f.sharp)) / best : 1,
      lookAway: main.filter(f => f.yaw > 0.5).length,
      talking: main.filter(f => f.jaw > 0.35 && f.smile < 0.3).length,
      smile: avg(main, 'smile'),
      cutFaces: main.filter(f => f.cut).length,
      faceSize: big / H,
      faceLum: avg(main, 'lum'),
      faceCenter: { x: cx, y: cy }
    };
  }

  function grayOf(c) {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const g = new Float32Array(c.width * c.height);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return g;
  }
  // ความคมชัดในกรอบ: ความแปรปรวนของ Laplacian หารด้วยคอนทราสต์ (ไม่ให้ส่วนที่สีเรียบ ๆ ถูกมองว่าเบลอ)
  function lapNorm(g, W, H, x0, y0, x1, y1) {
    x0 = Math.max(1, Math.floor(x0)); y0 = Math.max(1, Math.floor(y0));
    x1 = Math.min(W - 2, Math.ceil(x1)); y1 = Math.min(H - 2, Math.ceil(y1));
    let s = 0, ss = 0, gs = 0, gss = 0, n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
        s += L; ss += L * L; gs += g[i]; gss += g[i] * g[i]; n++;
      }
    }
    if (n < 50) return 0;
    const lv = ss / n - (s / n) ** 2, gv = gss / n - (gs / n) ** 2;
    return lv / (gv + 25);
  }
  function meanIn(g, W, H, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
    let s = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { s += g[y * W + x]; n++; }
    return n ? s / n : 128;
  }
  function sharpestArea(g, W, H) {
    const N = 8, vals = [];
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
      vals.push(lapNorm(g, W, H, tx * W / N, ty * H / N, (tx + 1) * W / N, (ty + 1) * H / N));
    }
    vals.sort((a, b) => b - a);
    return (vals[0] + vals[1] + vals[2]) / 3;
  }

  root.PCSKFaces = { load, analyze };
})(window);
