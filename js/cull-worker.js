// วิเคราะห์รูปเบื้องหลัง เพื่อให้หน้าเว็บไม่ค้างและทำงานหลายรูปพร้อมกันได้
importScripts('cull-core.js');

self.onmessage = async e => {
  const { id, file } = e.data;
  try {
    const r = await self.CullCore.analyzeFile(file);
    self.postMessage({ id, ok: true, r });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
