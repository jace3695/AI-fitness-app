/** Reviewed source default. Changing this is an explicit deployment decision,
 * never schema detection or a per-account storage inference. Once writes are
 * enabled in a deployment, resetProtocol must remain protocol-required forever. */
export type LanguageLegacyEvidenceRelease = Readonly<{
  resetProtocol: 'inactive' | 'protocol-required';
  enrollmentEnabled: boolean;
  captureEnabled: boolean;
}>;
export const LANGUAGE_LEGACY_EVIDENCE_RELEASE: LanguageLegacyEvidenceRelease = Object.freeze({
  resetProtocol: 'inactive', enrollmentEnabled: false, captureEnabled: false,
});
