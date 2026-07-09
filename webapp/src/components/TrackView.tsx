"use client";

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { track } from '@/lib/track-client';

// 페이지/필터 조회 트래킹 — URL(경로+쿼리)이 바뀔 때마다 page_view 1회 전송.
// 필터가 전부 URL 파라미터이므로 filters=쿼리스트링만으로 "어떤 상태를 봤는지" 캡처됨.
export function TrackView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  useEffect(() => {
    track('page_view', { path: pathname, filters: qs });
  }, [pathname, qs]);

  return null;
}
