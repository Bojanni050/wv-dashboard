// Text helpers shared by the AI-written report intros and explanations.

// Strip markdown, and characters the embedded fonts lack (emoji, CJK, ...).
function cleanText(text) {
  return String(text)
    .replace(/[*_`#>]+/g, '')
    .replace(/[^\n\x20-\x7E -ɏ‐-›€]/g, '')
    .trim();
}

// Models sometimes add a salutation or sign-off despite the prompt; drop those paragraphs.
function stripGreetings(text) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const isOpening = (p) => /^(beste|geachte|hallo|hoi|hi|goedemorgen|goedemiddag|lieve)\b/i.test(p) && p.length < 60;
  const isClosing = (p) => /^(met )?(vriendelijke|hartelijke|warme|sportieve)?\s*(groet|groeten)\b/i.test(p) && p.length < 80;
  const isSignature = (p) => /^(white vision|het (white vision )?team)\W*$/i.test(p);
  while (paras.length > 1 && isOpening(paras[0])) paras.shift();
  while (paras.length > 1 && (isClosing(paras[paras.length - 1]) || isSignature(paras[paras.length - 1]))) paras.pop();
  return paras.join('\n\n');
}

module.exports = { cleanText, stripGreetings };
