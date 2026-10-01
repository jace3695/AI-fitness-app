# 인간형 A안 — 원본 보존 자산 준비 v4

2026-10-01. 사용자가 고양이 동작 v3를 확인하고 다음 단계를 요청했다. 승인된 인간형 reference-v3를 머리/몸통 정지 자산으로 포장하고 배경을 분리한다. 과거 v1/v2 생성 머리·몸통은 사용하지 않는다.

## 보존 범위와 달라지는 부분

원본 1024×1536 좌표와 크기를 그대로 사용한다. 불투명 캐릭터 내부 RGB는 승인 원본에서 복사한다. 얼굴형, 눈·코·입, 목, 목걸이, 의상 무늬와 자세를 다시 생성하지 않는다. 눈 3상태와 입 7상태는 승인 reference-v3의 국소 패치를 그대로 참조한다.

내장 이미지 편집 도구로 배경 제거 후보를 만들었다. 후보의 얼굴·의상 RGB는 버리고, 알파와 반투명 외곽 경계색만 사용했다. 초기 합성에서 어두운 배경에 밝은 연보라색 머리카락 테두리가 남아 외곽 반투명 픽셀에만 배경색이 제거된 후보의 색을 적용했다. **배경/알파와 반투명 외곽은 원본과 달라진다. 전체 이미지 픽셀 일치를 주장하지 않는다.**

- 불투명 픽셀 1,072,095개: 원본 RGB 유지.
- 완전 투명 픽셀 450,895개.
- 반투명 외곽 픽셀 49,874개: 후보 알파/경계색 사용.
- 후보 알파의 내부 252~254는 255로, 0~4는 0으로 정규화했다. 얼굴 패치 전체와 목 경계 보호 영역은 완전 불투명인지 검사한다.

## 자산과 연결 기준

`public/yeoni/human/rig-v4/manifest.json`에 출처 해시, 레이어 좌표, 승인 눈/입 참조, 공통 Controller 의미 ID 대응, 잠정 피벗을 저장한다.

| 자산 | 원본 좌표 | 용도 |
| --- | --- | --- |
| head.png | 0,0,1024,740 | 머리·얼굴·머리카락·목 위쪽 |
| body.png | 0,740,1024,796 | 목 아래쪽·어깨·의상·목걸이 |
| matte-source.png | 1024×1536 | 편집 도구가 만든 원본 크기 알파 |
| edge-colors.png | 1024×1536 | 반투명 경계에만 남긴 후보 색 |
| assembled-preview.webp | 448×672 | 검수용 축소 합성 |

머리와 몸통은 y=740에서 원본을 나눈 **연속 목 변형용 파츠**다. 중립 합성은 빈틈 없이 원본 전경으로 재조립한다. 머리를 별개 사각 이미지처럼 회전시키면 목에 틈이 생길 수 있으므로 독립 강체 회전은 허용하지 않는다. PHASE 8에서 공통 변형 경계와 목 구간 `[632,816]`을 공유하고 작은 움직임으로 검증해야 한다. 피벗 `[524,696]`은 자산 좌표 초안이며 움직임 검증을 마친 값이 아니다. 가려진 목을 새로 그리거나 큰 시점 전환용 자산을 만든 것은 아니다.

## 검수 화면과 재현

[정지 비교 미리보기](Human_A_Rig_Preview.html)는 원본/합성을 같은 크기로 배치한다. 얼굴 확대, 50% 겹침, 배경 명도 전환, 눈/입 선택을 제공한다. 스크립트·Canvas·오디오·외부 요청 없이 기본 화면과 선택이 동작한다. 미리보기의 축소 해상도와 별도로 원본 1024×1536 픽셀 검사를 수행한다.

```sh
node scripts/yeoni-human-rig/pack.mjs
node scripts/yeoni-human-rig/export.mjs
node scripts/yeoni-human-rig/check.mjs
YEONI_BROWSER=webkit node scripts/yeoni-human-rig/check.mjs
```

검사 범위: 저장된 파츠 재조립, 불투명 원본 RGB와 목 경계 일치, 21개 눈×입 상태의 승인 합성 일치, 얼굴 편집 범위 밖 보존, 스크립트 비활성화 상태의 모든 선택, 확대/겹침/배경/모바일/샌드박스. 브라우저 결과 이후 실제 화면을 직접 원본과 비교한다. 최종 결과는 별도 증거 기록에 추가한다.

## 생성 출처

내장 imagegen 편집, 입력 `public/yeoni/human/reference-v3/base.png`, 투명 배경 요청. 후보에서 알파와 반투명 경계색을 추출했고, 최종 얼굴·의상의 불투명 RGB는 원본을 사용했다. 프롬프트:

> Use case: background-extraction. Edit target: the single attached approved character portrait. Produce a precise transparent-background cutout of this EXACT portrait. Remove only the pale lavender background to alpha transparency. Keep the exact 1024x1536 portrait canvas, placement, scale, crop, and silhouette. Preserve every visible strand of the brown bob hairstyle, both shoulders, all clothing down to the cropped bottom edge, purple cardigan knit details/buttons, ivory top, mint four-point star pendant and necklace. The character fills the same coordinates as input. Do not redraw, beautify, recolor, move, rotate, resize, reconstruct, or change the face, eye shape/position, nose, mouth, skin, hair, clothing or pose. Maintain wispy hair alpha at the edges. No added objects, no new parts, no labels, no contact sheet, no shadows, no decorative background. Real RGBA transparency, not a checkerboard painting. This is a background-removal production asset, NOT a newly generated variant. Only background pixels and their narrow antialiased edge may change.

이번 범위는 인간형 정지 자산 준비다. 인간형 기본 동작은 PHASE 8, 기존 음성 연결은 PHASE 9에서 검증한다. 실제 음성 청취·물리 iPhone 검증은 계속 남아 있으며 새 TTS 생성·운영 병합·배포는 없다.
