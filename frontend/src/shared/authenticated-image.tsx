import { useEffect, useMemo, useState } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { useSession } from '@/lib/auth';
import { getApiOrigin } from '@/lib/api';
import { cn } from '@/lib/utils';

const cachedObjectUrls = new Map<string, string>();
const pendingObjectUrls = new Map<string, Promise<string>>();

function normalizeProtectedUploadPath(src: string) {
  if (src.startsWith('/uploads/')) {
    return src;
  }

  const apiOrigin = getApiOrigin();

  if (src.startsWith(`${apiOrigin}/uploads/`)) {
    return src.slice(apiOrigin.length);
  }

  return null;
}

async function loadProtectedObjectUrl(path: string, token: string, cacheKey: string) {
  const cached = cachedObjectUrls.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = pendingObjectUrls.get(cacheKey);

  if (pending) {
    return pending;
  }

  const request = fetch(`${getApiOrigin()}${path}`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('图片加载失败。');
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      cachedObjectUrls.set(cacheKey, objectUrl);
      return objectUrl;
    })
    .finally(() => {
      pendingObjectUrls.delete(cacheKey);
    });

  pendingObjectUrls.set(cacheKey, request);
  return request;
}

export function AuthenticatedImage({
  src,
  alt,
  className,
  placeholderClassName
}: {
  src: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
}) {
  const { token } = useSession();
  const protectedPath = useMemo(() => normalizeProtectedUploadPath(src), [src]);
  const cacheKey = useMemo(
    () => protectedPath && token ? `${token}:${protectedPath}` : null,
    [protectedPath, token]
  );
  const [resolvedSrc, setResolvedSrc] = useState(() => {
    if (!cacheKey) {
      return protectedPath ? '' : src;
    }

    return cachedObjectUrls.get(cacheKey) ?? '';
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);

    if (!protectedPath) {
      setResolvedSrc(src);
      return;
    }

    if (!token || !cacheKey) {
      setResolvedSrc('');
      setFailed(true);
      return;
    }

    const cached = cachedObjectUrls.get(cacheKey);

    if (cached) {
      setResolvedSrc(cached);
      return;
    }

    let cancelled = false;

    loadProtectedObjectUrl(protectedPath, token, cacheKey)
      .then((nextSrc) => {
        if (!cancelled) {
          setResolvedSrc(nextSrc);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc('');
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, protectedPath, src, token]);

  if (resolvedSrc) {
    return <img className={className} src={resolvedSrc} alt={alt} />;
  }

  return (
    <div className={cn('flex items-center justify-center bg-muted/40 text-muted-foreground', placeholderClassName ?? className)}>
      {failed ? '图片不可用' : <Spinner className="size-5" />}
    </div>
  );
}
