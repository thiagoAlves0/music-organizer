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

    // 1. Detecta qualquer URL de playlist (com ou sem www, com &si= ou outros parâmetros)
    const playlistListMatch = trimmed.match(/youtube\.com\/playlist\?.*list=([a-zA-Z0-9_-]+)/);
    if (playlistListMatch) {
      // Normaliza para formato canônico limpo (sem &si= e com www)
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
  static async getPlaylistInfo(source) {
    const cleanSource = this.cleanUrl(source);
    const ytdlpPath = await this.getYtdlpPath();
    const args = [
      cleanSource,
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings'
    ];

    console.log(`🔍 Obtendo metadados da fonte: ${cleanSource}`);
    const proc = spawn(ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    await new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Falha ao obter info da playlist. Código ${code}.\n${stderr}`));
        } else {
          resolve();
        }
      });
      proc.on('error', (err) => {
        reject(new Error(`Erro ao executar yt-dlp: ${err.message}`));
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
   * Baixa uma única música (ou vídeo)
   */
  static async fetch(source, outputDir, options = {}) {
    const cleanSource = this.cleanUrl(source);
    await fs.ensureDir(outputDir);

    const ytdlpPath = await this.getYtdlpPath();
    const ffmpegPath = await this.getFfmpegPath();

    // Como processamos um por um, usamos um template simples baseado no título do vídeo
    const template = path.join(outputDir, '%(title)s.%(ext)s');

    const argsFinal = [
      cleanSource,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--output', template,
      '--write-info-json',
      '--write-thumbnail',
      '--convert-thumbnails', 'jpg',
      '--print', 'after_move:filepath',
      '--print', 'after_move:infojson',
      '--print', 'after_move:thumbpath',
      '--no-playlist',       // Baixar apenas a música individual
      '--no-warnings',
      '--no-progress',
      '--restrict-filenames'
    ];

    if (ffmpegPath) {
      argsFinal.push('--ffmpeg-location', ffmpegPath);
    }

    console.log(`🎵 Baixando música: ${cleanSource}`);

    const proc = spawn(ytdlpPath, argsFinal, { stdio: ['ignore', 'pipe', 'pipe'] });
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
        if (code !== 0) {
          reject(new Error(`yt-dlp falhou com código ${code}.\nDetalhes:\n${stderr}`));
        } else {
          resolve();
        }
      });
      proc.on('error', (err) => {
        reject(new Error(`Erro ao executar yt-dlp: ${err.message}`));
      });
    });

    const lines = stdout.split('\n').filter(line => line.trim() !== '');
    const results = [];

    if (lines.length === 0) {
      throw new Error('Nenhum arquivo foi baixado.');
    }

    let mp3 = lines.find(l => l.toLowerCase().endsWith('.mp3'))?.trim();

    if (!mp3) {
      // Se não encontrou no stdout, tenta encontrar qualquer arquivo .mp3 na pasta temporária
      const files = await fs.readdir(outputDir);
      const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
      if (mp3Files.length > 0) {
        mp3 = path.join(outputDir, mp3Files[0]);
      } else {
        throw new Error('Nenhum arquivo MP3 encontrado na pasta temporária.');
      }
    }

    // 🔥 Reconstrói de forma garantida os caminhos do JSON e da Thumbnail baseado no MP3 gerado
    const mp3Parsed = path.parse(mp3);
    const jsonFile = path.join(mp3Parsed.dir, mp3Parsed.name + '.info.json');
    
    // Procura por qualquer extensão de imagem suportada correspondente ao nome do MP3
    const thumbExtensions = ['.jpg', '.jpeg', '.webp', '.png'];
    let thumb = null;
    for (const ext of thumbExtensions) {
      const checkPath = path.join(mp3Parsed.dir, mp3Parsed.name + ext);
      if (await fs.pathExists(checkPath)) {
        thumb = checkPath;
        break;
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
      metadata.title = path.basename(mp3, '.mp3');
    }

    let thumbnailPath = null;
    if (thumb && await fs.pathExists(thumb)) {
      thumbnailPath = thumb;
    } else {
      const mp3Parsed = path.parse(mp3);
      const thumbParsed = thumb ? path.parse(thumb) : mp3Parsed;
      
      const possibleThumbnails = [
        path.join(thumbParsed.dir, thumbParsed.name + '.jpg'),
        path.join(mp3Parsed.dir, mp3Parsed.name + '.jpg'),
        path.join(thumbParsed.dir, thumbParsed.name + '.jpeg'),
        path.join(mp3Parsed.dir, mp3Parsed.name + '.jpeg'),
        path.join(thumbParsed.dir, thumbParsed.name + '.webp'),
        path.join(mp3Parsed.dir, mp3Parsed.name + '.webp'),
        path.join(thumbParsed.dir, thumbParsed.name + '.png'),
        path.join(mp3Parsed.dir, mp3Parsed.name + '.png')
      ];

      for (const possible of possibleThumbnails) {
        if (await fs.pathExists(possible)) {
          thumbnailPath = possible;
          break;
        }
      }
    }

    results.push({
      filePath: mp3,
      thumbnailPath: thumbnailPath,
      metadata: metadata,
    });

    return results;
  }
}

module.exports = Downloader;