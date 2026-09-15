# 4단계 — ChatGPT 기록 분석 연결

> **2026-09-15 최신 방향:** 사용자 요청으로 개발자 모드 없는 Work 방식으로 전환했습니다. 대표 계정 요약 조회·첫 조언 5건 저장·재조회와 매일 아침 예약 등록을 완료했습니다. 첫 예약 실행과 본인 계정 화면 확인은 남아 있습니다. 아래 일반 채팅 MCP 연결 절차는 보류 상태의 과거 기록이며 현재 필수 단계가 아닙니다. [Work 실행 결과와 남은 확인](work-daily-advice.md).

2026-09-15. 연이 전용 MCP/OAuth 연결과 조언 조회 화면을 구현했다. **실제 Jace ChatGPT 계정에서 연결·모델 분석·조언 저장은 아직 완료되지 않았다.** Preview 배포·DB 구조 적용·격리 브라우저 검증을 마쳤다. 사용자 승인 후 Preview 공개 예외를 적용했다. 실제 계정 연결 단계가 남아 있다.

## 사용자 흐름

1. ChatGPT에서 연이 연결을 추가한다. 아래 연결 주소는 검증용 Preview 전용이다.
   `https://ai-fitness-app-git-fix-app-wide-reliability-jace3695s-projects.vercel.app/mcp`
2. 연이 로그인 화면에서 기존 계정으로 로그인하고, 조회를 허용할 영역과 동작을 확인해 연결한다.
3. ChatGPT에서 “최근 7일 운동 기록을 분석하고 조언을 연이에 저장해 줘”라고 요청한다.
4. 연이 → **ChatGPT 조언**에서 결과와 분석 기간·기록 조회 시점을 확인한다.
5. **ChatGPT 연결 관리**에서 연결을 해제하면 다음 도구 호출부터 거부된다.

연결은 최대 30일, 개별 접근 토큰은 최대 1시간이다. 연이 로그인 세션이 끝나거나 연결된 영역을 초기화하면 재연결이 필요할 수 있다. 연결 해제는 이미 저장한 조언이나 ChatGPT 대화를 삭제하지 않는다. 연이의 영역별 초기화는 해당 영역의 조언을 제거하며, 연이 비서 전체 초기화는 모든 ChatGPT 조언을 제거한다.

## 첫 연결에서 제공하는 범위

| 도구 | 동작 | 범위 |
|---|---|---|
| `read_record_summary` | 기록 집계 조회·분석용 스냅샷 생성 | 일정·할 일 / 운동 / 식단 / 언어 / 가계부 중 승인한 영역, 최근 7일·28일 |
| `save_advice` | 요청한 조언 저장 | 유효한 본인 스냅샷, 제목·본문, 동일 요청 중복 방지 |
| `list_saved_advice` | 저장한 최근 조언 조회 | 승인한 영역의 최근 20개 |

- 원본 메모·상호·계정 식별자·사진·대화 전문은 전달하지 않는다. 첫 범위는 집계 숫자에 대한 조언이다.
- 일정 미완료 수와 언어 복습 목록 수는 현재 상태이며 기간 통계와 구분한다. 미기록을 실제 0이나 목표 달성으로 추정하지 않는다.
- 저장 전 집계 재조회에서 값이 달라졌으면 저장을 거부하고 새 요약으로 재분석하게 한다. 저장된 조언에는 당시 요약이 남으며 최신 상태를 보장하지 않는다.
- 원본 일정·가계부·운동 기록 수정, 음성 생성, 앱에서 GPT를 자동 호출, 24시간 감시는 포함하지 않는다.
- 이 경로는 OpenAI/Gemini 유료 추론 API나 TTS를 호출하지 않는다. ChatGPT 구독 한도와 기존 Vercel/Supabase 운영 한도는 별도로 적용된다. 추가 비용 0원을 무조건 보장하는 문서가 아니다.

