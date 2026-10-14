# 죠미 그림 상태 (Jomi Asset Status)

기준일: 2026-10-14. 원본 관리 규칙과 자른 방법은 `JOMI_ASSET_INVENTORY.md`, 화면별 쓰임은 `JOMI_INTERACTION_SPEC.md`에 있어요. 이 문서는 4.0 시점의 **승인 상태만** 짧게 정리해요.

## 원칙 (지시서 그대로)
- 사용자가 준 **원본 그림만** 써요.
  - `brand/jomi-expressions-original.webp`: 8표정 시트
  - `brand/yoonsiljang-icon-original.webp`: 앱 아이콘
- 원본은 덮어쓰지 않아요. 자른 파일은 `app/assets/jomi/`에 따로 만들어요.
- 새 고양이를 그리거나 생성하지 않아요. AI 생성도, 다시 그리기도 하지 않아요.
- 그림이 없는 표정은 **미승인(pending)** 그대로 두고, 승인된 다른 표정으로 대신 보여줘요.

## 표정 11개
| ID | 쓰임 | 상태 | 지금 보이는 그림 | 파일 |
|---|---|---|---|---|
| default | 홈·머리말·PIN | 승인 | 기본 미소 | expr-default-96.webp · -360.webp · -160.png |
| welcome | 첫 자기소개 | 승인 | 자기소개 | expr-welcome-* |
| curious | 피부 고민 가이드 | 승인 | 궁금한 | expr-curious-* |
| thinking | 고민 정보 찾는 중 | 승인 | 생각하는 | expr-thinking-* |
| happy | 담기·저장 완료(최저가 발견에는 안 씀: 지시 ②) | 승인 | 신나는 | expr-happy-* |
| wink | 가격 알림 저장 완료 | 승인 | 윙크 | expr-wink-* |
| empty | 결과 없음·관심 없음 | 승인 | 시무룩 | expr-empty-* |
| sleeping | 로딩·대기(가격 받는 중) | 승인 | 졸린 | expr-sleeping-* |
| **explaining** | 시술 사전·쉬운 용어 | **미승인** | 자기소개(welcome) | 없음 |
| **cart** | 빈 장바구니·빈 비교함 | **미승인** | 기본 미소(default) | 없음 |
| **error** | 오류 복구 | **미승인** | 시무룩(empty) | 없음 |

`tests/e2e/jomi.js` 39개가 이 규칙을 확인해요.
- 미승인 표정은 대신 보여주는 그림으로만 나와요.
- 생성한 그림 파일이 없어요.
- 원본 파일의 해시가 바뀌지 않았어요.

## 4.0에서 바뀐 것
- 새 그림 없음. 승인 상태 변경 없음.
- 새 화면(방문 계획·가격 종류·비교 판정·검색 결과 종류)에는 죠미를 넣지 않았어요. 정보 화면에 캐릭터를 더하지 않는 기존 원칙(`JOMI_INTERACTION_SPEC.md`)을 따라요.

## 사용자가 정할 것
- 이름 표기 '죠미' / '조미' 통일(시트에는 '조미', 앱에는 '죠미')
- 미승인 3표정(설명·장바구니·곤란)을 그릴지와 누가 그릴지. 원본 작가의 그림이 오면 `JOMI_ASSET_INVENTORY.md` §3 순서로 넣어요.
