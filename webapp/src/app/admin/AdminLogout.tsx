"use client";

import { useRouter } from 'next/navigation';

export function AdminLogout() {
  const router = useRouter();
  async function logout() {
    try {
      await fetch('/api/admin/login', { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    router.refresh();
  }
  return (
    <button
      onClick={logout}
      style={{
        padding: '4px 10px',
        borderRadius: 4,
        background: 'var(--panel-2)',
        border: '1px solid var(--border)',
        color: 'var(--text-dim)',
        fontSize: 11.5,
        cursor: 'pointer',
      }}
    >
      로그아웃
    </button>
  );
}
