// Bionic reading text formatter
// Bolds the first ~40% of each word to guide the eye

function bionify(text) {
  if (!text) return '';

  return text.replace(/\b([a-zA-Z]+)\b/g, (match) => {
    const len = match.length;
    let boldLen;

    // Tuned ratios for readability
    if (len <= 1) boldLen = 1;
    else if (len <= 3) boldLen = 1;
    else if (len <= 4) boldLen = 2;
    else boldLen = Math.ceil(len * 0.4);

    return `<b>${match.slice(0, boldLen)}</b>${match.slice(boldLen)}`;
  });
}

// For use in modules
if (typeof module !== 'undefined') {
  module.exports = { bionify };
}
