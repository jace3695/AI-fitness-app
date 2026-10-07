// Shared by saved character clips and the existing message reader.
export const SPEECH_FOCUS_EVENT = 'yeoni-zephyr-play';
export const SPEECH_STOP_EVENT = 'yeoni-speech-stop';
export function claimSpeechFocus(owner: string) {
  window.dispatchEvent(new CustomEvent(SPEECH_FOCUS_EVENT, { detail: owner }));
}
export function stopAllSpeech() {
  window.dispatchEvent(new Event(SPEECH_STOP_EVENT));
}
