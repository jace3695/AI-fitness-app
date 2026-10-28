# Home first-screen summary — H3 increment

## Behavior

- The home page now places **지금 확인할 요약** before the conversation, task list and application cards. The existing next-action selection and availability guards are unchanged.
- A loading state does not show an actionable stale recommendation. A failed read retains its warning and existing retry callback; retries remain disabled while loading. Connection/login failure does not become a successful empty state.
- Empty or completed inputs retain the neutral calendar fallback, not “all work complete.” Unrecorded activity is not treated as undone. Failed domains are still excluded by the existing action selector; available domains remain usable.
- Existing conversation, task, status and detail sections remain available. The summary links to the existing chat/status anchors. No query, mutation, network provider, auth or storage behavior is added.
- Inside the optional morning/evening briefing, the next-action title and link now precede its six domain cards. All six summaries and their existing semantics are retained.
- The primary action is before title content and fills the action card width. Its type still scales with text size; bounded pixel padding prevents nested rem padding from squeezing the label into a column at 200%.
- Titles over 80 Unicode code points show a 40-code-point preview and a native **전체 제목 보기** disclosure containing the complete original at the unchanged title size (40px at 200% text). Keyboard open/close preserves access to the full title; no source title is changed or deleted. Expanded titles may require vertical scrolling, but do not move the preceding CTA down.
- First-viewport acceptance covers named ordinary states at 320/390 × 844 and the isolated long-title state at 200% text. It is not a claim for every compound state (for example, a long failure notice plus a long title), physical browser zoom, or authenticated whole-home layout.

## Verification boundaries

Pure tests render the actual components and check the home binding/order, loading, failure/retry, neutral fallback, failed-domain exclusion, exact priority/link and full long-text retention. The updated briefing-order regression fails against the prior source and passes against this change.

The isolated native test lane uses the actual summary component and existing page/header spacing with synthetic already-read inputs. It checks ordinary state/CTA bounding boxes within the first viewport at 320/390, plus keyboard anchors/Back, a synthetic retry completion, reload, no writes/API traffic and 200% text reflow. At 200% the long-title test additionally requires a fully first-viewport, one-line short CTA at unchanged 28px text, complete expanded title retention, keyboard disclosure open/close, anchor/Back while expanded and explicit text-size reapplication after reload. The previous full-title heading assertion is retained equivalently on the expanded full-title region; the preview is checked separately. It also strengthens the existing briefing test without removing its card/state/navigation assertions. The fixture header and destination placeholders are not the authenticated home, real data acquisition or complete destination screens.

A local bundle, test discovery or server-rendered markup is not native visual evidence. Native execution and named PNG review must be recorded separately for the exact candidate. Human five-second understanding, physical devices, authenticated whole-home loading/recovery and live data remain separate acceptance items. No production deployment is implied.
