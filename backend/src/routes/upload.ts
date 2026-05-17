import { Hono } from 'hono';
import Busboy from 'busboy';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import sharp from 'sharp';

import { appConfig } from '../config';
import { apiError, requireAuthenticatedUser } from '../http';
import { authMiddleware, type AppBindings } from '../plugins/auth';

const uploadDir = path.resolve(process.cwd(), 'backend/uploads');

fs.mkdirSync(uploadDir, { recursive: true });

const webpQuality = 76;
const maxImageDimension = 1920;
const headerProbeSize = 8;

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${parseFloat(bytes.toFixed(2))} ${units[i]}`;
}

type UploadedImageFile = {
  filePath: string;
  imageType: string;
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

function removeFileIfExists(filePath: string) {
  return fs.promises.rm(filePath, { force: true });
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error('图片上传失败。');
}

function parseImageUpload(request: Request): Promise<UploadedImageFile> {
  return new Promise((resolve, reject) => {
    const contentType = request.headers.get('content-type');

    if (!contentType) {
      reject(new Error('缺少上传表单。'));
      return;
    }

    const source = Readable.fromWeb(request.body! as NodeReadableStream<Uint8Array>);
    const parser = Busboy({
      headers: {
        'content-type': contentType
      },
      limits: {
        files: 1,
        fields: 0,
        fileSize: appConfig.upload_image_max_size_bytes + 1
      }
    });
    const tempFilePath = path.join(uploadDir, `${randomUUID()}.upload`);
    let writeStream: fs.WriteStream | null = null;
    let settled = false;
    let sawImage = false;
    let imageType: string | null = null;
    let header = Buffer.alloc(0);

    function fail(error: Error) {
      if (settled) {
        return;
      }

      settled = true;
      source.destroy();
      parser.destroy();
      if (writeStream) {
        writeStream.destroy();
        writeStream.once('close', () => {
          void removeFileIfExists(tempFilePath);
        });
      } else {
        void removeFileIfExists(tempFilePath);
      }
      reject(error);
    }

    parser.on('file', (fieldName, file) => {
      if (fieldName !== 'image' || sawImage) {
        file.resume();
        fail(new Error('缺少图片文件。'));
        return;
      }

      sawImage = true;
      writeStream = fs.createWriteStream(tempFilePath, { flags: 'wx' });

      file.on('data', (chunk: Buffer) => {
        if (!imageType) {
          header = Buffer.concat([header, chunk]).subarray(0, headerProbeSize);

          if (header.length >= headerProbeSize) {
            imageType = detectImageType(header);

            if (!imageType) {
              fail(new Error('仅支持上传 JPG、PNG、GIF 格式的图片。'));
              return;
            }
          }
        }

        if (!writeStream!.write(chunk)) {
          file.pause();
          writeStream!.once('drain', () => file.resume());
        }
      });

      file.on('limit', () => {
        fail(new Error(`图片大小不能超过 ${formatBytes(appConfig.upload_image_max_size_bytes)}。`));
      });

      file.on('error', (error) => fail(error));

      file.on('end', () => {
        if (settled) {
          return;
        }

        if (!imageType) {
          imageType = detectImageType(header);
        }

        if (!imageType) {
          fail(new Error('仅支持上传 JPG、PNG、GIF 格式的图片。'));
          return;
        }

        writeStream!.end();
      });

      writeStream.on('error', (error) => fail(error));
      writeStream.on('finish', () => {
        if (!settled) {
          settled = true;
          resolve({
            filePath: tempFilePath,
            imageType: imageType!
          });
        }
      });
    });

    parser.on('filesLimit', () => fail(new Error('每次只能上传 1 张图片。')));
    parser.on('error', (error) => fail(toError(error)));
    parser.on('finish', () => {
      if (!settled && !sawImage) {
        fail(new Error('缺少图片文件。'));
      }
    });

    source.on('error', (error) => fail(toError(error)));
    source.pipe(parser);
  });
}

export const uploadRoutes = new Hono<AppBindings>()
  .use('/uploads', authMiddleware)
  .post('/uploads', async (c) => {
    const authFailure = requireAuthenticatedUser(c);

    if (authFailure) {
      return authFailure;
    }

    let uploaded: UploadedImageFile;
    const filename = `${randomUUID()}.webp`;
    const filePath = path.join(uploadDir, filename);

    try {
      uploaded = await parseImageUpload(c.req.raw);
    } catch (error) {
      return apiError(c, 400, error instanceof Error ? error.message : '图片上传失败。');
    }

    try {
      await sharp(uploaded.filePath, { animated: uploaded.imageType === 'image/gif' })
        .rotate()
        .resize({
          width: maxImageDimension,
          height: maxImageDimension,
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({
          quality: webpQuality,
          effort: 5
        })
        .toFile(filePath);
    } catch {
      await removeFileIfExists(uploaded.filePath);
      await removeFileIfExists(filePath);
      return apiError(c, 400, '仅支持上传 JPG、PNG、GIF 格式的图片。');
    }

    await removeFileIfExists(uploaded.filePath);

    return c.json({
      message: '上传成功。',
      filename,
      imageUrl: `/uploads/${filename}`
    });
  });
