# PS / PSP ROI Agent

A lightweight ROI assistant for Lenovo PS and PSP sales conversations.

The app:

- Collects ROI inputs through English natural-language chat
- Applies benchmark values when the customer says they do not know a value
- Calculates baseline, PS, and PSP ROI with deterministic formulas
- Uses GPT-4o mini for slot filling and final sales messaging when configured
- Falls back to local extraction and local sales copy when no model key is available

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

## Test

```bash
npm test
```

## GPT-4o mini Setup

The browser never receives the API key. The server reads these environment variables:

```bash
OPENAI_API_KEY=your-key \
OPENAI_BASE_URL=https://aiverse-row.ludp.lenovo.com/ics-apps/projects/115/smartfind-agent/aiverse/endpoint/v1 \
OPENAI_MODEL=gpt-4o-mini \
npm run dev
```

`OPENAI_MODEL` is optional and defaults to `gpt-4o-mini`.

Legacy `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` are still accepted as fallback names.

## GitHub Pages Demo

The app can run as a static GitHub Pages demo. The page includes an **LLM Settings** panel:

- Base URL is prefilled with the Lenovo endpoint.
- Model is prefilled with `gpt-4o-mini`.
- Paste the API key once and click **Save LLM Settings**.
- The key is saved only in the current browser's local storage.

For the LLM features to work, open the page while connected to the company VPN that can reach the Lenovo endpoint. If the endpoint is unavailable or blocked by browser network policy, the app still works with local fallback extraction and local sales copy.

GitHub Pages setup:

1. Push this folder to a GitHub repository.
2. In GitHub, open **Settings > Pages**.
3. Select **Deploy from a branch**.
4. Select branch `main` and folder `/root`.
5. Open the generated GitHub Pages URL.

## Required Inputs

The assistant collects these customer inputs:

- `devices_in_scope`, benchmark `10000`
- `blended_end_user_cost`, benchmark `60`
- `blended_it_support_cost`, benchmark `40`
- `baseline_incidents_per_device`, benchmark `0.6`
- `baseline_avg_it_time_per_incident`, benchmark `1`
- `baseline_avg_downtime_per_incident`, benchmark `2`
- `share_of_incidents_causing_downtime`, benchmark `0.8`
- `share_of_incidents_requiring_onsite`, benchmark `0.2`
- `avg_onsite_cost_per_claim`, benchmark `250`
- `ps_price_per_device`, benchmark `30`
- `psp_price_per_device`, benchmark `50`

## Architecture

```text
src/
  agent/
    dialogueManager.js       # dialogue state, validation, benchmark handling
    ruleExtractor.js         # local fallback extraction
  calculators/
    psPspRoiCalculator.js    # deterministic PS / PSP formulas
    registry.js
  domain/
    schema.js                # input field definitions and benchmarks
  llm/
    clientExtractor.js       # browser-to-server extraction bridge
    serverProvider.mjs       # OpenAI-compatible GPT-4o mini calls
  output/
    pitchGenerator.js        # server pitch call plus local fallback
  utils/
    format.js
```
