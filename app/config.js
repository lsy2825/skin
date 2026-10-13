// 로그인(회원가입) 설정. 비워 두면 로그인 기능이 꺼지고 내정보는 이 기기에만 저장돼요.
// 켜는 방법: docs/로그인_설정.md (Supabase 프로젝트 URL과 anon public key를 넣기. anon key는 공개돼도 되는 키예요)
window.APP_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  providers: ["kakao", "google"],
  // 기능 플래그: 법률 검토(의료광고·환자 알선·개인정보)가 필요한 기능은 꺼 둬요. 지금 앱에는 광고·예약 기능 자체가 없어요.
  flags: {
    ops: true,          // 내정보 → 운영 현황(수집 상태·검토 큐), 비밀번호 화면 뒤에만 있어요
    ads: false,         // 광고·협찬 표시(만들지 않음, 가격 순위와 분리 원칙)
    booking: false,     // 예약·결제 연결(만들지 않음)
    emailAlerts: false, // 메일 가격 알림(로그인 + 발송 서비스 키 필요)
    publicIndex: false, // 검색엔진 노출(index.html의 noindex 해제는 법률 검토 후)
    // 피부 고민으로 찾기 — 위험 등급과 법률 검토 항목: docs/LEGAL_REVIEW_CHECKLIST.md
    concernSearch: true,        // 규칙 기반 고민 분류 + 지식 파일 문장만 보여주기(기기 안에서만, 저장 안 함). 비공개 베타 범위
    concernPriceLink: true,     // 고민 화면에서 사용자가 직접 누르는 '가격 비교' 버튼(환자 유인 해당 여부 검토 대상)
    showDraftKnowledge: true,   // 의료진 검수 전 설명도 '초안' 표시와 함께 보여주기. 공개 출시 전 false(검수 완료만 노출)
    concernGenerativeAI: false, // 생성형 AI 답변: 만들지 않음. 법률·의료 검토 + 서버(키 보호·요청 제한) 전에는 켜지 않아요
  },
};
