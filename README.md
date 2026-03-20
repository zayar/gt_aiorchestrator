# ai-orchestrator-gt

GreatTime clinic Voice AI orchestrator for investor demo and future `VoiceConsultanceAi` client integration.

## What It Does

- Accepts transcript or audio-backed requests.
- Runs a two-step `analyze` -> `confirm/execute` flow for risky actions.
- Uses GreatTime bearer-token pass-through with optional refresh-token retry.
- Grounds booking, sales, stock, and recommendation flows in real `gt.apicore` GraphQL data.
- Keeps `gt.apicore` as the source of truth for operational validation and writes.
- Supports production-ready audio transcription with OpenAI Whisper and transcript understanding with Gemini Flash when those providers are configured.

## Current First-Pass Scope

- `booking.create`
- `booking.reschedule`
- `booking.cancel`
- `booking.availability_check`
- `sale.create`
- `sale.quote`
- `inventory.check`
- `recommend.products_for_service`
- `report.booking_summary`
- `report.sales_summary`
- `report.practitioner_summary`

## API Shape

### `POST /api/gt/voice/analyze`

Analyzes transcript or audio input and returns:

- detected intent
- confidence
- resolved entities
- clarification payloads
- confirmation-ready action previews
- recommendation payloads
- factual report summaries for read-only flows

### `POST /api/gt/voice/query`

Alias for analyze with direct handling of read-only flows.

### `POST /api/gt/action/confirm`

Executes a previously analyzed action after explicit confirmation and idempotency validation.

### `GET /health`

Service health check.

## GreatTime Auth Alignment

- Client sends the same GT access token used by `gt.business` in `Authorization: Bearer <token>`.
- Client may also send `x-gt-refresh-token` so this service can retry once through `gtAuthRefresh` if `gt.apicore` rejects an expired token.
- Clinic and user context are derived from token claims first, then reconciled with request payload when provided.
- The mobile app should keep refresh logic client-side as the primary path and treat server-side refresh retry as a resilience layer, not the main session store.

## Model Providers

- `STT_PROVIDER=openai_whisper` enables direct audio-to-text transcription through OpenAI Whisper.
- `LLM_PROVIDER=vertex_gemini` enables Gemini Flash intent classification and entity hint extraction.
- If either provider is unavailable, the service falls back safely:
  - transcript input still works without Whisper
  - deterministic regex routing still works without Gemini

See [.env.example](/Users/zayarmin/Development/Cashflow%20Platform/ai-orchestrator-gt/.env.example) for the expected environment variables.

## Catalog Grounding

Recommendations are grounded through GreatTime catalog data:

1. `services`
2. `products` + `product_stock_item`
3. `serviceProductStockItems`
4. `serviceProductStockItemUsages`

This lets the orchestrator recommend only real product items linked to real services.

## Known Backend Gaps

- No dedicated purpose-built voice orchestration API exists yet in `gt.apicore`; this service wraps existing GraphQL contracts.
- Reschedule and cancel currently rely on generic booking update flows rather than a dedicated mutation with richer domain-side validation.
- Seller-vs-practitioner performance reporting is split across different report resolvers and may need one clinic-facing summary resolver later.
- Durable audit persistence and distributed idempotency storage are not yet implemented; first pass uses structured logs and in-memory TTL stores.
- Real-time streaming transcription is still not wired; the current production path is upload-complete audio to Whisper, then structured intent classification with Gemini.

## Development

```bash
npm install
npm run dev
```

## CI/CD to Cloud Run

This repo now includes automatic deployment on push to `main` via:

- [deploy-cloud-run.yml](/Users/zayarmin/Development/Cashflow%20Platform/ai-orchestrator-gt/.github/workflows/deploy-cloud-run.yml)
- [Dockerfile](/Users/zayarmin/Development/Cashflow%20Platform/ai-orchestrator-gt/Dockerfile)
- [.dockerignore](/Users/zayarmin/Development/Cashflow%20Platform/ai-orchestrator-gt/.dockerignore)

### Recommended GitHub Variables

