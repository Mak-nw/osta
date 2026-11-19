/* Soft hyphens (U+00AD) for LONG English drug names in product-card titles (rule: no mid-word break without a hyphen; the site hyphenates EN manually, see base.css "Responsive typography").
   Only words of >= 16 letters are touched (shorter names fit a 320 px card line); break points follow the vowel-consonant-vowel pattern (never before x) with >= 4 letters before and >= 3 after. Not applied to DE (drug names stay whole there). */
const V = /[aeiouy]/i;
export function softHyphen(name) {
  return String(name).replace(/[A-Za-z]{16,}/g, (w) => {
    let out = '';
    for (let i = 0; i < w.length; i++) {
      if (i >= 4 && w.length - i >= 3 && V.test(w[i - 1]) && !V.test(w[i]) && !/x/i.test(w[i]) && V.test(w[i + 1] || '')) out += '­';
      out += w[i];
    }
    return out;
  });
}
