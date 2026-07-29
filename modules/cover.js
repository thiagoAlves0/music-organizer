const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

class CoverDownloader {
  /**
   * Busca capa por artista + música (apenas iTunes, que é rápido e estável)
   * @param {string} artist
   * @param {string} track
   * @param {string} saveDir
   * @returns {Promise<string|null>}
   */
  static async fetchCoverByTrack(artist, track, saveDir) {
    if (!artist || !track) return null;
    return await this._fetchFromITunesByTrack(artist, track, saveDir);
  }

  /**
   * Busca capa por artista + álbum (ordem: YouTube thumbnail > iTunes)
   * @param {string} artist
   * @param {string} album
   * @param {string|null} thumbnailPath - caminho da thumbnail do YouTube (já baixada)
   * @param {string} saveDir
   * @returns {Promise<string|null>}
   */
  static async fetchCover(artist, album, thumbnailPath, saveDir) {
    if (!artist || !album) {
      // Se não tem artista/álbum, tenta usar thumbnail se existir
      if (thumbnailPath && await fs.pathExists(thumbnailPath)) {
        console.log(`🖼️ Usando thumbnail do YouTube (sem artista/álbum)`);
        const thumbExt = path.extname(thumbnailPath) || '.jpg';
        const coverPath = path.join(saveDir, `cover${thumbExt}`);
        await fs.copy(thumbnailPath, coverPath);
        return coverPath;
      }
      return null;
    }

    // Fonte 1: Thumbnail do YouTube (se disponível)
    if (thumbnailPath && await fs.pathExists(thumbnailPath)) {
      console.log(`🖼️ Fonte 1: Usando thumbnail do YouTube`);
      const thumbExt = path.extname(thumbnailPath) || '.jpg';
      const coverPath = path.join(saveDir, `cover${thumbExt}`);
      await fs.copy(thumbnailPath, coverPath);
      return coverPath;
    }

    // Fonte 2: iTunes (Estável)
    console.log(`🌐 Fonte 2: Tentando iTunes (álbum)...`);
    return await this._fetchFromITunes(artist, album, saveDir);
  }

  // Limpa o texto para a busca do iTunes funcionar melhor
  static _cleanQuery(str) {
    return str
      .replace(/\[.*?\]|\(.*?\)/g, " ") // Remove tudo entre parênteses ou colchetes
      .replace(/(oficial|official|video|clipe|lyric|audio|hq|hd|4k)/gi, " ") // Remove palavras comuns de YouTube
      .replace(/\s+/g, " ")
      .trim();
  }

  // --- iTunes por música ---
  static async _fetchFromITunesByTrack(artist, track, saveDir) {
    const cleanArtist = this._cleanQuery(artist);
    const cleanTrack = this._cleanQuery(track);
    const query = `${cleanArtist} ${cleanTrack}`.trim();
    if (!query) return null;

    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
    try {
      const response = await axios.get(url, { timeout: 4000 });
      const result = response.data.results?.[0];
      if (!result) return null;
      
      let coverUrl = result.artworkUrl100?.replace("100x100", "600x600");
      if (!coverUrl) return null;
      
      const imageResponse = await axios.get(coverUrl, { responseType: "arraybuffer", timeout: 4000 });
      const coverPath = path.join(saveDir, "cover.jpg");
      await fs.writeFile(coverPath, Buffer.from(imageResponse.data));
      return coverPath;
    } catch (err) {
      console.warn("⚠️ iTunes (música) falhou ou não encontrou capa.");
      return null;
    }
  }

  // --- iTunes por álbum ---
  static async _fetchFromITunes(artist, album, saveDir) {
    const cleanArtist = this._cleanQuery(artist);
    const cleanAlbum = this._cleanQuery(album);
    const query = `${cleanArtist} ${cleanAlbum}`.trim();
    if (!query) return null;

    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=1`;
    try {
      const response = await axios.get(url, { timeout: 4000 });
      const result = response.data.results?.[0];
      if (!result) return null;
      
      let coverUrl = result.artworkUrl100?.replace("100x100", "600x600");
      if (!coverUrl) return null;
      
      const imageResponse = await axios.get(coverUrl, { responseType: "arraybuffer", timeout: 4000 });
      const coverPath = path.join(saveDir, "cover.jpg");
      await fs.writeFile(coverPath, Buffer.from(imageResponse.data));
      return coverPath;
    } catch (err) {
      console.warn("⚠️ iTunes (álbum) falhou ou não encontrou capa.");
      return null;
    }
  }
}

module.exports = CoverDownloader;