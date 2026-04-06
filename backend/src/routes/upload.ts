import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { apiError, requireAuthenticatedUser } from '../http';
import { authMiddleware, type AppBindings } from '../plugins/auth';

const uploadDir = path.resolve(process.cwd(), 'backend/uploads');
const maxUploadImageSize = 5 * 1024 * 1024;

fs.mkdirSync(uploadDir, { recursive: true });

const uploadExtensionByType: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif'
};

function detectImageType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }

  return null;
}

export const uploadRoutes = new Hono<AppBindings>()
  .use('/uploads', authMiddleware)
  .post('/uploads', async (c) => {
    const authFailure = requireAuthenticatedUser(c);

    if (authFailure) {
      return authFailure;
    }

    const formData = await c.req.raw.formData();
    const image = formData.get('image');

    if (!(image instanceof File)) {
      return apiError(c, 400, '缺少图片文件。');
    }

    if (image.size > maxUploadImageSize) {
      return apiError(c, 400, '图片大小不能超过 5 MiB。');
    }

    const imageHeader = new Uint8Array(await image.slice(0, 8).arrayBuffer());
    const imageType = detectImageType(imageHeader);

    if (!imageType) {
      return apiError(c, 400, '仅支持上传 JPG、PNG、GIF 格式的图片。');
    }

    const extension = uploadExtensionByType[imageType];
    const filename = `${randomUUID()}${extension}`;
    const filePath = path.join(uploadDir, filename);
    const buffer = Buffer.from(await image.arrayBuffer());

    await fs.promises.writeFile(filePath, buffer);

    return c.json({
      message: '上传成功。',
      filename,
      imageUrl: `/uploads/${filename}`
    });
  });
