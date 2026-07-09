// 클라이언트 사용 이벤트 전송 — sendBeacon 우선(언로드에도 안전), 폴백 fetch keepalive.
// 실패는 조용히 무시.
export function track(type: string, extra?: Record<string, string>): void {
  try {
    const body = JSON.stringify({ type, ...extra });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* no-op */
  }
}
