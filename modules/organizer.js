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
   * @param {string} customFolder - nome personalizado de pasta (opcional)
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
      tags.track = tags.track || fallbackMetadata.track || ""; // (não será usado para numeração)
      tags.year = tags.year || fallbackMetadata.year || "";
      tags.genre = tags.genre || fallbackMetadata.genre || "";

      // 3. 🔥 EXTRAIR ARTISTA DO TÍTULO (se estiver vazio)
      if (!tags.artist && tags.title) {
        const patterns = [
          /^(.+?)\s*[-–—]\s*(.+)$/,    // Artista - Música
          /^(.+?)\s*:\s*(.+)$/,        // Artista: Música
          /^(.+?)\s*\|\s*(.+)$/,       // Artista | Música
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
        baseName = baseName.replace(/_/g, ' ');
        const match = baseName.match(/^(.+?)\s*[-–]\s*(.+)$/);
        if (match && match[1] && match[2]) {
          tags.artist = match[1].trim();
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
      const playlistTitle = fallbackMetadata.playlistTitle || '';

      console.log(`🏷️ Gênero: ${genre}, 🎤 Artista: ${artist}, 🎵 Título: ${title}`);

      // 6. Pasta de destino — Estrutura Plana
      const safeName = (str) => str.replace(/[<>:"/\\|?*]/g, '').trim();

      let folderName;
      if (customFolder && safeName(customFolder)) {
        folderName = safeName(customFolder);
      } else if (playlistTitle && safeName(playlistTitle)) {
        folderName = safeName(playlistTitle);
      } else {
        folderName = safeName(genre) || "Diversos";
      }

      // Limita o tamanho do nome da pasta em no máximo 50 caracteres
      if (folderName.length > 50) {
        folderName = folderName.substring(0, 50).trim();
      }
      console.log(`📂 Pasta selecionada: "${folderName}"`);

      const destDir = path.join(destRoot, folderName);
      await fs.ensureDir(destDir);
      console.log(`📁 Pasta destino: ${destDir}`);

      // ============================================================
      // 🔥 AUTO‑NUMERAÇÃO INTELIGENTE (SEMPRE POR LACUNAS)
      // ============================================================
      // Ignora totalmente o número vindo do YouTube (fallbackMetadata.track).
      // Calcula o próximo número baseado nos arquivos já existentes na pasta.
      let trackNumber = "01";
      try {
        const files = await fs.readdir(destDir);
        const audioFiles = files.filter(f => f.match(/\.(mp3|m4a|wav|flac)$/i));

        // Extrai todos os números das faixas já organizadas
        const existingNumbers = audioFiles
          .map(f => {
            const match = f.match(/^(\d+)\s*-/);
            return match ? parseInt(match[1], 10) : null;
          })
          .filter(n => n !== null)
          .sort((a, b) => a - b);

        // Procura pela primeira lacuna começando em 1
        let nextTrack = 1;
        for (const num of existingNumbers) {
          if (num === nextTrack) {
            nextTrack++;
          } else if (num > nextTrack) {
            break; // Encontrou uma lacuna!
          }
        }

        trackNumber = String(nextTrack).padStart(2, "0");
        console.log(`🔢 Auto‑numeração: faixa definida como ${trackNumber} (lacuna preenchida)`);
      } catch (e) {
        // Se der erro (ex: pasta não existe), usa 01
        trackNumber = "01";
        console.log(`🔢 Auto‑numeração: usando 01 (pasta vazia ou erro)`);
      }

      // ============================================================
      // 7. 🔥 BUSCAR CAPA (prioriza thumbnail do YouTube, depois externas)
      // ============================================================
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

      // 8. Inserir capa no arquivo
      if (coverPath && (await fs.pathExists(coverPath))) {
        console.log(`💿 Inserindo capa no MP3...`);
        const result = Tagger.writeCover(filePath, coverPath);
        console.log(`✅ Capa inserida: ${result}`);
      } else {
        console.log(`⚠️ Nenhuma capa disponível.`);
      }

      // 9. Gravar tags corrigidas (atualizando o número da faixa com o valor calculado)
      tags.track = trackNumber; // sobrescreve com o número da lacuna
      console.log(`✏️ Escrevendo tags...`);
      Tagger.writeTags(filePath, tags);

      // 10. Renomear: "XX - Artista - Título.ext"
      const ext = path.extname(filePath);
      const safeArtistName = artist.replace(/[<>:"/\\|?*]/g, '').trim();
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim() || "Música";
      const newFileName = `${trackNumber} - ${safeArtistName} - ${safeTitle}${ext}`;
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

      // 12. Remover arquivo temporário de capa do diretório
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

  /**
   * Renumera todos os arquivos de áudio de uma pasta, corrigindo
   * duplicatas e lacunas na numeração. Não move arquivos para subpastas.
   *
   * @param {string} folderPath - caminho da pasta a renumerar
   * @param {'name'|'date'} sortBy - critério de ordenação ('name' ou 'date')
   * @returns {Promise<{success: boolean, renamed: number, errors: string[]}>}
   */
  static async renumberFolder(folderPath, sortBy = 'name') {
    const errors = [];
    let renamed = 0;

    try {
      const AUDIO_EXTS = /\.(mp3|m4a|wav|flac)$/i;
      const safeName = (str) => str.replace(/[<>:"/\\|?*]/g, '').trim();

      // 1. Listar apenas arquivos de áudio
      const allFiles = await fs.readdir(folderPath);
      let audioFiles = allFiles.filter(f => AUDIO_EXTS.test(f));

      if (audioFiles.length === 0) {
        return { success: true, renamed: 0, errors: ['Nenhum arquivo de áudio encontrado na pasta.'] };
      }

      // 2. Ordenar
      if (sortBy === 'date') {
        // Ordenar por data de modificação (mais antigo primeiro)
        const filesWithStats = await Promise.all(
          audioFiles.map(async (f) => {
            const stat = await fs.stat(path.join(folderPath, f));
            return { name: f, mtime: stat.mtimeMs };
          })
        );
        filesWithStats.sort((a, b) => a.mtime - b.mtime);
        audioFiles = filesWithStats.map(f => f.name);
      } else {
        // Ordenar por nome (alfabético, case-insensitive)
        audioFiles.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      }

      // 3. Primeira passagem: renomear para nomes temporários para evitar colisões
      const tempPrefix = `__renumber_tmp_${Date.now()}_`;
      const tempNames = [];

      for (let i = 0; i < audioFiles.length; i++) {
        const oldPath = path.join(folderPath, audioFiles[i]);
        const tempName = `${tempPrefix}${i}${path.extname(audioFiles[i])}`;
        const tempPath = path.join(folderPath, tempName);
        await fs.rename(oldPath, tempPath);
        tempNames.push({ tempName, originalName: audioFiles[i] });
      }

      // 4. Segunda passagem: renomear do temporário para o nome final sequencial
      for (let i = 0; i < tempNames.length; i++) {
        const { tempName, originalName } = tempNames[i];
        const tempPath = path.join(folderPath, tempName);
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext);

        // Extrair artista e título do nome antigo
        let artist = '';
        let title = '';

        // Padrão: "XX - Artista - Título" (com número no início)
        const matchNumbered = baseName.match(/^\d+\s*[-–—]\s*(.+?)\s*[-–—]\s*(.+)$/);
        // Padrão: "Artista - Título" (sem número)
        const matchSimple = baseName.match(/^(.+?)\s*[-–—]\s*(.+)$/);

        if (matchNumbered && matchNumbered[1] && matchNumbered[2]) {
          artist = matchNumbered[1].trim();
          title = matchNumbered[2].trim();
        } else if (matchSimple && matchSimple[1] && matchSimple[2]) {
          artist = matchSimple[1].trim();
          title = matchSimple[2].trim();
        } else {
          // Sem separador — usa o nome inteiro como título
          artist = '';
          title = baseName.replace(/^\d+\s*[-–—]?\s*/, '').trim() || baseName;
        }

        // Montar novo nome
        const trackNum = String(i + 1).padStart(2, '0');
        const safeArtist = safeName(artist);
        const safeTitle = safeName(title) || 'Música';

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
          console.log(`🔢 ${originalName} → ${newFileName}`);
        } catch (renameErr) {
          errors.push(`Erro ao renomear "${originalName}": ${renameErr.message}`);
          // Tentar restaurar o nome original
          try {
            await fs.rename(tempPath, path.join(folderPath, originalName));
          } catch (_) { /* silencioso */ }
        }
      }

      return { success: errors.length === 0, renamed, errors };
    } catch (err) {
      console.error('❌ Erro na renumeração:', err);
      errors.push(err.message);
      return { success: false, renamed, errors };
    }
  }
}

module.exports = Organizer;