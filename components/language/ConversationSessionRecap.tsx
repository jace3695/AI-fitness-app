import type { projectClosedConversationRecap } from "../../lib/conversation-session/recap";

type Recap = ReturnType<typeof projectClosedConversationRecap>;

function recordedTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium", timeStyle: "short", timeZone,
  }).format(new Date(value));
}

/** The caller supplies a projection of its current registered local snapshot.
 * This component never treats a pure projection as a persistence receipt. */
export function ConversationSessionRecap({ recap }: { recap: Recap }) {
  if (recap.status === "unavailable") {
    return <section className="card" aria-label="종료한 대화 요약">
      <h2>종료한 대화 요약</h2>
      <p role="status">저장된 종료 기준과 표시 기록을 모두 확인하지 못해 요약을 만들 수 없어요. 원본 기록은 그대로 보존해요.</p>
      <p>잘 쓴 표현: 평가하지 않음</p>
      <p>고칠 표현: 평가하지 않음</p>
      <p className="muted">자유 문장의 정확성이나 자연스러움은 평가하지 않았어요.</p>
    </section>;
  }

  const { source, closed } = recap.provenance;
  const shown = (value: "shown" | "not-shown" | "unknown") => value === "shown" ? "표시됨" : value === "not-shown" ? "표시 안 됨" : "확인 불가";
  return <section className="card" aria-label="종료한 대화 요약" style={{ overflowWrap: "anywhere" }}>
    <h2>종료한 대화 요약</h2>
    {recap.status === "partial" && <p role="alert">일부 기록을 확인하지 못했어요. 아래 내용은 확인된 기록에 한정해요.</p>}
    <p><strong>{source.label}</strong> · 기존 고정 예문 · 수준 미지정</p>
    <p>보낸 문장 {recap.assessmentCoverage.committedTurns}개 · 보내지 않은 초안 {recap.unsentDraftCount}개</p>
    <p>종료: {recordedTime(closed.closedAt, closed.timeZone)} ({closed.timeZone})</p>
    <p className="muted">보내지 않은 초안은 보낸 문장에 포함하지 않았어요. 아래 기록은 종료할 때 저장된 예문과 요약 기준으로 표시해요.</p>

    <h3>입력한 표현과 표시 기록</h3>
    {recap.recordedTurns.length === 0 ? <p>보낸 문장이 없는 대화예요.</p> : <ol style={{ paddingInlineStart: 24 }}>
      {recap.recordedTurns.map(turn => <li key={turn.turnId} style={{ marginBottom: 18 }}>
        <p lang="ja" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.input}</p>
        <p className="muted">
          {turn.origin.kind === "inserted-example" ? (turn.origin.edited ? "예문을 넣은 뒤 수정" : "예문 넣기 사용") : "입력란으로 입력"}
          {" · "}{turn.sampleMatch.matched ? (turn.sampleMatch.matchedAgainst === "reading" ? "읽는 법과 일치" : "예문과 일치") : "예문·읽는 법과 불일치"}
        </p>
        <p className="muted">보내기 전: 예문 {shown(turn.preAnswerExposure.example)} · 읽는 법 {shown(turn.preAnswerExposure.reading)} · 뜻 {shown(turn.preAnswerExposure.meaning)} · 힌트 {shown(turn.preAnswerExposure.hint)}</p>
      </li>)}
    </ol>}
    <p className="muted">일치 여부는 저장된 비교 기준에 따른 문자열 비교예요. 정답, 독립적인 작문 능력, 실력 점수를 뜻하지 않아요.</p>
    <p><strong>잘 쓴 표현: 평가하지 않음</strong></p>
    <p><strong>고칠 표현: 평가하지 않음</strong></p>
    <p className="muted">자유 문장의 정확성이나 자연스러움은 평가하지 않았어요.</p>
    <details>
      <summary>저장된 예문과 확인 기준</summary>
      <p lang="ja">{source.content.japanese}</p>
      <p>{source.content.meaning}</p>
      <p>예문 출처: {source.contentSource.module} · {source.contentSource.exportName} · {source.contentSource.entryKey}</p>
      <p>예문 버전: {source.scriptRevision}</p>
      <p>응답 기준: {source.builderPolicy}</p>
      <p>일치 비교 기준: {source.matchPolicy}</p>
      <p>요약 기준: {closed.summaryPolicyVersion}</p>
      <p>종료 기록에 보존된 마지막 계정 확인: {recordedTime(closed.observation.receivedAt, closed.timeZone)} ({closed.timeZone})</p>
      <p className="muted">이 시각은 이 기기가 인증된 서버 응답을 받은 시각이에요. 서버가 보증한 시각이나 이후 초기화가 없었다는 확인은 아니에요.</p>
    </details>
  </section>;
}
