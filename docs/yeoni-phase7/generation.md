# 인간형 A안 제작 기록

내장 imagegen 도구 사용. 별도 API/CLI 과금 경로를 사용하지 않았다.
입력: `reference/human-a-selected.png`, 사용자 선택 A안, SHA-256은 README 참조.

## 1. 모델 시트 — identity-preserve

원본의 성인 여성 얼굴·갈색 단발과 은은한 보라 포인트·보라색 눈·아이보리 상의·연보라 카디건·민트 네 갈래 별을 유지한다.
부드러운 2.5D를 유지하며 머리카락과 니트 질감을 애니메이션에 적합하게 단순화한다.
밝은 아이보리 배경의 가로 시트 상단에 전신 정면/사선/측면/뒷면, 하단에 neutral/warm/attentive/concerned/surprised/encouraging 표정 6종.
크림색 바지·연보라 플랫슈즈로 원본에서 보이지 않는 하의를 보완한다. 손발을 자르지 않고 날개·고양이 귀·새 장신구를 넣지 않는다.
생성 원본: `exec-5768cc6d-836e-4c8e-a4d8-ade084a5d18e.png`.

## 2. 투명 파츠 — identity-preserve

1024×1536 투명 RGBA atlas. 같은 얼굴·머리·의상·목걸이를 유지한다.
상단 왼쪽: 코/볼/귀/단발을 포함한 머리, 눈/눈썹/입 제거. 오른쪽: 목·카디건·상의·목걸이를 포함한 머리 없는 몸통.
아래: 뜬눈/반감은눈/감은눈 각 한 쌍, 닫힘/아/이/우/에/오의 구분되는 입, small 입, 좌우 소매/손 파츠.
눈·입 주변은 피부 사각형 없이 실제 투명 알파. 파츠 사이 빈 간격. 라벨·배경·체크무늬 금지.
생성 원본: `exec-292733d8-c325-4350-8916-26c23278f7ea.png` (초기 후보, 배포 자산으로 사용하지 않음).

## 3. 분리 간격·목 보완 — precise-object-edit

초기 atlas를 입력으로 동일 얼굴/눈/입/행 배치를 유지한다. 머리와 몸통이 닿지 않도록 상단 파츠 사이 간격을 늘린다.
목 상단을 위로 늘려 머리 합성 시 빈 틈이 생기지 않게 한다. 인접 파츠의 머리카락·카디건 조각을 제거한다.
나머지 눈/입/손의 위치와 형태는 유지한다. 배경은 실제 투명, 고정 파츠는 불투명, 경계만 안티앨리어싱.
최종 원본: `exec-6cadca3a-46ea-449d-890d-0fc0e2951f0c.png`, 프로젝트의 `public/yeoni/human/poc-atlas-v1.png`로 복사.

요청한 격자·간격을 정확히 준수한 결과는 아니므로 실제 파츠 좌표를 측정하여 JSON에 명시했다.

## 4. 대기·설명 자세와 공통 12감정 — identity-preserve

같은 원본 A안의 얼굴/머리/의상/목걸이를 유지한 가로형 참고 시트.
왼쪽은 상반신 대기와 한 손바닥을 편 설명 자세, 오른쪽은 4×3 표정 배열.
순서: neutral, smile, happy, proud, encourage, concerned, surprised, thinking, serious, disappointed, sleepy, comfort.
차이는 눈썹·눈꺼풀·입·고개로 표현하되 과장 변형을 피한다. 새로운 인물/장신구/날개/고양이 귀를 넣지 않는다.
완성 이미지: `human-a-poses-expressions.png` (생성 원본 `exec-84df1e56-1df6-4e3b-9b6e-ff16eac12173.png`).
이는 표정·자세 목표 참고 자료이며, 분리 파츠 또는 실제 Controller의 12감정 동작 검증을 의미하지 않는다.


## 눈·입 조화 수정 v2

방식: 내장 image_gen, 투명 배경. 입력은 원본 A안(정체성/화풍)과 v1 atlas(합성 대상 구조)다.
출력: `public/yeoni/human/face-parts-v2.png`, 원본 생성 `exec-700b6d07-a2bf-47b2-8caf-2165c46dd68f.png`.
요청 격자와 다른 1254×1254 결과이므로 실제 sourceRect와 입 중심 랜드마크를 측정했다. WebP는 품질 88, alpha 100으로 인코딩했다. 그림 자체를 코드로 재색칠/변형하지 않았으며 CSS/Canvas 렌더러가 원본 스프라이트를 배치한다.

