# 브랜드: 윤실장

- **앱 이름:** 윤실장 (2026-10-13 사용자 지정)
- **아이콘 원본:** `yoonsiljang-icon-original.webp` (1254×1254, 사용자 제공)
  - 원본은 둥근 모서리 바깥이 투명이 아니라 **검은색**이에요. 그대로 쓰면 홈 화면 아이콘에 검은 모서리가 보여요.
- **앱 아이콘용 원본(1024px):** `make_icons.py`로 만들어요.
  - `yoonsiljang-icon-1024.png`
    - 정사각형 전체를 채운 버전이에요. 모서리는 흐린 분홍으로 채웠어요.
    - iPhone·Android가 모서리를 직접 둥글게 잘라서, 채운 부분은 거의 보이지 않아요.
  - `yoonsiljang-icon-maskable-1024.png`
    - 그림을 80% 크기로 줄이고 분홍 여백을 둔 버전이에요.
    - Android가 원형 등으로 잘라도 '윤실장' 글자가 잘리지 않게 하려는 거예요.
- **아직 앱에 적용하지 않았어요.** 적용할 때 바꿀 곳:
  - `app/manifest.webmanifest`: name, short_name, icons, theme_color
  - `app/index.html`: title, apple-touch-icon, 머리말 제목
  - `app/icons/`: 192·512·maskable·180px 아이콘
  - `app/sw.js`: 캐시 버전
