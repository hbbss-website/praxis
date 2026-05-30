import { useState } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { getApiOrigin } from '@/lib/api';
import { cn } from '@/lib/utils';

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
  const protectedPath = normalizeProtectedUploadPath(src);
  const resolvedSrc = protectedPath ? `${getApiOrigin()}${protectedPath}` : src;
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={cn('flex items-center justify-center bg-muted/40 text-muted-foreground', placeholderClassName ?? className)}>
        图片不可用
      </div>
    );
  }

  return (
    <img className={className} src={resolvedSrc} alt={alt} onError={() => setFailed(true)} />
  );
}
