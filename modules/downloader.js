const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

class Downloader {
  /**
   * Detecta se a URL é de uma playlist ou de um vídeo único.
   * - Playlist: preserva a URL inteira
   * - Vídeo único dentro de playlist (watch?v=...&list=...): remove o &list para não baixar a playlist toda
   * - Vídeo simples: preserva normalmente
   */
  static cleanUrl(url) {
    const trimmed = url.trim();

    // 0. Já é uma busca ytsearch → retorna como está
    if (trimmed.startsWith('ytsearch')) {
      return trimmed;
    }

    // 1. Detecta qualquer URL de playlist (com ou sem www, com &si= ou outros parâmetros)
    const playlistListMatch = trimmed.match(/youtube\.com\/playlist\?.*list=([a-zA-Z0-9_-]+)/);
    if (playlistListMatch) {
      return `https://www.youtube.com/playlist?list=${playlistListMatch[1]}`;
    }

    // 2. Vídeo com &list= → prioriza a playlist inteira
    const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (listMatch) {
      const playlistId = listMatch[1];
      console.log(`📋 Lista detectada na URL: ${playlistId}`);
      return `https://www.youtube.com/playlist?list=${playlistId}`;
    }

    // 3. Vídeo simples: watch?v=ID ou youtu.be/ID
    const videoMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (videoMatch) {
      return `https://www.youtube.com/watch?v=${videoMatch[1]}`;
    }

    const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) {
      return `https://www.youtube.com/watch?v=${shortMatch[1]}`;
    }

