const path = require("path");
const fs = require("fs-extra");
const Tagger = require("./tagger");
const CoverDownloader = require("./cover");

class Organizer {
  static async organize(filePath, destRoot, fallbackMetadata = {}, thumbnailPath = null, customFolder = '') {
    const errors = [];
    let newPath = null;

    try {
      let tags = Tagger.readTags(filePath);

      tags.title = tags.title || fallbackMetadata.title || "";
      tags.artist = tags.artist || fallbackMetadata.artist || "";
      tags.album = tags.album || fallbackMetadata.album || "";
      tags.track = tags.track || fallbackMetadata.track || "";
      tags.year = tags.year || fallbackMetadata.year || "";
      tags.genre = tags.genre || fallbackMetadata.genre || "";

      // Extrair artista do título
      if (!tags.artist && tags.title) {
        const patterns = [
          /^(.+?)\s*[-–—]\s*(.+)$/,
          /^(.+?)\s*:\s*(.+)$/,
          /^(.+?)\s*\|\s*(.+)$/,
          /^(.+?)\s*\/\s*(.+)$/,
          /^(.+?)\s*['"](.+)['"]\s*$/,
          /^(.+?)\s*\(\s*(.+)\s*\)$/
        ];

        for (const pattern of patterns) {
          const match = tags.title.match(pattern);
          if (match && match[1] && match[2]) {
            tags.artist = match[1].trim();
            tags.title = match[2].trim();
            console.log(`🔍 Artista extraído do título: "${tags.artist}"`);
            break;
          }
        }
      }

      if (!tags.artist && fallbackMetadata.channel) {
        tags.artist = fallbackMetadata.channel;
        console.log(`🔍 Usando nome do canal como artista: "${tags.artist}"`);
      }

      // Limpar sujeiras
      if (tags.title) {
        tags.title = tags.title.replace(/\[.*?\]|\(.*?\)/g, "").replace(/(oficial|official|video|clipe|lyric|audio|hq|hd|4k)/gi, "").replace(/\s+/g, " ").trim();
      }
      if (tags.artist) {
        tags.artist = tags.artist.replace(/\[.*?\]|\(.*?\)/g, "").replace(/(topic|- topic|oficial|official|vevo)/gi, "").replace(/\s+/g, " ").trim();
      }

      // Extrair do nome do arquivo
      if (!tags.artist && filePath) {
        let baseName = path.basename(filePath, path.extname(filePath));
        baseName = baseName.replace(/_/g, ' ');
        const match = baseName.match(/^(.+?)\s*[-–]\s*(.+)$/);
        if (match && match[1] && match[2]) {
          tags.artist = match[1].trim();
          if (!tags.title) tags.title = match[2].trim();
          console.log(`🔍 Artista extraído do nome do arquivo: "${tags.artist}"`);
        }
      }

      tags.genre = tags.genre || "Diversos";
      const genre = tags.genre;
      const artist = tags.artist || "Vários Artistas";
      const album = tags.album || "";
      const title = tags.title || path.basename(filePath, path.extname(filePath));
      const playlistTitle = fallbackMetadata.playlistTitle || '';

      console.log(`🏷️ Gênero: ${genre}, 🎤 Artista: ${artist}, 🎵 Título: ${title}`);

      const safeName = (str) => str.replace(/[<>:"/\\|?*]/g, '').trim();

      let folderName;
      if (customFolder && safeName(customFolder)) {
        folderName = safeName(customFolder);
      } else if (playlistTitle && safeName(playlistTitle)) {
        folderName = safeName(playlistTitle);
      } else {
        folderName = safeName(genre) || "Diversos";
      }

      if (folderName.length > 50) {
        folderName = folderName.substring(0, 50).trim();
      }
      console.log(`📂 Pasta selecionada: "${folderName}"`);

      const destDir = path.join(destRoot, folderName);
      await fs.ensureDir(destDir);
      console.log(`📁 Pasta destino: ${destDir}`);

      // Auto-numeração por lacunas
      let trackNumber = "01";
      try {
        const files = await fs.readdir(destDir);
        const audioFiles = files.filter(f => f.match(/\.(mp3|m4a|wav|flac)$/i));

        const existingNumbers = audioFiles
          .map(f => {
            const match = f.match(/^(\d+)\s*-/);
            return match ? parseInt(match[1], 10) : null;
          })
          .filter(n => n !== null)
          .sort((a, b) => a - b);

        let nextTrack = 1;
        for (const num of existingNumbers) {
          if (num === nextTrack) {
            nextTrack++;
          } else if (num > nextTrack) {
            break;
          }
        }

        trackNumber = String(nextTrack).padStart(2, "0");
        console.log(`🔢 Auto‑numeração: faixa definida como ${trackNumber} (lacuna preenchida)`);
      } catch (e) {
        trackNumber = "01";
        console.log(`🔢 Auto‑numeração: usando 01 (pasta vazia ou erro)`);
      }

      // Buscar capa
      let coverPath = null;

      if (thumbnailPath && await fs.pathExists(thumbnailPath)) {
        console.log(`🖼️ Usando thumbnail do YouTube como capa`);
        const thumbExt = path.extname(thumbnailPath) || '.jpg';
        coverPath = path.join(destDir, `cover${thumbExt}`);
        await fs.copy(thumbnailPath, coverPath);
        console.log(`✅ Capa salva de thumbnail`);
      } else {
        if (artist !== "Vários Artistas" && title !== "Álbum Desconhecido") {
          console.log(`🔍 Buscando capa por artista + música: ${artist} - ${title}`);
          coverPath = await CoverDownloader.fetchCoverByTrack(artist, title, destDir);
        }
        if (!coverPath && artist !== "Vários Artistas" && album !== "Álbum Desconhecido") {
          console.log(`🔍 Buscando capa por artista + álbum: ${artist} - ${album}`);
          coverPath = await CoverDownloader.fetchCover(artist, album, null, destDir);
        }
      }

      if (coverPath && (await fs.pathExists(coverPath))) {
        console.log(`💿 Inserindo capa no MP3...`);
        const result = Tagger.writeCover(filePath, coverPath);
        console.log(`✅ Capa inserida: ${result}`);
      } else {
        console.log(`⚠️ Nenhuma capa disponível.`);
      }

      tags.track = trackNumber;
      console.log(`✏️ Escrevendo tags...`);
      Tagger.writeTags(filePath, tags);

      const ext = path.extname(filePath);
      const safeArtistName = artist.replace(/[<>:"/\\|?*]/g, '').trim();
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim() || "Música";
      const newFileName = `${trackNumber} - ${safeArtistName} - ${safeTitle}${ext}`;
      newPath = path.join(destDir, newFileName);
      console.log(`📄 Novo nome: ${newFileName}`);

      if (path.resolve(filePath) !== path.resolve(newPath)) {
        console.log(`🚚 Movendo para: ${newPath}`);
        await fs.move(filePath, newPath, { overwrite: true });
        console.log(`✅ Movido com sucesso.`);
      } else {
        console.log(`✅ Arquivo já está no destino.`);
      }

      if (coverPath && await fs.pathExists(coverPath)) {
        console.log(`🗑️ Apagando arquivo de capa: ${coverPath}`);
        await fs.remove(coverPath).catch(() => { });
      }

      return { success: true, newPath, errors };
    } catch (err) {
      console.error(`❌ Erro:`, err);
      errors.push(err.message);
      return { success: false, newPath, errors };
    }
  }

  static async renumberFolder(folderPath, sortBy = 'name') {
    const errors = [];
    let renamed = 0;

    try {
      const AUDIO_EXTS = /\.(mp3|m4a|wav|flac)$/i;
      const safeName = (str) => str.replace(/[<>:"/\\|?*]/g, '').trim();

      if (!await fs.pathExists(folderPath)) {
        throw new Error(`Pasta não encontrada: ${folderPath}`);
      }

      const allFiles = await fs.readdir(folderPath);
      let audioFiles = allFiles.filter(f => AUDIO_EXTS.test(f));

      if (audioFiles.length === 0) {
        return { success: true, renamed: 0, errors: ['Nenhum arquivo de áudio encontrado.'] };
      }

      console.log(`🎵 Encontrados ${audioFiles.length} arquivo(s) em: ${folderPath}`);

      // Ordenação
      if (sortBy === 'date') {
        const filesWithStats = await Promise.all(
          audioFiles.map(async (f) => {
            const stat = await fs.stat(path.join(folderPath, f));
            return { name: f, mtime: stat.mtimeMs };
          })
        );
        filesWithStats.sort((a, b) => a.mtime - b.mtime);
        audioFiles = filesWithStats.map(f => f.name);
      } else {
        audioFiles.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      }

      // Renomear para temporários (evita colisões)
      const tempPrefix = `__renumber_tmp_${Date.now()}_`;
      const tempMappings = [];

      for (let i = 0; i < audioFiles.length; i++) {
        const oldPath = path.join(folderPath, audioFiles[i]);
        const tempName = `${tempPrefix}${String(i).padStart(4, '0')}${path.extname(audioFiles[i])}`;
        const tempPath = path.join(folderPath, tempName);
        await fs.rename(oldPath, tempPath);
        tempMappings.push({ tempName, originalName: audioFiles[i] });
        console.log(`🔄 Temporário: ${audioFiles[i]} → ${tempName}`);
      }

      // Renomear definitivo
      for (let i = 0; i < tempMappings.length; i++) {
        const { tempName, originalName } = tempMappings[i];
        const tempPath = path.join(folderPath, tempName);
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext);

        // 🔥 CORREÇÃO: Remove TODOS os números iniciais consecutivos
        let cleanBase = baseName;
        let previous;
        do {
          previous = cleanBase;
          cleanBase = cleanBase.replace(/^\d+\s*[-–—._]\s*/, '');
        } while (cleanBase !== previous && /^\d+\s*[-–—._]\s*/.test(cleanBase));

        // Converte underlines para espaços
        cleanBase = cleanBase.replace(/_/g, ' ').trim();

        let artist = '';
        let title = '';

        // Tenta extrair "Artista - Título"
        const match = cleanBase.match(/^(.+?)\s*[-–—]\s*(.+)$/);
        if (match && match[1] && match[2]) {
          artist = match[1].trim();
          title = match[2].trim();
        } else {
          // Se não tem separador, usa o nome todo como título
          title = cleanBase || 'Música';
        }

        const safeArtist = safeName(artist);
        const safeTitle = safeName(title) || 'Música';
        const trackNum = String(i + 1).padStart(2, '0');

        let newFileName;
        if (safeArtist) {
          newFileName = `${trackNum} - ${safeArtist} - ${safeTitle}${ext}`;
        } else {
          newFileName = `${trackNum} - ${safeTitle}${ext}`;
        }

        const newPath = path.join(folderPath, newFileName);

        try {
          await fs.rename(tempPath, newPath);
          renamed++;
          console.log(`✅ ${originalName} → ${newFileName}`);
        } catch (renameErr) {
          errors.push(`Erro ao renomear "${originalName}": ${renameErr.message}`);
          try {
            await fs.rename(tempPath, path.join(folderPath, originalName));
          } catch (_) { }
        }
      }

      console.log(`✅ Renumerados ${renamed} arquivo(s) em: ${folderPath}`);
      return { success: errors.length === 0, renamed, errors };
    } catch (err) {
      console.error(`❌ Erro:`, err);
      errors.push(err.message);
      return { success: false, renamed, errors };
    }
  }
}

module.exports = Organizer;