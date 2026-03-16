import type { NextFunction, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';

import { jwtAudience, jwtIssuer, jwtSecret } from '../auth/config';
import type { AuthTokenPayload, UserRole } from '../models';

function sendAuthError(response: Response, statusCode: number, message: string): void {
  response.status(statusCode).json({ error: message });
}

export const authMiddleware: RequestHandler = (request, response, next: NextFunction) => {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendAuthError(response, 401, '缺少认证令牌。');
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const decoded = jwt.verify(token, jwtSecret, {
      audience: jwtAudience,
      issuer: jwtIssuer
    });

    if (!decoded || typeof decoded === 'string') {
      sendAuthError(response, 401, '认证令牌无效。');
      return;
    }

    request.user = decoded as AuthTokenPayload;
    next();
  } catch {
    sendAuthError(response, 401, '认证令牌无效或已过期。');
  }
};

function requireRole(role: UserRole): RequestHandler {
  return (request, response, next) => {
    if (request.user?.role !== role) {
      sendAuthError(response, 403, role === 'teacher' ? '只有教师可以访问该资源。' : '只有学生可以访问该资源。');
      return;
    }

    next();
  };
}

export const teacherOnly = requireRole('teacher');
export const studentOnly = requireRole('student');
