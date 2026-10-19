/**
 * How Uzbek Latin is spelled, for every prompt that asks for Uzbek: ʻ (U+02BB)
 * in oʻ and gʻ, ʼ (U+02BC) for the glottal stop, never the plain apostrophe.
 * Without it the model copies whatever marks it is shown, and a plain
 * apostrophe is what most of the web uses.
 */
export const UZBEK_SPELLING =
  "In Uzbek, write oʻ and gʻ with ʻ (U+02BB) and the glottal stop with ʼ (U+02BC), " +
  "as in oʻzbek, qoʻngʻiroq and maʼlumot; never a plain apostrophe.";
