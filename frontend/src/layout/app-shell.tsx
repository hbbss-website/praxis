import { ClipboardList, LogOut } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSession } from '@/lib/auth';
import type { StoredUser, UserRole } from '@/lib/types';
import { cn } from '@/lib/utils';

const navMap: Record<UserRole, Array<{ to: string; label: string }>> = {
  student: [
    { to: '/student/dashboard', label: '实践概览' },
    { to: '/student/upload', label: '上传记录' },
    { to: '/student/notifications', label: '消息通知' },
    { to: '/student/account', label: '账号设置' }
  ],
  teacher: [
    { to: '/teacher/dashboard', label: '审核中心' },
    { to: '/teacher/students', label: '学生列表' },
    { to: '/teacher/account', label: '账号设置' }
  ],
  admin: [
    { to: '/admin/records', label: '记录管理' },
    { to: '/admin/users', label: '用户创建' },
    { to: '/admin/assign', label: '关系分配' },
    { to: '/admin/students', label: '学生列表' },
    { to: '/admin/teachers', label: '教师列表' },
    { to: '/admin/account', label: '账号设置' }
  ]
};

const roleTitleMap: Record<UserRole, string> = {
  admin: '管理员后台',
  teacher: '教师工作台',
  student: '学生中心'
};

export function AppShell({
  user,
  notificationCount = 0
}: {
  user: StoredUser;
  notificationCount?: number;
}) {
  const navigate = useNavigate();
  const items = navMap[user.role];
  const { signOut } = useSession();
  const roleTitle = roleTitleMap[user.role];

  function handleSignOut() {
    signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      <div className="space-y-4 px-3 py-3 sm:px-4 sm:py-4 lg:hidden">
        <Card className="border-border/70 bg-card/95 py-0 shadow-sm">
          <div className="flex items-start justify-between gap-4 p-4">
            <Link to="/" className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ClipboardList className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">社会实践系统</p>
                <p className="truncate text-base font-semibold">{roleTitle}</p>
              </div>
            </Link>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={handleSignOut}>
              <LogOut className="size-4" />
              退出
            </Button>
          </div>
          <div className="border-t border-border/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="font-semibold">{user.name}</span>
              <span className="text-muted-foreground">{user.uid}</span>
            </div>
          </div>
        </Card>

        <Card className="border-border/70 bg-card/95 py-0 shadow-sm">
          <nav className="flex gap-2 overflow-x-auto p-2">
            {items.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border/70 bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                {label}
                {user.role === 'student' && to === '/student/notifications' ? (
                  <NotificationBadgeInline count={notificationCount} />
                ) : null}
              </NavLink>
            ))}
          </nav>
        </Card>
      </div>

      <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-border/80 bg-card lg:sticky lg:top-0 lg:flex">
        <div className="flex h-full flex-col overflow-y-auto">
          <Link to="/" className="flex min-h-20 items-center gap-3 px-5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ClipboardList className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">社会实践系统</p>
              <p className="truncate text-base font-semibold tracking-tight">{roleTitle}</p>
            </div>
          </Link>

          <nav className="flex flex-1 flex-col gap-1 px-3 py-3">
            {items.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group flex min-h-10 items-center justify-between rounded-full px-4 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-muted text-foreground shadow-[inset_0_0_0_1px_rgb(0_0_0/0.02)]'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                  )
                }
              >
                <span className="truncate">{label}</span>
                {user.role === 'student' && to === '/student/notifications' ? (
                  <NotificationBadgeInline count={notificationCount} />
                ) : null}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-border/80 px-4 py-4">
            <div className="min-w-0 px-1 pb-3">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.uid}</p>
            </div>
            <Button variant="ghost" className="w-full justify-start rounded-full px-3" onClick={handleSignOut}>
              <LogOut className="size-4" />
              退出登录
            </Button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-5 lg:px-8 lg:py-6">
        <div className="mx-auto max-w-[1220px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NotificationBadgeInline({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <Badge variant="destructive" className="ml-1 h-5 min-w-5 justify-center rounded-full px-1 text-[10px] leading-none shadow-sm">
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
