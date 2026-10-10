# MandiNet — Parts 1–5

One Next.js / TypeScript application with a pure deterministic calculator and a multilingual farmer interface. Node 24 or 26+ is required by the installed test runner. This is a local hackathon implementation, not a deployed service.

```sh
npm install
npm test
npm run validate:i18n
npm run typecheck
npm run build
npm run dev
```

The app runs at http://localhost:3000. To use the existing in-app browser address, run `npm run dev -- --hostname 127.0.0.1 --port 3000`. For a production smoke check, run `npm run build` then `npm start`.

## Farmer interface

The initial page loads verified official Agmarknet filters and `/api/markets`. Select state, district, crop, variety and a date, optionally one market, then refresh. Live price access currently requires CAPTCHA or an authorized token; the actual failure is shown, never replaced with synthetic observations. Use the explicit official-export import or **Try demonstration**. The same calculator updates every card on edits and on the shared minimum/modal switch. Real-market financial inputs start blank; costs are keyed by stable market ID and retained across dates/refreshes and demo switching.

Loading, unloading, weighing, packaging, farmer-paid commission/charges and other selling expenses each support an entered estimate, confirmed zero, included-in-parent expense or unknown. Charging bases are fixed total, per kg, per quintal and per load. Unknown or unresolved parent costs keep net proceeds incomplete. The original flat expense API is preserved, but the interface uses only its itemized replacement.

No universal payload, mileage, fuel price, labour rate or compulsory fee is assumed for real records. A fuel/mileage copy-to-all action is explicit. The road-distance limit uses a current Google outward route when available, otherwise an explicitly entered manual road distance. Unknown distances leave prices visible but suppress the best badge. Geolocation is click-only and never pretends to identify a village without reverse geocoding.

All active controls use the shared outlined field components in `src/app/components/form-fields.tsx`: light backgrounds, thin borders, labels inset into the top border, localized required/optional status, linked hints/errors, native dropdown arrows and native date calendars. Location inputs use three columns on very wide screens, two on tablets and one on narrow phones. Optional observation-date filters are inclusive and do not relax freshness; reversed date ranges show an error and suppress the winner badge. Activating the fixed-date demo clears date filters.

## Calculator contract

Public functions and types are exported from `src/lib/calculator/index.ts`. The calculator never reads the clock, environment, network or storage. The comparison clock is supplied as `freshness.asOfEpochMs`.

- `convertQuantity`: positive finite kg, quintal, tonne or bags with explicit positive kg per bag. Returns kg and quintals; invalid quantities return null and reasons.
- `calculateLoads`: positive confirmed payload; ceiling of total kg / payload. The result describes loads/trips, not vehicles.
- `calculateTransport`: owned round-trip fuel with separate loaded/empty mileage, editable fuel price, a visible return-distance assumption and confirmed TOTAL driver/toll/other costs. Hired whole-job quote applies once; per-round-trip-load quote scales with loads. Every category must be explicitly included/excluded. Only excluded categories' confirmed TOTAL supplemental costs are added; bundled fuel is never counted again.
- `calculateSellingExpenses`: resolves itemized charging bases and inclusion references without double counting; rejects cycles, unknown parents, duplicate or missing categories. It also preserves the original confirmed-total input.
- `calculateSaleScenarios`: gross = quintals × price per quintal; estimated net sale proceeds = gross − transport − confirmed farmer-borne selling expenses. Unknown inputs stay null. Confirmed zero is valid. Reported modal and reported minimum scenarios stay separate. Negative net values are allowed.
- `evaluateObservation`: matching crop/variety (trimmed, case insensitive, no fuzzy match), valid date and prices, valid price unit, dataset separation, future/stale detection and explicit exclusion reasons.
- `compareMarkets`: complete eligible estimates ranked separately for each scenario. Suppresses best badges if any otherwise eligible comparison is incomplete, on a tie, or with fewer than two complete candidates. No best badge claims anything beyond the eligible provided comparisons.

