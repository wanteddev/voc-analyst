"use client";

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { track } from '@/lib/track-client';

type ToolTrace = {
  name: string;
  args?: unknown;
  ok?: boolean;
  preview?: string;
  rows?: unknown[];
};
type Msg = { role: 'user' | 'assistant'; content: string; trace?: ToolTrace[] };

type SSEEvent =
  | { type: 'status'; step: number; message: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; preview: string; rows?: unknown[] }
  | { type: 'token'; delta: string }
  | { type: 'done'; content: string; tool_trace: ToolTrace[] }
  | { type: 'error'; message: string };

const SEEDS = [
  '이번 주 부정 감정이 급증한 카테고리 원인 분석해줘',
  '회원가입 관련 문의 있어? 대표 티켓 3건 보여줘',
  '지난달 대비 이번달 개선된 카테고리와 악화된 카테고리 각각 알려줘',
  '부정률 높은 카테고리 상위 3개와 부정 티켓 대표 원문 요약',
];

function mapChatError(raw: string): string {
  if (/HTTP\s*50[0-9]/i.test(raw) || /5\d{2}/.test(raw)) return '서버가 응답하지 않아요. 잠시 후 다시 시도해주세요.';
  if (/HTTP\s*40[13]/i.test(raw)) return '요청이 인증/권한 오류로 거절되었습니다. 관리자에게 문의해주세요.';
  if (/HTTP\s*404/i.test(raw)) return 'API 경로를 찾을 수 없습니다. 페이지를 새로고침해주세요.';
  if (/OPENAI_API_KEY/i.test(raw)) return 'AI API 키 설정 문제입니다. 관리자에게 문의해주세요.';
  if (/Unexpected token|not valid JSON|SyntaxError/i.test(raw)) return '서버 응답 형식이 올바르지 않아요. 잠시 후 다시 시도해주세요.';
  if (/aborted|abort/i.test(raw)) return '요청이 중단되었습니다.';
  if (/network|failed to fetch|Load failed/i.test(raw)) return '네트워크 연결을 확인해주세요.';
  if (/timeout/i.test(raw)) return '응답 시간이 너무 길어요. 질문을 좁혀 다시 물어봐주세요.';
  return raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// tool_trace 여러 개를 하나의 CSV 파일로 병합. UTF-8 BOM으로 Excel 한글 대응.
function traceToCSV(trace: ToolTrace[]): string | null {
  const sections: string[] = [];
  for (const t of trace) {
    if (!t.ok || !Array.isArray(t.rows) || t.rows.length === 0) continue;
    sections.push(`# ${t.name}`);
    if (t.args !== undefined) sections.push(`# args: ${JSON.stringify(t.args)}`);
    const headers = Object.keys(t.rows[0] as Record<string, unknown>);
    sections.push(headers.map(csvEscape).join(','));
    for (const row of t.rows) {
      const r = row as Record<string, unknown>;
      sections.push(headers.map(h => csvEscape(r[h])).join(','));
    }
    sections.push('');
  }
  if (sections.length === 0) return null;
  return '﻿' + sections.join('\n');
}

function downloadCSV(trace: ToolTrace[]) {
  const csv = traceToCSV(trace);
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voc-chat-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function traceRowCount(trace: ToolTrace[]): number {
  return trace.reduce((s, t) => s + (t.ok && Array.isArray(t.rows) ? t.rows.length : 0), 0);
}

export function ChatSidebar() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const [statusText, setStatusText] = useState<string>('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, status, statusText]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || status === 'sending') return;
    setInput('');
    const nextMessages: Msg[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setStatus('sending');
    setStatusText('분석 중');

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ messages: nextMessages.map(m => ({ role: m.role, content: m.content })) }),
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalContent = '';
      const trace: ToolTrace[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIdx: number;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;
          let ev: SSEEvent;
          try { ev = JSON.parse(dataLine.slice(6)); } catch { continue; }
          switch (ev.type) {
            case 'status':
              setStatusText(ev.message);
              break;
            case 'tool_call':
              setStatusText(`도구 호출: ${ev.name}`);
              trace.push({ name: ev.name, args: ev.args });
              break;
            case 'tool_result': {
              const last = trace[trace.length - 1];
              if (last) {
                last.ok = ev.ok;
                last.preview = ev.preview;
                last.rows = ev.rows;
              }
              setStatusText(`도구 완료: ${ev.preview}`);
              break;
            }
            case 'token':
              finalContent += ev.delta;
              break;
            case 'done':
              finalContent = ev.content;
              break;
            case 'error':
              throw new Error(ev.message);
          }
        }
      }

      setMessages([
        ...nextMessages,
        { role: 'assistant', content: finalContent || '(응답 없음)', trace },
      ]);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      const friendly = mapChatError(raw);
      setMessages([...nextMessages, { role: 'assistant', content: `❌ ${friendly}` }]);
    } finally {
      setStatus('idle');
      setStatusText('');
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(o => { if (!o) track('chat_open'); return !o; })}
        aria-label={open ? '분석 에이전트 닫기' : '에이전트와 대화하기'}
        style={{
          position: 'fixed', right: open ? 380 : 16, bottom: 20,
          zIndex: 20,
          background: 'var(--accent)',
          border: 'none',
          color: '#fff',
          width: open ? 48 : 'auto', height: 48, borderRadius: 24,
          padding: open ? 0 : '0 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          fontSize: open ? 20 : 14, fontWeight: 500,
          whiteSpace: 'nowrap',
          transition: 'right .18s',
        }}
      >
        {open ? '›' : <><span aria-hidden>💬</span> 에이전트와 대화하기</>}
      </button>

      <aside
        aria-hidden={!open}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 380, maxWidth: '100vw',
          background: 'var(--panel)',
          borderLeft: '1px solid var(--border)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .18s ease',
          display: 'flex', flexDirection: 'column',
          zIndex: 15,
          boxShadow: open ? '-8px 0 24px rgba(0,0,0,0.2)' : 'none',
        }}
      >
        <header style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>VOC 분석 에이전트</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-mute)' }}>
              gpt-5-mini · BQ + Zendesk 도구
            </div>
          </div>
          <button onClick={() => setOpen(false)}
                  aria-label="닫기"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--text-mute)', cursor: 'pointer', fontSize: 18,
                  }}>×</button>
        </header>

        <div ref={listRef} style={{
          flex: 1, overflowY: 'auto', padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {messages.length === 0 && (
            <div>
              <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 10 }}>
                자연어로 질문하면 BigQuery 쿼리와 원천 티켓을 조회해서 답합니다.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SEEDS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{
                      textAlign: 'left',
                      padding: '8px 12px', borderRadius: 6,
                      background: 'var(--panel-2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-dim)', fontSize: 12.5, cursor: 'pointer',
                    }}
                  >{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
          {status === 'sending' && (
            <div style={{
              color: 'var(--text-mute)', fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span className="pulse-dot" style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: 3,
                background: 'var(--accent)',
              }} />
              <span>{statusText || '분석 중'}</span>
            </div>
          )}
        </div>

        <form
          onSubmit={e => { e.preventDefault(); send(input); }}
          style={{
            borderTop: '1px solid var(--border)',
            padding: 12, display: 'flex', gap: 8,
          }}
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="질문 입력 (예: 광고 문의 원인)"
            disabled={status === 'sending'}
            style={{
              flex: 1, padding: '9px 12px',
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text)',
              fontSize: 13, outline: 'none',
              fontFamily: 'var(--sans)',
            }}
          />
          <button
            type="submit"
            disabled={status === 'sending' || !input.trim()}
            style={{
              padding: '9px 14px', borderRadius: 6,
              background: input.trim() ? 'var(--accent)' : 'var(--panel-2)',
              border: 'none',
              color: input.trim() ? '#fff' : 'var(--text-mute)',
              cursor: status === 'sending' ? 'wait' : 'pointer',
              fontSize: 13, fontWeight: 500,
            }}
          >
            {status === 'sending' ? '…' : '전송'}
          </button>
        </form>
      </aside>
    </>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user';
  const rowCount = msg.trace ? traceRowCount(msg.trace) : 0;
  const hasCSV = !isUser && rowCount > 0;

  return (
    <div style={{
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      maxWidth: isUser ? '92%' : '100%',
      width: isUser ? 'auto' : '100%',
    }}>
      <div style={{
        padding: '10px 14px',
        borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        background: isUser ? 'var(--accent)' : 'var(--panel-2)',
        color: isUser ? '#fff' : 'var(--text)',
        fontSize: 13, lineHeight: 1.55,
        border: isUser ? 'none' : '1px solid var(--border)',
        wordBreak: 'break-word',
        whiteSpace: isUser ? 'pre-wrap' : undefined,
      }}>
        {isUser ? msg.content : (
          <div className="md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.content}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {hasCSV && msg.trace && (
        <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => downloadCSV(msg.trace!)}
            title="참고한 원본 데이터를 CSV로 다운로드"
            style={{
              padding: '4px 10px', borderRadius: 4,
              background: 'var(--panel)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-dim)',
              fontFamily: 'var(--mono)', fontSize: 11,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            ⬇ CSV ({rowCount}행)
          </button>
          <details style={{ fontSize: 11, color: 'var(--text-mute)' }}>
            <summary style={{ cursor: 'pointer' }}>도구 호출 {msg.trace.length}회</summary>
            <div style={{ marginTop: 6, fontFamily: 'var(--mono)', fontSize: 10.5 }}>
              {msg.trace.map((t, i) => (
                <div key={i} style={{
                  padding: 6, marginBottom: 4,
                  background: 'var(--panel-2)', borderRadius: 4,
                  borderLeft: `2px solid ${t.ok === false ? 'var(--surge)' : 'var(--accent)'}`,
                }}>
                  <div style={{ color: t.ok === false ? 'var(--surge)' : 'var(--accent)' }}>{t.name}</div>
                  <div>{JSON.stringify(t.args).slice(0, 180)}</div>
                  {t.preview && (
                    <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>→ {t.preview}</div>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
