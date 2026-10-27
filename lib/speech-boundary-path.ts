export const SPEECH_BOUNDARY_PATH = '/language/practice/access-check';

export function isSpeechBoundaryPath(pathname: string | null) {
  // A trailing slash is equivalent; descendants also stay isolated if a nested
  // not-found route is requested. The wrapper renders nothing on unknown paths.
  return pathname !== null && (pathname === SPEECH_BOUNDARY_PATH || pathname.startsWith(`${SPEECH_BOUNDARY_PATH}/`));
}
