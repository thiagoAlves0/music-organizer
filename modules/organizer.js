const path = require("path");
const fs = require("fs-extra");
const Tagger = require("./tagger");
const CoverDownloader = require("./cover");

class Organizer {
  /**
   * Processa um arquivo de áudio e o organiza na estrutura:
   *   destino/Artista/Álbum/01 - Música.mp3
   *
   * @param {string} filePath - caminho do arquivo original
   * @param {string} destRoot - raiz de destino (ex: pendrive)
   * @param {object} fallbackMetadata - metadados vindos de uma fonte externa (opcional)
   * @param {string|null} thumbnailPath - capa alternativa, se houver (opcional)
   * @returns {Promise<{success: boolean, newPath: string|null, errors: string[]}>}
   */
  static async organize(filePath, destRoot, fallbackMetadata = {}, thumbnailPath = null, customFolder = '') {
    const errors = [];
    let newPath = null;

    try {
      // 1. Ler tags existentes
      let tags = Tagger.readTags(filePath);

      // 2. Preencher lacunas com metadados de fallback (vindos do YouTube)
      tags.title = tags.title || fallbackMetadata.title || "";
      tags.artist = tags.artist || fallbackMetadata.artist || "";
      tags.album = tags.album || fallbackMetadata.album || "";
      tags.track = tags.track || fallbackMetadata.track || "";
      tags.year = tags.year || fallbackMetadata.year || "";
      tags.genre = tags.genre || fallbackMetadata.genre || "";

      // 3. 🔥 EXTRAIR ARTISTA DO TÍTULO (se estiver vazio)
      if (!tags.artist && tags.title) {
        // Lista de padrões comuns mais robustos
        const patterns = [
          /^(.+?)\s*[-–—]\s*(.+)$/,    // Artista - Música (incluindo travessões)
          /^(.+?)\s*:\s*(.+)$/,        // Artista: Música
          /^(.+?)\s*\|\s*(.+)$/,       // Artista | Música (pipe obrigatório)
          /^(.+?)\s*\/\s*(.+)$/,       // Artista / Música
          /^(.+?)\s*['"](.+)['"]\s*$/, // Artista "Música"
          /^(.+?)\s*\(\s*(.+)\s*\)$/   // Artista (Música)
        ];
        
        let extracted = false;
        for (const pattern of patterns) {
          const match = tags.title.match(pattern);
          if (match && match[1] && match[2]) {
            tags.artist = match[1].trim();
            tags.title = match[2].trim();
            console.log(`🔍 Artista extraído do título: "${tags.artist}"`);
            extracted = true;
            break;
          }
        }
      }

      // Se ainda não tiver artista, tenta usar o nome do canal (se disponível)
      if (!tags.artist && fallbackMetadata.channel) {
        tags.artist = fallbackMetadata.channel;
        console.log(`🔍 Usando nome do canal como artista: "${tags.artist}"`);
      }

      // 🔥 Limpar sujeiras comuns de YouTube no título e artista
      if (tags.title) {
        tags.title = tags.title.replace(/\[.*?\]|\(.*?\)/g, "").replace(/(oficial|official|video|clipe|lyric|audio|hq|hd|4k)/gi, "").replace(/\s+/g, " ").trim();
      }
      if (tags.artist) {
        tags.artist = tags.artist.replace(/\[.*?\]|\(.*?\)/g, "").replace(/(topic|- topic|oficial|official|vevo)/gi, "").replace(/\s+/g, " ").trim();
      }

      // 4. Se ainda não tiver artista, tenta extrair do nome do arquivo (último recurso)
      if (!tags.artist && filePath) {
        let baseName = path.basename(filePath, path.extname(filePath));
        baseName = baseName.replace(/_/g, ' '); // Limpa underlines gerados pelo yt-dlp
        // Se o nome do arquivo tiver formato "Artista - Música"
        const match = baseName.match(/^(.+?)\s*[-–]\s*(.+)$/);
        if (match && match[1] && match[2]) {
          tags.artist = match[1].trim();
          // Se o título ainda estiver vazio, usa a segunda parte
          if (!tags.title) tags.title = match[2].trim();
          console.log(`🔍 Artista extraído do nome do arquivo: "${tags.artist}"`);
        }
      }

      // 5. Garantir gênero/artista/álbum (com fallbacks amiguáveis)
      tags.genre = tags.genre || "Diversos";
      const genre = tags.genre;
      const artist = tags.artist || "Vários Artistas";
      const album = tags.album || "";
      const title = tags.title || path.basename(filePath, path.extname(filePath));
      const playlistTitle = tags.playlistTitle || '';

      console.log(`🏷️ Gênero: ${genre}, 🎤 Artista: ${artist}, 🎵 Título: ${title}`);

      // 6. Pasta de destino — Estrutura Plana (Ideia 1+3)
      //    Prioridade: customFolder > playlistTitle > genre
      const safeName = (str) => str.replace(/[<>:"/\\|?*]/g, '').trim();
      
      let folderName;
      if (customFolder && safeName(customFolder)) {
        folderName = safeName(customFolder);
      } else if (playlistTitle && safeName(playlistTitle)) {
        folderName = safeName(playlistTitle);
      } else {
        folderName = safeName(genre) || "Diversos";
      }

      // 🔥 Limita o tamanho do nome da pasta em no máximo 50 caracteres (evita erro de caminho muito longo no Windows)
      if (folderName.length > 50) {
        folderName = folderName.substring(0, 50).trim();
      }
      console.log(`📂 Pasta selecionada: "${folderName}"`);

      const destDir = path.join(destRoot, folderName);
      await fs.ensureDir(destDir);
      console.log(`📁 Pasta destino: ${destDir}`);

      // 6.5 🔥 Lógica de Auto-Numeração com Detecção de Lacunas (Gaps)
      if (!tags.track) {
        try {
          const files = await fs.readdir(destDir);
          const audioFiles = files.filter(f => f.match(/\.(mp3|m4a|wav|flac)$/i));

          // Extrai todos os números das faixas já organizadas
          const numbers = audioFiles
            .map(f => {
              const match = f.match(/^(\d+)\s*-/);
              return match ? parseInt(match[1], 10) : null;
            })
            .filter(n => n !== null)
            .sort((a, b) => a - b);

          // Procura pela primeira lacuna começando em 1
          let nextTrack = 1;
          for (const num of numbers) {
            if (num === nextTrack) {
              nextTrack++;
            } else if (num > nextTrack) {
              break; // Encontrou um buraco/lacuna!
            }
          }

          tags.track = String(nextTrack);
          console.log(`🔢 Auto-numeração Inteligente: Faixa definida como ${tags.track} (preenchendo lacunas)`);
        } catch (e) {
          tags.track = "1";
        }
      }

      // 7. 🔥 BUSCAR CAPA (prioriza thumbnail do YouTube, depois fontes externas)
      let coverPath = null;

      // 7a. Se tiver thumbnail do YouTube, usa como capa (mais rápido e confiável)
      if (thumbnailPath && await fs.pathExists(thumbnailPath)) {
        console.log(`🖼️ Usando thumbnail do YouTube como capa`);
        const thumbExt = path.extname(thumbnailPath) || '.jpg';
        coverPath = path.join(destDir, `cover${thumbExt}`);
        await fs.copy(thumbnailPath, coverPath);
        console.log(`✅ Capa salva de thumbnail`);
      } else {
        // 7b. Se não tem thumbnail, tenta buscar por artista + música (iTunes/Deezer)
        if (artist !== "Vários Artistas" && title !== "Álbum Desconhecido") {
          console.log(`🔍 Buscando capa por artista + música: ${artist} - ${title}`);
          coverPath = await CoverDownloader.fetchCoverByTrack(artist, title, destDir);
        }
        // 7c. Se falhou, tenta por artista + álbum
        if (!coverPath && artist !== "Vários Artistas" && album !== "Álbum Desconhecido") {
          console.log(`🔍 Buscando capa por artista + álbum: ${artist} - ${album}`);
          coverPath = await CoverDownloader.fetchCover(artist, album, null, destDir);
        }
      }

      // 8. Inserir capa no arquivo
      if (coverPath && (await fs.pathExists(coverPath))) {
        console.log(`💿 Inserindo capa no MP3...`);
        const result = Tagger.writeCover(filePath, coverPath);
        console.log(`✅ Capa inserida: ${result}`);
      } else {
        console.log(`⚠️ Nenhuma capa disponível.`);
      }

      // 9. Gravar tags corrigidas
      console.log(`✏️ Escrevendo tags...`);
      Tagger.writeTags(filePath, tags);

      // 10. Renomear: "XX - Artista - Título.ext" (artista no nome para ver no visor do carro)
      const paddedTrack = String(tags.track).padStart(2, "0");
      const ext = path.extname(filePath);
      const safeArtistName = artist.replace(/[<>:"/\\|?*]/g, '').trim();
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim() || "Música";
      const newFileName = `${paddedTrack} - ${safeArtistName} - ${safeTitle}${ext}`;
      newPath = path.join(destDir, newFileName);
      console.log(`📄 Novo nome: ${newFileName}`);

      // 11. Mover para o destino final
      if (path.resolve(filePath) !== path.resolve(newPath)) {
        console.log(`🚚 Movendo para: ${newPath}`);
        await fs.move(filePath, newPath, { overwrite: true });
        console.log(`✅ Movido com sucesso.`);
      } else {
        console.log(`✅ Arquivo já está no destino.`);
      }

      // 12. Remover arquivo temporário de capa do diretório (já está embutida no MP3)
      if (coverPath && await fs.pathExists(coverPath)) {
        console.log(`🗑️ Apagando arquivo de capa: ${coverPath}`);
        await fs.remove(coverPath).catch(() => {});
      }

      return { success: true, newPath, errors };
    } catch (err) {
      console.error(`❌ Erro:`, err);
      errors.push(err.message);
      return { success: false, newPath, errors };
    }
  }
}

module.exports = Organizer;