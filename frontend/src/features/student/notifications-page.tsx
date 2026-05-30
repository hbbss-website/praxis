import { CalendarDays, CheckCircle2, Clock3, Eye, ImagePlus, MapPin, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useSession } from '@/lib/auth';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { AuthenticatedImage } from '@/shared/authenticated-image';
import { DatePickerField } from '@/shared/date-picker-field';
import { EmptyState } from '@/shared/empty-state';
import { StatCard } from '@/shared/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ApiResponseError, createApiClient, formatUploadImageMaxSize, getRuntimeConfig, unwrapResponse, uploadImage, validateUploadImageFiles } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/feedback';
import { formatDate, formatDateTime, formatDuration, normalizeDateInputValue, notificationLabel, statusLabel } from '@/lib/format';
import { MAX_RECORD_IMAGES, type AppNotification, type RecordStatistics, type StudentRecord } from '@/lib/types';
import { ErrorCard, LoadingCard, StudentPageFrame } from './shared';

export function StudentNotificationsPage() {
  const { signOut, setNotificationCount } = useSession();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    unwrapResponse<{ notifications: AppNotification[]; unreadCount: number }>(createApiClient().student.notifications.get())
      .then(async (data) => {
        setNotifications(data.notifications);
        setNotificationCount(0);
        if (data.unreadCount > 0) {
          await unwrapResponse(createApiClient().student.notifications.read.post());
        }
      })
      .catch((nextError) => {
        if (nextError instanceof ApiResponseError && nextError.status === 401) {
          signOut();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : '加载通知失败。');
      })
      .finally(() => setLoading(false));
  }, [setNotificationCount, signOut]);

  return (
    <StudentPageFrame title="消息通知" description="这里会展示审核通过、驳回、删除以及撤销审核等状态变更。">
      {loading ? (
        <LoadingCard label="正在同步通知..." />
      ) : error ? (
        <ErrorCard message={error} />
      ) : notifications.length === 0 ? (
        <EmptyState title="暂无通知" description="你目前还没有收到新的系统消息。" />
      ) : (
        <div className="space-y-4">
          {notifications.map((notification) => (
            <Card key={notification.id} className={notification.is_read ? '' : 'ring-2 ring-[color:var(--ring-soft)]'}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={notification.type === 'approved' ? 'default' : notification.type === 'rejected' || notification.type === 'deleted' ? 'destructive' : 'secondary'}>
                      {notificationLabel(notification.type)}
                    </Badge>
                    {!notification.is_read ? <Badge variant="default">未读</Badge> : null}
                  </div>
                  <p className="text-sm text-[color:var(--muted-foreground)]">{formatDateTime(notification.created_at)}</p>
                </div>
                <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">{notification.message}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </StudentPageFrame>
  );
}
