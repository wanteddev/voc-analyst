// 정형 개인정보(PII) 마스킹 — BigQuery RE2 정규식으로 detail/title 등 원문 컬럼을 치환.
// 이름·주소 같은 비정형 PII는 잡지 못함(그건 DLP/LLM 레닥션 영역). 정형 PII 1차 차단용.
// 규칙 순서 중요: 구체적 패턴을 일반 패턴보다 먼저 적용(배열 앞→뒤 = 안쪽→바깥쪽 적용).
//
// 적용 지점: 드릴다운 원문 티켓(fetchCategoryTickets) + 챗봇 get_ticket_detail
// (후자는 원문이 OpenAI로 전송되므로 외부 유출 1차 차단 목적).
//
// 전화번호: 국내(010/02/070…) + 국제(+82, 앞자리 0 생략, 구분자 공백/괄호/점/하이픈) +
//   0 생략 휴대폰(10-xxxx-xxxx) + 대표번호(15xx/16xx/18xx) 커버.
// 연봉: '연봉/급여/월급/처우/보수' 키워드 + 금액(원 단위)만 치환 — '연봉의 7%' 등 비금액은 보존.
const RULES: Array<[pattern: string, replacement: string]> = [
  [String.raw`[\w.+-]+@[\w.-]+\.[\w-]+`, '[이메일]'],                              // 이메일
  [String.raw`\d{6}[- ]?[1-4]\d{6}`, '[주민번호]'],                                // 주민등록번호
  [String.raw`\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}`, '[카드번호]'],                  // 카드번호(16)
  [String.raw`\d{3}-\d{2}-\d{5}`, '[사업자번호]'],                                 // 사업자등록번호
  [
    String.raw`(연봉|급여|월급|처우|보수)([^\d\n%]{0,4})([0-9][0-9,.]*\s*(?:억|천만|천|백만|만)*\s*원)`,
    String.raw`\1\2[연봉]`,
  ],                                                                              // 연봉/급여 금액
  [
    String.raw`\+?82[ ()\-.]*(?:0[ ()\-.]*)?\d{1,2}[ ()\-.]*\d{3,4}[ ()\-.]*\d{4}`,
    '[전화번호]',
  ],                                                                              // 국제표기(+82, (0)/(10) 트렁크 포함)
  [String.raw`0\d{1,2}[ ()\-.]?\d{3,4}[ ()\-.]?\d{4}`, '[전화번호]'],               // 국내(0으로 시작)
  [String.raw`\b10[ ()\-.]\d{3,4}[ ()\-.]\d{4}\b`, '[전화번호]'],                   // 0 생략 휴대폰
  [String.raw`1[5-9]\d{2}[ )\-.]?\d{4}`, '[전화번호]'],                            // 대표번호(15xx~19xx)
  [String.raw`\d{11,}`, '[번호]'],                                                // 남은 장문 숫자열
];

export function maskPiiSql(col: string): string {
  return RULES.reduce(
    (inner, [pattern, replacement]) => `REGEXP_REPLACE(${inner}, r'${pattern}', r'${replacement}')`,
    col,
  );
}
