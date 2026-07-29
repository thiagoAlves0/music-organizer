const NodeID3 = require("node-id3");
const fs = require("fs");
const path = require("path");

class Tagger {
  static readTags(filePath) {
    try {
      const tags = NodeID3.read(filePath) || {};
      return {
        title: tags.title || "",
        artist: tags.artist || "",
        album: tags.album || "",
        track: tags.trackNumber || "",
        year: tags.year || "",
        genre: tags.genre || "",
      };
    } catch (err) {
      console.error("❌ Erro ao ler tags:", err);
      return {};
    }
  }

  static writeTags(filePath, tags) {
    try {
      const id3Tags = {
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        trackNumber: tags.track,
        year: tags.year,
        genre: tags.genre,
      };
      NodeID3.update(id3Tags, filePath);
      console.log('✏️ Tags escritas com sucesso.');
      return true;
    } catch (err) {
      console.error("❌ Erro ao escrever tags:", err);
      return false;
    }
  }

  static writeCover(filePath, coverPath) {
    try {
      console.log(`📖 Lendo capa de: ${coverPath}`);
      const coverBuffer = fs.readFileSync(coverPath);
      console.log(`📦 Tamanho da imagem: ${coverBuffer.length} bytes`);
      
      let mimeType = "image/jpeg";
      const ext = path.extname(coverPath).toLowerCase();
      if (ext === ".png") mimeType = "image/png";
      else if (ext === ".webp") mimeType = "image/webp";

      NodeID3.update(
        {
          image: {
            mime: mimeType,
            type: { id: 3, name: "Cover (front)" },
            imageBuffer: coverBuffer,
          },
        },
        filePath
      );
      console.log('✅ Capa inserida no MP3 com sucesso.');
      return true;
    } catch (err) {
      console.error("❌ Erro ao inserir capa:", err.message);
      return false;
    }
  }
}

module.exports = Tagger;