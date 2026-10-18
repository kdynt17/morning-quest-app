# 무료 학급 버전 배포

대상은 27명 학급, Firebase 프로젝트 `morning-quest`, 정적 사이트는 GitHub Pages입니다. Spark 요금제를 유지합니다. `firebase.json`에는 Realtime Database 규칙만 포함하며 Functions·Scheduler 배포는 하지 않습니다.

## 보상과 저장 구조

매일 한국 시각 06:00에 도전 날짜가 바뀝니다. 5영역을 완료하면 마감 이후 본인이 접속할 때 고정 50P가 지급됩니다. 접속하지 않는 동안 예약 서버가 실행되지는 않습니다. 연습은 영역별 하루 10P, 최대 50P입니다. 순위 보너스는 없습니다.

기존 회원·상품·문제는 유지합니다. 학생 최초 접속 시 기존 `users/uid/points`를 `wallets/uid`로 한 번 옮겨 새 잔액 기준으로 사용합니다. 이후 기존 points 필드는 초기 잔액이며 새 지갑이 현재 잔액입니다. 날짜와 영역 마스크로 중복 지급을 차단하고 상품의 실제 가격만 차감합니다. 구매 영수증 저장이 중단되면 다음 접속/구매 시 재시도합니다.

게임 점수는 브라우저에서 계산합니다. DB 규칙은 회차 진행 시간·완료·점수 범위·보상 조건을 검사하지만 정답을 다시 채점하지는 않습니다. 개발자 도구를 활용한 점수 조작까지 방어하는 시스템은 아닙니다. 학급 내부 운영용입니다.

## 배포

1. Firebase CLI로 프로젝트 관리 계정에 로그인합니다.
2. `npx firebase-tools deploy --only database --project morning-quest`
3. PR을 main에 병합합니다. GitHub Pages는 main의 루트 폴더를 게시합니다.
4. 학생 계정으로 로그인하여 도전·연습·상점을 확인합니다.

규칙과 프런트엔드를 연속 배포하세요. 새 규칙 적용부터 Pages 갱신까지 기존 클라이언트의 구매가 잠시 실패할 수 있습니다. 요금제 변경이나 결제 등록은 필요하지 않습니다. 무료 할당량에 도달하면 이용이 제한될 수 있습니다.

## 검증

- `npm test`: 게임 생성·채점·날짜 경계 및 기존 서비스 로직 10개 테스트. 기존 서비스 테스트에는 사용하지 않는 서버 정산 방식도 포함됩니다.
- `npm run check`: JavaScript 문법 검사.
- `node tests/ui-smoke.mjs`: Playwright/Chrome으로 5종 도전·13종 연습·모바일 레이아웃 검사. Firebase 통신은 모의 서버로 대체합니다.
- `npx --package firebase-tools@14.0.0 firebase emulators:exec --only database --project demo-morning-quest "node tests/free-rules.mjs"`: 실제 규칙의 부정 지급·중복 지급·가격 조작 차단 검사.
- 같은 에뮬레이터 명령에서 `node tests/free-client-emulator.mjs`: 실제 무료 클라이언트로 잔액 이전·5종 도전·13종 연습·50P 상한·정산·구매 재시도 검증.

에뮬레이터 테스트는 `npm ci --prefix functions`로 테스트용 Firebase Admin 의존성을 설치해야 합니다. CLI 14는 Java 17 환경용입니다. 테스트는 운영 DB에 실행하지 않습니다.

`functions/domain.mjs`는 브라우저에서도 사용하는 공통 문제 생성/채점 코드입니다. `functions/index.js`와 `functions/service.mjs`는 이전 서버 방식의 미사용 코드로 현재 앱에서 호출하거나 배포하지 않습니다. `tests/rules-emulator.mjs` 역시 이전 방식용이며 무료 버전 검증에는 위 free 테스트 두 개를 사용합니다.

같은 브라우저에서는 진행 중 입력을 복원하지만 브라우저 저장소를 지우거나 기기를 바꾸면 아직 제출하지 않은 입력은 복원되지 않습니다. 제출한 회차는 DB에 남습니다. 최근 평균은 게임 기록이며 IQ 수치가 아닙니다.
