# Auto Music Organizer — Relatório de Status e Handoff (Antigravity)
**Versão Atual:** 0.3.0
**Data:** 29/07/2026

Este documento contém o estado atualizado do projeto, detalhando a arquitetura, as funcionalidades implementadas recentemente e os próximos passos. Ele foi estruturado para fornecer contexto completo para o Antigravity IDE continuar o desenvolvimento.

---

## 1. Visão Geral do Projeto
**Tecnologia:** Electron + Node.js (JavaScript puro, sem frameworks front-end)
**Propósito:** Automatizar o download, conversão, organização e inserção de metadados (tags ID3 e capas) de músicas do YouTube, deixando-as prontas para pendrives (foco em centrais multimídia como VW Play).

## 2. Estrutura do Projeto
```text
music-organizer/
├── main.js                    # Processo principal (Electron IPC, controle de estado, loop principal)
├── preload.js                 # Bridge segura entre main e renderer
├── renderer.js                # Lógica da interface (Manipulação do DOM, envio de IPC)
├── index.html                 # Interface visual (HTML estruturado em cards)
├── style.css                  # Estilos (Design premium, tema escuro, Inter font)
├── yt-dlp.exe                 # Binário de download
├── ffmpeg.exe                 # Binário de conversão
└── modules/
    ├── downloader.js          # Wrapper do yt-dlp (download, metadados, suporte a ytsearch1:)
    ├── organizer.js           # Renomeação, pastas planas, numeração de faixas e ID3 tags
    ├── tagger.js              # Manipulação de tags ID3 (node-id3)
    ├── cover.js               # Download de capas (Thumbnail > iTunes > Deezer)
    └── logger.js              # Utilitário de logging para terminal e interface
```

---

## 3. Últimas Funcionalidades Implementadas (Recentemente)

### A. Perfil de Usuário (Configurações Salvas)
- O aplicativo agora utiliza `localStorage` no processo do *renderer* para salvar e carregar automaticamente a última **Pasta de Destino** e o **Nome da Playlist**.
- Isso evita que o usuário precise reconfigurar o app a cada sessão.

### B. Refinamento Visual (Design Premium)
- Interface modernizada com tema escuro (`#111113`, `#1a1a1f`).
- Uso da fonte **Inter** (Google Fonts).
- Elementos estruturados em "Cards" com bordas arredondadas, sombras suaves e *badges* de status (ex: para indicar pasta conectada).
- Logs com cores (verde para sucesso, vermelho para erro) diretamente na interface.

### C. Busca de Músicas por Nome em Lote (Lote/ytsearch)
- O campo de "Fonte externa" foi convertido para um `<textarea>`.
- O usuário pode colar URLs misturadas com nomes de músicas, uma por linha.
- O `main.js` divide as quebras de linha (`\n`) e processa cada uma separadamente.
- O `downloader.js` foi atualizado para detectar automaticamente se a linha é uma URL ou uma busca. Se for busca, prefixa com `ytsearch1:` para o `yt-dlp` baixar o primeiro resultado correspondente.

### D. Sistema de Controle (Pausar, Retomar e Cancelar)
Foi implementado um controle robusto de fluxo utilizando recursos nativos do Node.js:
- **Interface**: Adicionados botões "⏸ Pausar" e "✕ Cancelar", que só ficam visíveis enquanto um processo está em andamento (`showProcessControls` / `hideProcessControls`).
- **Main.js**: Implementado o objeto `processState` com `isPaused`, `isCancelled` e `AbortController`. O loop principal aguarda um `checkPause()` entre cada música.
- **Downloader**: A função de *spawn* do `child_process` agora aceita a opção `signal` do `AbortController`. Quando o usuário clica em Cancelar, o processo do `yt-dlp` ou `ffmpeg` em andamento é morto imediatamente (`AbortError`), interrompendo o fluxo instantaneamente.

---

## 4. Funcionalidades Base (Já Existentes)
- **Pastas Planas**: Evita subpastas profundas, limitando o nome da pasta a 50 caracteres para evitar erros do Windows.
- **Auto-numeração Inteligente**: Lê os arquivos da pasta e preenche lacunas numéricas (ex: se existe 01, 02 e 04, a próxima será 03).
- **Tratamento de Rate Limit (403)**: O `main.js` faz retry com recuo exponencial (espera 8s, 16s, etc.) quando o YouTube bloqueia temporariamente.
- **Limpeza**: Deleta MP3 temporário, JSON e cover.jpg após o processamento.
- **Capas (Covers)**: Tenta usar a thumbnail do vídeo, fazendo fallback para as APIs do iTunes ou Deezer.

---

## 5. Próximos Passos (Roadmap Pendente)

Os próximos itens a serem desenvolvidos, conforme as prioridades do projeto:

1. **Seleção de Formato (MP3 vs MP4) [Alta Prioridade]**
   - **Objetivo**: Permitir baixar vídeos além de áudio.
   - **O que fazer**: Adicionar um dropdown/radio button no `index.html`. Adaptar o `downloader.js` para baixar `mp4` quando selecionado (removendo as flags de `--extract-audio`). Atualizar o `organizer.js` para pular a escrita de tags ID3 se o arquivo for de vídeo.

2. **Geração de Playlist por IA [Média Prioridade]**
   - **Objetivo**: O usuário digita "Clássicos do rock 80s" e a IA (Gemini/OpenAI) gera uma lista de músicas que é automaticamente enviada para a busca em lote (`ytsearch1:`).
   - **O que fazer**: Adicionar campo para chave de API e interface de chat/prompt.

3. **Arquivo .m3u para o Carro [Média Prioridade]**
   - **Objetivo**: Gerar uma lista de reprodução `.m3u` na pasta raiz do pendrive para facilitar a navegação no sistema do carro.
