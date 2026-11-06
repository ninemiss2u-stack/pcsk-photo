// ===== ตั้งค่าเว็บไซต์ =====
// ใส่ค่าจาก Supabase: Project Settings > API (Project URL และ anon public key)
// ถ้าเว้นว่างไว้ เว็บจะทำงานใน "โหมดทดลอง" (ข้อมูลตัวอย่าง ไม่บันทึกจริง)
window.APP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  SCHOOL_NAME: 'โรงเรียนประชาสงเคราะห์วิทยา',
  SITE_SUBTITLE: 'PCSK PHOTO · งานประชาสัมพันธ์',
  PRIMARY_COLOR: '#2f6a12',

  // ลายน้ำที่ใส่ลงรูปตอนบันทึก
  WATERMARK_TEXT: 'PCSK PHOTO',

  CATEGORIES: ['วันสำคัญ', 'กีฬา', 'วิชาการ', 'ทัศนศึกษา', 'ศิลปะและดนตรี', 'ประชุม/อบรม', 'อื่นๆ'],

  // ขนาดรูปที่ย่อก่อนอัปโหลด (ช่วยประหยัดพื้นที่เก็บรูป)
  MAX_PHOTO_SIZE: 2560,   // ด้านยาวสุดของรูปเต็ม (พิกเซล)
  THUMB_SIZE: 640,        // ด้านยาวสุดของรูปย่อ
  PHOTO_QUALITY: 0.86
};
