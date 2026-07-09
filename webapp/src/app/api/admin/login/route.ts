import { NextRequest, NextResponse } from 'next/server';
import { checkPassword, adminToken, adminConfigured, ADMIN_COOKIE } from '@/lib/admin';

export const runtime = 'nodejs';
export const revalidate = 0;

// 로그인 — 비밀번호 검증 후 httpOnly 쿠키 발급.
export async function POST(req: NextRequest) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { ok: false, error: '서버에 ADMIN_PASSWORD가 설정되지 않았습니다.' },
      { status: 503 }
    );
  }
  let body: { password?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* 빈 body */
  }
  if (!checkPassword(body.password || '')) {
    return NextResponse.json({ ok: false, error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12, // 12시간
  });
  return res;
}

// 로그아웃 — 쿠키 제거.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
