import { createHash } from 'crypto';

// 관리자 인증 — ADMIN_PASSWORD 시크릿 기반. 정답 시 발급하는 쿠키 값은 비밀번호에서
// 파생한 토큰(sha256)이라, 비밀번호를 모르면 위조 불가. 쿠키는 httpOnly로 발급.
export const ADMIN_COOKIE = 'voc_admin';
const VERSION = 'v1';

function pw(): string {
  return process.env.ADMIN_PASSWORD || '';
}

export function adminConfigured(): boolean {
  return pw().length > 0;
}

export function adminToken(): string {
  return createHash('sha256').update(`${pw()}:voc-admin-${VERSION}`).digest('hex');
}

export function checkPassword(input: string): boolean {
  return adminConfigured() && input.length > 0 && input === pw();
}

export function isAdminCookie(value: string | undefined | null): boolean {
  return adminConfigured() && !!value && value === adminToken();
}
