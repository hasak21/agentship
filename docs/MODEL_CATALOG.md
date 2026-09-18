# Model catalog

Last verified against first-party model catalogs: 2026-09-18.

| Provider | AgentShip presets | Default | Protocol |
| --- | --- | --- | --- |
| DeepSeek | V4.1 Flash (`deepseek-flash`), V4 Pro (`deepseek-v4-pro`) | `deepseek-flash` | OpenAI-compatible Chat Completions |
| Anthropic | Opus 5, Sonnet 5, Haiku 4.5 | `claude-sonnet-5` | Anthropic Messages |
| OpenAI | GPT-6 Astra, GPT-5.6 Terra | `gpt-6-astra` | Chat Completions |
| Google | Gemini 3.8 Flash | `gemini-3.8-flash` | Gemini `generateContent` |
| Ollama | Qwen3-Coder 30B | `qwen3-coder:30b` | Local OpenAI-compatible Chat Completions |

The OpenAI adapter omits sampling parameters and uses `max_completion_tokens` for GPT-5/6 requests sent directly to `api.openai.com`. Other OpenAI-compatible endpoints retain the existing `temperature` and `max_tokens` contract. AgentShip currently uses text chat only; GPT-6 Astra tool calling would require a future migration to the Responses API.

Environment variables override every default, so deployments can retain pinned or provider-specific models during rollout. Ollama users should select a smaller locally installed model when 30B hardware requirements are unsuitable.

Official sources:

- [OpenAI latest model and migration guide](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart)
- [Anthropic models overview](https://docs.anthropic.com/en/docs/about-claude/models/overview)
- [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Google Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [Ollama Qwen3-Coder library](https://ollama.com/library/qwen3-coder)
