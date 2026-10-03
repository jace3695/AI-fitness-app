/** Normalized, engine-independent expression targets. No image coordinates. */
export const CHARACTER_EMOTIONS = ['neutral', 'smile', 'happy', 'proud', 'encouraging', 'concerned', 'surprised', 'thinking', 'serious', 'disappointed', 'sleepy', 'comforting'] as const;
export type CharacterEmotion = typeof CHARACTER_EMOTIONS[number];
export const CHARACTER_GESTURES = ['nod', 'tilt', 'greet', 'cheer'] as const;
export type CharacterGesture = typeof CHARACTER_GESTURES[number];
export type CharacterExpression = Readonly<{
  eyeOpen: number; eyeSmile: number; eyeTilt: number; gazeX: number; gazeY: number;
  headTilt: number; headNod: number; mouthCurve: number; energy: number;
}>;
const pose = (eyeOpen = 1, eyeSmile = 0, eyeTilt = 0, gazeX = 0, gazeY = 0, headTilt = 0, headNod = 0, mouthCurve = 0, energy = 0): CharacterExpression =>
  Object.freeze({ eyeOpen, eyeSmile, eyeTilt, gazeX, gazeY, headTilt, headNod, mouthCurve, energy });
export const EXPRESSIONS: Readonly<Record<CharacterEmotion, CharacterExpression>> = Object.freeze({
  neutral: pose(), smile: pose(.8, .25, 0, 0, 0, .08, 0, .55, .1),
  happy: pose(.4, 1, 0, 0, 0, 0, -.08, 1, .7),
  proud: pose(.6, .25, -.15, 0, -.2, -.1, -.4, .7, .3),
  encouraging: pose(.95, .15, -.1, 0, 0, -.15, -.12, .85, 1),
  concerned: pose(.75, 0, .65, 0, .12, .3, .1, -.4, -.5),
  surprised: pose(1.18, 0, -.15, 0, -.05, 0, -.3, 0, .45),
  thinking: pose(.8, 0, .15, .5, -.15, -.5, -.08, .05, -.1),
  serious: pose(.58, 0, -.55, 0, 0, 0, .12, -.1, -.25),
  disappointed: pose(.52, 0, .45, 0, .3, -.2, .45, -.8, -.7),
  sleepy: pose(.25, .05, 0, 0, .15, .22, .3, .1, -.85),
  comforting: pose(.7, .45, .2, 0, .1, .4, .2, .5, -.35),
});
export function blendExpression(from: CharacterExpression, to: CharacterExpression, amount: number): CharacterExpression {
  const p = Math.min(1, Math.max(0, amount));
  if (p === 0) return from;
  if (p === 1) return to;
  return Object.freeze(Object.fromEntries(Object.keys(from).map(key => {
    const k = key as keyof CharacterExpression; return [k, from[k] + (to[k] - from[k]) * p];
  })) as CharacterExpression);
}
export const GESTURE_DURATION: Readonly<Record<CharacterGesture, number>> = Object.freeze({ nod: 1100, tilt: 1500, greet: 1300, cheer: 1200 });
