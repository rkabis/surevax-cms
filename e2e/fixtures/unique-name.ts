/**
 * A unique, DIGIT-FREE surname suffix.
 *
 * The intake form rejects digits in a name field (`lib/phValidation.ts`), which
 * is correct on the evidence: 3 of 45,429 name cells in the clinic's real export
 * contain a digit and all three are junk ("Abdulrahman (Sample 2)", a bare "0").
 * So a test fixture cannot stamp uniqueness with `Date.now()` digits: it encodes
 * the same timestamp in letters instead.
 *
 * Note the PREFIX matters too: "E2E" contains a digit, so fixture names spell it
 * "EndToEnd". A name assembled here must be letters end to end.
 */
export function uniqueNameSuffix(): string {
  const digits = Date.now().toString().slice(-9)
  return digits.replace(/\d/g, (d) => 'ABCDEFGHIJ'[Number(d)]!)
}