최종 프롬프트:

```text
Use case: identity-preserve / compositing.
Asset type: transparent replacement eye and mouth sprite sheet for the illustrated woman Yeoni.
Input 1 is the CANONICAL identity and painting style. Input 2 is the faulty old atlas, supplied ONLY to show the head the new facial features must fit. Do not copy its doll-like eyes or oversized glossy lips.
Produce one 1024 x 1024 transparent PNG sprite sheet, no head/body, no labels, no grid. Three columns of equal width, three rows, with generous fully transparent gaps.
Row 1 at y≈170: three PAIRS of eyes WITH eyebrows (open, half blink, fully closed). Each pair about 285 pixels wide. Copy the reference woman's almond-shaped violet eyes, delicate warm brown fine lashes and softly textured fine brows. Match her subtle rising eye line, reference spacing, gentle asymmetry and upper eyelid folds. Do NOT make huge circular doll irises or heavy eyeliner.
Row 2 at y≈480: mouth closed relaxed reference smile; mouth saying ah; mouth saying ee.
Row 3 at y≈780: mouth saying oo (Korean u), mouth saying eh (Korean e), mouth saying oh (Korean o).
Mouth widths about 165 pixels except rounded u/o about 110 pixels. Every mouth must belong to the SAME woman: delicate slender warm muted rose lips like input 1, fine corners, minimal specular highlights, no saturated lipstick, no inflated thick lip edges, no wet gloss. Ah opens vertically with modest natural cavity; ee spreads horizontally and is shallow; e opens more than ee; u is small pursed; o is round and more open than u.
Match the reference soft painterly 2.5D texture and diffuse warm illumination exactly. Keep a SMALL naturally shaded skin transition around each eye/lip, feathering immediately into true transparency, without a large colored halo, without opaque rectangle patches. Keep all parts strictly separated, no overlapping features, no stray other body parts. Rest smile should have the slight natural angle of the original, not a symmetrical plastic smile. Actual transparent alpha background.
```


## 원본 보존 수정 v3

내장 image_gen을 사용했다. 기존 atlas를 참고하지 않고 선택한 원본 A안만 입력했다. 최종 제품 자산은 생성된 전체 초상 중 지정한 눈/입 영역을 무손실 WebP로 패키징한 것이다. 원본 바탕은 재생성하지 않았다. 런타임의 crop 배치·마스크 외에 이미지에 코드로 재색칠/변형을 하지 않았다. a와 o는 발음 모양을 재검토하여 재생성했으며 첫 o 시안은 채택하지 않았다. 작은 첫 ah는 small 보조 모양으로 사용했다.

자산 위치: `public/yeoni/human/reference-v3/`; 배치/원본·소스 해시는 `manifest.json`에 기록한다.

### small

원본 생성 파일: `exec-63517626-30d4-41ff-80ff-d3486d3fa3e9.png`

```text
Use case: identity-preserve, precise facial expression edit.
Edit target: the supplied canonical illustration of Yeoni. It is essential this remains EXACTLY the same woman, same face, same head tilt, same eye geometry, same portrait framing and body proportions.
Change ONLY her mouth to a restrained, natural mid-speech Korean 'ah'. Her mouth is gently open, a modest vertical opening, not a loud laugh, not a surprised gasp. Retain her original slender muted rose lip texture, slightly asymmetric smile corners, slight upward mouth angle to the viewer's right, and original diffused lighting. The opening is small enough that the outer chin/jaw position need not move. Minimal natural upper teeth, subtle dark mouth interior. No thick lipstick outline, inflated lips, gloss enhancement, extra makeup or artificial perfect symmetry.
Keep EVERYTHING else identical: eyes, lashes, brows, nose, cheeks, skin tones, silhouette, hair, clothing, necklace, background and lighting. No beautification, repainting or redesign. This is one frame of an identity-locked animation, not a reinterpretation.
Output a single 1024x1536 portrait in exactly the original framing. No panels or text.
```

