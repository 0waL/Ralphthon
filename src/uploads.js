import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from './config.js';
import { badRequest } from './http.js';

// Claude가 읽을 수 있는 형식만 받는다. 확장자나 Content-Type이 아니라 파일 앞부분으로 판별한다.
function sniffImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

export function uploadMiddleware(fieldName, maxCount) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: maxCount, fields: 50 },
  }).array(fieldName, maxCount);
}

/** 업로드된 파일을 검사하고 사진 목록으로 바꾼다. 아직 디스크에 쓰지 않는다. */
export function readImages(files = []) {
  return files.map((file) => {
    const mediaType = sniffImageType(file.buffer);
    if (!mediaType) throw badRequest('사진은 JPG, PNG, GIF, WEBP 파일만 올릴 수 있습니다.');
    return { mediaType, data: file.buffer };
  });
}

export function createPhotoStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    save(photo) {
      const filename = crypto.randomBytes(16).toString('hex') + EXTENSIONS[photo.mediaType];
      fs.writeFileSync(path.join(dir, filename), photo.data);
      return filename;
    },
    load(filename, mediaType) {
      return { mediaType, data: fs.readFileSync(path.join(dir, filename)) };
    },
    path(filename) {
      return path.join(dir, filename);
    },
    remove(filename) {
      fs.rmSync(path.join(dir, filename), { force: true });
    },
  };
}