## 인증·데이터 보호 설계

- Supabase 기존 로그인으로 본인을 확인한다. OAuth에는 별도의 불투명 토큰을 발급한다. Supabase 세션 JWT·서비스 키를 ChatGPT에 제공하지 않는다.
- 이유: 현재 Supabase OAuth 서버 문서는 일반 세션과 같은 사용자 데이터 권한을 설명한다. 기존 앱 전체 RLS·RPC를 광범위하게 바꾸는 대신, 연결 토큰을 세 동작으로 제한했다.
- OAuth 인증 코드는 5분·1회, S256 PKCE 필수다. 안정된 ChatGPT CIMD `https://chatgpt.com/oauth/client.json`의 공개 메타데이터를 검증하고 공개 클라이언트 방식 `none`을 지원한다. 동적 임의 URL·클라이언트 등록을 받지 않는다.
- 콜백은 공개 메타데이터의 `https://chatgpt.com/connector_platform_oauth_redirect`만 허용한다. 성공·거부 응답 모두 동일 `iss`와 원래 `state`를 반환한다.
- issuer/resource는 요청 Host에서 만들지 않는다. Preview의 고정 주소를 사용하고 코드 교환·토큰 사용마다 resource·client·범위·만료·해제·살아 있는 로그인 세션을 확인한다.
- refresh token은 회전하며 사용한 코드/refresh token 재사용은 해당 연결을 해제한다. 토큰 응답이 유실되어 재교환에 실패하면 새로 연결해야 한다.
- 비밀값은 DB에 SHA-256 해시로 저장한다. 원문은 OAuth 응답에만 쓰며 로그·문서·브라우저 저장소에 추가하지 않는다.
- 내부 연결 테이블은 비공개 스키마, RLS 활성화, 일반 직접 접근 권한 없음. 제한된 capability/본인 세션을 검사하는 내부 함수에만 `SECURITY DEFINER`를 사용하며 검색 경로를 비웠다. 공개 RPC는 invoker wrapper이고 역할별 실행 권한을 명시했다.
- 공개 `chatgpt_advice`는 본인 조회·삭제 RLS만 허용한다. 임의 REST 삽입·수정은 차단한다. 계정 삭제는 새 연결 데이터 전체를 연쇄 삭제한다.
- 조언 저장은 서버 스냅샷과 연결한다. 요청 UUID와 전체 payload 해시로 동일 재시도를 처리한다. 다른 계정·다른 연결의 스냅샷, 만료·초기화된 스냅샷은 거부한다.
- 원본 기록의 RLS·로그인 동작은 바꾸지 않는다. 기록 초기화 표식 변경 시 해당 조언·스냅샷 제거와 연결 해제만 추가한다.
- 승인 화면은 본인 로그인·동일 Origin·명시적인 버튼 클릭을 요구한다. 외부 iframe 삽입과 referrer 전송을 차단하며 조언은 HTML로 해석하지 않는다.
- 조회 스냅샷은 1일, 최대 100개, 조언 신규 저장은 하루 50개, 도구 호출은 연결당 분당 60개로 제한한다. 이 숫자는 공급사 요금 무료 한도와는 다르다.

## 검증 기록

