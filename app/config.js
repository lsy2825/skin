// 로그인(회원가입) 설정. 비워 두면 로그인 기능이 꺼지고 내정보는 이 기기에만 저장돼요.
// 켜는 방법: docs/로그인_설정.md (Supabase 프로젝트 URL과 anon public key를 넣기. anon key는 공개돼도 되는 키예요)
window.APP_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  providers: ["kakao", "google"],
};