Decimal arithmetic prevents fractional payload boundary errors. Currency rounds to nearest paise, with halves away from zero, at each reported monetary line. Litres and quantity are not rounded for calculation. Invalid inputs and overflow produce reasons, never NaN/Infinity net values. Runtime numeric/date validation accompanies the TypeScript schemas; future external JSON/import endpoints must validate full object shapes before calling these functions.

## Date policy

Date-only observations are strict `YYYY-MM-DD` Kolkata calendar dates. The configurable demo maximum age is 2, inclusive: today, yesterday and the day before are eligible; three days old is stale. This is a demonstration freshness policy, not a claim about an official market reporting standard.

## Synthetic fixtures

`src/lib/demo/synthetic-fixtures.ts` is explicitly synthetic. A and B are fictional, share one demo crop/variety and use observation date **2000-01-07**, with a fixed comparison reference date **2000-01-08**. C is dated **2000-01-01** and excluded as seven calendar days old. There are no government source URLs, verified locations, retrieval timestamps or coordinates. The UI repeats the synthetic label prominently. Synthetic records require explicit `dataset: "synthetic"`; the default reported ranking excludes them. Production uses an injected current clock, never the demo clock.

At 20 quintals and a confirmed 1,500 kg usable payload (two loads):

| Example | Modal / quintal | Minimum / quintal | Transport total | Selling total | Modal net | Minimum net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 2,200 | 2,100 | 800 | 400 | 42,800 | 40,800 |
| B | 2,250 | 2,120 | 2,800 | 400 | 41,800 | 39,200 |

All figures are INR. Modal is not average; reported minimum is not a crop grade. The UI uses these same functions for every financial value.

The ₹400 selling expense in each demo is loading ₹200, unloading ₹150 and other selling ₹50; weighing, packaging and commission are explicitly confirmed zero. All demo hire inclusions are explicit. Fuel is included and never added again.

## Languages and scripts

The local UTF-8 registry contains English plus all 22 requested Indian languages, searchable by native name or English name. Each complete dictionary has 157 essential keys with matching interpolation placeholders. English and 20 Indian-language dictionaries are key-complete; **Bodo and Kashmiri are partial (English fallback)** because the bulk translation service did not support them. Their selector entries and the page show a partial/fallback notice. Dictionary validation explicitly verifies this disclosed exception, not full translated coverage of all 23 locales.

Translations are machine-generated, mainly through bulk public Google Translate requests during implementation, with model-generated additions/repairs. No fluent-speaker review has occurred. There is no runtime translation network request. Language switching preserves current form values/results; only the language preference is persisted across reloads. Date/currency formatting uses available `Intl` locale support and can fall back to system-supported formats.

Default scripts: Kashmiri and Sindhi use Arabic (RTL), Urdu is RTL; Meitei uses Meitei Mayek (LTR); Santali uses Ol Chiki (LTR). Other scripts and directions are declared in `src/lib/i18n/index.ts`. Local Noto Meetei Mayek and Noto Ol Chiki font files are included with SIL Open Font License texts. The combined font files are approximately 187 KB; no large multilingual font bundle was installed.

Browser inspection covered English, Hindi, Gujarati, Tamil, Bengali and Urdu, plus Meitei and Santali; it was layout/rendering inspection, not linguistic review. Verified CSS viewport width and scroll width were both 360px for those eight locales. Urdu's RTL layout and local Mayek/Ol Chiki font readiness were checked.

## Integration seams and blockers

No pre-existing data.gov.in provider or credentials were present. No data.gov.in integration was removed, and missing DATA_GOV_IN_API_KEY does not select demo mode. The public Agmarknet filter integration works. Real price acquisition is blocked by the report endpoint's CAPTCHA/token requirement. Manual official CSV/JSON import is implemented, but no authentic price export was supplied to verify real prices end-to-end. Verified market IDs/names are available, including Rajkot APMC (60), Gondal APMC (61) and Jetpur(Dist.Rajkot) APMC (1615), all in Gujarat (11), Rajkot (157); no coordinates or road distances have been invented. Google routing is implemented but unverified live because its key is missing. Cline is implemented with mock-model SDK smoke coverage but lacks live provider configuration.

