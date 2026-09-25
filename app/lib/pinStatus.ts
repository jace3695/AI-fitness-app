export async function readPinStatus(response: Response): Promise<boolean> {
  if (!response.ok) throw new Error('PIN 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('configured' in data) || typeof data.configured !== 'boolean') {
    throw new Error('PIN 상태 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
  }
  return data.configured;
}