- 로컬: 단위·DB 363개 통과. 이 중 새 연결 18개는 실제 PGlite SQL과 공식 MCP SDK 전송을 사용한다.
- 타입·린트·독립 CI 빌드 통과. 첫 [CI 34931719825](https://github.com/jace3695/AI-fitness-app/actions/runs/34931719825)는 71/74 통과했다. 기존 68개와 새 WebKit 3개가 통과했고, 새 Chromium 3개는 연결 후 문서가 이동하면서 테스트의 `response.json()`을 읽지 못했다. 제품의 저장 검사 실패로 확정하지 않으며, 당시 Chromium 전체 흐름은 미검증이다.
- 수정본 `36792638188b9ade455cd1dfdf8ecd3492f9124d`는 응답 본문 대신 합성 콜백으로의 실제 브라우저 이동 완료와 state/issuer/code를 검사한다. assertion을 생략하거나 성공을 모사하지 않는다. 앱 런타임·SQL 내용은 동일하며 마이그레이션 파일명과 참조만 실제 이력에 맞췄다. [재검증 34932777180](https://github.com/jace3695/AI-fitness-app/actions/runs/34932777180)은 **단위/DB 363개·VM 25개·Chromium/WebKit 74/74·타입·린트·독립 빌드 모두 통과**했다. 새 연결 시나리오 3개를 두 브라우저에서 모두 통과했고, 합성 계정 91개·관련 행 잔여 0·브라우저 외부 origin 0·임시 DB/키 정리를 확인했다. 파일명 변경 후 로컬 새 연결 18개도 다시 통과했다.
- 브라우저 검증은 폐기 가능한 계정·DB만 사용하고 ChatGPT 콜백은 합성 클라이언트로 대체한다. 실제 ChatGPT 로그인·모델 호출 성공을 뜻하지 않는다.
- 호스팅 DB: `20260915052413_chatgpt_scoped_connection` 적용 성공. 원본 11개 테이블의 전체 행 해시·행 수가 전후 동일했고, 후속 호스팅 화면 읽기 검증 이후에도 같았다. 기존 지출 36개·앱 상태 2개·언어 상태 2개·AI 사용 이력 13개·음성 검증 슬롯 3개를 유지했다. 새 연결·토큰·스냅샷·조언은 모두 0개다.
- 권한: 새 테이블 RLS 활성화, 비공개 세 테이블의 anon/authenticated 직접 조회·삽입·수정 차단, 조언 본인 조회·삭제만 허용, 공개 RPC invoker·역할별 execute 설정 확인.
- 보안 진단: 새 WARN/ERROR 없음. 비공개 세 테이블의 [RLS 정책 없음 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)는 직접 접근을 전부 차단하고 제한된 내부 함수를 쓰는 설계상 의도한 결과다. 새 인덱스의 [미사용 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)는 아직 연결 데이터가 없기 때문이다. 기존 비밀번호 보호 WARN과 기존 FK 인덱스 INFO 2개는 이번 변경 전부터 있었다.
- Preview: 기능 코드 `a19b941`의 배포 `dpl_Hevih8DA8odxPwiqBE4RBAEnpdga` READY. 위 테스트/파일명 수정본 `3679263`의 `dpl_2nmup6QeRDrd42rP9GCp3P5eGHNZ`도 READY이며 브랜치 별칭은 동일하다.
- 호스팅 브라우저: 기존 로그인 계정에서 연결 관리 조회, 조언 화면 이동·새로고침, 합성 PKCE 요청을 이용한 **승인 전** 영역/동작 검토 화면을 확인했다. 실제 공개 ChatGPT CIMD 조회·검증 경로를 거쳤으며 연결 버튼은 누르지 않았다. 기록 요약·조언 본문을 외부로 전송하거나 새 조언을 쓰지 않았다.
- PR은 Draft·미병합이며 운영 승격은 하지 않았다. 실제 iPhone과 실제 ChatGPT 계정 연결·모델 분석은 아직 남아 있다.

## Preview 보호 설정 변경 이력

2026-09-15 비로그인 HTTP 확인에서 OAuth 메타데이터는 302, MCP 초기화·도구 목록·호출은 Vercel의 `401 Protected deployment`를 반환했다. 앱에 도달하기 전의 Vercel 인증 장벽이다. 로그인된 개발용 브라우저에서 페이지가 보이는 것만으로 ChatGPT의 외부 접근이 가능하다고 판정하지 않는다.

프로젝트의 실제 설정은 **Vercel Authentication → Standard Protection**이다. **Deployment Protection Exceptions → Add Domain**은 현재 Hobby 화면에서도 제공된다. [Vercel 공식 안내](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions)는 도메인별 예외가 모든 요금제에서 추가 비용 없이 가능하다고 설명한다.

제안한 변경은 아래 브랜치 Preview 도메인 하나를 예외에 추가하는 것이다.

`ai-fitness-app-git-fix-app-wide-reliability-jace3695s-projects.vercel.app`

예외를 적용하면 **이 도메인의 모든 경로와 앞으로의 배포**에 Vercel 로그인 요구가 없어지며 외부에서 앱 접속 화면과 MCP 공개 메타데이터에 접근할 수 있다. 개인 기록은 계속 연이 로그인·OAuth 승인·영역 권한 검사로 보호된다. 다른 Preview 도메인과 운영 배포는 변경 대상이 아니다. 예외 제거로 Vercel 보호를 다시 적용할 수 있다.

**2026-09-15 사용자 명시적 승인 후 공개 예외 저장 완료.** Vercel의 Unprotected Domains 표에 위 도메인 한 개가 표시됨을 확인했다. 별도 비로그인 HTTP에서 OAuth 서버/리소스 메타데이터 200, MCP initialize 200, tools/list 200 및 세 도구의 OAuth 범위를 확인했다. `/api/chatgpt/advice`는 401과 로그인 요구를 반환했다. 모두 no-store였다. 빈 도구 인자는 스키마 오류를 반환했으며 이를 인증 검증으로 간주하지 않는다. 유효한 운동 요약 인자로 시도한 무토큰 검사 결과 수집은 자동 승인 검토에서 민감한 운동 기록 조회 위험을 이유로 거절되어 재시도하지 않았다. 따라서 공개 전환 후 해당 도구의 인증 차단 검사는 미완료이며, 개인 기록 반환·실제 ChatGPT 연결 성공을 주장하지 않는다. 우회 비밀키·공유 링크는 생성하거나 전달하지 않았다.

## Jace 계정에서 마지막으로 할 일

Preview 공개 예외와 공개 메타데이터/도구 발견 확인을 완료했다. 이제 Jace의 ChatGPT 계정에서 다음 절차를 진행한다.

1. ChatGPT **설정 → 보안 및 로그인 → 개발자 모드**를 확인한다. 계정·작업 공간 정책에 따라 제공 여부가 다르다.
2. [ChatGPT 플러그인](https://chatgpt.com/plugins)에서 추가 버튼을 누르고, 이름 **AI 연이**, 위 `/mcp` 주소를 입력한다.
3. OAuth 클라이언트 방식 선택이 있으면 **CIMD**, 토큰 인증 방식 선택이 있으면 **none**을 사용한다. 현재 구현은 DCR/고정 비밀키 방식이 아니다. 메타데이터에서 자동 발견되는 값은 임의로 바꾸지 않는다.
4. 연이 계정으로 로그인하고 권한을 확인해 승인한다.
5. 새 분석 대화에서 연이 도구를 활성화한 뒤 위 예시를 요청한다. 실제 도구 실행 결과와 연이의 조언 화면을 함께 확인한 뒤 4단계 완료로 표시한다.

필요한 메뉴가 없거나 연결 오류가 나면 해당 화면을 확인한다. API 키·비밀번호·토큰은 채팅에 붙여넣지 않는다. 추가 요금제나 충전 없이 가능한 범위에서 확인한다.

## 확인한 공식 자료

- [OpenAI MCP 서버 구현](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI 인증·CIMD·PKCE·issuer 식별](https://developers.openai.com/plugins/build/auth)
- [ChatGPT 개발자 연결·검증 절차](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Supabase OAuth 흐름과 토큰 권한](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
- [Supabase Data API 권한 변경](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

공식 MCP SDK `1.30.0` 사용. 초기 연결은 Preview 전용이며 실제 iPhone 확인과 운영 반영은 마지막 단계다.
