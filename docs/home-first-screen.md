# Home first-screen summary — H3 increment

## Behavior

- The home page now places **지금 확인할 요약** before the conversation, task list and application cards. The existing next-action selection and availability guards are unchanged.
- A loading state does not show an actionable stale recommendation. A failed read retains its warning and existing retry callback; retries remain disabled while loading. Connection/login failure does not become a successful empty state.
- Empty or completed inputs retain the neutral calendar fallback, not “all work complete.” Unrecorded activity is not treated as undone. Failed domains are still excluded by the existing action selector; available domains remain usable.
- Existing conversation, task, status and detail sections remain available. The summary links to the existing chat/status anchors. No query, mutation, network provider, auth or storage behavior is added.
- Inside the optional morning/evening briefing, the next-action title and link now precede its six domain cards. All six summaries and their existing semantics are retained.
- Long action text is wrapped, not truncated. Very long titles or 200% text may require scrolling; the first-viewport acceptance is only for the named ordinary synthetic states at 320/390 × 844.

## Verification boundaries

Pure tests render the actual components and check the home binding/order, loading, failure/retry, neutral fallback, failed-domain exclusion, exact priority/link and full long-text retention. The updated briefing-order regression fails against the prior source and passes against this change.

The isolated native test lane uses the actual summary component and existing page/header spacing with synthetic already-read inputs. It checks ordinary state/CTA bounding boxes within the first viewport at 320/390, plus keyboard anchors/Back, a synthetic retry completion, reload, no writes/API traffic and 200% text reflow. It also strengthens the existing briefing test without removing its card/state/navigation assertions. The fixture header and destination placeholders are not the authenticated home, real data acquisition or complete destination screens.

A local bundle, test discovery or server-rendered markup is not native visual evidence. Native execution and named PNG review must be recorded separately for the exact candidate. Human five-second understanding, physical devices, authenticated whole-home loading/recovery and live data remain separate acceptance items. No production deployment is implied.
