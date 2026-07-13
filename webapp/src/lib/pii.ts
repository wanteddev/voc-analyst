// 정형 개인정보(PII) 마스킹 — BigQuery RE2 정규식으로 detail/title 등 원문 컬럼을 치환.
// 이름·주소 같은 비정형 PII는 잡지 못함(그건 DLP/LLM 레닥션 영역). 정형 PII 1차 차단용.
// 순서 중요: 구체적 패턴(카드·주민·사업자)을 전화·일반 숫자보다 먼저 적용.
//
// 적용 지점: 드릴다운 원문 티켓(fetchCategoryTickets) + 챗봇 get_ticket_detail
// (후자는 원문이 OpenAI로 전송되므로 외부 유출 1차 차단 목적).
export function maskPiiSql(col: string): string {
  return (
    'REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(' +
    col +
    ", r'[\\w.+-]+@[\\w.-]+\\.[\\w-]+', '[이메일]')" +                       // 이메일
    ", r'\\d{6}[- ]?[1-4]\\d{6}', '[주민번호]')" +                          // 주민등록번호
    ", r'\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}', '[카드번호]')" +          // 카드번호(16)
    ", r'\\d{3}-\\d{2}-\\d{5}', '[사업자번호]')" +                          // 사업자등록번호
    ", r'(01[0-9]|0[2-6][0-9]?)[- ]?\\d{3,4}[- ]?\\d{4}', '[전화번호]')" +    // 전화번호
    ", r'\\d{11,}', '[번호]')"                                              // 남은 장문 숫자열(계좌 등)
  );
}