### a

원본 생성 파일: `exec-0b80a149-86ea-47ad-8235-3a27c354764e.png`

```text
Use case: identity-preserve, precise facial expression edit.
Edit ONLY the requested expression in the supplied original portrait. Keep this EXACT woman and identity: original face silhouette, head tilt, eye line sloping slightly up to the viewer's right, asymmetry, skin shading, delicate restrained makeup and thin muted rose lips. Same hair, nose, cheeks, eyebrows, neck, shoulders, cardigan, pendant and lilac backdrop. No redesign, beautification, inflated lips, shiny lip gloss, symmetry correction or doll-like features. Preserve original exact 1024x1536 framing and scale.
This is a gentle conversational expression, not an exaggerated phoneme chart or a broad grin. Single portrait, no grid, no text. Change ONLY her mouth to gently pronounce Korean 'ah' /a/. This must be a visibly vertically OPEN speech vowel, not a tiny slit, not an eh smile. The dark mouth opening is approximately 80 pixels wide and 40 pixels tall on the 1024x1536 portrait. The whole lips stay close to original width, thin soft muted rose, slight angle rising toward viewer's right. Subtle upper teeth and tongue, no heavy lip rim or shine. No large surprised gasp. Leave nose, philtrum, jaw outline and chin position untouched.
```

### i

원본 생성 파일: `exec-cae8a2f7-d11b-4b7c-9288-37e2e4937c5e.png`

```text
Use case: identity-preserve, precise facial expression edit.
Edit ONLY the requested expression in the supplied original portrait. Keep this EXACT woman and identity: original face silhouette, head tilt, eye line sloping slightly up to the viewer's right, asymmetry, skin shading, delicate restrained makeup and thin muted rose lips. Same hair, nose, cheeks, eyebrows, neck, shoulders, cardigan, pendant and lilac backdrop. No redesign, beautification, inflated lips, shiny lip gloss, symmetry correction or doll-like features. Preserve original exact 1024x1536 framing and scale.
This is a gentle conversational expression, not an exaggerated phoneme chart or a broad grin. Single portrait, no grid, no text. Change only her mouth to quietly pronounce Korean 'ee' /i/: lips slightly spread, a narrow horizontal opening, a fine natural strip of upper teeth. Original mouth width and upturned angle, slender understated lip volume; only a shallow opening, no big grin. Everything outside the immediate lip region remains unchanged.
```

### e

원본 생성 파일: `exec-fe712d66-0364-4c26-b8e2-10e9b8ef9bc1.png`

```text
Use case: identity-preserve, precise facial expression edit.
Edit ONLY the requested expression in the supplied original portrait. Keep this EXACT woman and identity: original face silhouette, head tilt, eye line sloping slightly up to the viewer's right, asymmetry, skin shading, delicate restrained makeup and thin muted rose lips. Same hair, nose, cheeks, eyebrows, neck, shoulders, cardigan, pendant and lilac backdrop. No redesign, beautification, inflated lips, shiny lip gloss, symmetry correction or doll-like features. Preserve original exact 1024x1536 framing and scale.
This is a gentle conversational expression, not an exaggerated phoneme chart or a broad grin. Single portrait, no grid, no text. Change only her mouth to quietly pronounce Korean 'eh' /e/: a modest horizontal opening clearly taller than a thin ee opening but restrained, natural upper teeth and dim mouth interior. Keep original mouth width and gentle tilted angle, thin soft rose lips. Everything outside the immediate lip region remains unchanged.
```

### u

원본 생성 파일: `exec-aac8c09c-0ee7-4d06-878f-d83785673be0.png`

```text
Use case: identity-preserve, precise facial expression edit.
Edit ONLY the requested expression in the supplied original portrait. Keep this EXACT woman and identity: original face silhouette, head tilt, eye line sloping slightly up to the viewer's right, asymmetry, skin shading, delicate restrained makeup and thin muted rose lips. Same hair, nose, cheeks, eyebrows, neck, shoulders, cardigan, pendant and lilac backdrop. No redesign, beautification, inflated lips, shiny lip gloss, symmetry correction or doll-like features. Preserve original exact 1024x1536 framing and scale.
This is a gentle conversational expression, not an exaggerated phoneme chart or a broad grin. Single portrait, no grid, no text. Change ONLY her mouth to quietly pronounce Korean 'oo' /u/: a SMALL, gently rounded opening with a subtle natural forward purse. The whole mouth should be narrower than the original relaxed smile but never inflated or thick. Keep the natural mouth angle and restrained thin matte rose lip edges. This is speaking oo, NOT a kiss/duck face. Everything outside the immediate lip region remains unchanged.
```

