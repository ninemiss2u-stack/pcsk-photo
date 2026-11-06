// รองรับไฟล์ HEIC/HEIF จาก iPhone: แปลงเป็น JPG ก่อนนำไปคัด
// Chrome/Edge เปิด HEIC เองไม่ได้ จึงใช้ตัวแปลง heic2any (โหลดเฉพาะตอนมีไฟล์ HEIC และต้องต่ออินเทอร์เน็ตครั้งแรก)
// รูปไม่ได้ถูกส่งออกไปไหน การแปลงทำในเบราว์เซอร์บนเครื่องนี้
(function (root) {
  const SRC = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
  const HEIC_RE = /\.(heic|heif)$/i;
  let loading = null;

  function load() {
    if (root.heic2any) return Promise.resolve();
    if (!loading) {
      loading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = SRC;
        s.onload = () => (root.heic2any ? res() : rej(new Error('โหลดตัวแปลงไฟล์ HEIC ไม่สำเร็จ')));
        s.onerror = () => { loading = null; rej(new Error('โหลดตัวแปลงไฟล์ HEIC ไม่สำเร็จ กรุณาต่ออินเทอร์เน็ตแล้วลองใหม่')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  // ดึงข้อมูลกล้อง (EXIF) จากไฟล์ HEIC (โครงสร้างแบบกล่อง ISOBMFF: meta > iinf/iloc)
  // คืนค่าเป็นส่วน APP1 ของ JPEG พร้อมใส่ลงไฟล์ JPG ที่แปลงแล้ว
  function exifFromHeic(buf) {
    const v = new DataView(buf);
    const end = buf.byteLength;
    const str = o => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const each = (start, stop, cb) => {
      let o = start;
      while (o + 8 <= stop) {
        let size = v.getUint32(o), hdr = 8;
        const type = str(o + 4);
        if (size === 1) { size = Number(v.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = stop - o;
        if (size < hdr || o + size > stop) return;
        if (cb(type, o + hdr, o + size) === false) return;
        o += size;
      }
    };
    let meta = null;
    each(0, end, (t, s, e) => { if (t === 'meta') { meta = [s + 4, e]; return false; } });
    if (!meta) return null;

    let exifId = null, iloc = null;
    each(meta[0], meta[1], (t, s, e) => {
      if (t === 'iinf') {
        const ver = v.getUint8(s);
        each(s + 4 + (ver === 0 ? 2 : 4), e, (t2, s2) => {
          if (t2 !== 'infe') return;
          const iv = v.getUint8(s2);
          if (iv < 2) return;
          const id = iv === 2 ? v.getUint16(s2 + 4) : v.getUint32(s2 + 4);
          if (str(s2 + 4 + (iv === 2 ? 2 : 4) + 2) === 'Exif') exifId = id;
        });
      } else if (t === 'iloc') iloc = [s, e];
    });
    if (exifId == null || !iloc) return null;

    const ver = v.getUint8(iloc[0]);
    let o = iloc[0] + 4;
    const b1 = v.getUint8(o), b2 = v.getUint8(o + 1);
    o += 2;
    const offSize = b1 >> 4, lenSize = b1 & 15, baseSize = b2 >> 4;
    const idxSize = ver === 1 || ver === 2 ? b2 & 15 : 0;
    const rd = n => {
      let x = 0;
      if (n === 2) x = v.getUint16(o); else if (n === 4) x = v.getUint32(o); else if (n === 8) x = Number(v.getBigUint64(o));
      o += n;
      return x;
    };
    const count = ver < 2 ? rd(2) : rd(4);
    for (let i = 0; i < count && o < iloc[1]; i++) {
      const id = ver < 2 ? rd(2) : rd(4);
      const method = ver === 1 || ver === 2 ? rd(2) & 15 : 0;
      rd(2); // data_reference_index
      const base = rd(baseSize);
      const extents = rd(2);
      let first = null;
      for (let k = 0; k < extents; k++) {
        if (idxSize) rd(idxSize);
        const off = rd(offSize), len = rd(lenSize);
        if (k === 0) first = [base + off, len];
      }
      if (id !== exifId) continue;
      if (method !== 0 || !first) return null;
      const [off, len] = first;
      if (len < 12 || off + len > end) return null;
      const skip = v.getUint32(off); // ระยะไปถึงหัว TIFF (ปกติข้าม "Exif\0\0")
      const ts = off + 4 + skip, tl = len - 4 - skip;
      if (tl < 8 || tl > 65000) return null;
      const seg = new Uint8Array(10 + tl);
      seg.set([0xFF, 0xE1, ((tl + 8) >> 8) & 255, (tl + 8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
      seg.set(new Uint8Array(buf, ts, tl), 10);
      return seg;
    }
    return null;
  }

  // แปลงไฟล์ HEIC หนึ่งไฟล์เป็น JPG (คุณภาพ 92%) พร้อมข้อมูลกล้อง
  async function toJpeg(file) {
    await load();
    const buf = await file.arrayBuffer();
    let out = await root.heic2any({ blob: new Blob([buf], { type: 'image/heic' }), toType: 'image/jpeg', quality: 0.92 });
    if (Array.isArray(out)) out = out[0];
    try {
      const seg = exifFromHeic(buf);
      // ภาพที่แปลงแล้วตั้งตรงอยู่แล้ว จึงตั้ง Orientation เป็นปกติ และตัดรูปย่อเดิมออก
      if (seg && root.PCSKWatermark.fixExif(seg)) out = await root.PCSKWatermark.insertExif(out, seg);
    } catch (e) { /* ไม่มีข้อมูลกล้อง ใช้เวลาของไฟล์แทน */ }
    const f = new File([out], file.name.replace(HEIC_RE, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified });
    f._path = (file._path || file.webkitRelativePath || file.name).replace(HEIC_RE, '.jpg');
    f._from = file.name;
    return f;
  }

  root.PCSKHeic = { load, toJpeg, exifFromHeic, HEIC_RE };
})(window);
