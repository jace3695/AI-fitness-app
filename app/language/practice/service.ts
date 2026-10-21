import type { Transport } from './conversation';

// Deliberately not wired into the production page. Existing free-mode policy
// remains authoritative. Authentication headers are supplied by the host app.
export function conversationTransport(fetcher: typeof fetch, headers: () => Promise<HeadersInit>): Transport {
  return async (request, signal) => {
    const authHeaders = await headers();
    if (signal.aborted) throw new DOMException('취소됨', 'AbortError');
    const response = await fetcher('/api/language/conversation', {
      method: 'POST', signal, headers: authHeaders,
      body: JSON.stringify({ ...request, history: request.history.map(m => m.role === 'user' ? m : { role: 'assistant', reply: m.text }) }),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: '로그인을 다시 확인해 주세요. 입력은 유지했어요.',
        402: 'AI 사용 한도에 도달했어요. 자동 재시도하지 않아요.',
        429: '요청이 많아요. 잠시 후 직접 다시 시도해 주세요.',
        503: '자유 AI 대화 서비스가 아직 연결되지 않았어요.',
      };
      throw Error(messages[response.status] || '대화 응답을 받지 못했어요. 입력은 유지했어요.');
    }
    return response.json();
  };
}
