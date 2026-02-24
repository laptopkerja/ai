# Vision Capability Audit (Phase 1)

Date: 2026-02-20  
Scope: audit provider/model vision capability for providers already integrated in this project.

## Summary
- Phase 1 status: `Completed`.
- Core finding: project already collects image references (`url` and `data_url`), but provider adapters still send text-only requests.
- Impact: image is currently used as prompt context text, not true image understanding by model.

## Current Code Findings (Local)
- Image references are validated and normalized in backend:
  - `server/index.js:191`
- Image references are appended into prompt as text lines:
  - `server/index.js:272`
- Provider generation is called with single compiled text prompt:
  - `server/index.js:874`
- Provider adapters build text-only user message:
  - `server/lib/aiProviders.js:102`
  - `server/lib/aiProviders.js:119`
  - `server/lib/aiProviders.js:161`
- No multimodal payload fields are currently sent (`image_url`, inline image parts, etc.) in adapter requests.

## Provider Capability Matrix
Legend:
- `Provider Vision Support`: capability at provider/doc level.
- `Project Default/Fallback Models`: model list currently shown/used in this repo.
- `Ready Now`: whether current implementation can do real image analysis.

| Provider | Provider Vision Support | Project Default/Fallback Models | Vision Model Present in Fallback List | Ready Now |
|---|---|---|---|---|
| OpenAI | Yes (multimodal) | `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini` | Yes | No (text-only adapter) |
| Gemini | Yes (multimodal) | `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash` | Yes | No (text-only adapter) |
| OpenRouter | Yes (depends on selected model) | `openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, `google/gemini-2.0-flash-001` | Yes | No (text-only adapter) |
| Groq | Yes (selected models) | `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` | Not in current fallback list | No |
| Cohere AI | Yes (selected models) | `command-r`, `command-r-plus` | Not in current fallback list | No |
| DeepSeek | Not confirmed for image input in current API usage | `deepseek-chat`, `deepseek-reasoner` | No | No |
| Hugging Face | Yes (depends on selected VLM/provider route) | `meta-llama/Llama-3.1-8B-Instruct`, `mistralai/Mistral-7B-Instruct-v0.3` | Not in current fallback list | No |

## Gaps Identified
- No provider-specific multimodal request builder yet.
- No model-level `supportsVision` metadata in model detection response.
- No guardrail when user sends image but selected model is text-only.
- No UX indicator (`Vision ON/OFF`) tied to current provider+model capability.

## Phase 2 Handoff (Implementation Target)
- Prioritize multimodal adapter implementation for:
  - OpenAI
  - Gemini
  - OpenRouter
- Add model capability flags:
  - `supportsVision` (boolean)
  - `supportsText` (boolean, optional future-proof)
- Enforce server validation:
  - if `imageReferences.length > 0` and model not vision-capable -> explicit validation error.

## Reference Docs (official)
- OpenAI Vision:
  - https://platform.openai.com/docs/guides/images-vision
- Gemini Image Understanding:
  - https://ai.google.dev/gemini-api/docs/image-understanding
- OpenRouter Image Inputs:
  - https://openrouter.ai/docs/features/multimodal/images
- Groq Vision:
  - https://console.groq.com/docs/vision
- Cohere Image Inputs:
  - https://docs.cohere.com/docs/image-inputs
- Hugging Face (chat-completion task, model dependent):
  - https://huggingface.co/docs/inference-providers/tasks/chat-completion
- DeepSeek API docs (current API usage in project):
  - https://api-docs.deepseek.com/api/create-chat-completion

