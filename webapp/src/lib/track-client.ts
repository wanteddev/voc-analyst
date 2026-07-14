// 클라이언트 사용 이벤트 전송 — sendBeacon 우선(언로드에도 안전), 폴백 fetch keepalive.
// 실패는 조용히 무시.
//
// 방문자 식별: 회사 egress가 NAT라 IP로는 개인 구분이 안 됨 → 브라우저별 익명 ID(localStorage)
// 를 생성해 vid로 동봉. 개인정보 아님(랜덤 UUID). IP는 보조 지표로만 사용.
const VID_KEY = 'voc_vid';

export function visitorId(): string {
  try {
    let v = localStorage.getItem(VID_KEY);
    if (!v) {
      v =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(VID_KEY, v);
    }
    return v;
  } catch {
    return 'unknown';
  }
}

export function track(type: string, extra?: Record<string, string>): void {
  try {
    const body = JSON.stringify({ type, vid: visitorId(), ...extra });
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
