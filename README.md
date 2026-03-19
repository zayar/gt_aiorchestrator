# ai-orchestrator-gt

GreatTime clinic Voice AI orchestrator for investor demo and future `VoiceConsultanceAi` client integration.

## What It Does

- Accepts transcript or audio-backed requests.
- Runs a two-step `analyze` -> `confirm/execute` flow for risky actions.
- Uses GreatTime bearer-token pass-through with optional refresh-token retry.
- Grounds booking, sales, stock, and recommendation flows in real `gt.apicore` GraphQL data.
- Keeps `gt.apicore` as the source of truth for operational validation and writes.

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

## Development

```bash
npm install
npm run dev
```

## Suggested Next Backend Enhancements

1. Add a dedicated `bookingPreview` / `bookingReschedulePreview` resolver in `gt.apicore`.
2. Add a report resolver that returns seller + practitioner leaderboard summaries in one payload.
3. Add a purpose-built catalog query for service-to-product recommendation payloads.
4. Replace in-memory preview/idempotency storage with Redis or Firestore for multi-instance safety.