Explain now uses the restricted server-side Cline endpoint with a calculator-only fallback when unavailable; the earlier unconnected status is superseded by Part 5 below. Directions require verified coordinates and are disabled for the fictional demonstration. No arbitrary agent tools, credentials, embedded map, login or payments have been introduced.

## Restricted Cline comparison assistant (Part 5)

The starting commit did not contain the stated SDK/seam/smoke test. After explicit user approval, installed/pinned `@cline/sdk` **0.0.92** and read its actual installed declarations and official [SDK examples](https://github.com/cline/cline/tree/main/apps/examples) / [custom-tool docs](https://github.com/cline/cline/blob/main/docs/sdk/tools.mdx). This uses plain `Agent`, not `ClineCore`: no built-in host tools, workspace config discovery, MCP, plugins or provider-executed tools. Only `get_market_observations` and `calculate_sale_scenarios` are registered. Both take no arguments and are closed over this exact comparison; model-invented records, prices or costs are rejected. The calculator tool requires observation reading first and reuses the unchanged pure TypeScript calculator.

Set server-only **CLINE_PROVIDER_ID**, **CLINE_MODEL_ID**, **CLINE_PROVIDER_API_KEY** privately in `.env.local`, then restart. No defaults or real keys are committed. Allowed HTTP provider IDs: `cline`, `anthropic`, `openai`, `gemini`; agent-backed/CLI providers are disallowed. Choose a provider-supported tool-capable model. GET `/api/agent/explain` exposes only presence booleans. All three were absent: **no genuine live provider execution is claimed**. A dummy-key failure is not success.

Reported observations are snapshotted by the existing validated provider/import response, with random IDs bound to an HttpOnly/SameSite=Strict owner cookie, a 15-minute expiry and 200-snapshot limit. Other owners cannot read them. Demo explicitly loads server-side synthetic fixtures; real failures never substitute demo. The browser supplies record IDs and displayed assumptions/scenario, not authoritative prices. The server recalculates from its own observations and rejects changed results. Historical freshness uses the selected Kolkata date; the current UI clock must be within two minutes of the server. Refresh expired real observations before explaining again. Village text and precise GPS/origin coordinates are not sent to the AI; quantities/cost assumptions and market observations are sent to the configured provider after Explain is requested.

Limits: 25 seconds, six SDK iterations, four tool invocations, two requests/minute per owner, two concurrent requests/process, 20 observations and 150 KB/request. The UI prevents duplicates, aborts obsolete requests and invalidates explanations on comparison/mode/scenario/language changes. NDJSON activity comes from actual SDK tool/model-turn events; private reasoning/transcripts/raw provider errors are never sent to the UI. Limits and snapshots are ephemeral/process-local, not a distributed production security boundary.

AI returns a winner ID and explanation categories only. They are validated against calculator facts and must include applicable incomplete/stale/exclusion warnings. The UI renders them through English/Hindi/Gujarati templates, inserting money directly from deterministic outputs; arbitrary AI prose/arithmetic/financial fields are not accepted. Other languages visibly disclose English fallback for assistant wording, with existing calculation labels localized. Missing configuration, provider/output failure or timeout shows **AI explanation unavailable** and a labelled **calculation summary**, not successful SDK execution. SDK smoke tests use a mock model over synthetic fixtures: actual SDK loop/tool tests, **not genuine live-provider verification**.

Installation audit: **34 vulnerabilities (5 low, 11 moderate, 14 high, 4 critical)**, including transitive SDK-chain reports. No broad/forced audit fix was applied. Dependency remediation and provider/privacy review remain prerequisites for public deployment. This local phase does not deploy the application.

Setup followed the [official Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation) and [Vitest guide](https://vitest.dev/guide/); installed versions are pinned with a lockfile.

## Google location and road routing (Part 4)

Create a private `.env.local` using the blank settings in `.env.example`. Set **GOOGLE_MAPS_API_KEY** on the server only, then restart Next.js. In that Google Cloud project enable **Places API (New)** and **Routes API**, enable billing, restrict the key to those APIs and the server's egress IP where practical, and set quotas/billing alerts. Do not use a `NEXT_PUBLIC_` variable or browser/referrer-only restrictions for this server key. No key was configured during implementation, so **zero live Google origins, verified yard destinations or routes are claimed**. GET `/api/location/google` reports only a configuration boolean; missing-key POST requests return 503 with an explicit configuration error.

The server integration follows the current official [Places Autocomplete](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete), [Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details), [Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search), [route matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix) and [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) contracts. Requests use fixed Google endpoints, eight-second timeouts, no-store responses and narrowly selected fields. The POST application endpoint rejects cross-Origin requests and accepts only named application actions, not arbitrary network URLs. Add deployment-appropriate abuse protection/rate limits before exposing a billed endpoint publicly; this phase is local only.

- Village search is India-restricted, debounced 350ms, and uses a UUID autocomplete session token. A Google-returned administrative viewport biases the selected region when available; no region coordinates are invented. Suggestions show full Google text; Place Details is fetched only after selection. Name/address/coordinates remain session-only. Typing alone never confirms an origin, edits invalidate it, and state/district mismatches block confirmation until corrected. Google results use English names/address components to compare official region labels; the added interface messages are English/Hindi/Gujarati with a visible English-fallback notice for other languages. New translations are model-generated and have not had fluent-speaker review.
- Current location is requested only after a button click and browser permission. Accuracy is displayed when provided and coordinates require explicit confirmation. GPS is never persisted. “Remember my village” stores **only the Google Place ID**; reuse fetches fresh details and does not fall back to stored coordinates. Change/Forget controls are available. Google attribution accompanies displayed Google results, including third-party attribution when supplied, following [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies). Public local `/terms` and `/privacy` pages link Google's terms/privacy and describe location processing; review them and the applicable policies before any public deployment.
- Routing covers at most three canonical real markets from the selected subset, not a claim that they are the nearest. When price observations are absent, verified official market metadata still supplies this bounded shortlist. Search uses the full market name, district and state; political/town results are excluded and the farmer must confirm the actual yard candidate. Destinations stay linked to canonical market IDs, session-only. No real destinations are assigned to the synthetic A/B/C records. Unresolved destinations disable routing/directions; manual distance fields remain available even without a price record.
- Two bounded matrices request outward 1×N and return N×1 driving legs independently. Required masks include both indices, status, condition, distance and duration; elements are mapped by indices, not response order. Metres convert consistently to kilometres. Failed/missing legs remain unavailable, partial failures do not erase successful legs, and obsolete-origin/destination responses are ignored. General driving routes are road estimates, **not verified tractor-access routes**.
- Changing an origin/destination clears affected fetched distances but preserves explicit manual distances, quotes, mileage, fuel price and itemized expenses. Manual distances are labelled unverified. Return equals outward remains an explicit user assumption, not an automatic route. The pure financial calculator is unchanged: whole-job hire applies once, per-load quotes multiply by loads, and included fuel is never added again. Unknown prices/units/costs still block a complete estimate.
- Directions uses confirmed origin and verified destination coordinates/Place IDs in an encoded Google Maps URL. It is disabled for missing origins, unresolved yards and fictional demo markets. No embedded map was added.

With a configured key, verify one village suggestion → Details → confirmation, confirm the actual mandi yard, then click “Fetch outward and return road distances” and inspect both legs before using the estimate. Opening directions sends those selected locations to Google Maps. Live village-selection and destination-link browser checks could not be completed without configuration; unit tests use explicitly synthetic test-only Google shapes, never runtime fake destinations.

## Agmarknet contract and evidence (Part 3)

Inspected [reference README/client/reference document](https://github.com/makrand999/agmarknet-api) at commit `89d9f0d74a4775f8f3c4c44eb3545372ef7155fd`. No licence file/declaration was present; no Python code was copied or installed. The independent TypeScript adapter uses the verified protocol:

- GET `https://api.agmarknet.gov.in/v1/daily-price-arrival/filters`: HTTP 200; actual canonical IDs/names and dependency arrays parsed. The frontend receives 36 state/UT choices, 4,175 markets, 605 commodities; All sentinels are removed.
- POST `https://api.agmarknet.gov.in/v1/prices-and-arrivals/market-report/daily`: JSON `{date, marketIds, stateIds, includeExcel:false}`. A returned-ID probe for Gujarat/Rajkot markets returned HTTP 400, code `TOKEN_OR_CAPTCHA_REQUIRED`, detail `Captcha key and captcha value are required.` No CAPTCHA automation, token guessing or protected-access bypass was attempted. **Zero real price records retrieved.** A future successful price-response shape must be verified before normalization; unknown response shapes fail closed, rather than guessing fields.
- Official frontend asset `https://agmarknet.gov.in/static/js/main.2dd03766.js` includes both generic price-unit and rupees/quintal strings. Those strings alone do **not** establish the unit of an unavailable report. No universal government price unit is assumed. Imported units require an explicit `INR/quintal` (or Rs./quintal / ₹/quintal) declaration and user-supplied evidence from the official export/header; evidence is preserved and shown, not independently authenticated.
- Live queries are **exact-date only**. Imports select latest on/before the selected date per market/crop/variety/grade, never a later observation. Historical views show a prominent warning and use the selected Kolkata calendar date for the inclusive two-day freshness check. Current views use the actual clock. This is the existing application policy, not an official freshness guarantee.
- Server requests time out after 8 seconds and retry transient failures once (not CAPTCHA/ordinary 4xx). Filter cache: 5 minutes; successful report cache: 1 minute, keyed by endpoint + filters. Last good cached filter/local-import snapshots retain their original retrieval/observation dates on refresh failure and are visibly labelled. District report requests are limited to 20 markets; larger districts require selecting one. No nationwide history sweep or paginated report schema is claimed.

## Official export fallback

On the **local** page expand “Import official CSV / JSON export”. Upload is limited to 2 MB / 5,000 rows and only accepted with matching localhost Origin. It is not a publicly deployed upload endpoint. Files stay in browser/server memory for that request; no uploaded file is written, no arbitrary URL is fetched, and page reload clears the upload. For protected deployment, configure the server-only `MANDINET_IMPORT_PATH` to an administrator-provided JSON file instead. Never expose that path via NEXT_PUBLIC variables or commit official/private exports or `.env` files.

CSV columns (rename official export headers to this documented adapter schema; preserve canonical source IDs, do not manufacture them):

```text
source_record_id,market_id,market_name,state_id,state_name,district_id,district_name,crop_id,crop_name,variety_id,variety_name,grade,observation_date,minimum_price,modal_price,maximum_price,price_unit
```

IDs/names and observation_date are required. source_record_id, grade, all three prices and price_unit may be blank. Dates accept YYYY-MM-DD or DD/MM/YYYY; date-only values mean Asia/Kolkata. Prices must be positive numbers without thousands separators, or blank; inconsistent min/modal/max are rejected. Unknown units keep raw prices visible in excluded records but block authoritative money calculations. Missing expenses remain unknown.

For CSV, enter the official HTTPS source URL, original ISO retrieval timestamp with timezone, declared unit and its evidence in the outlined fields. JSON uses `{ "metadata": { "sourceUrl": "…", "retrievedAt": "…", "priceUnit": "…", "unitEvidence": "…" }, "records": [ … ] }` with the same row keys. Fill these from the actual export, not this README. Source URLs are restricted to the official Agmarknet/data.gov.in domains and must not contain credentials. Imported provenance is clearly labelled **user-supplied**, not independently authenticated. Source record ID, endpoint, acquisition mode, raw unit/prices, maximum price, grade, observation/retrieval dates remain available in card details. Coordinates stay unavailable.

Original 157-key translations are preserved. New provider/import messages are supplied in English, Hindi and Gujarati (unreviewed); other languages show a visible scoped English-fallback notice. Bodo/Kashmiri remain partial. No runtime translation service was added.
