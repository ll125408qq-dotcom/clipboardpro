/**
 * icon-gen.js — 图标生成（卡通剪贴板 + ★ 星标）
 * 用真实 PNG 编码替代原始 RGBA 传给 nativeImage，修复 Windows 上的颜色通道错乱
 */
"use strict";
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

// 五角星顶点
function starPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const oa = (i * 2 * Math.PI / 5) - Math.PI / 2;
    pts.push([cx + r * Math.cos(oa), cy + r * Math.sin(oa)]);
    const ia = oa + Math.PI / 5;
    pts.push([cx + r * 0.38 * Math.cos(ia), cy + r * 0.38 * Math.sin(ia)]);
  }
  return pts;
}
function pointInStar(px, py, star) {
  let inside = false;
  for (let i = 0, j = star.length - 1; i < star.length; j = i++) {
    const xi = star[i][0], yi = star[i][1], xj = star[j][0], yj = star[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function roundedRectSDF(x, y, rx, ry, rw, rh, cr) {
  const dx = Math.abs(x - rx) - rw, dy = Math.abs(y - ry) - rh;
  return Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) - cr;
}

// CRC32 for PNG
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crc32Table[i] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) c = crc32Table[(c ^ buf[n]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tb = Buffer.from(type, 'ascii');
  const cv = Buffer.alloc(4); cv.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, cv]);
}

// RGBA → PNG 编码
function encodePNG(S, rgba) {
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(S, 0); ih.writeUInt32BE(S, 4);
  ih[8] = 8; ih[9] = 6; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  const rows = [];
  for (let y = 0; y < S; y++) {
    const r = Buffer.alloc(1 + S * 4); r[0] = 0;
    rgba.copy(r, 1, y * S * 4, (y + 1) * S * 4);
    rows.push(r);
  }
  const comp = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ih), pngChunk('IDAT', comp), pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// 生成 RGBA 像素数据
function generateRGBA(S) {
  const buf = Buffer.alloc(S * S * 4, 0);
  const BODY = [235, 218, 190], OUTLINE = [80, 64, 48];
  const CLIP = [176, 178, 192], CLIP_HL = [210, 212, 224];
  const STAR = [255, 215, 0], STAR_HL = [255, 230, 80];
  const LINE = [212, 192, 162];
  const star = starPoints(S * 0.80, S * 0.20, S * 0.17);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const cr = S * 0.07, bw = S * 0.38, bh = S * 0.44;
      const cx = S * 0.5, cy = S * 0.52;
      const d = roundedRectSDF(x + 0.5, y + 0.5, cx, cy, bw, bh, cr);

      if (d < -1.5) {
        buf[i] = BODY[0]; buf[i+1] = BODY[1]; buf[i+2] = BODY[2]; buf[i+3] = 255;
        const relY = y - (cy - bh) + cr;
        if ((Math.abs(relY - bh * 0.42) < 1.5 || Math.abs(relY - bh * 0.66) < 1.5) && x > cx - bw * 0.7 && x < cx + bw * 0.7) {
          buf[i] = LINE[0]; buf[i+1] = LINE[1]; buf[i+2] = LINE[2];
        }
      } else if (d < 0) {
        const t = -d / 1.5;
        buf[i] = Math.round(OUTLINE[0] * (1 - t) + BODY[0] * t);
        buf[i+1] = Math.round(OUTLINE[1] * (1 - t) + BODY[1] * t);
        buf[i+2] = Math.round(OUTLINE[2] * (1 - t) + BODY[2] * t);
        buf[i+3] = 255;
      } else if (d < 2) {
        const a = Math.round(Math.min(255, Math.max(0, (2 - d) * 128)));
        buf[i] = OUTLINE[0]; buf[i+1] = OUTLINE[1]; buf[i+2] = OUTLINE[2]; buf[i+3] = a;
      }
    }
  }

  // 夹子
  const cY1 = Math.round(S * 0.52 - S * 0.44 - S * 0.07 * 0.5);
  const cY2 = Math.round(S * 0.52 - S * 0.44 + S * 0.07 * 1.2);
  const cX1 = Math.round(S * 0.5 - S * 0.44 * 0.22);
  const cX2 = Math.round(S * 0.5 + S * 0.44 * 0.22);
  for (let y = cY1; y <= cY2; y++) {
    for (let x = cX1; x <= cX2; x++) {
      if (x < 0 || x >= S || y < 0 || y >= S) continue;
      const dc = roundedRectSDF(x+0.5, y+0.5, (cX1+cX2)/2, (cY1+cY2)/2, (cX2-cX1)/2, (cY2-cY1)/2, 3);
      if (dc < 0) {
        const idx = (y * S + x) * 4;
        if (y < cY1 + (cY2-cY1)*0.4) { buf[idx]=CLIP_HL[0]; buf[idx+1]=CLIP_HL[1]; buf[idx+2]=CLIP_HL[2]; }
        else { buf[idx]=CLIP[0]; buf[idx+1]=CLIP[1]; buf[idx+2]=CLIP[2]; }
        buf[idx+3] = 255;
      }
    }
  }

  // 五角星
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (pointInStar(x+0.5, y+0.5, star)) {
        const idx = (y * S + x) * 4;
        const dist = Math.sqrt((x-S*0.82)**2 + (y-S*0.18)**2);
        const t = Math.min(1, dist/(S*0.08));
        buf[idx] = Math.round(STAR[0]*(1-t) + STAR_HL[0]*t);
        buf[idx+1] = Math.round(STAR[1]*(1-t) + STAR_HL[1]*t);
        buf[idx+2] = Math.round(STAR[2]*(1-t) + STAR_HL[2]*t);
        buf[idx+3] = 255;
      }
    }
  }

  return buf;
}

// —— 公开接口 ——

// 创建托盘图标（返回 nativeImage）
function createTrayIcon(nativeImage) {
  const rgba = generateRGBA(16);
  const png = encodePNG(16, rgba);
  return nativeImage.createFromBuffer(png);
}

// 生成应用图标文件
function generateAppIcon(appDir) {
  const assetsDir = path.join(appDir, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const rgba = generateRGBA(256);
  const png = encodePNG(256, rgba);

  // 写 PNG
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), png);
  console.log('【图标】已生成 assets/icon.png (PNG)');

  // 写 ICO（嵌入 PNG 的标准 ICO 格式）
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), Buffer.concat([header, entry, png]));
  console.log('【图标】已生成 assets/icon.ico');
}

module.exports = { createTrayIcon, generateAppIcon };
