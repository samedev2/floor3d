# Contexto — sessão de trabalho neste projeto (Claude, ago/2026)

Este arquivo resume o que foi explorado/construído numa sessão de chat com o
Claude, para não se perder ao continuar em outra ferramenta (MiniMax ou
qualquer outra). Nada aqui é mágico — é só o registro das decisões, pra você
não ter que re-explicar do zero.

## O que é o projeto

`buildingcv` / "Floorplan to 3D": um ResNet-UNet treinado no dataset
CubiCasa5K que segmenta plantas baixas (SVG) em `floor`/`wall`/`door`/`window`,
extrai polígonos por classe, e um viewer Three.js extrude isso em 3D.
Backend: FastAPI (`server/main.py`). Sem npm/Node em lugar nenhum do projeto.

## Estado atual dos arquivos

- `src/buildingcv/labels.py` — **revertido para o original de 4 classes**
  (`floor`/`wall`/`door`/`window`). Esse é o estado que carrega os pesos
  pré-treinados publicados pelo autor no Hugging Face.
- `extras/labels.hydraulic-scaffold.py` e `extras/model.hydraulic-scaffold.py`
  — versão estendida com 4 classes extras (`sink`/`toilet`/`bathtub`/`shower`),
  preparando terreno para uma futura "planta hidráulica". **Não treinada.**
  Os tokens SVG usados (`"Sink"`, `"Toilet"`, etc.) são um chute baseado na
  taxonomia geral do paper do CubiCasa5K — não foram verificados contra um
  `model.svg` real (sem acesso à rede na sessão pra baixar o dataset e
  confirmar). Confira antes de treinar em cima disso.
- `extras/floorplan-to-3d-app.html` — dashboard standalone (HTML/CSS/JS num
  arquivo só, sem servidor) que replica a estrutura de menus/botões de um
  app de referência que o usuário mostrou (prints de um app chamado
  "Floor3D"). Funciona 100% offline exceto o Visualizador 3D, que carrega
  Three.js de um CDN (unpkg.com) — precisa de internet no navegador de quem
  abrir.
  - Usa dados reais dos 3 planos de exemplo do projeto (embutidos no HTML).
  - "Materiais de Obra" é uma calculadora com fórmulas transparentes e
    coeficientes editáveis (tipos de tijolo, cimento, areia, mão de obra) —
    rotulada explicitamente como NÃO sendo IA, pra não induzir a erro.
  - "Chat com IA", "Blockout Preciso", "Planta Hidráulica", "Gaussian
    Splatting" ficam travados ("Em breve") — não existe implementação real
    por trás, de propósito, pra não fingir uma capacidade que não existe.

## Decisões/avisos importantes

1. **Licença do CubiCasa5K**: CC BY-NC-SA 4.0 — **não permite uso comercial**
   sem licenciamento à parte. Relevante se este projeto virar produto pago.
2. **Pesos pré-treinados** (baixados via `weights/best.safetensors` +
   `weights/config.yaml`, link no README) só carregam com `labels.py` na
   versão original de 4 classes — mudar `NUM_CLASSES` quebra o carregamento
   (shape mismatch na última camada).
3. **Cairo no Windows** não instala via pip — precisa do instalador GTK3
   runtime (github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer)
   ou MSYS2. Sem isso o servidor nem sobe (`server/main.py` carrega o modelo
   no boot, então falha cedo sem os pesos/Cairo).
4. **Upload de planta própria** só aceita `.svg` no formato de anotação do
   CubiCasa5K — não aceita foto/print/PDF de planta qualquer. O modelo nunca
   viu esse tipo de entrada no treino.
5. **"Planta Hidráulica" de verdade** (roteamento de tubulação, não só
   localização de pia/vaso) não é algo que este dataset resolve de jeito
   nenhum — é um problema de dados totalmente diferente.

## Como rodar localmente (Windows, testado nos comandos, não no resultado)

Resumo — os detalhes completos foram dados passo a passo na conversa:
1. `python -m venv .venv` → `.venv\Scripts\Activate.ps1` → `pip install -e ".[serve]"`
2. Instalar Cairo via GTK3 runtime installer
3. Baixar pesos: `weights/best.safetensors` + `weights/config.yaml` do
   Hugging Face (link no README do projeto)
4. `uvicorn server.main:app --reload --host 127.0.0.1 --port 8000`
5. Abrir `http://localhost:8000`

## O que NÃO foi possível verificar nesta sessão

O ambiente onde o Claude rodou não tinha acesso à rede — então nada disso
foi de fato testado ponta a ponta (só a sintaxe/lógica foi validada onde deu
pra fazer sem rede, incluindo testes reais em Chromium headless para o
dashboard HTML). Ou seja: os comandos acima são corretos pelo que a
documentação do projeto e das ferramentas (Cairo, Hugging Face) descrevem,
mas ninguém rodou o servidor de ponta a ponta com sucesso ainda.
