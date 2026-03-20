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
    const decoded = jwt.verify(token, jwtSecret, { audience: jwtAudience, issuer: jwtIssuer });

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

function requireRole(...roles: UserRole[]): RequestHandler {
  return (request, response, next) => {
    if (!request.user || !roles.includes(request.user.role)) {
      sendAuthError(response, 403, '没有权限访问该资源。');
      return;
    }
    next();
  };
}

export const adminOnly = requireRole('admin');
export const teacherOnly = requireRole('teacher');
export const teacherOrAdmin = requireRole('teacher', 'admin');
export const studentOnly = requireRole('student');
