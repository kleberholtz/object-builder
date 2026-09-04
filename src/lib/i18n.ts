import { useCallback } from "react";
import { useSettingsStore, type Language } from "../stores/settings-store";

export type Locale = "en" | "pt";

/**
 * Entries are keyed by the English source text, so a missing translation degrades to the
 * original sentence instead of showing a key. Placeholders are `{name}` and are filled by
 * `translate`; the English source is the one place a phrase is written for both languages.
 */
const pt: Record<string, string> = {
  // Common actions and words
  Save: "Salvar",
  Cancel: "Cancelar",
  Close: "Fechar",
  Done: "Concluído",
  Apply: "Aplicar",
  "Applying…": "Aplicando…",
  Open: "Abrir",
  Edit: "Editar",
  Copy: "Copiar",
  Paste: "Colar",
  Delete: "Excluir",
  Duplicate: "Duplicar",
  Remove: "Remover",
  Reset: "Redefinir",
  Undo: "Desfazer",
  Redo: "Refazer",
  Back: "Voltar",
  "Browse…": "Procurar…",
  Import: "Importar",
  Export: "Exportar",
  Optimize: "Otimizar",
  All: "Todos",
  Any: "Qualquer",
  Yes: "Sim",
  No: "Não",
  Auto: "Automático",
  Fit: "Ajustar",
  Manual: "Manual",
  Modified: "Modificado",
  "Last used": "Último usado",
  "Last selected": "Último selecionado",
  Idle: "Parado",
  Moving: "Movendo",
  Minimized: "Minimizado",
  Maximized: "Maximizado",
  North: "Norte",
  East: "Leste",
  South: "Sul",
  West: "Oeste",
  Head: "Cabeça",
  Body: "Corpo",
  Legs: "Pernas",
  Feet: "Pés",
  "Saving…": "Salvando…",
  "Cancelling…": "Cancelando…",
  object: "objeto",
  objects: "objetos",
  frame: "frame",
  frames: "frames",
  sprite: "sprite",
  sprites: "sprites",

  // Object categories and animation modes (the stored value stays English; only the label changes)
  Item: "Item",
  Outfit: "Outfit",
  Effect: "Efeito",
  Missile: "Projétil",
  Items: "Itens",
  Outfits: "Outfits",
  Effects: "Efeitos",
  Missiles: "Projéteis",
  Asynchronous: "Assíncrona",
  Synchronous: "Síncrona",
  Random: "Aleatória",

  // Menu bar
  "Application menu": "Menu do aplicativo",
  File: "Arquivo",
  View: "Exibir",
  Objects: "Objetos",
  Sprites: "Sprites",
  Tools: "Ferramentas",
  Settings: "Configurações",
  Help: "Ajuda",
  "Open client…": "Abrir cliente…",
  "Open recent": "Abrir recente",
  "No recent projects": "Nenhum projeto recente",
  "Import file…": "Importar arquivo…",
  "Save as…": "Salvar como…",
  "Quick save": "Salvamento rápido",
  "Import OBD…": "Importar OBD…",
  "Export object…": "Exportar objeto…",
  "Select all": "Selecionar tudo",
  "Pixel grid": "Grade de pixels",
  "Duplicate selected object": "Duplicar objeto selecionado",
  "Delete selection": "Excluir seleção",
  "View all sprites…": "Ver todos os sprites…",
  "Import PNG…": "Importar PNG…",
  "Import spritesheet…": "Importar spritesheet…",
  "Export selected frame…": "Exportar frame selecionado…",
  "Export all frames…": "Exportar todos os frames…",
  "Export complete object…": "Exportar objeto completo…",
  "Export spritesheet…": "Exportar spritesheet…",
  "Validate project": "Validar projeto",
  "Optimize project…": "Otimizar projeto…",
  "Application Settings…": "Configurações do aplicativo…",
  "Keyboard Shortcuts…": "Atalhos de teclado…",
  "About Object Builder": "Sobre o Object Builder",
  "Client {version}": "Cliente {version}",
  "Minimize window": "Minimizar janela",
  "Maximize window": "Maximizar janela",
  "Maximize or restore window": "Maximizar ou restaurar janela",
  "Close window": "Fechar janela",

  // Toolbar
  "Open Client": "Abrir cliente",
  "Configures and loads an existing DAT and SPR client.":
    "Configura e carrega um cliente DAT e SPR existente.",
  "Save Client": "Salvar cliente",
  "Writes the active DAT/SPR/OTFI files safely in the background.":
    "Grava os arquivos DAT/SPR/OTFI ativos com segurança em segundo plano.",
  "Restores the object state before the latest edit.":
    "Restaura o estado do objeto anterior à última edição.",
  "Reapplies the most recently undone object edit.":
    "Reaplica a edição de objeto desfeita mais recentemente.",
  Select: "Selecionar",
  "Selects objects and frames for inspection or editing.":
    "Seleciona objetos e frames para inspeção ou edição.",
  "Pixel Grid": "Grade de pixels",
  "Displays a grid over the current object for pixel-level inspection.":
    "Exibe uma grade sobre o objeto atual para inspeção pixel a pixel.",
  "Displays a grid over the object for pixel-level inspection.":
    "Exibe uma grade sobre o objeto para inspeção pixel a pixel.",
  "Zoom Out": "Reduzir zoom",
  "Decreases the scale relative to auto-fit.":
    "Diminui a escala em relação ao ajuste automático.",
  "Zoom In": "Aumentar zoom",
  "Increases the scale relative to auto-fit.":
    "Aumenta a escala em relação ao ajuste automático.",
  "Reset View": "Redefinir visualização",
  "Fits and recenters the current object, discarding any panning.":
    "Ajusta e recentraliza o objeto atual, descartando qualquer deslocamento.",
  "View All Sprites": "Ver todos os sprites",
  "Opens paginated sprite statistics and the indexed object usage graph.":
    "Abre as estatísticas paginadas de sprites e o grafo indexado de uso por objeto.",
  "Imports DAT/SPR, JSON, OBD, PNG or a spritesheet.":
    "Importa DAT/SPR, JSON, OBD, PNG ou um spritesheet.",
  "Export Object": "Exportar objeto",
  "Exports the selected object as lossless OBD, rendered PNG or spritesheet.":
    "Exporta o objeto selecionado como OBD sem perdas, PNG renderizado ou spritesheet.",
  "Optimize Project": "Otimizar projeto",
  "Analyzes unused, missing and duplicate sprites, then offers only confirmed safe cleanup.":
    "Analisa sprites não usados, ausentes e duplicados e oferece apenas a limpeza segura confirmada.",

  // Status bar
  Ready: "Pronto",
  "No DAT": "Sem DAT",
  "No SPR": "Sem SPR",
  "{count} objects": "{count} objetos",
  "{count} sprites": "{count} sprites",
  "{count} selected": "{count} selecionados",
  "Sprite cache in use / capacity": "Cache de sprites em uso / capacidade",
  "Cache {value}": "Cache {value}",
  "Memory used by the application": "Memória usada pelo aplicativo",

  // Log panel
  ALL: "TODOS",
  ERROR: "ERRO",
  WARNING: "AVISO",
  INFO: "INFO",
  SPRITE: "SPRITE",
  Logs: "Logs",
  "Collapse logs": "Recolher logs",
  "Expand logs": "Expandir logs",
  "Shows or hides the application event log.":
    "Mostra ou oculta o log de eventos do aplicativo.",
  "{count} events": "{count} eventos",
  "{count} errors": "{count} erros",
  "Search logs…": "Pesquisar nos logs…",
  "Log level": "Nível do log",
  "Auto-follow logs": "Acompanhar logs automaticamente",
  "Keeps the newest matching event visible as logs arrive.":
    "Mantém visível o evento mais recente que corresponde ao filtro conforme os logs chegam.",
  "Toggle automatic log following":
    "Alternar o acompanhamento automático dos logs",
  "Copy logs": "Copiar logs",
  "Copies the currently filtered log entries and details.":
    "Copia as entradas de log filtradas e seus detalhes.",
  "Copy filtered logs": "Copiar logs filtrados",
  "Clear logs": "Limpar logs",
  "Clears retained UI log entries without affecting project data.":
    "Limpa as entradas de log da interface sem afetar os dados do projeto.",
  Time: "Hora",
  Level: "Nível",
  Message: "Mensagem",
  Source: "Origem",
  "No log entries match the current filters.":
    "Nenhuma entrada de log corresponde aos filtros atuais.",
  "Unable to copy logs": "Não foi possível copiar os logs",

  // App shell notices
  "Replace the current unsaved workspace with another client?":
    "Substituir a área de trabalho não salva atual por outro cliente?",
  "Replace the current unsaved workspace with this recent project? Unsaved changes will be lost.":
    "Substituir a área de trabalho não salva atual por este projeto recente? As alterações não salvas serão perdidas.",
  "Replace the current unsaved workspace with the imported project/client?":
    "Substituir a área de trabalho não salva atual pelo projeto/cliente importado?",
  "Saving projects requires the Tauri desktop application":
    "Salvar projetos requer o aplicativo desktop Tauri",
  "Import requires the Tauri desktop application":
    "Importar requer o aplicativo desktop Tauri",
  "Pasting objects requires the Tauri desktop application":
    "Colar objetos requer o aplicativo desktop Tauri",
  "Validation requires the Tauri desktop application":
    "A validação requer o aplicativo desktop Tauri",
  "Apply the pending object/frame order before saving DAT/SPR":
    "Aplique a ordem pendente de objetos/frames antes de salvar DAT/SPR",
  "Save Client DAT/SPR": "Salvar DAT/SPR do cliente",
  "Client DAT/SPR pair": "Par DAT/SPR do cliente",
  "Save Project JSON": "Salvar JSON do projeto",
  "Object Builder JSON": "JSON do Object Builder",
  "Save Object Builder project": "Salvar projeto do Object Builder",
  "Preparing changes": "Preparando alterações",
  "Client DAT/SPR saved successfully": "DAT/SPR do cliente salvo com sucesso",
  "Project JSON saved successfully": "JSON do projeto salvo com sucesso",
  "Unable to save project: {details}":
    "Não foi possível salvar o projeto: {details}",
  "Opening recent project": "Abrindo projeto recente",
  "Checking project location": "Verificando o local do projeto",
  "Recent project is unavailable: {path}":
    "Projeto recente indisponível: {path}",
  "Reading project manifest": "Lendo o manifesto do projeto",
  "This recent client is missing its load configuration":
    "Este cliente recente está sem a configuração de carregamento",
  "Preparing workspace": "Preparando a área de trabalho",
  "Opened {name}": "{name} aberto",
  "Opening {name}": "Abrindo {name}",
  "Unable to open recent project: {details}":
    "Não foi possível abrir o projeto recente: {details}",
  "Unable to close application: {details}":
    "Não foi possível fechar o aplicativo: {details}",
  "Select an object first": "Selecione um objeto primeiro",
  "Object Builder Object": "Objeto do Object Builder",
  "Import Object": "Importar objeto",
  "Imported {kind} #{id}": "{kind} #{id} importado",
  "Unable to import object: {details}":
    "Não foi possível importar o objeto: {details}",
  "Export Object as OBD": "Exportar objeto como OBD",
  "Object exported with its referenced sprites":
    "Objeto exportado com os sprites referenciados",
  "Unable to export object: {details}":
    "Não foi possível exportar o objeto: {details}",
  "Export selected frame": "Exportar frame selecionado",
  "Export spritesheet": "Exportar spritesheet",
  "PNG image": "Imagem PNG",
  "PNG exported": "PNG exportado",
  "Unable to export PNG: {details}":
    "Não foi possível exportar o PNG: {details}",
  "Import spritesheet": "Importar spritesheet",
  "Replace selected frame": "Substituir o frame selecionado",
  "Spritesheet imported": "Spritesheet importado",
  "Frame replaced from PNG": "Frame substituído a partir do PNG",
  "Unable to import PNG: {details}":
    "Não foi possível importar o PNG: {details}",
  "Import DAT/SPR, JSON, OBD or PNG": "Importar DAT/SPR, JSON, OBD ou PNG",
  "Supported files": "Arquivos suportados",
  "Client files": "Arquivos do cliente",
  "Project JSON imported": "JSON do projeto importado",
  "Unable to import JSON: {details}":
    "Não foi possível importar o JSON: {details}",
  "Unsupported import format": "Formato de importação não suportado",
  "{kind} #{id} copied": "{kind} #{id} copiado",
  "Copy an object before pasting": "Copie um objeto antes de colar",
  "Created {kind} #{id}": "{kind} #{id} criado",
  "Unable to paste object: {details}":
    "Não foi possível colar o objeto: {details}",
  "Delete {count} selected object?": "Excluir {count} objeto selecionado?",
  "Delete {count} selected objects?": "Excluir {count} objetos selecionados?",
  "{count} object deleted; apply order before saving DAT/SPR":
    "{count} objeto excluído; aplique a ordem antes de salvar DAT/SPR",
  "{count} objects deleted; apply order before saving DAT/SPR":
    "{count} objetos excluídos; aplique a ordem antes de salvar DAT/SPR",
  "Unable to delete selection: {details}":
    "Não foi possível excluir a seleção: {details}",
  "Validated {objects} objects and {sprites} sprite references":
    "{objects} objetos e {sprites} referências de sprite validados",
  "Validation found {count} issues: {first}":
    "A validação encontrou {count} problemas: {first}",
  "Unable to validate project: {details}":
    "Não foi possível validar o projeto: {details}",
  "Unable to open referenced object: {details}":
    "Não foi possível abrir o objeto referenciado: {details}",
  "Rust core could not initialize: {details}":
    "O núcleo Rust não pôde inicializar: {details}",

  // Object browser
  "Object type": "Tipo de objeto",
  "Object filters": "Filtros de objeto",
  "Object filters, {count} active": "Filtros de objeto, {count} ativos",
  "Clear all": "Limpar tudo",
  Animated: "Animado",
  "Has light": "Tem luz",
  "Multiple tiles": "Múltiplos tiles",
  "Name, #ID, spr:ID…": "Nome, #ID, spr:ID…",
  "Combine terms such as type:item animated filters or spr:120":
    "Combine termos como type:item, filtros de animação ou spr:120",
  "Clear search": "Limpar pesquisa",
  "Object ordering": "Ordenação de objetos",
  "ID ↑": "ID ↑",
  "ID ↓": "ID ↓",
  Heaviest: "Mais pesados",
  Lightest: "Mais leves",
  "Name ↑": "Nome ↑",
  "Name ↓": "Nome ↓",
  "Sprite ↑": "Sprite ↑",
  "Sprite ↓": "Sprite ↓",
  "Apply order": "Aplicar ordem",
  "Commits pending object/frame order and normalizes identifiers.":
    "Confirma a ordem pendente de objetos/frames e normaliza os identificadores.",
  "No pending object or frame order changes.":
    "Nenhuma alteração pendente de ordem de objetos ou frames.",
  "No pending frame order changes.": "Nenhuma alteração pendente de ordem de frames.",
  Object: "Objeto",
  Info: "Info",
  "Drag to reorder. The orange line shows the insertion point.":
    "Arraste para reordenar. A linha laranja mostra o ponto de inserção.",
  "Animated · {count} frames": "Animado · {count} frames",
  "{bytes} bytes in SPR storage (unique compressed sprites and index entries)":
    "{bytes} bytes de armazenamento no SPR (sprites comprimidos únicos e entradas de índice)",
  "No objects match the current filters":
    "Nenhum objeto corresponde aos filtros atuais",
  "Export OBD…": "Exportar OBD…",
  "Export PNG…": "Exportar PNG…",
  "Unable to load object page": "Não foi possível carregar a página de objetos",
  "Page {page}": "Página {page}",
  "Moved {kind} #{id} to position {position}":
    "{kind} #{id} movido para a posição {position}",
  "Manual object order is pending application":
    "A ordem manual de objetos está pendente de aplicação",
  "Unable to reorder objects": "Não foi possível reordenar os objetos",
  "Duplicated {kind} #{id} as #{newId}": "{kind} #{id} duplicado como #{newId}",
  "Unable to duplicate {kind} #{id}": "Não foi possível duplicar {kind} #{id}",
  "Delete {kind} #{id}?": "Excluir {kind} #{id}?",
  "Deleted {kind} #{id}": "{kind} #{id} excluído",
  "Object IDs are pending application":
    "Os IDs dos objetos estão pendentes de aplicação",
  "Unable to delete {kind} #{id}": "Não foi possível excluir {kind} #{id}",
  "Export Object as PNG": "Exportar objeto como PNG",
  "Export Object as Spritesheet": "Exportar objeto como spritesheet",
  "Exported {kind} #{id}": "{kind} #{id} exportado",
  "Unable to export {kind} #{id}": "Não foi possível exportar {kind} #{id}",
  "Exported {kind} #{id} as PNG": "{kind} #{id} exportado como PNG",
  "Exported {kind} #{id} as spritesheet":
    "{kind} #{id} exportado como spritesheet",
  "Unable to export {kind} #{id} as PNG":
    "Não foi possível exportar {kind} #{id} como PNG",
  "Order applied: {objects} object IDs and {frames} frame IDs normalized":
    "Ordem aplicada: {objects} IDs de objeto e {frames} IDs de frame normalizados",
  "Ready to save DAT/SPR": "Pronto para salvar DAT/SPR",
  "Unable to apply object order":
    "Não foi possível aplicar a ordem dos objetos",
  "Unable to update {kind} #{id}": "Não foi possível atualizar {kind} #{id}",
  // Change history
  "Change history": "Histórico de alterações",
  "Change history…": "Histórico de alterações…",
  "Every recorded edit of this session. Select a step to travel to it.":
    "Todas as edições registradas nesta sessão. Selecione um passo para voltar até ele.",
  "Lists every recorded edit and travels back to any of them.":
    "Lista todas as edições registradas e volta para qualquer uma delas.",
  "Travels back to any recorded edit": "Volta para qualquer edição registrada",
  "{count} steps": "{count} passos",
  "{count} undone": "{count} desfeitos",
  "Opening state": "Estado inicial",
  "Before the first recorded edit of this session.":
    "Antes da primeira edição registrada desta sessão.",
  "Drops the recorded steps and keeps the project exactly as it is now. The edits themselves are not reverted.":
    "Descarta os passos registrados e mantém o projeto exatamente como está. As edições não são revertidas.",
  "Edited object": "Objeto editado",
  "Painted frame {index}": "Pintou o frame {index}",
  "Changed {field}": "Alterou {field}",
  "Enabled {flag}": "Ativou {flag}",
  "Disabled {flag}": "Desativou {flag}",
  "Added attribute": "Adicionou atributo",
  "Removed attribute": "Removeu atributo",
  "Undo failed in the Rust core": "Falha ao desfazer no núcleo Rust",
  "Redo failed in the Rust core": "Falha ao refazer no núcleo Rust",

  // Inspector
  Inspector: "Inspetor",
  "Expand Inspector": "Expandir inspetor",
  "Restores object properties beside the Canvas.":
    "Restaura as propriedades do objeto ao lado do canvas.",
  "Collapse Inspector": "Recolher inspetor",
  "Releases horizontal space for the Canvas.":
    "Libera espaço horizontal para o canvas.",
  "No object selected": "Nenhum objeto selecionado",
  "Select an object in the browser to inspect and edit its properties.":
    "Selecione um objeto no navegador para inspecionar e editar suas propriedades.",
  "Editing {count} selected objects": "Editando {count} objetos selecionados",
  Server: "Servidor",
  Flags: "Flags",
  General: "Geral",
  ID: "ID",
  locked: "bloqueado",
  Type: "Tipo",
  Name: "Nome",
  "Sprite ID": "ID do sprite",
  "View referenced sprites": "Ver sprites referenciados",
  "Outfit colors": "Cores do outfit",
  "Preview only": "Apenas pré-visualização",
  "{part} preview color": "Cor de pré-visualização: {part}",
  "Randomize preview": "Sortear pré-visualização",
  "Chooses four random preview colors without changing or saving the outfit sprites.":
    "Escolhe quatro cores aleatórias de pré-visualização sem alterar ou salvar os sprites do outfit.",
  Randomize: "Sortear",
  "Reset preview": "Redefinir pré-visualização",
  "Restores the neutral preview palette for this outfit.":
    "Restaura a paleta neutra de pré-visualização deste outfit.",
  "These colors affect previews only. DAT and SPR data are not changed.":
    "Estas cores afetam apenas a pré-visualização. Os dados de DAT e SPR não são alterados.",
  Dimensions: "Dimensões",
  Width: "Largura",
  Height: "Altura",
  Layers: "Camadas",
  layers: "camadas",
  "Pattern X": "Padrão X",
  "Pattern Y": "Padrão Y",
  "Pattern Z": "Padrão Z",
  Directions: "Direções",
  Addons: "Addons",
  Mounts: "Montarias",
  Animation: "Animação",
  Frames: "Frames",
  FPS: "FPS",
  "Total animation duration in milliseconds":
    "Duração total da animação em milissegundos",
  "Frames per second": "Frames por segundo",
  "Frames of this group have different durations, so FPS is the average. Editing FPS or Duration gives every frame the same duration.":
    "Os frames deste grupo têm durações diferentes, então o FPS é a média. Editar FPS ou Duração dá a mesma duração a todos os frames.",
  Mode: "Modo",
  "Animation mode": "Modo de animação",
  Loop: "Repetir",
  Position: "Posição",
  "X offset": "Deslocamento X",
  "Y offset": "Deslocamento Y",
  Elevation: "Elevação",
  Lighting: "Iluminação",
  "Lighting & Minimap": "Iluminação e minimapa",
  "Light level": "Nível de luz",
  "Light color": "Cor da luz",
  Minimap: "Minimapa",
  "Minimap color": "Cor no minimapa",
  "Ground speed": "Velocidade do solo",
  "Server attributes": "Atributos do servidor",
  "{count} entries": "{count} entradas",
  Attribute: "Atributo",
  Value: "Valor",
  "Add attribute": "Adicionar atributo",
  "Not offered here": "Não oferecidos aqui",
  "{count} carried": "{count} presentes",
  "These attributes are on the object but not part of what {kind} carry in client {version}. They can be cleared, not added.":
    "Estes atributos estão no objeto, mas não fazem parte do que {kind} carregam no cliente {version}. Podem ser removidos, não adicionados.",
  "This attribute is not in the DAT attribute table; saving the DAT will refuse it.":
    "Este atributo não está na tabela de atributos do DAT; salvar o DAT o recusará.",
  "This name is not in the DAT attribute table; saving the DAT would refuse it.":
    "Este nome não está na tabela de atributos do DAT; salvar o DAT o recusaria.",
  "The client does not read this attribute for {kind}.":
    "O cliente não lê este atributo para {kind}.",
  "Client {version} has no attribute byte for this flag; saving the DAT would refuse it.":
    "O cliente {version} não tem byte de atributo para esta flag; salvar o DAT a recusaria.",
  ignored: "ignorado",
  client: "cliente",
  unknown: "desconhecido",

  // Flag groups and descriptions
  "Stacking order": "Ordem de empilhamento",
  "Movement & blocking": "Movimento e bloqueio",
  "Use & contents": "Uso e conteúdo",
  "Appearance & light": "Aparência e luz",
  "Tile ground; carries the walking speed edited under Lighting & Minimap.":
    "Solo do tile; carrega a velocidade de caminhada editada em Iluminação e minimapa.",
  "Drawn over the ground and under every other item on the tile.":
    "Desenhado sobre o solo e abaixo de todos os outros itens do tile.",
  "Stacks below creatures, such as a doormat or a stair.":
    "Empilha abaixo das criaturas, como um capacho ou uma escada.",
  "Stacks above creatures, such as a roof or a treetop.":
    "Empilha acima das criaturas, como um telhado ou a copa de uma árvore.",
  "Covers the whole tile, so the ground under it is not drawn.":
    "Cobre o tile inteiro, então o solo sob ele não é desenhado.",
  "Blocks creatures from stepping onto the tile.":
    "Impede que criaturas pisem no tile.",
  "Cannot be pushed or dragged; clears the derived Moveable flag.":
    "Não pode ser empurrado ou arrastado; limpa a flag derivada Moveable.",
  "Stops missiles from crossing the tile.":
    "Impede que projéteis atravessem o tile.",
  "Excluded from automatic pathfinding.":
    "Excluído do cálculo automático de caminho.",
  "Can be taken into a container or the inventory.":
    "Pode ser guardado em um container ou no inventário.",
  "Can be hung on a wall.": "Pode ser pendurado em uma parede.",
  "Hangs on the southern wall of the tile.": "Pendura na parede sul do tile.",
  "Hangs on the eastern wall of the tile.": "Pendura na parede leste do tile.",
  "Can be turned in place by the client.":
    "Pode ser girado no lugar pelo cliente.",
  "Moves the player to another floor when stepped on.":
    "Leva o jogador para outro andar ao ser pisado.",
  "Opens as a container window.": "Abre como uma janela de container.",
  "Piles up to a count instead of taking one slot each.":
    "Empilha em uma quantidade em vez de ocupar um slot para cada unidade.",
  "Left click uses the object instead of walking to it.":
    "O clique esquerdo usa o objeto em vez de caminhar até ele.",
  "Use asks for a second target.": "O uso pede um segundo alvo.",
  "Text can be written and rewritten; carries the maximum length.":
    "O texto pode ser escrito e reescrito; carrega o comprimento máximo.",
  "Text can be written a single time; carries the maximum length.":
    "O texto pode ser escrito uma única vez; carrega o comprimento máximo.",
  "Holds a fluid, drawn by the fluid's pattern.":
    "Contém um fluido, desenhado pelo padrão do fluido.",
  "A puddle on the ground, drawn by the fluid's pattern.":
    "Uma poça no chão, desenhada pelo padrão do fluido.",
  "Offers Use in the context menu; carries the client action id.":
    "Oferece Usar no menu de contexto; carrega o id de ação do cliente.",
  "Equipment; carries the inventory slot it occupies.":
    "Equipamento; carrega o slot de inventário que ocupa.",
  "Tradable on the market; carries the entry edited on the Server tab.":
    "Negociável no mercado; carrega a entrada editada na aba Servidor.",
  "Can be wrapped into a parcel by house decoration.":
    "Pode ser embrulhado em um pacote pela decoração da casa.",
  "Is a wrapped object that can be unwrapped again.":
    "É um objeto embrulhado que pode ser desembrulhado novamente.",
  "Shows remaining charges instead of a count.":
    "Mostra as cargas restantes em vez de uma quantidade.",
  "Shows a help cursor; carries the help id.":
    "Mostra um cursor de ajuda; carrega o id da ajuda.",
  "Emits light; carries the level and color edited under Lighting & Minimap.":
    "Emite luz; carrega o nível e a cor editados em Iluminação e minimapa.",
  "Drawn off the tile; carries the X and Y offsets edited under Position.":
    "Desenhado fora do tile; carrega os deslocamentos X e Y editados em Posição.",
  "Lifts what is stacked on top; carries the height edited under Position.":
    "Eleva o que está empilhado em cima; carrega a altura editada em Posição.",
  "Paints the tile on the minimap; carries the color index.":
    "Pinta o tile no minimapa; carrega o índice da cor.",
  "Stays visible under an object that would otherwise cover it.":
    "Continua visível sob um objeto que normalmente o cobriria.",
  "Drawn semi-transparent when the player stands behind it.":
    "Desenhado semitransparente quando o jogador está atrás dele.",
  "Drawn flat on the ground, like a corpse.":
    "Desenhado deitado no chão, como um cadáver.",
  "Look targets what is under it instead of the object itself.":
    "O examinar mira no que está embaixo em vez do próprio objeto.",
  "Animates even while off screen or not moving.":
    "Anima mesmo fora da tela ou parado.",
  "Keeps the idle frame while the creature carrying it moves.":
    "Mantém o frame parado enquanto a criatura que o carrega se move.",
  "Drawn above everything else on the tile.":
    "Desenhado acima de tudo o mais no tile.",

  // Canvas
  "Select an object in the browser to open it on the Canvas.":
    "Selecione um objeto no navegador para abri-lo no canvas.",
  "Frame group": "Grupo de frames",
  "Scales the object down around the canvas centre.":
    "Reduz o objeto em torno do centro do canvas.",
  "Scales the object up around the canvas centre.":
    "Amplia o objeto em torno do centro do canvas.",
  "Fit to Canvas": "Ajustar ao canvas",
  "Scales the object so it fills the work area with margin, and recentres it.":
    "Ajusta o objeto para preencher a área de trabalho com margem e o recentraliza.",
  "Actual Size": "Tamanho real",
  "Renders one sprite pixel per screen pixel.":
    "Renderiza um pixel de sprite por pixel da tela.",
  "Restores the default zoom and recentres the object.":
    "Restaura o zoom padrão e recentraliza o objeto.",
  "Canvas view options": "Opções de visualização do canvas",
  Overlays: "Sobreposições",
  "Tile grid ({size}px)": "Grade de tiles ({size}px)",
  "Object bounds": "Limites do objeto",
  "Centre axes": "Eixos centrais",
  "Badges and coordinates": "Selos e coordenadas",
  "Direction arrows": "Setas de direção",
  Rendering: "Renderização",
  "Smooth scaling": "Escalonamento suavizado",
  Background: "Fundo",
  "Fit to canvas": "Ajustar ao canvas",
  "Actual size (1:1)": "Tamanho real (1:1)",
  "Centre object": "Centralizar objeto",
  "Reset view": "Redefinir visualização",
  "Object {width}×{height}": "Objeto {width}×{height}",
  "Single direction": "Direção única",
  "Direction {index}": "Direção {index}",
  Direction: "Direção",
  "Previous direction": "Direção anterior",
  "Rotates the outfit preview to the previous available direction.":
    "Gira a pré-visualização do outfit para a direção anterior disponível.",
  "Previous outfit direction": "Direção anterior do outfit",
  "Next direction": "Próxima direção",
  "Rotates the outfit preview to the next available direction.":
    "Gira a pré-visualização do outfit para a próxima direção disponível.",
  "Next outfit direction": "Próxima direção do outfit",
  "Show body": "Mostrar corpo",
  "Composes the selected addon over the outfit body. Uncheck to inspect only the addon.":
    "Compõe o addon selecionado sobre o corpo do outfit. Desmarque para inspecionar apenas o addon.",
  "No addons": "Sem addons",
  "Addon {index}": "Addon {index}",
  "All addons": "Todos os addons",
  "Outfit addons": "Addons do outfit",
  "Face {direction}": "Virar para {direction}",
  "Draws the outfit facing {direction}. The object stays in place — only the pattern changes.":
    "Desenha o outfit virado para {direction}. O objeto permanece no lugar — apenas o padrão muda.",
  north: "o norte",
  east: "o leste",
  south: "o sul",
  west: "o oeste",
  "Scroll or pinch to zoom": "Rolar ou pinçar para dar zoom",
  "Drag or Ctrl + scroll to move the camera":
    "Arraste ou Ctrl + rolar para mover a câmera",
  Smooth: "Suavizado",
  "Nearest-neighbor": "Vizinho mais próximo",
  Checkerboard: "Xadrez",
  "Solid dark": "Escuro sólido",
  "Solid light": "Claro sólido",
  Magenta: "Magenta",

  // Film roll
  "Film roll": "Rolo de filme",
  "Expand Film Roll": "Expandir rolo de filme",
  "Collapse Film Roll": "Recolher rolo de filme",
  "Releases vertical space for the Canvas.":
    "Libera espaço vertical para o canvas.",
  "Apply frame order": "Aplicar ordem dos frames",
  "Commits the current visual order and recreates continuous frame identifiers. This starts a new Undo/Redo history.":
    "Confirma a ordem visual atual e recria identificadores de frame contínuos. Isso inicia um novo histórico de desfazer/refazer.",
  "Play animation": "Reproduzir animação",
  "Pause animation": "Pausar animação",
  "Previews frames using each frame's configured duration and the playback speed from Settings.":
    "Pré-visualiza os frames usando a duração configurada de cada um e a velocidade de reprodução das Configurações.",
  "Duplicate frame": "Duplicar frame",
  "Copies the selected frame metadata and complete sprite layout.":
    "Copia os metadados do frame selecionado e todo o layout de sprites.",
  "Delete selected frames": "Excluir frames selecionados",
  "Removes selected frames and their matching sprite-layout phases.":
    "Remove os frames selecionados e as fases de layout de sprites correspondentes.",
  "Drag this preview to reorder the frame":
    "Arraste esta pré-visualização para reordenar o frame",
  "Add frame": "Adicionar frame",
  "Copies the final frame layout into a new frame using the configured default duration.":
    "Copia o layout do último frame para um novo frame usando a duração padrão configurada.",
  "Animation timeline": "Linha do tempo da animação",
  "Each frame occupies the share of the track its duration represents. Click or drag to move the playhead.":
    "Cada frame ocupa a fatia da trilha que sua duração representa. Clique ou arraste para mover o cursor de reprodução.",
  "Apply duration": "Aplicar duração",
  Duration: "Duração",
  "Duration in milliseconds": "Duração em milissegundos",
  "Duration scope": "Escopo da duração",
  "Current frame": "Frame atual",
  "Selected frames ({count})": "Frames selecionados ({count})",
  "All frames ({count})": "Todos os frames ({count})",
  "Edit duration": "Editar duração",
  "Frame duration in milliseconds. Arrow keys change by 10 ms; hold Shift for 100 ms.":
    "Duração do frame em milissegundos. As setas alteram de 10 em 10 ms; segure Shift para 100 ms.",
  "Frame {index} duration in milliseconds":
    "Duração do frame {index} em milissegundos",
  "Moved frame {from} to {to}": "Frame {from} movido para {to}",
  "Frame duration must be between 1 and 60,000 ms":
    "A duração do frame deve estar entre 1 e 60.000 ms",
  "Frame {index}": "Frame {index}",
  "Select at least one frame before applying duration":
    "Selecione ao menos um frame antes de aplicar a duração",
  "Applied {duration} ms to {count} frame":
    "{duration} ms aplicados a {count} frame",
  "Applied {duration} ms to {count} frames":
    "{duration} ms aplicados a {count} frames",
  "Duplicated frame {index}": "Frame {index} duplicado",
  "Deleted {count} frame": "{count} frame excluído",
  "Deleted {count} frames": "{count} frames excluídos",
  "Frame order applied": "Ordem dos frames aplicada",
  "{kind} #{id} · Ready to save": "{kind} #{id} · Pronto para salvar",
  "Unable to apply frame order": "Não foi possível aplicar a ordem dos frames",
  "Copied frame {index}": "Frame {index} copiado",
  "Unable to copy frame to the system clipboard":
    "Não foi possível copiar o frame para a área de transferência do sistema",

  // Sprite manager
  "Sprite Manager": "Gerenciador de sprites",
  "Sprites referenced by {kind} #{id}":
    "Sprites referenciados por {kind} #{id}",
  "Indexed sprite usage across the complete loaded client.":
    "Uso indexado de sprites em todo o cliente carregado.",
  Total: "Total",
  "In use": "Em uso",
  Unused: "Não usados",
  "Objects using sprites": "Objetos que usam sprites",
  "Shared sprites": "Sprites compartilhados",
  "Invalid refs": "Refs inválidas",
  "Search Sprite ID…": "Pesquisar ID de sprite…",
  "Sprite usage filter": "Filtro de uso de sprites",
  "All sprites": "Todos os sprites",
  Used: "Usados",
  "Used once": "Usados uma vez",
  "Used multiple times": "Usados várias vezes",
  Preview: "Pré-visualização",
  "Objects using": "Objetos que usam",
  "No sprites match the current filter.":
    "Nenhum sprite corresponde ao filtro atual.",
  "Select a sprite to view the objects that reference it.":
    "Selecione um sprite para ver os objetos que o referenciam.",
  "Sprite {id}": "Sprite {id}",
  "Used by {count} objects": "Usado por {count} objetos",
  "This sprite is not referenced by any object.":
    "Este sprite não é referenciado por nenhum objeto.",
  "Usage is indexed in Rust and is not recalculated during React renders.":
    "O uso é indexado em Rust e não é recalculado durante as renderizações do React.",
  "Optimize…": "Otimizar…",
  "Unable to load Sprite Manager":
    "Não foi possível carregar o gerenciador de sprites",
  "Unable to inspect sprite {id}": "Não foi possível inspecionar o sprite {id}",

  // Launcher
  "Native OTClient object and sprite editor":
    "Editor nativo de objetos e sprites do OTClient",
  "Recent Projects": "Projetos recentes",
  "Clear history": "Limpar histórico",
  "Remove {name} from recent projects": "Remover {name} dos projetos recentes",
  "Project unavailable": "Projeto indisponível",
  "The project path no longer exists.": "O caminho do projeto não existe mais.",
  "Locate Project": "Localizar projeto",
  "Locate project": "Localizar projeto",
  "Locate client directory": "Localizar o diretório do cliente",
  "Object Builder Project": "Projeto do Object Builder",
  "Create Project": "Criar projeto",
  "Creating…": "Criando…",
  "Start an empty workspace on disk":
    "Comece uma área de trabalho vazia no disco",
  "Load existing DAT and SPR assets": "Carregue arquivos DAT e SPR existentes",
  "Supports client versions 7.40–15.25":
    "Compatível com as versões de cliente 7.40–15.25",
  "Create an empty Object Builder workspace on disk.":
    "Cria uma área de trabalho vazia do Object Builder no disco.",
  "Project name": "Nome do projeto",
  Location: "Local",
  "Choose project directory": "Escolha o diretório do projeto",
  "Client version": "Versão do cliente",
  "/path/to/client": "/caminho/para/o/cliente",
  "Configure the client before parsing its DAT and SPR files.":
    "Configure o cliente antes de interpretar seus arquivos DAT e SPR.",
  "Client directory": "Diretório do cliente",
  "Choose OTClient data directory": "Escolha o diretório de dados do OTClient",
  Version: "Versão",
  "Client version preset": "Predefinição de versão do cliente",
  "Exact client version": "Versão exata do cliente",
  Automatic: "Automático",
  "Custom version": "Versão personalizada",
  "Choose the client directory to detect the version.":
    "Escolha o diretório do cliente para detectar a versão.",
  "Reading the DAT layout…": "Lendo o formato do DAT…",
  "Detecting version…": "Detectando versão…",
  "Read from the OTFI configuration": "Lida da configuração OTFI",
  "Read from the DAT layout": "Lida do formato do DAT",
  "Read from the DAT layout, with format options":
    "Lida do formato do DAT, com opções de formato",
  "No supported layout reads this DAT. Pick the version by hand.":
    "Nenhum formato compatível lê este DAT. Escolha a versão manualmente.",
  "Set by hand. Pick Automatic to read it from the files.":
    "Definida manualmente. Escolha Automático para lê-la dos arquivos.",
  "{count} items": "{count} itens",
  "Client type": "Tipo de cliente",
  "CipSoft client": "Cliente CipSoft",
  "Custom client": "Cliente personalizado",
  "DAT file": "Arquivo DAT",
  "SPR file": "Arquivo SPR",
  "OTFI file": "Arquivo OTFI",
  "Show format options": "Mostrar opções de formato",
  "Hide format options": "Ocultar opções de formato",
  "Read OTFI configuration": "Ler configuração OTFI",
  "Validate complete SPR index": "Validar o índice SPR completo",
  "32-bit sprite IDs": "IDs de sprite de 32 bits",
  "Sprite alpha channel": "Canal alfa dos sprites",
  "Frame durations": "Durações dos frames",
  "Frame groups": "Grupos de frames",
  "Opening client": "Abrindo cliente",
  "Unable to open client": "Não foi possível abrir o cliente",
  Operation: "Operação",
  Reason: "Motivo",
  "How to fix": "Como corrigir",

  // Save / export dialogs
  "Save As": "Salvar como",
  "Choose the output format before selecting its destination.":
    "Escolha o formato de saída antes de selecionar o destino.",
  "Client DAT/SPR": "DAT/SPR do cliente",
  "Writes a version-aware DAT, SPR archive and matching OTFI file.":
    "Grava um DAT compatível com a versão, o arquivo SPR e o OTFI correspondente.",
  "Load a client SPR source first.":
    "Carregue antes uma origem SPR de cliente.",
  "Project JSON": "JSON do projeto",
  "Stores the editable workspace and imported sprite overrides.":
    "Armazena a área de trabalho editável e os sprites importados que sobrescrevem os originais.",
  "Select an object before exporting.":
    "Selecione um objeto antes de exportar.",
  "Lossless object metadata, layouts, frames and referenced sprites.":
    "Metadados, layouts, frames e sprites referenciados do objeto, sem perdas.",
  "Rendered image of the currently selected frame.":
    "Imagem renderizada do frame selecionado.",
  Spritesheet: "Spritesheet",
  "Rendered sheet containing all supported frames and patterns.":
    "Folha renderizada contendo todos os frames e padrões suportados.",
  "Save failed": "Falha ao salvar",
  "Save completed successfully": "Salvamento concluído com sucesso",
  "Saving Client DAT/SPR": "Salvando DAT/SPR do cliente",
  "Saving Project JSON": "Salvando JSON do projeto",
  "The save operation has finished.": "A operação de salvamento terminou.",
  "Please wait while the files are written safely in the background.":
    "Aguarde enquanto os arquivos são gravados com segurança em segundo plano.",
  "Unable to write the project": "Não foi possível gravar o projeto",
  "Sprite overrides": "Sprites sobrescritos",
  Stage: "Etapa",
  Written: "Gravado",
  Elapsed: "Tempo",
  Volumes: "Volumes",
  "{count} × up to {size} MB": "{count} × até {size} MB",
  "{size} MB each": "{size} MB cada",

  // Save stages reported by the Rust core
  "Collecting workspace changes": "Coletando alterações da área de trabalho",
  "Collecting objects and sprite overrides": "Coletando objetos e sprites sobrescritos",
  "Objects prepared": "Objetos preparados",
  "Sprite overrides prepared": "Sprites sobrescritos preparados",
  "Writing project file": "Gravando arquivo do projeto",
  "Re-reading the saved project": "Relendo o projeto salvo",
  "Project saved and verified": "Projeto salvo e verificado",
  "Serializing objects": "Serializando objetos",
  "Re-parsing the serialized DAT": "Relendo o DAT serializado",
  "DAT written and verified": "DAT gravado e verificado",
  "Writing SPR archive": "Gravando o arquivo SPR",
  "Writing sprites": "Gravando sprites",
  "Writing OTFI feature file": "Gravando o arquivo OTFI",
  "Splitting the SPR into volumes": "Dividindo o SPR em volumes",
  "Indexing the saved sprites": "Indexando os sprites salvos",
  "Client files saved and verified": "Arquivos do cliente salvos e verificados",
  "Joining SPR volumes": "Juntando os volumes do SPR",

  // Save stage checklist
  "Collecting changes": "Coletando alterações",
  "DAT metadata": "Metadados DAT",
  "SPR archive": "Arquivo SPR",
  "OTFI features": "Recursos OTFI",
  "Sprite index": "Índice de sprites",
  "Project file": "Arquivo do projeto",
  Verification: "Verificação",
  Finished: "Concluído",

  // SPR volumes
  "SPR volumes": "Volumes do SPR",
  "The complete SPR is always written; volumes are published next to it.":
    "O SPR completo é sempre gravado; os volumes são publicados ao lado dele.",
  "Single archive": "Arquivo único",
  "Writes only the complete SPR file.": "Grava apenas o arquivo SPR completo.",
  "{size} MB per volume": "{size} MB por volume",
  "Numbered .001, .002, … next to the archive.":
    "Numerados .001, .002, … ao lado do arquivo.",
  "Custom size": "Tamanho personalizado",
  "Between {min} and {max} MB per volume.": "Entre {min} e {max} MB por volume.",
  "Volumes are byte ranges of the archive: a client directory that only has them is joined back when the project is opened.":
    "Os volumes são faixas de bytes do arquivo: um diretório de cliente que só tenha eles é reunido ao abrir o projeto.",
  "Choose destination": "Escolher destino",
  "Unable to write": "Não foi possível gravar",
  "Show details": "Mostrar detalhes",
  "Copy details": "Copiar detalhes",

  // Unsaved changes / about / shortcuts
  "Save changes before closing?": "Salvar alterações antes de fechar?",
  "Your unsaved object, frame, sprite, and property changes will be lost.":
    "Suas alterações não salvas de objetos, frames, sprites e propriedades serão perdidas.",
  "This workspace has unsaved changes.":
    "Esta área de trabalho tem alterações não salvas.",
  "Save them now or discard them permanently before closing Object Builder.":
    "Salve-as agora ou descarte-as permanentemente antes de fechar o Object Builder.",
  Discard: "Descartar",
  "Save and close": "Salvar e fechar",
  "Version {version}": "Versão {version}",
  "Rust core / app": "Núcleo Rust / app",
  Frontend: "Frontend",
  UI: "Interface",
  License: "Licença",
  Documentation: "Documentação",
  "© 2026 Eibly · Released under the MIT License":
    "© 2026 Eibly · Distribuído sob a licença MIT",
  "Keyboard Shortcuts": "Atalhos de teclado",
  "Customize commands. Changes are saved automatically.":
    "Personalize os comandos. As alterações são salvas automaticamente.",
  "Application shortcuts": "Atalhos do aplicativo",
  "Reset all": "Redefinir tudo",
  Unassigned: "Não atribuído",
  "Reset {name}": "Redefinir {name}",
  "Change shortcut": "Alterar atalho",
  "Press the new shortcut…": "Pressione o novo atalho…",
  "Shortcut already in use": "Atalho já em uso",
  "{shortcut} is assigned to {name}.": "{shortcut} está atribuído a {name}.",
  Reassign: "Reatribuir",
  "Shortcut: {keys}": "Atalho: {keys}",
  "Quick Save": "Salvamento rápido",
  "Select All": "Selecionar tudo",
  "Search Objects": "Pesquisar objetos",
  "Reset Zoom": "Redefinir zoom",
  "Configure and load DAT/SPR files": "Configure e carregue arquivos DAT/SPR",
  "Save the active client as DAT/SPR": "Salva o cliente ativo como DAT/SPR",
  "Save as DAT/SPR or project JSON": "Salva como DAT/SPR ou JSON do projeto",
  "Save without showing a dialog": "Salva sem exibir um diálogo",
  "Undo the last edit": "Desfaz a última edição",
  "Redo the last edit": "Refaz a última edição",
  "Copy the selected object": "Copia o objeto selecionado",
  "Paste an object": "Cola um objeto",
  "Delete the current selection": "Exclui a seleção atual",
  "Select all visible objects": "Seleciona todos os objetos visíveis",
  "Focus the object browser search field":
    "Foca o campo de pesquisa do navegador de objetos",
  "Increase canvas zoom": "Aumenta o zoom do canvas",
  "Decrease canvas zoom": "Diminui o zoom do canvas",
  "Restore centered auto-fit with margin":
    "Restaura o ajuste automático centralizado com margem",
  "Toggle the pixel grid": "Alterna a grade de pixels",

  // Application settings
  "Application Settings": "Configurações do aplicativo",
  "Configure defaults used when browsing, previewing and editing objects.":
    "Configure os padrões usados ao navegar, pré-visualizar e editar objetos.",
  Canvas: "Canvas",
  Advanced: "Avançado",
  "Object workflow": "Fluxo de trabalho de objetos",
  "Defaults applied to the Object Browser when a project opens.":
    "Padrões aplicados ao navegador de objetos quando um projeto é aberto.",
  "Canvas & preview": "Canvas e pré-visualização",
  "How objects are framed and rendered on the canvas.":
    "Como os objetos são enquadrados e renderizados no canvas.",
  "Film roll & playback": "Rolo de filme e reprodução",
  "Frame group, playback and new-frame defaults.":
    "Padrões de grupo de frames, reprodução e novos frames.",
  "Outfit preview": "Pré-visualização de outfits",
  "Starting direction, addons and palette used to preview outfits.":
    "Direção inicial, addons e paleta usados para pré-visualizar outfits.",
  "History & diagnostics": "Histórico e diagnóstico",
  "Memory limits for undo history and the application log.":
    "Limites de memória do histórico de desfazer e do log do aplicativo.",
  "{hint} Changes are saved automatically.":
    "{hint} As alterações são salvas automaticamente.",
  Language: "Idioma",
  "Interface language. Automatic follows the language configured on this computer.":
    "Idioma da interface. Automático segue o idioma configurado neste computador.",
  "Interface language": "Idioma da interface",
  "Automatic ({language})": "Automático ({language})",
  English: "Inglês",
  Portuguese: "Português",
  Theme: "Tema",
  "Interface colours. Automatic follows the theme configured on this computer.":
    "Cores da interface. Automático segue o tema configurado neste computador.",
  "Interface theme": "Tema da interface",
  "Automatic ({theme})": "Automático ({theme})",
  Light: "Claro",
  Dark: "Escuro",
  "Default object type": "Tipo de objeto padrão",
  "Choose the category shown when a project opens.":
    "Escolha a categoria exibida quando um projeto é aberto.",
  "Default sort": "Ordenação padrão",
  "Initial ordering used by the Object Browser.":
    "Ordenação inicial usada pelo navegador de objetos.",
  "Default object sort": "Ordenação padrão de objetos",
  "Objects per page": "Objetos por página",
  "Rows requested from the core for each Object Browser page.":
    "Linhas solicitadas ao núcleo para cada página do navegador de objetos.",
  "{size} objects": "{size} objetos",
  "Confirm before deleting": "Confirmar antes de excluir",
  "Ask for confirmation before removing an object from the project.":
    "Pede confirmação antes de remover um objeto do projeto.",
  "Notification duration": "Duração das notificações",
  "How long status messages stay on screen before fading out.":
    "Por quanto tempo as mensagens de status permanecem na tela antes de sumir.",
  "Notification duration in seconds": "Duração das notificações em segundos",
  "Default canvas zoom": "Zoom padrão do canvas",
  "Auto includes a small margin; Fit uses all available canvas space.":
    "Automático inclui uma pequena margem; Ajustar usa todo o espaço disponível do canvas.",
  "Zoom percent": "Porcentagem de zoom",
  "Default canvas zoom percentage": "Porcentagem de zoom padrão do canvas",
  "Canvas background": "Fundo do canvas",
  "Backdrop drawn behind transparent pixels of the object.":
    "Fundo desenhado atrás dos pixels transparentes do objeto.",
  "Show pixel grid by default": "Mostrar a grade de pixels por padrão",
  "Opens the canvas with the pixel grid already enabled.":
    "Abre o canvas com a grade de pixels já ativada.",
  "Interpolates zoomed sprites instead of keeping hard pixel edges.":
    "Interpola os sprites ampliados em vez de manter as bordas de pixel nítidas.",
  "Canvas overlays": "Sobreposições do canvas",
  "Cursor coordinates, zoom hint and the size badges around the object.":
    "Coordenadas do cursor, dica de zoom e os selos de tamanho ao redor do objeto.",
  "Default frame group": "Grupo de frames padrão",
  "The preferred animation group selected when opening an object.":
    "O grupo de animação preferido, selecionado ao abrir um objeto.",
  "Default film roll": "Rolo de filme padrão",
  "Choose its initial state when opening an animated object.":
    "Escolha o estado inicial ao abrir um objeto animado.",
  "Default film roll state": "Estado padrão do rolo de filme",
  "Auto-play animation": "Reproduzir animação automaticamente",
  "Start playback automatically after selecting another animated object.":
    "Inicia a reprodução automaticamente ao selecionar outro objeto animado.",
  "Loop playback": "Repetir reprodução",
  "Restart from the first frame instead of stopping at the last one.":
    "Reinicia do primeiro frame em vez de parar no último.",
  "Playback speed": "Velocidade de reprodução",
  "Multiplies frame durations during preview only; stored values are untouched.":
    "Multiplica as durações dos frames apenas na pré-visualização; os valores salvos não mudam.",
  "Animation playback speed": "Velocidade de reprodução da animação",
  "1× (normal)": "1× (normal)",
  "New frame duration": "Duração de novos frames",
  "Duration assigned to frames created with the Add frame button.":
    "Duração atribuída aos frames criados com o botão Adicionar frame.",
  "Default duration for new frames": "Duração padrão dos novos frames",
  "Default outfit direction": "Direção padrão do outfit",
  "Direction selected when previewing an outfit for the first time.":
    "Direção selecionada ao pré-visualizar um outfit pela primeira vez.",
  "Default outfit addons": "Addons padrão do outfit",
  "Addons selected when previewing an outfit for the first time.":
    "Addons selecionados ao pré-visualizar um outfit pela primeira vez.",
  "Addon 1": "Addon 1",
  "Addon 2": "Addon 2",
  "Compose addons over the body": "Compor addons sobre o corpo",
  "Draws the outfit body under the selected addon by default.":
    "Desenha o corpo do outfit sob o addon selecionado por padrão.",
  "Default outfit colors": "Cores padrão do outfit",
  "Preview palette for head, body, legs and feet.":
    "Paleta de pré-visualização para cabeça, corpo, pernas e pés.",
  "Default outfit {part} color": "Cor padrão do outfit: {part}",
  "Undo history": "Histórico de desfazer",
  "How many editing steps are kept before the oldest ones are dropped.":
    "Quantos passos de edição são mantidos antes de os mais antigos serem descartados.",
  "Undo history limit": "Limite do histórico de desfazer",
  steps: "passos",
  "Log retention": "Retenção de logs",
  "Maximum events kept in the log panel; older entries are discarded.":
    "Máximo de eventos mantidos no painel de logs; as entradas mais antigas são descartadas.",
  "Log retention limit": "Limite de retenção de logs",
  events: "eventos",
  "Restore defaults": "Restaurar padrões",
  "Resets every preference on all tabs. Remembered “last used” values are kept.":
    "Redefine todas as preferências de todas as abas. Os valores lembrados de “último usado” são mantidos.",
  "Reset settings": "Redefinir configurações",

  // Pagination
  "{count} {label}": "{count} {label}",
  "Page {page} of {pages}": "Página {page} de {pages}",
  "Per page": "Por página",
  "{label} per page": "{label} por página",
  "{label} pagination": "Paginação de {label}",
  "First page": "Primeira página",
  "Previous page": "Página anterior",
  "Next page": "Próxima página",
  "Last page": "Última página",
  "Previous {label} page": "Página anterior de {label}",
  "Next {label} page": "Próxima página de {label}",
  items: "itens",
  candidates: "candidatos",
  "duplicate groups": "grupos de duplicatas",

  // Number input
  "Increase {label}": "Aumentar {label}",
  "Decrease {label}": "Diminuir {label}",
  value: "valor",

  // Optimize dialog
  "Analyze first, review exact changes, then explicitly confirm safe cleanup.":
    "Analise primeiro, revise as alterações exatas e então confirme explicitamente a limpeza segura.",
  "Analyzing sprites": "Analisando sprites",
  "Applying optimization": "Aplicando otimização",
  "Preparing sprite analysis": "Preparando a análise de sprites",
  "Preparing analysis": "Preparando a análise",
  "Revalidating sprite checksums":
    "Revalidando as somas de verificação dos sprites",
  "Cancelling analysis…": "Cancelando a análise…",
  "Reading sprite index…": "Lendo o índice de sprites…",
  // Optimization stages, reported one by one by the Rust core.
  "Indexing the sprite table": "Indexando a tabela de sprites",
  "Hashing edited sprites":
    "Calculando a soma de verificação dos sprites editados",
  "Comparing edited sprites against the archive":
    "Comparando os sprites editados com o arquivo",
  "Reading cached sprite checksums": "Lendo as somas de verificação em cache",
  "Decoding sprites from the archive": "Decodificando os sprites do arquivo",
  "Grouping matching checksums": "Agrupando as somas de verificação iguais",
  "Staging sprite removals": "Preparando a remoção dos sprites",
  "Rewriting object references": "Reescrevendo as referências dos objetos",
  "Rebuilding the sprite usage index":
    "Reconstruindo o índice de uso dos sprites",
  "Step {index} of {total}": "Etapa {index} de {total}",
  "{processed} / {total} sprites": "{processed} / {total} sprites",
  "{processed} / {total} edited sprites":
    "{processed} / {total} sprites editados",
  "{processed} / {total} objects": "{processed} / {total} objetos",
  "{processed} / {total} checksum groups": "{processed} / {total} grupos",
  "{processed} / {total} removals": "{processed} / {total} remoções",
  "Calculating ETA…": "Calculando o tempo restante…",
  "Finishing…": "Finalizando…",
  "ETA {seconds}s": "Faltam {seconds}s",
  "ETA {minutes}m {seconds}s": "Faltam {minutes}m {seconds}s",
  "ETA {hours}h {minutes}m": "Faltam {hours}h {minutes}m",
  "reclaimed on the next save": "recuperados no próximo salvamento",
  "{count} sprites dropped": "{count} sprites removidos",
  "Nothing to optimize — every pass came back clean.":
    "Nada a otimizar — todas as verificações vieram limpas.",
  "{selected} of {total} available operation selected":
    "{selected} de {total} operação disponível selecionada",
  "{selected} of {total} available operations selected":
    "{selected} de {total} operações disponíveis selecionadas",
  "{count} object references rewritten":
    "{count} referências de objeto reescritas",
  "no object is changed": "nenhum objeto é alterado",
  "Total sprites": "Total de sprites",
  Duplicated: "Duplicados",
  Blank: "Vazios",
  "Broken refs": "Refs quebradas",
  "{count} groups": "{count} grupos",
  "Nothing is written until you save": "Nada é gravado até você salvar",
  "Every pass runs on the in-memory index in the Rust core: sprite removals are staged for the next SPR write and reference changes are undone by closing the project without saving.":
    "Cada verificação roda sobre o índice em memória no núcleo Rust: as remoções de sprite ficam preparadas para a próxima gravação do SPR e as mudanças de referência são desfeitas fechando o projeto sem salvar.",
  Everything: "Tudo",
  "Storage only": "Somente armazenamento",
  None: "Nenhum",
  "Expand all": "Expandir tudo",
  "Collapse all": "Recolher tudo",
  "I reviewed the enabled operation and confirm the sprite cleanup and reference changes listed above.":
    "Revisei a operação ativada e confirmo a limpeza de sprites e as alterações de referência listadas acima.",
  "I reviewed the {count} enabled operations and confirm the sprite cleanup and reference changes listed above.":
    "Revisei as {count} operações ativadas e confirmo a limpeza de sprites e as alterações de referência listadas acima.",
  "Optimizing…": "Otimizando…",
  "Run 1 operation": "Executar 1 operação",
  "Run {count} operations": "Executar {count} operações",
  Clean: "Limpo",
  "rewrites objects": "reescreve objetos",
  group: "grupo",
  groups: "grupos",
  override: "sobrescrito",
  overrides: "sobrescritos",
  slot: "slot",
  slots: "slots",
  reference: "referência",
  references: "referências",
  "Duplicate sprites": "Sprites duplicados",
  "Sprites sharing decoded pixels are collapsed onto one keeper and every reference is redirected before removal.":
    "Sprites com os mesmos pixels decodificados são reduzidos a um único mantido, e todas as referências são redirecionadas antes da remoção.",
  "No sprites with identical content were found.":
    "Nenhum sprite com conteúdo idêntico foi encontrado.",
  "Showing the first {shown} groups of {total}. Groups outside the review sample keep their lowest ID.":
    "Mostrando os primeiros {shown} grupos de {total}. Os grupos fora da amostra de revisão mantêm o menor ID.",
  "Blank sprites": "Sprites vazios",
  "Sprites that still occupy a block but decode to fully transparent pixels while objects point at them. The references are cleared and the pixels dropped.":
    "Sprites que ainda ocupam um bloco mas decodificam para pixels totalmente transparentes enquanto objetos apontam para eles. As referências são limpas e os pixels descartados.",
  "No referenced sprite decodes to an empty image.":
    "Nenhum sprite referenciado decodifica para uma imagem vazia.",
  "Unused source sprites": "Sprites de origem não usados",
  "Sprites in the SPR that no object references. They are dropped from the archive the next time it is written.":
    "Sprites no SPR que nenhum objeto referencia. Eles são removidos do arquivo na próxima gravação.",
  "No unused source sprites.": "Nenhum sprite de origem não usado.",
  "Unused sprite overrides": "Sprites sobrescritos não usados",
  "Imported or edited sprites that no object ended up using. Dropping them frees the decoded buffer they hold.":
    "Sprites importados ou editados que nenhum objeto acabou usando. Descartá-los libera o buffer decodificado que ocupam.",
  "No unused overrides.": "Nenhum sprite sobrescrito não usado.",
  "Redundant overrides": "Sobrescritos redundantes",
  "Overrides whose pixels are identical to the SPR sprite they shadow. Dropping them re-exposes the original block and skips a re-encode on save.":
    "Sobrescritos cujos pixels são idênticos ao sprite do SPR que eles substituem. Descartá-los reexpõe o bloco original e evita uma recodificação ao salvar.",
  "Every override differs from its source sprite.":
    "Todo sobrescrito difere do seu sprite de origem.",
  "Empty sprite slots": "Slots de sprite vazios",
  "References to IDs inside the archive whose slot holds no sprite block at all. They draw nothing and are cleared to 0.":
    "Referências a IDs dentro do arquivo cujo slot não contém nenhum bloco de sprite. Elas não desenham nada e são zeradas.",
  "Every referenced slot carries sprite data.":
    "Todo slot referenciado contém dados de sprite.",
  "Invalid references": "Referências inválidas",
  "References pointing past the end of the archive. Nothing can resolve them, so they are cleared to 0.":
    "Referências que apontam além do fim do arquivo. Nada consegue resolvê-las, então são zeradas.",
  "No invalid references.": "Nenhuma referência inválida.",
  "Showing {shown} of {total} IDs. The operation applies to all of them.":
    "Mostrando {shown} de {total} IDs. A operação se aplica a todos eles.",
  "Checksum {checksum}": "Soma de verificação {checksum}",
  Checksum: "Soma de verificação",
  "{count} identical IDs · keeping #{id}":
    "{count} IDs idênticos · mantendo #{id}",
  "Automatic: keep first ID": "Automático: manter o primeiro ID",
  "Optimization analysis failed": "A análise de otimização falhou",
  "Optimization failed": "A otimização falhou",
  "Unable to signal optimization cancellation":
    "Não foi possível sinalizar o cancelamento da otimização",
  duplicates: "duplicatas",
  "unused sprites": "sprites não usados",
  "blank sprites": "sprites vazios",
  "unused overrides": "sobrescritos não usados",
  "redundant overrides": "sobrescritos redundantes",
  redirected: "redirecionadas",
  blank: "vazias",
  empty: "vazias",
  invalid: "inválidas",
  "removed {list}": "removidos {list}",
  "removed nothing": "nada removido",
  "{list} references updated": "{list} referências atualizadas",
  "Optimization completed: {summary} ({bytes} reclaimed on save)":
    "Otimização concluída: {summary} ({bytes} recuperados ao salvar)",
  // Command palette
  "Command palette": "Paleta de comandos",
  "Command palette…": "Paleta de comandos…",
  "Command Palette": "Paleta de comandos",
  "Search commands, panels and tabs": "Pesquisar comandos, painéis e abas",
  "Search commands, panels and tabs…": "Pesquisar comandos, painéis e abas…",
  "Search commands…": "Pesquisar comandos…",
  Search: "Pesquisar",
  "Finds any command, panel or tab by name.":
    "Encontra qualquer comando, painel ou aba pelo nome.",
  "No command matches “{query}”": "Nenhum comando corresponde a “{query}”",
  Recent: "Recentes",
  "Go to tab": "Ir para aba",
  navigate: "navegar",
  run: "executar",
  close: "fechar",
  command: "comando",
  commands: "comandos",
  current: "atual",
  "All objects": "Todos os objetos",
  "Close application": "Fechar aplicativo",
  "Copy object": "Copiar objeto",
  "Paste object": "Colar objeto",
  "Select all objects": "Selecionar todos os objetos",
  "Search objects": "Pesquisar objetos",
  "Zoom in": "Aproximar",
  "Zoom out": "Afastar",
  "Reset zoom to auto-fit": "Redefinir zoom para ajuste automático",
  "Show pixel grid": "Mostrar grade de pixels",
  "Hide pixel grid": "Ocultar grade de pixels",
  "Show film roll": "Mostrar rolo de frames",
  "Hide film roll": "Ocultar rolo de frames",
  "Show inspector": "Mostrar inspetor",
  "Hide inspector": "Ocultar inspetor",
  "Show log panel": "Mostrar painel de logs",
  "Hide log panel": "Ocultar painel de logs",
  "Search every command, panel and tab": "Pesquisa todo comando, painel e aba",

  // Pixel editor
  "Edit Mode": "Modo de edição",
  "Turns the canvas into a pixel editor for the frame on screen. Edits are written straight into the sprites.": "Transforma o canvas em um editor de pixels do frame em tela. As edições vão direto para os sprites.",
  "Turn the canvas into a pixel editor": "Transforma o canvas em um editor de pixels",
  "Middle-drag or the hand tool moves the camera": "Botão do meio ou a ferramenta mão movem a câmera",
  "Pencil": "Lápis",
  "Paints the primary color. Right-drag paints the secondary one.": "Pinta com a cor primária. Arrastar com o botão direito pinta com a secundária.",
  "Paint with the primary color": "Pinta com a cor primária",
  "Eraser": "Borracha",
  "Clears pixels back to transparent.": "Apaga os pixels de volta para transparente.",
  "Clear pixels back to transparent": "Apaga os pixels de volta para transparente",
  "Eyedropper": "Conta-gotas",
  "Takes the color under the pointer. Alt does the same from any tool.": "Pega a cor sob o ponteiro. Alt faz o mesmo a partir de qualquer ferramenta.",
  "Pick the color under the pointer": "Pega a cor sob o ponteiro",
  "Paint Bucket": "Balde de tinta",
  "Fills the contiguous region under the pointer, within the tolerance.": "Preenche a região contígua sob o ponteiro, dentro da tolerância.",
  "Fill the contiguous region under the pointer": "Preenche a região contígua sob o ponteiro",
  "Replace Color": "Substituir cor",
  "Repaints every pixel of the color you click, contiguous or not.": "Repinta todos os pixels da cor clicada, contíguos ou não.",
  "Repaint every pixel of one color in the frame": "Repinta todos os pixels de uma cor no frame",
  "Line": "Linha",
  "Drag to draw. Shift snaps to 45°.": "Arraste para desenhar. Shift trava em 45°.",
  "Draw a straight line": "Desenha uma linha reta",
  "Rectangle": "Retângulo",
  "Drag to draw. Shift keeps it square.": "Arraste para desenhar. Shift mantém quadrado.",
  "Draw a rectangle": "Desenha um retângulo",
  "Ellipse": "Elipse",
  "Drag to draw. Shift keeps it circular.": "Arraste para desenhar. Shift mantém circular.",
  "Draw an ellipse": "Desenha uma elipse",
  "Select Pixels": "Selecionar pixels",
  "Drag a rectangle. Every tool then writes only inside it.": "Arraste um retângulo. A partir daí toda ferramenta escreve só dentro dele.",
  "Select a rectangular region of the frame": "Seleciona uma região retangular do frame",
  "Magic Wand": "Varinha mágica",
  "Selects the contiguous region of the color you click.": "Seleciona a região contígua da cor clicada.",
  "Select the contiguous region of one color": "Seleciona a região contígua de uma cor",
  "Move Pixels": "Mover pixels",
  "Drags the selection elsewhere. Hold Alt to leave a copy behind.": "Arrasta a seleção para outro lugar. Segure Alt para deixar uma cópia.",
  "Drag the selected pixels to another place": "Arrasta os pixels selecionados para outro lugar",
  "Pan Canvas": "Mover câmera",
  "Moves the camera. Middle-drag and Space do this from any tool.": "Move a câmera. O botão do meio faz o mesmo a partir de qualquer ferramenta.",
  "Drag the camera while edit mode is on": "Move a câmera com o modo de edição ligado",
  "Transparent": "Transparente",
  "Primary color": "Cor primária",
  "Painted by the left button. Click the swatch to change it.": "Pintada pelo botão esquerdo. Clique na amostra para trocar.",
  "Secondary color": "Cor secundária",
  "Painted by the right button.": "Pintada pelo botão direito.",
  "Swap colors": "Trocar cores",
  "Swap Colors": "Trocar cores",
  "Exchanges the primary and secondary colors.": "Troca a cor primária pela secundária.",
  "Exchange the primary and secondary colors": "Troca a cor primária pela secundária",
  "Colors in this frame": "Cores deste frame",
  "Brush": "Pincel",
  "Brush size": "Tamanho do pincel",
  "Larger Brush": "Pincel maior",
  "Grow the pencil and eraser nib": "Aumenta a ponta do lápis e da borracha",
  "Smaller Brush": "Pincel menor",
  "Shrink the pencil and eraser nib": "Diminui a ponta do lápis e da borracha",
  "Filled": "Preenchido",
  "Tolerance": "Tolerância",
  "Layer": "Camada",
  "Layer {index}": "Camada {index}",
  "Outfits keep their four-color mask here: yellow head, red body, green legs, blue feet.": "Outfits guardam aqui a máscara de quatro cores: amarelo cabeça, vermelho corpo, verde pernas, azul pés.",
  "Paints this layer of the frame. The others stay untouched.": "Pinta esta camada do frame. As outras não são tocadas.",
  "Ghost other layers": "Fantasma das outras camadas",
  "Copy pixels": "Copiar pixels",
  "Copies the selection. Without one, the whole layer is copied.": "Copia a seleção. Sem seleção, copia a camada inteira.",
  "Paste pixels": "Colar pixels",
  "Drops the copied pixels on the frame, ready to be dragged into place.": "Solta os pixels copiados no frame, prontos para serem arrastados até o lugar.",
  "Delete pixels": "Excluir pixels",
  "Clears the selected pixels.": "Apaga os pixels selecionados.",
  "Deselect": "Limpar seleção",
  "Drop the pixel selection": "Descarta a seleção de pixels",
  "Onion skin": "Onion skin",
  "Onion Skin": "Onion skin",
  "Ghosts the previous and next frames under this one.": "Mostra o frame anterior e o próximo como fantasma sob este.",
  "Ghost the neighbouring frames under the current one": "Mostra os frames vizinhos como fantasma sob o atual",
  "Flip horizontally": "Espelhar na horizontal",
  "Flip Horizontally": "Espelhar na horizontal",
  "Mirrors the edited layer left to right.": "Espelha a camada editada da esquerda para a direita.",
  "Mirror the edited frame left to right": "Espelha o frame editado da esquerda para a direita",
  "Flip vertically": "Espelhar na vertical",
  "Flip Vertically": "Espelhar na vertical",
  "Mirrors the edited layer top to bottom.": "Espelha a camada editada de cima para baixo.",
  "Mirror the edited frame top to bottom": "Espelha o frame editado de cima para baixo",
  "Rotate a quarter turn": "Girar um quarto de volta",
  "Rotate Frame": "Girar frame",
  "Turns the edited layer clockwise.": "Gira a camada editada no sentido horário.",
  "Turn the edited frame a quarter turn clockwise": "Gira o frame editado um quarto de volta no sentido horário",
  "Only a square frame can be rotated in place.": "Só um frame quadrado pode ser girado no lugar.",
  "Previous Frame": "Frame anterior",
  "Open the previous frame of the group": "Abre o frame anterior do grupo",
  "Next Frame": "Próximo frame",
  "Open the next frame of the group": "Abre o próximo frame do grupo",
  "Pixel editor": "Editor de pixels",
  "Unable to open this frame for editing": "Não foi possível abrir este frame para edição",
  "Unable to write the edited frame": "Não foi possível gravar o frame editado",
  "Unable to restore the frame pixels": "Não foi possível restaurar os pixels do frame",
  "{count} edited sprite(s) are shared with other objects, which changed too": "{count} sprite(s) editado(s) são compartilhados com outros objetos, que mudaram junto",
};

