# 고양이 연이 2.5D 반응 — 2026-09-07

## 적용

기존 로고의 보라색·흰색·민트색, J 모양 꼬리와 네 갈래 별 목걸이를 사용한 고양이 시안을 반영했다. 실시간 3D 모델이 아니라 입체감 있는 그림의 프레임을 재생하는 방식이다.

- 이미지: `public/yeoni-cat-sprite-v1.webp` — 1254×1254, 138,256 bytes, 4행×4열.
- 공용 컴포넌트: `components/YeoniMascot.tsx`, `components/yeoni-mascot.module.css`.
- 일본어 홈·가나 첫걸음·통합 수업·수업 복습에 연결했다.

| 상황 | 동작 | 재생 |
| --- | --- | --- |
| 홈 | 짧은 눈 깜빡임 | 12초 간격으로 반복 |
| 홈 | 작은 숨쉬기 | 18초 간격으로 반복 |
| 설명·새 표현 | 손짓 | 1.6초 한 번 |
| 정답·성공 | 두 앞발을 올려 칭찬 | 1.6초 한 번 |
| 오답·추가 연습 | 고개를 기울이며 격려 | 1.6초 한 번 |

이미지 로딩 후 재생을 시작한다. CSS로 반복하고, JavaScript 반복 타이머나 프레임별 React 상태 변경은 사용하지 않는다. 홈에서는 대부분의 시간 동안 정지해 있고, 학습 반응은 한 번 재생한 뒤 첫 프레임에서 멈춘다. 화면 밖으로 스크롤하거나 문서가 숨김 상태가 되면 재생을 일시 정지하도록 연결했다. `prefers-reduced-motion`에서는 두 애니메이션 모두 정지 이미지로 표시한다.

홈 말풍선의 ‘움직임 멈추기/켜기’ 버튼과 학습 설정의 ‘홈에서 연이 가끔 움직이기’는 같은 설정을 저장한다. 기존 설정에 새 항목이 없으면 반복을 기본으로 켠다. 기기 저장에 실패해도 홈의 멈춤 버튼은 즉시 동작하고 저장 오류를 안내한다. 캐릭터 표시 설정을 끄거나 이미지 요청이 실패해도 학습 설명과 결과는 텍스트로 읽을 수 있다.

실사용 중 아래쪽 답을 고르면 상단 캐릭터가 화면 밖에 남는 문제를 발견했다. 문제를 푸는 동안에는 설명만 표시하고, 답을 고르면 결과 안내 옆에 캐릭터 하나를 표시하도록 보완했다. 결과는 고정 메뉴에 가리지 않도록 가까운 위치로 스크롤한다.

## 코드 검증

- 145개 테스트 통과.
- ESLint 통과.
- Next.js 프로덕션 빌드·TypeScript·45개 정적 경로 생성 통과.
- React 검토: 상태 소유권, 이미지 로딩/실패, 홈 반복과 단발 반응 분리, 관찰자·이벤트 리스너 정리, 숨김·멈춤 설정, 장식 이미지의 접근성, 기존 채점·저장 함수 변경 여부를 확인했다.
- 최종 앱 코드: 로컬 `3f8f425d99eb10fc7f7de0cf1ccd46746f7f45ea`, 원격 `11c98f7112c2e4f73f54dbc1598bbab240ee7b66`. 동일 트리 `5737089bc4eac74daf07f5cbfec98962215990ec`.
- 프리뷰 배포 `dpl_5PEnoVXSq1HmjRc1ooFhosKKDBkK`: READY, GitHub Vercel 체크 success.

## 실제 브라우저에서 확인한 범위

로그인된 허가 계정으로 다음을 조작했다. 테스트 계정 식별 정보는 공개 문서에 기록하지 않는다. 홈 반복 변경 후 최종 앱 프리뷰에서 확인한 내용은 다음과 같다.