### o

원본 생성 파일: `exec-b0ae42a8-620c-4dba-9d3e-89b260328473.png`

```text
Use case: identity-preserve, precise facial expression edit.
Edit ONLY the requested expression in the supplied original portrait. Keep this EXACT woman and identity: original face silhouette, head tilt, eye line sloping slightly up to the viewer's right, asymmetry, skin shading, delicate restrained makeup and thin muted rose lips. Same hair, nose, cheeks, eyebrows, neck, shoulders, cardigan, pendant and lilac backdrop. No redesign, beautification, inflated lips, shiny lip gloss, symmetry correction or doll-like features. Preserve original exact 1024x1536 framing and scale.
This is a gentle conversational expression, not an exaggerated phoneme chart or a broad grin. Single portrait, no grid, no text. Change ONLY her mouth to quietly pronounce Korean 'oh' /o/. Make a compact ROUND VERTICAL OVAL mouth cavity, approximately 34 pixels wide by 40 pixels tall in this 1024x1536 portrait. This is more open than oo/u, with a vertical aspect ratio, not a horizontal slit or smile. Entire lips are approximately 75 pixels wide and 68 pixels high, slender restrained muted rose lip edges matching the original pigment. Soft small upper tooth glimpse optional, shaded natural interior. No duck face, thick lipstick or inflated lips. Keep original nose, philtrum, cheeks, jawline and chin untouched; no surprise expression.
```

### eyesHalf

원본 생성 파일: `exec-cd073e9e-1c30-4d03-a162-e27ec9298a1f.png`

```text
Use case: identity-preserve, precise facial expression edit.
Edit ONLY the requested expression in the supplied original portrait. Keep this EXACT woman and identity: original face silhouette, head tilt, eye line sloping slightly up to the viewer's right, asymmetry, skin shading, delicate restrained makeup and thin muted rose lips. Same hair, nose, cheeks, eyebrows, neck, shoulders, cardigan, pendant and lilac backdrop. No redesign, beautification, inflated lips, shiny lip gloss, symmetry correction or doll-like features. Preserve original exact 1024x1536 framing and scale.
This is a gentle conversational expression, not an exaggerated phoneme chart or a broad grin. Single portrait, no grid, no text. Change ONLY the eyelids to a relaxed HALF blink, halfway down over the existing violet irises. Both eyes half closed together. Keep original eyebrows, eyelash length, eye corners, eye tilt, and mouth exactly unchanged. Show half the iris vertically. Do not shift gaze, change expression elsewhere, add eyelid makeup, thicken lash lines or change the shape/size of the eyes.
```

### eyesClosed

원본 생성 파일: `exec-d06b69e3-20cb-41da-8f7a-bebcf15515b3.png`

```text
Use case: identity-preserve, precise facial expression edit.
Edit ONLY the requested expression in the supplied original portrait. Keep this EXACT woman and identity: original face silhouette, head tilt, eye line sloping slightly up to the viewer's right, asymmetry, skin shading, delicate restrained makeup and thin muted rose lips. Same hair, nose, cheeks, eyebrows, neck, shoulders, cardigan, pendant and lilac backdrop. No redesign, beautification, inflated lips, shiny lip gloss, symmetry correction or doll-like features. Preserve original exact 1024x1536 framing and scale.
This is a gentle conversational expression, not an exaggerated phoneme chart or a broad grin. Single portrait, no grid, no text. Change ONLY the eyelids to a soft natural CLOSED blink. Keep both original eyebrows exactly in place, original eye corners and the tilted eye line; the lids close down over the existing eyeballs. Do not lower/raise eyebrows, smile more, change the lips, turn the head or repaint the skin. Retain original fine warm brown lashes, without adding false eyelashes or thick eyeliner. The original mouth stays fully unchanged.
```
