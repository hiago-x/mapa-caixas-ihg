# Mapa de Caixas — Centro de Oncologia IHG

Catálogo visual dos armários e caixas do 5º andar, baseado no PDF verificado. A versão principal usa API e banco compartilhado para login administrativo, adição, edição, exclusão, movimentação e substituição de caixas.

## GitHub Pages

O workflow em `.github/workflows/pages.yml` publica uma versão estática de consulta em `https://hiago-x.github.io/mapa-caixas-ihg/`. Essa versão contém busca, mapa, fichas, inventário e QR Code, mas não executa a API nem as operações administrativas. O menu Administração direciona para o site principal.

## Desenvolvimento

```bash
npm install
npm run build
npm run dev
```

As variáveis `DATABASE_URL`, `ADMIN_USERNAME` e `ADMIN_PASSWORD` são necessárias apenas para o servidor/API e não ficam gravadas no repositório.