    // 4. Não é URL → tratar como busca por nome no YouTube
    const isUrl = /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed) || trimmed.includes('youtube.com');
    if (!isUrl && trimmed.length > 0) {
      console.log(`🔍 Busca por nome detectada: "${trimmed}"`);
      return `ytsearch1:${trimmed}`;
    }

    return trimmed;
  }

  static isPlaylist(url) {
    return /youtube\.com\/playlist\?list=/.test(url);
  }

  static async getYtdlpPath() {
    let ytdlpPath = 'yt-dlp';
    if (process.platform === 'win32') {
      const localExe = path.join(__dirname, '..', 'yt-dlp.exe');
      if (await fs.pathExists(localExe)) {
        ytdlpPath = localExe;
      }
    } else {
      const localBin = path.join(__dirname, '..', 'yt-dlp');
      if (await fs.pathExists(localBin)) {
        ytdlpPath = localBin;
      }
    }
    return ytdlpPath;
  }

  static async getFfmpegPath() {
    let ffmpegPath = null;
    if (process.platform === 'win32') {
      const localFfmpeg = path.join(__dirname, '..', 'ffmpeg.exe');
      if (await fs.pathExists(localFfmpeg)) {
        ffmpegPath = localFfmpeg;
      }
    } else {
      const localFfmpeg = path.join(__dirname, '..', 'ffmpeg');
      if (await fs.pathExists(localFfmpeg)) {
        ffmpegPath = localFfmpeg;
      }
    }
    return ffmpegPath;
  }

  /**
   * Obtém metadados da playlist ou do vídeo de forma ultra-rápida (sem baixar os arquivos)
   */
  static async getPlaylistInfo(source, signal = null) {
    const cleanSource = this.cleanUrl(source);
    const ytdlpPath = await this.getYtdlpPath();
    const args = [
      cleanSource,
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings'
    ];

    console.log(`🔍 Obtendo metadados da fonte: ${cleanSource}`);
    const spawnOpts = { stdio: ['ignore', 'pipe', 'pipe'] };
    if (signal) spawnOpts.signal = signal;
    const proc = spawn(ytdlpPath, args, spawnOpts);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    await new Promise((resolve, reject) => {
      proc.on('close', (code, sig) => {
        if (signal && signal.aborted) {
          const err = new Error('Operação cancelada.');
          err.name = 'AbortError';
          return reject(err);
        }
        if (code !== 0) {
          reject(new Error(`Falha ao obter info da playlist. Código ${code}.\n${stderr}`));
        } else {
          resolve();
        }
      });
      proc.on('error', (err) => {
        if (err.code === 'ABORT_ERR' || (signal && signal.aborted)) {
          err.name = 'AbortError';
        }
        reject(err);
      });
    });

    try {
      const info = JSON.parse(stdout);
      if (info._type === 'playlist' && Array.isArray(info.entries)) {
        return {
          isPlaylist: true,
          title: info.title || 'Playlist',
          entries: info.entries.map((entry, idx) => ({
            url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
            title: entry.title || `Faixa ${idx + 1}`,
            index: idx + 1
          }))
        };
      } else {
        return {
          isPlaylist: false,
          title: '',
          entries: [{
            url: cleanSource,
            title: info.title || 'Música Única',
            index: 1
          }]
        };
      }
    } catch (err) {
      throw new Error(`Falha ao processar os dados da playlist: ${err.message}`);
    }
  }

  /**
   * Detecta as resoluções/formatos disponíveis para uma URL sem baixar o arquivo.
   * Para playlists, analisa apenas o primeiro vídeo como amostra.
   * Tem timeout de 8s para não travar a UI.
   *
   * @param {string} url - URL do YouTube (vídeo ou playlist)
   * @returns {Promise<{resolutions: number[], audioOnly: boolean}>}
   */
  static async getAvailableFormats(url) {
    const cleanSource = this.cleanUrl(url);
    const ytdlpPath = await this.getYtdlpPath();

    // Para playlists, amostra apenas o primeiro item
    const args = [
      cleanSource,
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--playlist-items', '1'
    ];

    console.log(`🔍 Detectando formatos disponíveis para: ${cleanSource}`);

    const proc = spawn(ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    // Race entre o processo e um timeout de 8s
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        proc.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`yt-dlp retornou código ${code}`));
          } else {
            resolve(stdout);
          }
        });
        proc.on('error', reject);
      }),
      new Promise((_, reject) =>
        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          reject(new Error('Timeout ao detectar formatos (20s)'));
        }, 20000)
      )
    ]);

    try {
      // dump-json pode retornar múltiplas linhas (uma por vídeo); pega a primeira
      const firstLine = result.trim().split('\n')[0];
      const info = JSON.parse(firstLine);

      const formats = info.formats || [];
      const resolutionSet = new Set();

      for (const f of formats) {
        if (f.height && f.height >= 144 && f.vcodec !== 'none') {
          // Normaliza para as resoluções padrão mais próximas
          const h = f.height;
          if (h >= 2000) resolutionSet.add(2160);
          else if (h >= 1350) resolutionSet.add(1440);
          else if (h >= 900)  resolutionSet.add(1080);
          else if (h >= 600)  resolutionSet.add(720);
          else if (h >= 400)  resolutionSet.add(480);
          else if (h >= 250)  resolutionSet.add(360);
          else                resolutionSet.add(240);
        }
      }

      const resolutions = [...resolutionSet].sort((a, b) => b - a);
      return { resolutions, title: info.title || null, playlistCount: null };
    } catch (e) {
      throw new Error(`Falha ao processar formatos: ${e.message}`);
    }
  }

  /**
   * Baixa uma única música (ou vídeo)
   */
  static async fetch(source, outputDir, options = {}, signal = null) {
    const cleanSource = this.cleanUrl(source);
    await fs.ensureDir(outputDir);

    const ytdlpPath = await this.getYtdlpPath();
    const ffmpegPath = await this.getFfmpegPath();

    const template = path.join(outputDir, '%(title)s.%(ext)s');

    const downloadOpts = options.downloadOpts || { format: 'mp3', quality: '320' };
    const format = downloadOpts.format || 'mp3';
    const quality = downloadOpts.quality || (format === 'mp3' ? '320' : '1080');

    const argsFinal = [
      cleanSource,
      '--output', template,
      '--write-info-json',
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--restrict-filenames'
    ];

    if (format === 'mp3') {
      // Mapeia bitrate para VBR do yt-dlp: 0 = melhor qualidade, 9 = pior
      const vbrMap = { '320': '0', '256': '3', '128': '7' };
      const vbrQuality = vbrMap[quality] || '0';
      argsFinal.push(
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', vbrQuality,
        '--write-thumbnail',
        '--convert-thumbnails', 'jpg',
        '--print', 'after_move:filepath',
        '--print', 'after_move:infojson',
        '--print', 'after_move:thumbpath'
      );
    } else {
      // MP4 Video
      const formatStr = `bestvideo[height<=?${quality}]+bestaudio/best[height<=?${quality}]/best`;
      argsFinal.push(
        '--format', formatStr,
        '--merge-output-format', 'mp4',
        '--print', 'after_move:filepath',
        '--print', 'after_move:infojson'
      );
    }

    if (ffmpegPath) {
      argsFinal.push('--ffmpeg-location', ffmpegPath);
    }

    console.log(`🎵 Baixando em formato ${format.toUpperCase()} (${quality}): ${cleanSource}`);

    const spawnOpts = { stdio: ['ignore', 'pipe', 'pipe'] };
    if (signal) spawnOpts.signal = signal;
    const proc = spawn(ytdlpPath, argsFinal, spawnOpts);
    let stdout = '';
    let stderr = '';

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      stderr += line;
      if (line.includes('[download]') || line.includes('[ExtractAudio]')) {
        process.stdout.write(line);
      }
    });

    proc.stdout.on('data', (data) => { stdout += data.toString(); });

    await new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (signal && signal.aborted) {
          const err = new Error('Operação cancelada.');
          err.name = 'AbortError';
          return reject(err);
        }
        if (code !== 0) {
          reject(new Error(`yt-dlp falhou com código ${code}.\nDetalhes:\n${stderr}`));
        } else {
          resolve();
        }
      });
      proc.on('error', (err) => {
        if (err.code === 'ABORT_ERR' || (signal && signal.aborted)) {
          err.name = 'AbortError';
        }
        reject(err);
      });
    });

    const lines = stdout.split('\n').filter(line => line.trim() !== '');
    const results = [];

    if (lines.length === 0) {
      throw new Error('Nenhum arquivo foi baixado.');
    }

    let downloadedFile = lines.find(l => l.toLowerCase().endsWith(`.${format}`))?.trim();

    if (!downloadedFile) {
      // Se não encontrou no stdout, tenta encontrar qualquer arquivo com a extensão correspondente na pasta temporária
      const files = await fs.readdir(outputDir);
      const matchedFiles = files.filter(f => f.toLowerCase().endsWith(`.${format}`));
      if (matchedFiles.length > 0) {
        downloadedFile = path.join(outputDir, matchedFiles[0]);
      } else {
        throw new Error(`Nenhum arquivo ${format.toUpperCase()} encontrado na pasta temporária.`);
      }
    }

    // 🔥 Reconstrói de forma garantida os caminhos do JSON e da Thumbnail baseado no arquivo gerado
    const fileParsed = path.parse(downloadedFile);
    const jsonFile = path.join(fileParsed.dir, fileParsed.name + '.info.json');
    
    let thumb = null;
    if (format === 'mp3') {
      // Procura por qualquer extensão de imagem suportada correspondente ao nome do MP3
      const thumbExtensions = ['.jpg', '.jpeg', '.webp', '.png'];
      for (const ext of thumbExtensions) {
        const checkPath = path.join(fileParsed.dir, fileParsed.name + ext);
        if (await fs.pathExists(checkPath)) {
          thumb = checkPath;
          break;
        }
      }
    }

    let metadata = {};
    let channelName = '';
    if (jsonFile && await fs.pathExists(jsonFile)) {
      try {
        const raw = await fs.readFile(jsonFile, 'utf-8');
        const info = JSON.parse(raw);
        channelName = info.uploader || info.channel || '';
        metadata = {
          title: info.title || '',
          artist: info.artist || '',
          album: info.album || options.playlistTitle || '',
          track: info.track_number || options.playlistIndex || '',
          year: info.release_year || (info.upload_date ? info.upload_date.slice(0, 4) : ''),
          genre: info.genre || '',
          channel: channelName,
          thumbnailUrl: info.thumbnail || '',
          playlistTitle: options.playlistTitle || '',
        };
      } catch (e) {
        console.warn('Falha ao ler JSON:', e.message);
      }
      await fs.remove(jsonFile).catch(() => { });
    }

    if (!metadata.title) {
      metadata.title = path.basename(downloadedFile, `.${format}`);
    }

    let thumbnailPath = null;
    if (format === 'mp3') {
      if (thumb && await fs.pathExists(thumb)) {
        thumbnailPath = thumb;
      } else {
        const thumbParsed = thumb ? path.parse(thumb) : fileParsed;
        
        const possibleThumbnails = [
          path.join(thumbParsed.dir, thumbParsed.name + '.jpg'),
          path.join(fileParsed.dir, fileParsed.name + '.jpg'),
          path.join(thumbParsed.dir, thumbParsed.name + '.jpeg'),
          path.join(fileParsed.dir, fileParsed.name + '.jpeg'),
          path.join(thumbParsed.dir, thumbParsed.name + '.webp'),
          path.join(fileParsed.dir, fileParsed.name + '.webp'),
          path.join(thumbParsed.dir, thumbParsed.name + '.png'),
          path.join(fileParsed.dir, fileParsed.name + '.png')
        ];

        for (const possible of possibleThumbnails) {
          if (await fs.pathExists(possible)) {
            thumbnailPath = possible;
            break;
          }
        }
      }
    }

    results.push({
      filePath: downloadedFile,
      thumbnailPath: thumbnailPath,
      metadata: metadata,
    });

    return results;
  }

  static extractArtistAndTitle(title) {
    // Remove sujeiras comuns (parênteses, colchetes, palavras-chave)
    const clean = title
      .replace(/\[.*?\]|\(.*?\)/g, "")
      .replace(/(oficial|official|video|clipe|lyric|audio|hq|hd|4k|remaster|remix|ao vivo|live|dvd|vol|parte)/gi, "")
      .trim();
    
    // Tenta extrair "Artista - Música"
    const match = clean.match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (match && match[1] && match[2]) {
      return { 
        artist: match[1].trim().replace(/\s+/g, ' '), 
        track: match[2].trim().replace(/\s+/g, ' ')
      };
    }
    
    // Se não encontrar, usa o título inteiro como música
    return { artist: "", track: clean };
  }
}

module.exports = Downloader;