Set these in GitHub at:
`Repo -> Settings -> Secrets and variables -> Actions -> Variables`

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `CLOUD_RUN_SERVICE`
- `ARTIFACT_REGISTRY_REPOSITORY`
- `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`
- `GT_APICORE_URL`
- `DEFAULT_TIMEZONE`
- `STT_PROVIDER`
- `LLM_PROVIDER`
- `VERTEX_REGION`
- `VERTEX_MODEL`

Suggested values for the current production target:

- `GCP_REGION=us-central1`
- `CLOUD_RUN_SERVICE=gt-aiorchestrator`
- `ARTIFACT_REGISTRY_REPOSITORY=gt-aiorchestrator`
- `GT_APICORE_URL=https://greattime-api-core-hs6rtohe3q-uc.a.run.app/apicore`
- `DEFAULT_TIMEZONE=Asia/Yangon`
- `STT_PROVIDER=openai_whisper`
- `LLM_PROVIDER=vertex_gemini`
- `VERTEX_REGION=us-central1`
- `VERTEX_MODEL=gemini-2.5-flash`

### Recommended GitHub Secrets

Set these in GitHub at:
`Repo -> Settings -> Secrets and variables -> Actions -> Secrets`

Authentication to Google Cloud:

- easiest first pass: `GCP_SA_KEY`
- more secure later: `WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`

App/runtime secrets:

- `OPENAI_API_KEY`
- optional: `OPENAI_ORG_ID`
- optional: `OPENAI_API_KEY_SECRET`

If `OPENAI_API_KEY_SECRET` is set, the workflow will bind the Cloud Run env var from Secret Manager.
If it is not set, the workflow will fall back to the plain `OPENAI_API_KEY` GitHub secret.

### One-Time GCP Setup

1. Enable the required APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com
```

2. Create a runtime service account for Cloud Run:

```bash
gcloud iam service-accounts create gt-aiorchestrator-runtime \
  --display-name="GT AI Orchestrator Runtime"
```

3. Grant the runtime service account access to Vertex AI:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gt-aiorchestrator-runtime@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

4. Create a deployer service account for GitHub Actions:

```bash
gcloud iam service-accounts create github-actions-gt-aiorchestrator \
  --display-name="GitHub Actions Deployer for GT AI Orchestrator"
```

5. Grant deploy permissions:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions-gt-aiorchestrator@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions-gt-aiorchestrator@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.admin"

gcloud iam service-accounts add-iam-policy-binding \
  gt-aiorchestrator-runtime@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:github-actions-gt-aiorchestrator@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

6. Beginner-friendly auth setup: create one service account key and save it as the `GCP_SA_KEY` GitHub secret:

```bash
gcloud iam service-accounts keys create github-actions-gt-aiorchestrator-key.json \
  --iam-account=github-actions-gt-aiorchestrator@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Store the JSON content from `github-actions-gt-aiorchestrator-key.json` in the GitHub secret `GCP_SA_KEY`.

If you prefer stricter permissions later, create the Artifact Registry repository once, then you can reduce that deployer role from `roles/artifactregistry.admin` to `roles/artifactregistry.writer`.

### First Deploy Flow

After the variables and secrets are configured:

1. Push to `main`
2. GitHub Actions builds the service
3. GitHub Actions builds and pushes the container image to Artifact Registry
4. GitHub Actions deploys the latest image to Cloud Run

You can also trigger it manually from:
`GitHub -> Actions -> Deploy GT AI Orchestrator -> Run workflow`

### Later Security Upgrade

The workflow already supports Workload Identity Federation.
Once you are comfortable, you can replace `GCP_SA_KEY` with:

- `WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

That removes the need to store a long-lived Google service account key in GitHub.

## Suggested Next Backend Enhancements

1. Add a dedicated `bookingPreview` / `bookingReschedulePreview` resolver in `gt.apicore`.
2. Add a report resolver that returns seller + practitioner leaderboard summaries in one payload.
3. Add a purpose-built catalog query for service-to-product recommendation payloads.
4. Replace in-memory preview/idempotency storage with Redis or Firestore for multi-instance safety.
