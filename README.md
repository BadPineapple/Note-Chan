# Note-Chan

Widget de notas, listas e eventos que fica ancorado no canto da tela — leve, sempre visível e **100% local**: nenhum dado sai da sua máquina, não existe conta, login ou sincronização com servidor nenhum.

Feito com [Electron](https://www.electronjs.org/) puro (sem framework de UI) para Windows.

## Índice

- [Funcionalidades](#funcionalidades)
- [Instalação](#instalação)
- [Uso](#uso)
- [Onde ficam os seus dados](#onde-ficam-os-seus-dados)
- [Desenvolvimento](#desenvolvimento)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Licença](#licença)

## Funcionalidades

### Widget

- Fica ancorado no canto inferior esquerdo da tela, sempre visível por cima das outras janelas.
- Modo bandeja: recolhe pra só a barra de título, clique expande de novo.
- Atalho global pra mostrar/ocultar (`Ctrl+Alt+N` por padrão) e captura rápida de nota de qualquer lugar do Windows (`Ctrl+Alt+Q` por padrão) — ambos configuráveis.
- Arrastar um arquivo pra cima do widget cria uma nota com o conteúdo dele (texto lido direto; outros formatos viram um atalho pro caminho do arquivo).
- Navegação completa por teclado: setas para mover entre cards, `Enter` abre/fecha, `Delete` exclui (com confirmação em dois toques), `Esc` recolhe.
- Busca por título entre os cards da aba atual — clique na lupa ou `Ctrl+F`, ignora acentuação.

### Notas, Listas e Eventos

Três abas, cada uma com seus próprios cards, arrastáveis para reordenar:

- **Notas** — texto livre, com prévia recolhida e editor expandido.
- **Listas** — itens com checkbox, reordenáveis, "Enter" continua a lista igual Notion/Todoist.
- **Eventos** — data, recorrência (diária/semanal/mensal/anual), horário de início/fim opcional, link, checklist próprio, e alarme sonoro que toca na hora marcada (sintetizado via Web Audio, sem depender de arquivo de áudio externo).

Cada nota/lista/evento pode receber **tags** coloridas (gerenciadas em Configurações), exibidas como pills no card.

### Aniversariantes

Aba dedicada dentro de Configurações: nome, data e categoria (família/amigo/trabalho), com indicador de quantos dias faltam e idade que a pessoa vai fazer.

### Configurações

- 5 temas prontos: Dourado, Kuromi, Hello Kitty, Cinnamoroll e Gudetama.
- Transparência do widget ajustável.
- Alarme de eventos: ligar/desligar, volume e escolha de som (4 opções sintetizadas).
- Atalhos globais reconfiguráveis (gravados clicando e pressionando a combinação desejada).

## Instalação

### Baixando o instalador

Pegue o `Note-Chan-Setup-<versão>.exe` mais recente e rode — o instalador NSIS deixa escolher a pasta de instalação e cria atalhos no Menu Iniciar e na Área de Trabalho. Não precisa de privilégio de administrador.

### Compilando você mesmo

Pré-requisitos: [Node.js](https://nodejs.org/) (LTS) e npm.

```bash
npm install
npm run dist
```

O instalador é gerado em `dist/Note-Chan-Setup-<versão>.exe`.

## Uso

| Atalho | Ação |
|---|---|
| `Ctrl+Alt+N` (padrão) | Mostrar/ocultar o widget |
| `Ctrl+Alt+Q` (padrão) | Captura rápida de nota (de qualquer app) |
| `Ctrl+F` | Abrir a busca por card |
| `←` / `→` | Trocar de aba |
| `↑` / `↓` | Navegar entre os cards |
| `Enter` | Abrir/fechar o card selecionado |
| `Delete` | Excluir o card selecionado (2º toque confirma) |
| `Esc` | Fechar a busca; se já fechada, recolhe o widget |

Os atalhos globais (`Ctrl+Alt+N` e `Ctrl+Alt+Q`) podem ser trocados em Configurações → Geral.

O ícone da bandeja do sistema também dá acesso rápido a: abrir o widget, captura rápida, criar nota/lista/evento/aniversariante direto, Configurações e Sair.

## Onde ficam os seus dados

Tudo fica em `data.json` dentro da pasta de dados do usuário do Windows (`%APPDATA%/NoteChan`), sem nenhuma chamada de rede. A cada gravação:

- Uma cópia do estado anterior é mantida (`data.json.bak`) como rede de segurança contra uma escrita corrompida.
- Um snapshot datado é salvo em `backups/` uma vez por dia, mantendo os últimos 14 dias.

Logs de execução ficam em `logs/runtime.log` (rotacionado a cada 2 MB), úteis pra diagnosticar problemas sem precisar abrir o DevTools.

## Desenvolvimento

```bash
npm install
npm start        # roda o app em modo desenvolvimento (DevTools abre junto)
npm run dist      # gera o instalador Windows em dist/
```

Não há framework de build nem bundler — os arquivos em `src/html` e `src/js` são servidos como estão pelo Electron.

### Ícone do app

`assets/img/icon.png` (1024×1024) é gerado a partir de `scripts/icon-source.html` — um SVG renderizado num `BrowserWindow` do Electron e salvo em disco. Pra ajustar o mascote, edite o SVG e rode:

```bash
npx electron scripts/generate-icon.js
```

O electron-builder converte esse PNG pro `.ico` do instalador automaticamente (exige no mínimo 256×256 de origem).

## Arquitetura

- **Processo principal** (`src/js/Main.js`) — dono das janelas, da bandeja do sistema, dos atalhos globais, do alarme de eventos e da persistência (`DataManager.js`). Nenhuma janela do renderer tem acesso a Node.js (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`).
- **Renderer** (`src/js/preload.js` + `Widget.js`, `Settings.js`, `QuickCapture.js`, `Alarm.js`) — cada janela HTML fala com o processo principal só através de um `window.api` restrito, exposto via `contextBridge` com uma lista fechada de canais IPC permitidos.
- **Janelas**: widget (notas/listas/eventos), Configurações, captura rápida e o popup de alarme — cada uma é um `BrowserWindow` isolado.

## Stack

- [Electron](https://www.electronjs.org/) — runtime desktop
- JavaScript puro no front-end (sem React/Vue/framework nenhum) e CSS com variáveis para os temas
- [electron-builder](https://www.electron.build/) — empacotamento e instalador NSIS

## Licença

MIT — veja [LICENSE](LICENSE).