- 홈에서 고양이 이미지 로드, 말풍선, 진도 0/60 확인.
- 켜기 버튼을 누른 후 36초 동안 실제 브라우저의 렌더링 값을 399회 관측했다. 눈 깜빡임은 약 10.74·22.79·34.74초에 시작해 세 번 반복됐고, 각 회차에서 `translateX(0) → -96px → -192px → -288px → 0`을 확인했다.
- 숨쉬기는 약 13.91~16.64초와 31.84~34.65초에 두 번 관측됐다. 가로 확대 최고값 1.015, 바깥 96×96px 프레임 위치·크기는 전체 관측 동안 고정됐다.
- 화면 아래로 스크롤하여 캐릭터가 화면 밖(y=-433px)에 있으면 두 애니메이션 모두 `paused`, ‘맨 위로 이동’ 후에는 `running`으로 돌아오는 것을 확인했다.
- 홈에서 멈추기 → 두 애니메이션 `none` → 새로고침 후 정지 유지 → 설정 화면의 반복 체크 해제 상태 확인 → 체크 후 저장 성공 → 홈에서 반복 재개를 확인했다. 최종 설정은 반복 켜짐으로 복원했다.
- 가나 설명에서 다음 글자 이동 시 손짓의 실제 네 프레임 이동을 확인했다. 반복 횟수 1, 재생 시간 1.6초이며 3.36초 관측 종료까지 첫 프레임에서 정지했다.
- 1363px 데스크톱 뷰포트에서 문서 폭 1359px로 가로 넘침 없음.
- 최종 앱 배포 생성 시각(2026-09-07 02:58:15 UTC) 이후 앱 출처의 새 콘솔 오류 없음. 브라우저 확장 프로그램의 메타데이터 전송 오류는 앱 오류와 구분했다.

앞선 고양이 반응 배치 프리뷰 `a254a99`에서 다음 항목을 실검증했다. 이번 변경은 채점과 결과 배치를 변경하지 않는다.

- 첫 확인 문제에서 오답을 선택하면 격려, 정답으로 다시 고르면 칭찬으로 변경됨을 확인. 오답에서는 다음 버튼 비활성, 정답에서는 활성화 유지.
- 최종 배치에서 결과 옆 캐릭터가 하나만 표시되고 화면 안에 완전히 들어옴을 확인. 격려·칭찬 모두 재생 중 `translateX(-192px)`, 종료 후 `0` 확인.
- 캐릭터 표시 끄기 → 학습 설정 저장 → 홈 → 새로고침에서 캐릭터 숨김과 텍스트 안내 유지 확인. 이후 표시 설정을 다시 켜고 저장했다.

가나 묶음 저장이나 수업 완료 저장은 이번 검증에서 실행하지 않았다. 완료 진도는 0/60으로 유지됐다. 통합 수업·복습의 새 캐릭터 배치는 공통 컴포넌트 연결과 코드 검토로 확인했으며, 이 변경 이후 해당 화면의 완료 저장을 별도로 재실행한 것으로 보고하지 않는다. 기존 저장·초기화 검증은 `app-record-reset-verification.md`를 참고한다.

## 미검증 및 배포 조건

- 현재 연결된 브라우저에는 뷰포트 크기/기기 에뮬레이션 및 OS 동작 줄이기 설정을 변경하는 지원 기능이 없다. 320·390px 실제 화면과 OS 설정 적용은 미검증이다. CSS 분기 확인을 실제 기기 검증으로 대신 보고하지 않는다.
- 다른 탭을 연 뒤에도 제공된 브라우저가 원래 문서를 `visible`로 유지하므로 문서 숨김에 따른 자동 정지는 실검증하지 못했다. 스크롤에 따른 정지·재개는 실검증했다. 기기 저장 실패 안내는 코드 검토 범위이며 브라우저에서 저장 실패를 인위적으로 주입하지 않았다.
- 앞서 확인된 프리뷰 음성 키 설정 및 성공 재생 검증은 이번 캐릭터 변경 범위 밖에 남아 있다.
- PR #186의 작은 화면·음성 검증 조건이 남아 있으므로 운영 병합/배포는 진행하지 않았다.

## 이미지 제작 기록

내장 이미지 생성 도구로 사용자와 합의한 고양이 시안을 참조해 16프레임 시트를 만들었다. 첫 출력의 체크무늬 배경을 최종 편집에서 흰 배경으로 바꿨다. 최종 출력의 그림은 변경하지 않고, 웹 전송을 위해 Sharp WebP 품질 88로 변환했다.

최종 편집 프롬프트:

> EDIT this exact 16-frame cat sprite sheet. Preserve all 16 expressions and poses, character identity, white-and-purple fur, mint four-point pendant, soft 2.5D shading, 4 columns and 4 rows order. Change ONLY background and framing: replace EVERY checkerboard pixel with a clean flat SOLID WHITE (#FFFFFF) opaque background. Absolutely no checkerboard texture anywhere, no transparency visualization, no text, no grid lines. Reposition and scale each cat to fit WITHIN its own equal-size cell in the exact 4x4 grid, centered horizontally consistently, with a minimum 10% margin from ALL cell edges INCLUDING tail, paws, whiskers and sparkles. Common seated-body center and ground baseline across all cells, same character size, camera and head size. The last column's tails MUST have complete rounded tips and generous white margin before the image edge. Keep every character complete, 16 separate uniformly registered animation frames, no overlap, no changes to number or order of frames. One square sheet.
