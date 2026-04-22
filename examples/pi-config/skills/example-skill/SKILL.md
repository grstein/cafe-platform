---
name: example-skill
description: Example skill that demonstrates the skill format
---

# Example Skill

Este é um exemplo de skill para o Pi Agent SDK. Skills ficam em `pi-config/skills/<nome-da-skill>/SKILL.md` e são descobertas automaticamente pelo SDK na inicialização de cada sessão.

## Como funciona

- Na inicialização, o SDK carrega apenas o **frontmatter** (`name` e `description`) de cada skill e injeta essa lista no prompt de sistema.
- O conteúdo completo do `SKILL.md` **não** é enviado por padrão ao modelo — ele é carregado sob demanda quando o agente decide usar a skill.
- Isso permite ter muitas skills disponíveis sem estourar o orçamento de tokens.

## Quando criar uma skill

Crie uma skill quando tiver um procedimento recorrente, um playbook ou um conjunto de instruções detalhadas que só precisa ser consultado em situações específicas. Exemplos:

- Roteiro de troubleshooting para um tipo específico de reclamação.
- Instruções para lidar com um tipo raro de pedido (atacado, B2B, etc.).
- Guia de estilo para respostas em cenários delicados.

## Estrutura recomendada

```
pi-config/skills/
  minha-skill/
    SKILL.md           # frontmatter + conteúdo principal
    arquivos-apoio.md  # opcional — carregados sob demanda se citados na SKILL.md
```

## Observação

Esta skill é apenas um exemplo. Você pode removê-la com segurança ou substituí-la por skills específicas do seu negócio. O sistema funciona sem nenhuma skill definida.