const translations: Record<Locale, Record<string, string> | null> = {
  en: null,
  pt,
};

/** Language configured on this computer, used by the "auto" preference. */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const tags = [...(navigator.languages ?? []), navigator.language].filter(
    Boolean,
  ) as string[];
  return tags.some((tag) => tag.toLowerCase().startsWith("pt")) ? "pt" : "en";
}

export function resolveLocale(language: Language): Locale {
  return language === "auto" ? detectLocale() : language;
}

export function translate(
  locale: Locale,
  text: string,
  vars?: Record<string, string | number>,
): string {
  const output = translations[locale]?.[text] ?? text;
  return vars
    ? output.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      )
    : output;
}

export type Translate = (
  text: string,
  vars?: Record<string, string | number>,
) => string;

/** Translation outside a component (stores, log messages, event handlers in modules). */
export const tr: Translate = (text, vars) =>
  translate(resolveLocale(useSettingsStore.getState().language), text, vars);

export function useLocale(): Locale {
  return resolveLocale(useSettingsStore((state) => state.language));
}

/** Re-renders the caller whenever the language preference changes. */
export function useT(): Translate {
  const locale = useLocale();
  return useCallback((text, vars) => translate(locale, text, vars), [locale]);
}

/** Keeps `<html lang>` in sync so the platform picks the right hyphenation and spellcheck. */
export function initI18n() {
  const apply = () => {
    document.documentElement.lang =
      resolveLocale(useSettingsStore.getState().language) === "pt"
        ? "pt-BR"
        : "en";
  };
  apply();
  useSettingsStore.subscribe(apply);
}
