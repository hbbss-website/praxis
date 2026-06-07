import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { CFAppBindings } from '../auth-plugin';
import { authMiddleware } from '../auth-plugin';
import { apiError, requireAuthenticatedUser } from '../../http';
import { getCFConfig } from '../config';
import { tmpUploadPathPattern } from '../repository/helpers';

const headerProbeSize = 8;

function detectImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

function formatBytes(bytes: number) {
  const units = ['B', 'KiB', 'MiB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${parseFloat(bytes.toFixed(2))} ${units[i]}`;
}

export const cfUploadRoutes = new Hono<CFAppBindings>()
  .use('/uploads', authMiddleware)
  .post('/uploads', async (c) => {
    const authFailure = requireAuthenticatedUser(c);
    if (authFailure) return authFailure;

    const cfg = getCFConfig(c.env);
    const contentType = c.req.header('content-type') ?? '';

    if (!contentType.includes('multipart/form-data')) {
      return apiError(c, 400, '缺少上传表单。');
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return apiError(c, 400, '表单解析失败。');
    }

    const file = formData.get('image');
    if (!(file instanceof File)) return apiError(c, 400, '缺少图片文件。');

    if (file.size > cfg.upload_image_max_size_bytes) {
      return apiError(c, 400, `图片大小不能超过 ${formatBytes(cfg.upload_image_max_size_bytes)}。`);
    }

    const buffer = await file.arrayBuffer();
    const header = new Uint8Array(buffer.slice(0, headerProbeSize));
    const imageType = detectImageType(header);

    if (!imageType) return apiError(c, 400, '仅支持上传 JPG、PNG、GIF 格式的图片。');

    const filename = `${randomUUID()}.webp`;
    const key = `tmp-uploads/${filename}`;
    const imagePath = `/tmp-uploads/${filename}`;

    await c.env.UPLOADS.put(key, buffer, {
      httpMetadata: { contentType: imageType },
      customMetadata: { uploaded_by: String(c.var.user!.id), expires_at: new Date(Date.now() + cfg.temp_upload_ttl_ms).toISOString() }
    });

    await c.var.db.enqueueTempUpload(imagePath);

    return c.json({ message: '上传成功。', filename, imageUrl: imagePath });
  });
