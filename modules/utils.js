const TITLE_SPLIT_PATTERNS = [
  /^(.+?)\s*[-–—]\s*(.+)$/,
  /^(.+?)\s*:\s*(.+)$/,
  /^(.+?)\s*\|\s*(.+)$/,
  /^(.+?)\s*\/\s*(.+)$/,
  /^(.+?)\s*['"](.+)['"]\s*$/,
  /^(.+?)\s*\(\s*(.+)\s*\)$/,
];

const NOISE_WORDS =
  /(oficial|official|video|clipe|lyric|audio|hq|hd|4k|remaster|remix|ao vivo|live|dvd|vol|parte)/gi;

const ARTIST_NOISE = /(topic|- topic|oficial|official|vevo)/gi;

/**
 * Extrai artista e título a partir de uma string (título de vídeo, nome de arquivo, etc.)
 * @param {string} text
 * @returns {{ artist: string, track: string }}
 */
function extractArtistAndTitle(text) {
  if (!text) return { artist: "", track: "" };

  const clean = text
    .replace(/\[.*?\]|\(.*?\)/g, "")
    .replace(NOISE_WORDS, "")
    .trim();

  for (const pattern of TITLE_SPLIT_PATTERNS) {
    const match = clean.match(pattern);
    if (match && match[1] && match[2]) {
      return {
        artist: match[1].trim().replace(/\s+/g, " "),
        track: match[2].trim().replace(/\s+/g, " "),
      };
    }
  }

  return { artist: "", track: clean.replace(/\s+/g, " ").trim() };
}

/**
 * Limpa ruídos comuns de título/artista para tags e nomes de arquivo.
 */
function cleanTagText(text, type = "title") {
  if (!text) return "";
  let result = text.replace(/\[.*?\]|\(.*?\)/g, "");
  if (type === "title") {
    result = result.replace(NOISE_WORDS, "");
  } else {
    result = result.replace(ARTIST_NOISE, "");
  }
  return result.replace(/\s+/g, " ").trim();
}

module.exports = {
  extractArtistAndTitle,
  cleanTagText,
  TITLE_SPLIT_PATTERNS,
};
