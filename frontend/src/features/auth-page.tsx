import { FileCheck2, LockKeyhole, ShieldCheck, UserRound, Zap } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { login } from '@/lib/api';
import { toastError } from '@/lib/feedback';
import { getDefaultPathByRole } from '@/lib/session';
import { useSession } from '@/lib/auth';

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useSession();
  const [uid, setUid] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const highlights = [
    {
      title: '流程清晰',
      description: '实践提交、审核流转、通知反馈集中在一处，状态变化随时可追踪。',
      icon: FileCheck2,
      iconWrapperClassName: 'bg-sky-50 text-sky-700'
    },
    {
      title: '数据集中',
      description: '学生实践记录、教师审核意见统一存储，减少分散查找与重复核对，敏感信息加密存储，全方位保障数据安全。',
      icon: ShieldCheck,
      iconWrapperClassName: 'bg-emerald-50 text-emerald-700'
    },
    {
      title: '操作高效',
      description: '支持批量审核、智能筛选、自动提醒、数据导出等功能，大幅减轻重复工作，提升效率。',
      icon: Zap,
      iconWrapperClassName: 'bg-amber-50 text-amber-700'
    }
  ] as const;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="grid w-full max-w-6xl items-start gap-4 lg:gap-20 lg:grid-cols-[1fr_minmax(380px,460px)]">
        <div className="hidden lg:block">
          <div className="space-y-6">
            <div className="space-y-5">
              <div className="inline-flex rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                社会实践系统
              </div>
              <div className="space-y-3">
                <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight">一套系统，搞定社会实践全流程。</h1>
                <p className="max-w-lg text-base text-muted-foreground">统一操作入口，让实践提交更便捷、审核更透明、管理更省心。</p>
              </div>
            </div>
            <div className="grid gap-3 pt-6">
              {highlights.map(({ title, description, icon: Icon, iconWrapperClassName }) => (
                <Card key={title} className="border-border/60 bg-background/80 shadow-none">
                  <CardContent className="flex items-start gap-4 p-4">
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${iconWrapperClassName}`}>
                      <Icon className="size-5" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-sm font-semibold tracking-tight">{title}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>

        <Card className="border-border/70 shadow-sm lg:self-center">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LockKeyhole className="size-6" />
            </div>
            <CardTitle className="text-2xl">登录系统</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={async (event) => {
                event.preventDefault();
                setLoading(true);

                try {
                  const data = await login(uid.trim(), password);
                  signIn(data.user, data.user.password_setup_required ? password : null);

                  if (data.user.password_setup_required) {
                    toast('请先设置密码。');
                  }

                  navigate(getDefaultPathByRole(data.user.role, data.user.password_setup_required), { replace: true });
                } catch (nextError) {
                  toastError(nextError, '登录失败。');
                } finally {
                  setLoading(false);
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="uid">UID</Label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="uid" value={uid} onChange={(event) => setUid(event.target.value)} className="pl-10" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="pl-10" />
                </div>
              </div>
              <Button className="h-11 w-full" disabled={loading} type="submit">
                {loading ? <Spinner className="size-4 text-current" /> : null}
                {loading ? '登录中...' : '登录'}
              </Button>
              <div className="flex justify-end">
                <HoverCard openDelay={10} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <Button type="button" variant="link">忘记密码</Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="flex w-max flex-col gap-0.5">
                    <div>如果您是学生，请联系班主任修改密码；</div>
                    <div>如果您是教师，请联系管理员修改密码。</div>
                  </HoverCardContent>
                </HoverCard>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
