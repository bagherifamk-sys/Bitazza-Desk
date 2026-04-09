# QWEN On-Premises Migration Guide

**Purpose:** Step-by-step technical instructions for replacing Gemini Flash (Google Cloud) with an on-premises QWEN model in the CS BOT stack.  
**Audience:** Developers or Claude Code performing the migration.  
**Scope:** Text generation (chat + copilot + classification) AND embeddings (ChromaDB vector store).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Architecture Overview — What Changes](#2-architecture-overview--what-changes)
3. [Step 1 — Deploy QWEN On-Prem](#3-step-1--deploy-qwen-on-prem)
4. [Step 2 — Environment Variables](#4-step-2--environment-variables)
5. [Step 3 — config/settings.py](#5-step-3--configsettingspy)
6. [Step 4 — engine/agent.py (Biggest Change)](#6-step-4--engineagentpy-biggest-change)
7. [Step 5 — api/copilot.py](#7-step-5--apicopilotpy)
8. [Step 6 — db/vector_store.py (Embeddings)](#8-step-6--dbvector_storepy-embeddings)
9. [Step 7 — dashboard/server/src/routes/copilot.js](#9-step-7--dashboardserversrcroutescopilotjs)
10. [Step 8 — dashboard/server/src/lib/redis.js](#10-step-8--dashboardserversrclibRedisjs)
11. [Step 9 — Classification Scripts](#11-step-9--classification-scripts)
12. [Step 10 — Tests](#12-step-10--tests)
13. [Step 11 — ChromaDB Reindex](#13-step-11--chromadb-reindex)
14. [Step 12 — Validation Checklist](#14-step-12--validation-checklist)
15. [Pitfalls & Notes](#15-pitfalls--notes)

---

## 1. Prerequisites

Before touching any code, confirm the following on the QWEN server side:

| Requirement | Detail |
|-------------|--------|
| QWEN chat model deployed | Must expose an **OpenAI-compatible HTTP API** — i.e. `POST /v1/chat/completions`. vLLM, Ollama, and LMDeploy all support this out of the box. |
| QWEN embedding model deployed | A separate endpoint (or same server) for `POST /v1/embeddings`. The embedding model must produce a **fixed-dimension vector** — note the dimension size, you will need it. |
| Function/tool calling support | Verify QWEN's version supports `tools` in the chat completion request. QWEN2.5-72B-Instruct and QWEN2.5-7B-Instruct both support this. Older QWEN1.5 models do NOT — if using those, see the tool calling workaround in Step 4. |
| Network access | The Python API server and Node dashboard server must both be able to reach the QWEN HTTP endpoints. |
| No `google-generativeai` dependency needed | After migration, `google-genai` can be removed from `requirements.txt`. |

---

## 2. Architecture Overview — What Changes

```
BEFORE                              AFTER
──────────────────────────────      ──────────────────────────────
Gemini Flash (Google Cloud)    →    QWEN Chat (on-prem, vLLM/Ollama)
  api_key auth                        base_url + optional api_key
  google.genai SDK                    openai SDK (compatible)
  genai_types.Content format          {"role": ..., "content": ...} messages
  genai_types.FunctionCallingConfig   {"tools": [...]} in OpenAI format
  FunctionResponse parts              tool_call_id response messages

Gemini Embedding (Google Cloud) →   QWEN Embedding (on-prem)
  models/gemini-embedding-001         your chosen embedding model name
  3072-dim vectors                    check your model's dim (e.g. 1024, 4096)
  google.genai client                 openai client (compatible)
  ChromaDB collection                 FULL REINDEX REQUIRED
```

Files changed: **9 files** (3 Python core, 1 JS, 2 Python scripts, 1 test, 1 config, 1 new reindex run).

---

## 3. Step 1 — Deploy QWEN On-Prem

### Recommended: vLLM (OpenAI-compatible server)

```bash
# Install vLLM
pip install vllm

# Start QWEN chat model (adjust model path / HuggingFace ID)
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-72B-Instruct \
  --served-model-name qwen2.5-72b-instruct \
  --host 0.0.0.0 \
  --port 8080 \
  --max-model-len 8192 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes

# Start QWEN embedding model (separate process or port)
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-Embedding \
  --task embed \
  --host 0.0.0.0 \
  --port 8081
```

> **Note on `--enable-auto-tool-choice` and `--tool-call-parser hermes`:**  
> These flags are required for function calling to work with QWEN on vLLM. Without them, the model may output tool calls as plain text and the `tools` field in the request will be ignored.

### Alternative: Ollama

```bash
ollama pull qwen2.5:72b
ollama serve  # runs on http://localhost:11434, also OpenAI-compatible
```

Ollama does not yet support tool calling robustly for all QWEN variants — use vLLM if function calling is needed (it is needed for `engine/agent.py`).

---

## 4. Step 2 — Environment Variables

Edit `.env` (and update `.env.example` accordingly):

```dotenv
# REMOVE this:
# GEMINI_API_KEY=your-google-key

# ADD these:
QWEN_BASE_URL=http://your-qwen-server:8080/v1
QWEN_EMBED_BASE_URL=http://your-qwen-server:8081/v1
QWEN_API_KEY=none          # leave as "none" if your on-prem server has no auth
QWEN_MODEL=qwen2.5-72b-instruct
QWEN_EMBED_MODEL=qwen2.5-embedding
QWEN_EMBED_DIM=4096        # match your embedding model's actual output dimension
```

> If the same vLLM server handles both chat and embeddings on the same port, set both `QWEN_BASE_URL` and `QWEN_EMBED_BASE_URL` to the same URL.

---

## 5. Step 3 — config/settings.py

**File:** `config/settings.py`

Replace the Gemini block with QWEN variables. The rest of the file is unchanged.

**Before (lines 7–10):**
```python
# AI
GEMINI_API_KEY: str = os.environ["GEMINI_API_KEY"]
MODEL: str = "gemini-2.0-flash"
MAX_TOKENS: int = 1024
```

**After:**
```python
# AI — QWEN on-premises
QWEN_BASE_URL: str = os.environ["QWEN_BASE_URL"]
QWEN_EMBED_BASE_URL: str = os.getenv("QWEN_EMBED_BASE_URL", os.environ["QWEN_BASE_URL"])
QWEN_API_KEY: str = os.getenv("QWEN_API_KEY", "none")
MODEL: str = os.getenv("QWEN_MODEL", "qwen2.5-72b-instruct")
EMBED_MODEL: str = os.getenv("QWEN_EMBED_MODEL", "qwen2.5-embedding")
EMBED_DIM: int = int(os.getenv("QWEN_EMBED_DIM", "4096"))
MAX_TOKENS: int = 1024
```

Also remove `GEMINI_API_KEY` from any `os.environ[...]` hard-requirements so the app doesn't crash on startup.

**Dependency change — `requirements.txt`:**
```
# Remove:
google-genai

# Add:
openai>=1.30.0     # the openai Python SDK works against any OpenAI-compatible server
```

---

## 6. Step 4 — engine/agent.py (Biggest Change)

**File:** `engine/agent.py`  
This is the most complex file. It uses Gemini's native function calling with `genai_types.Content`, `genai_types.FunctionCallingConfig`, and multi-turn `FunctionResponse` parts. All of this maps to OpenAI-compatible equivalents.

### 6.1 — Imports & client init

**Before (lines 9–13, 30):**
```python
from google import genai
from google.genai import types as genai_types
from google.genai import errors as genai_errors
from config.settings import GEMINI_API_KEY, MODEL, MAX_TOKENS, ESCALATION_CONFIDENCE_THRESHOLD
...
client = genai.Client(api_key=GEMINI_API_KEY)
```

**After:**
```python
from openai import OpenAI, APIError as OpenAIAPIError
from config.settings import QWEN_BASE_URL, QWEN_API_KEY, MODEL, MAX_TOKENS, ESCALATION_CONFIDENCE_THRESHOLD

client = OpenAI(base_url=QWEN_BASE_URL, api_key=QWEN_API_KEY)
```

### 6.2 — Message history format

Gemini uses `genai_types.Content` objects with `role="model"`. OpenAI uses plain dicts with `role="assistant"`.

**Before (lines 189–194):**
```python
gemini_history = []
for msg in history:
    role = "model" if msg["role"] == "assistant" else "user"
    gemini_history.append(
        genai_types.Content(role=role, parts=[genai_types.Part(text=msg["content"])])
    )
```

**After:**
```python
chat_history = []
for msg in history:
    role = "assistant" if msg["role"] == "assistant" else "user"
    chat_history.append({"role": role, "content": msg["content"]})
```

### 6.3 — Tool definitions format

The `TOOL_DEFINITIONS` list in `engine/account_tools.py` is already in JSON Schema format and is compatible with OpenAI's `tools` parameter — it just needs to be wrapped differently.

**Before (lines 219–235 of agent.py):**
```python
tools = [] if is_other_category else [genai_types.Tool(function_declarations=TOOL_DEFINITIONS)]
tool_config = (
    genai_types.ToolConfig(
        function_calling_config=genai_types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=[force_tool_name],
        )
    )
    if force_tool_name
    else None
)
config = genai_types.GenerateContentConfig(
    system_instruction=system_prompt,
    **({"tools": tools} if tools else {}),
    **({"tool_config": tool_config} if tool_config else {}),
    max_output_tokens=MAX_TOKENS,
)
```

**After:**
```python
# OpenAI tool format wraps each definition in {"type": "function", "function": {...}}
openai_tools = (
    [{"type": "function", "function": t} for t in TOOL_DEFINITIONS]
    if not is_other_category else []
)

# Force a specific tool call using tool_choice
if force_tool_name and openai_tools:
    tool_choice = {"type": "function", "function": {"name": force_tool_name}}
else:
    tool_choice = "auto" if openai_tools else "none"
```

### 6.4 — The LLM call

**Before (lines 237–243):**
```python
gemini_messages = gemini_history + [
    genai_types.Content(role="user", parts=[genai_types.Part(text=augmented_message)])
]
try:
    final_response = client.models.generate_content(
        model=MODEL, contents=gemini_messages, config=config
    )
except genai_errors.APIError as e:
```

**After:**
```python
messages = (
    [{"role": "system", "content": system_prompt}]
    + chat_history
    + [{"role": "user", "content": augmented_message}]
)
try:
    final_response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        tools=openai_tools or None,
        tool_choice=tool_choice if openai_tools else None,
        max_tokens=MAX_TOKENS,
    )
except OpenAIAPIError as e:
```

### 6.5 — Function calling loop

This is the most structurally different part. Gemini appends `FunctionResponse` parts as `"user"` role messages; OpenAI uses `"tool"` role messages with a `tool_call_id`.

**Before (lines 263–309) — the while loop:**
```python
while True:
    candidate = final_response.candidates[0] if final_response.candidates else None
    parts = (candidate.content.parts if candidate and candidate.content else None) or []
    fn_calls = [part.function_call for part in parts if part.function_call]
    if not fn_calls:
        break

    fn_response_parts = []
    for fn_call in fn_calls:
        tool_fn = TOOLS.get(fn_call.name)
        if tool_fn:
            kwargs = dict(fn_call.args)
            result = tool_fn(user_id=user_id, **kwargs)
            account_data[fn_call.name] = result
            fn_response_parts.append(
                genai_types.Part(
                    function_response=genai_types.FunctionResponse(
                        name=fn_call.name,
                        response={"result": result},
                    )
                )
            )

    if not fn_response_parts:
        break

    gemini_messages = gemini_messages + [
        candidate.content,
        genai_types.Content(role="user", parts=fn_response_parts),
    ]
    try:
        final_response = client.models.generate_content(
            model=MODEL, contents=gemini_messages, config=free_config
        )
    except genai_errors.APIError as e:
        ...
```

**After:**
```python
while True:
    choice = final_response.choices[0] if final_response.choices else None
    tool_calls = choice.message.tool_calls if choice and choice.message else None
    if not tool_calls:
        break

    # Append the assistant's tool_calls message to history
    messages.append(choice.message)   # already has role="assistant" and tool_calls

    for tc in tool_calls:
        tool_fn = TOOLS.get(tc.function.name)
        if tool_fn:
            import json as _json
            kwargs = _json.loads(tc.function.arguments)
            result = tool_fn(user_id=user_id, **kwargs)
            account_data[tc.function.name] = result
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": _json.dumps(result),
            })

    try:
        final_response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=openai_tools or None,
            tool_choice="auto" if openai_tools else None,
            max_tokens=MAX_TOKENS,
        )
    except OpenAIAPIError as e:
        import logging
        logging.error("QWEN API error (tool loop): %s", e)
        fallback = (
            "I'm having trouble connecting to our AI service right now. Please try again in a moment."
            if language == "en"
            else "ขณะนี้ไม่สามารถเชื่อมต่อกับระบบ AI ได้ กรุณาลองใหม่อีกครั้งในอีกสักครู่"
        )
        return AgentResponse(text=fallback, language=language)
```

### 6.6 — Extracting the final text response

**Before (lines 312–318):**
```python
raw_text = ""
final_candidate = final_response.candidates[0] if final_response.candidates else None
final_parts = (final_candidate.content.parts if final_candidate and final_candidate.content else None) or []
for part in final_parts:
    if hasattr(part, "text") and part.text:
        raw_text += part.text
```

**After:**
```python
final_choice = final_response.choices[0] if final_response.choices else None
raw_text = (final_choice.message.content or "") if final_choice else ""
```

### 6.7 — `_parse_gemini_response` — rename only

Rename to `_parse_llm_response` (optional but cleaner). The parsing logic itself does not change — it already handles JSON with markdown fence stripping and prose fallback, which is model-agnostic. Update the one call site at line 319.

---

## 7. Step 5 — api/copilot.py

**File:** `api/copilot.py`

This file only does simple text generation (no function calling). The change is straightforward.

**Before (lines 5, 9–28):**
```python
from config.settings import GEMINI_API_KEY

try:
    from google import genai as _genai
    _client = _genai.Client(api_key=GEMINI_API_KEY)
except Exception:
    logger.exception("Failed to initialise Gemini client — copilot features disabled")
    _client = None


async def _call(prompt: str) -> str:
    if not _client:
        return ""
    try:
        resp = _client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
        )
        return resp.text.strip()
    except Exception:
        logger.exception("Gemini copilot call failed — returning empty string")
        return ""
```

**After:**
```python
from config.settings import QWEN_BASE_URL, QWEN_API_KEY, MODEL

try:
    from openai import OpenAI as _OpenAI
    _client = _OpenAI(base_url=QWEN_BASE_URL, api_key=QWEN_API_KEY)
except Exception:
    logger.exception("Failed to initialise QWEN client — copilot features disabled")
    _client = None


async def _call(prompt: str) -> str:
    if not _client:
        return ""
    try:
        resp = _client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=512,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception:
        logger.exception("QWEN copilot call failed — returning empty string")
        return ""
```

The rest of the file (`suggest_reply`, `summarize_conversation`, `classify_sentiment`, `draft_reply_with_instruction`) requires **no changes** — they only call `_call()`.

---

## 8. Step 6 — db/vector_store.py (Embeddings)

**File:** `db/vector_store.py`

Replace the Gemini embedding client and batch function with an OpenAI-compatible embeddings call.

### 8.1 — Config constants (lines 23–25)

**Before:**
```python
_EMBED_MODEL = "models/gemini-embedding-001"
_EMBED_BATCH  = 20
_EMBED_RPM    = 1500
```

**After:**
```python
# Loaded from config — set QWEN_EMBED_MODEL and QWEN_EMBED_DIM in .env
from config.settings import EMBED_MODEL as _EMBED_MODEL, EMBED_DIM as _DIM, QWEN_EMBED_BASE_URL, QWEN_API_KEY
_EMBED_BATCH = 32   # tune based on your server's VRAM; start conservative
```

> **Important:** `_DIM` was previously hardcoded to `3072` (Gemini's dimension). It now must match your QWEN embedding model's actual output dimension. This is set via `QWEN_EMBED_DIM` in `.env`. If you get the dimension wrong, ChromaDB will reject vectors silently or error on query.

### 8.2 — Client init and batch function (lines 27–58)

**Before:**
```python
_gemini_client = None

def _get_gemini_client():
    global _gemini_client
    ...
    _gemini_client = _genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client

def _gemini_embed_batch(texts):
    client = _get_gemini_client()
    result = client.models.embed_content(model=_EMBED_MODEL, contents=texts)
    return [e.values for e in result.embeddings]
```

**After:**
```python
_embed_client = None

def _get_embed_client():
    global _embed_client
    if _embed_client is not None:
        return _embed_client
    try:
        from openai import OpenAI as _OpenAI
        _embed_client = _OpenAI(base_url=QWEN_EMBED_BASE_URL, api_key=QWEN_API_KEY)
        return _embed_client
    except Exception as exc:
        logger.warning("QWEN embedding client unavailable (%s) — falling back to word-hash", exc)
        return None


def _qwen_embed_batch(texts: list[str]) -> list[list[float]] | None:
    """Call QWEN embedding API for a batch of texts. Returns None on failure."""
    client = _get_embed_client()
    if client is None:
        return None
    try:
        result = client.embeddings.create(model=_EMBED_MODEL, input=texts)
        # OpenAI response: result.data is a list of Embedding objects, each has .embedding
        return [item.embedding for item in result.data]
    except Exception as exc:
        logger.warning("QWEN embed_content failed: %s — falling back to word-hash", exc)
        return None
```

### 8.3 — ChromaDB embedding function class (lines 97–120)

**Before:**
```python
class _GeminiEmbedFn(EmbeddingFunction):
    def __call__(self, input: Documents) -> Embeddings:
        ...
        vecs = _gemini_embed_batch(batch)
        ...
_embed_fn = _GeminiEmbedFn()
```

**After:**
```python
class _QwenEmbedFn(EmbeddingFunction):
    def __call__(self, input: Documents) -> Embeddings:
        results: list[list[float]] = [[] for _ in input]
        for start in range(0, len(input), _EMBED_BATCH):
            batch = list(input[start:start + _EMBED_BATCH])
            vecs = _qwen_embed_batch(batch)
            if vecs is not None:
                for i, vec in enumerate(vecs):
                    results[start + i] = list(vec)
            else:
                for i, doc in enumerate(batch):
                    results[start + i] = _word_embed(doc)
            if start + _EMBED_BATCH < len(input):
                time.sleep(0.05)
        return results

_embed_fn = _QwenEmbedFn()
```

### 8.4 — Update the module docstring

Change the top comment to reflect the new embedding model name and dimension.

---

## 9. Step 7 — dashboard/server/src/routes/copilot.js

**File:** `dashboard/server/src/routes/copilot.js`

This file makes direct HTTP REST calls to Gemini. Replace with calls to your QWEN server's OpenAI-compatible endpoint.

### 9.1 — URL and request format

**Before (lines 10–29):**
```javascript
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

async function callGemini(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: controller.signal,
  });
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}
```

**After:**
```javascript
const QWEN_URL = `${process.env.QWEN_BASE_URL}/chat/completions`;
const QWEN_API_KEY = process.env.QWEN_API_KEY || 'none';

async function callQwen(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(QWEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.QWEN_MODEL || 'qwen2.5-72b-instruct',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`QWEN ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}
```

Then find-and-replace all `callGemini(` with `callQwen(` throughout the file (4 call sites: summarize, draft, suggest-reply, sentiment).

### 9.2 — Error messages

Update strings like `'Gemini ${res.status}'` and `'AI Assist unavailable.'` log lines to reference QWEN for clarity — optional but helpful for debugging.

---

## 10. Step 8 — dashboard/server/src/lib/redis.js

**File:** `dashboard/server/src/lib/redis.js`

One line change — rename the rate limit key so it's correctly attributed in monitoring.

**Before (line 41):**
```javascript
geminiRate: (agentId) => `rate:gemini:${agentId}`
```

**After:**
```javascript
qwenRate: (agentId) => `rate:qwen:${agentId}`
```

Then update the one reference in `copilot.js` (line 35): `keys.geminiRate(agentId)` → `keys.qwenRate(agentId)`.

> If you have existing Redis keys in production with the old name, they will expire naturally (TTL is 60 seconds). No flush needed.

---

## 11. Step 9 — Classification Scripts

Both scripts are standalone utilities that only do simple text generation. The pattern is identical for both.

**Files:**
- `scripts/classify_tickets.py`
- `scripts/reclassify_ai_handling.py`

**Before (both files):**
```python
from google import genai
from google.genai import types as genai_types
...
_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
MODEL = "gemini-2.0-flash"
...
resp = _client.models.generate_content(model=MODEL, contents=..., config=cfg)
text = resp.text
```

**After (both files):**
```python
from openai import OpenAI
...
_client = OpenAI(
    base_url=os.environ["QWEN_BASE_URL"],
    api_key=os.environ.get("QWEN_API_KEY", "none"),
)
MODEL = os.environ.get("QWEN_MODEL", "qwen2.5-72b-instruct")
...
resp = _client.chat.completions.create(
    model=MODEL,
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ],
    max_tokens=256,
)
text = resp.choices[0].message.content or ""
```

> The JSON response parsing logic (markdown fence stripping + `json.loads`) requires **no changes** — it is model-agnostic.

---

## 12. Step 10 — Tests

**File:** `tests/test_agent_integration.py`

The `_gemini_response()` helper (lines 13–27) builds mock response objects. Replace with OpenAI-shaped mocks.

**Before:**
```python
def _gemini_response(text: str) -> MagicMock:
    part = MagicMock()
    part.text = text
    part.function_call = None

    content = MagicMock()
    content.parts = [part]

    candidate = MagicMock()
    candidate.content = content

    response = MagicMock()
    response.candidates = [candidate]
    return response
```

**After:**
```python
def _qwen_response(text: str) -> MagicMock:
    message = MagicMock()
    message.content = text
    message.tool_calls = None

    choice = MagicMock()
    choice.message = message

    response = MagicMock()
    response.choices = [choice]
    return response
```

Also update all `patch('google.genai...')` patch targets to `patch('openai.OpenAI')` or wherever the client is instantiated in `engine/agent.py`.

---

## 13. Step 11 — ChromaDB Reindex

**This step is mandatory.** Embedding vectors are model-specific — vectors produced by `gemini-embedding-001` (3072-dim) are incompatible with any QWEN embedding model. Querying with mismatched vectors will return garbage results.

### Option A — Delete and rebuild (recommended for clean start)

```bash
# 1. Back up existing ChromaDB data
cp -r ./data/chroma ./data/chroma_gemini_backup

# 2. Delete the existing collection data
rm -rf ./data/chroma

# 3. Re-run the ingestion pipeline with QWEN embeddings active
python ingestion/ingest_knowledge.py   # or whatever the ingestion entry point is

# 4. Verify count
python -c "from db.vector_store import collection_count; print(collection_count())"
```

### Option B — In-place reindex (use existing reindex script)

```bash
# The script already handles re-embedding all docs in the collection.
# After updating db/vector_store.py to use QWEN, simply run:
python scripts/reindex_embeddings.py
```

> Note: `scripts/reindex_embeddings.py` imports from `db/vector_store.py` and calls `_gemini_embed_batch()` directly. Rename that function call to `_qwen_embed_batch()` in the script before running.

### Verifying embedding dimension

After reindex, confirm the dimension is correct:

```python
from db.vector_store import get_collection
col = get_collection()
sample = col.get(limit=1, include=["embeddings"])
print(len(sample["embeddings"][0]))  # must match QWEN_EMBED_DIM in .env
```

---

## 14. Step 12 — Validation Checklist

Run through these after all code changes and before going live:

- [ ] `python -c "from config.settings import MODEL, EMBED_MODEL; print(MODEL, EMBED_MODEL)"` — prints QWEN model names, not Gemini
- [ ] API server starts without error: `uvicorn api.main:app --reload`
- [ ] Send a test chat message via the widget — should get a JSON response from QWEN
- [ ] Function calling works: send a KYC or withdrawal query — check logs to confirm tool call is made and account data is returned
- [ ] Escalation works: send a message with confidence < 0.6 — check escalation path fires
- [ ] Thai language test: send a Thai message — confirm Thai response returned
- [ ] Copilot summarize: call `POST /api/copilot/summarize` from the dashboard — should return a 3-line summary
- [ ] Copilot draft: call `POST /api/copilot/draft` — should expand shorthand
- [ ] Embedding sanity: `python -c "from db.vector_store import query; print(query('how to reset password', n_results=2))"` — should return relevant chunks, not empty
- [ ] Classification script (optional): run `python scripts/classify_tickets.py` on a small sample
- [ ] Run existing tests: `pytest tests/` — all should pass with new mocks
- [ ] Rate limit key in Redis updated: confirm `rate:qwen:*` keys appear (not `rate:gemini:*`)

---

## 15. Pitfalls & Notes

### Function calling — most likely failure point

If QWEN returns tool calls as plain text (e.g. `<tool_call>{"name": "get_user_profile"...}</tool_call>`) instead of structured `tool_calls` objects, the function calling loop in `engine/agent.py` will fail silently (no tool call detected → model gives holding message instead of account data).

**Fix:** Ensure `--enable-auto-tool-choice` and `--tool-call-parser hermes` are passed to vLLM. Alternatively, for QWEN models that do not support native tool calling, implement a prompt-based tool calling fallback:
- Describe available tools in the system prompt as JSON schema
- Instruct the model to output `{"tool_call": {"name": "...", "args": {...}}}` when it needs to call a tool
- Parse this from the text response in the tool calling loop instead of reading `choice.message.tool_calls`

### Response JSON format

The existing `_parse_gemini_response()` (to be renamed `_parse_llm_response()`) already handles:
- Clean JSON
- JSON wrapped in markdown code fences
- Prose followed by JSON
- Pure prose fallback

QWEN models generally comply with structured JSON instructions well, but during testing watch for variations like QWEN adding a preamble before the JSON block — the existing parser handles this already.

### Thai language quality

QWEN2.5 models have strong Thai language support. However, if response quality in Thai is noticeably worse than Gemini, consider:
- Using a larger model (72B vs 7B)
- Adding explicit Thai language instruction to the system prompt (already present in `engine/prompt_templates.py`)

### Token count differences

QWEN uses a different tokenizer than Gemini. `MAX_TOKENS=1024` in settings is a safe default, but you may find responses getting cut off or being overly brief. Tune upward to 2048 if needed.

### Removing `google-genai`

After confirming everything works, remove `google-genai` from `requirements.txt` and run `pip uninstall google-genai google-generativeai` to keep the environment clean.

### Concurrency (classification scripts)

`scripts/classify_tickets.py` uses `concurrent.futures.ThreadPoolExecutor` with 20 workers. The OpenAI SDK is thread-safe, so this requires no change. Tune the worker count based on your QWEN server's throughput capacity.
