# Korean MFA v3 inventory projection

The prior renderer accepted 45 of the 108 symbols in the pinned Korean MFA G2P
model. The hosted short job on a8c4a51 completed decode/engine (0.27s/7.96s)
without a worker rejection, but the application rejected its manifest. The full
phone inventory is now explicitly mapped; this is a supported-symbol gap fix,
not a claim that the returned alignment has been phonetically reviewed.

Sources: [MFA Korean rules](https://mfa-models.readthedocs.io/en/latest/mfa_phone_set.html#korean)
and [Korean MFA dictionary v3.0.0 IPA charts](https://mfa-models.readthedocs.io/en/latest/dictionary/Korean/Korean%20MFA%20dictionary%20v3_0_0.html).
Michael McAuliffe and Morgan Sonderegger, Montreal Forced Aligner, 2024, CC BY 4.0.
The inventory snapshot comes from the unchanged G2P model metadata; its archive
SHA256 is recorded in `korean-mfa-inventory.json`.

- Preserve all existing vowel and consonant assignments.
- Bilabial stops/nasals retain the closure pose under secondary articulation or
  length. Non-closure rounded consonants use the existing rounded `u` pose.
- MFA's labial fricative variants of /h/ before rounded vowels use that rounded
  pose; they do not imply a bilabial stop closure.
- Other consonants use the existing `small` pose. The renderer does not attempt
  to depict tongue position, voicing, aspiration or tension as separate mouths.
- Length and secondary articulation remain in the original phone label. Each
  source interval is unchanged; no glide segment or timing is invented.
- `spn`, `<unk>` and every symbol outside the explicit inventory remain rejected.

This expands visual coverage, not pronunciation certainty. G2P predictions,
numbers and connected pronunciation still require saved-audio review. No general
alignment enablement or production promotion follows from these code checks.
