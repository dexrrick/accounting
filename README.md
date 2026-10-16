# 📊 IFRS & SFRS(I) Accounting Double-Entry Assistant

An accounting assistant for **IFRS** and **Singapore SFRS(I)** scenarios. It interprets natural-language transactions, constructs and checks double-entry journal suggestions, and retrieves relevant accounting standards and Singapore statutory guidance. Coverage, evidence quality, and applicability depend on the question and available authoritative sources; outputs require professional review before use in financial reporting or regulatory filings.

---

## 🌟 Key Highlights

* **Dual-Framework Support**: Models scenarios under **Singapore Financial Reporting Standards (International) [SFRS(I)]** and **International Financial Reporting Standards [IFRS]**, subject to scenario coverage and source verification.
* **Scenario Interpretation**: Extracts relevant transaction facts (such as costs, discounts, financing, GST, leases, and FX rates), with deterministic accounting logic and AI-assisted interpretation where appropriate.
* **Live Foreign Exchange Integration**: Fetches real-time spot exchange rates directly from the **European Central Bank (ECB)** via the **Frankfurter API**.
* **Double-Entry Checks**: Validates debit/credit balance for generated journals. Balanced totals alone do not establish that the accounting treatment is correct.
* **Singapore Localization**:
  * Date sequence strictly formatted as **`DD/MM/YYYY`** (e.g. `13/11/2026`, `01/04/2026`).
  * Singapore 9% GST tax treatment (IRAS input tax claimability and output tax on asset disposals/trade-ins).
  * Functional currency defaults to **SGD**.
* **AI Provider Options**: Google Gemini, Azure OpenAI, OpenAI, and offline mode are represented in provider settings. Available models and usage limits depend on provider configuration and account entitlements; no fixed daily quotas are guaranteed by this repository.
* **Accessibility & Ergonomics**: Default enlarged typography (17px base) with interactive font size adjustment controls (`A-`, `A`, `A+`) in the navigation bar.
* **Screenshot attachments & Gemini vision**: Paste, drag/drop, or select up to five PNG, JPEG, or WEBP screenshots per message. Images are validated (10 MB each), downscaled in browser memory to a 2400 px maximum side, and are not persisted to localStorage. Gemini first extracts visible evidence and then applies the established accounting/source workflow; extracted evidence is displayed separately from the accounting conclusion. Feedback includes only attachment count and MIME types, never image content.

---

## 🏛️ Supported Statutory Accounting Scenarios

The following are example scenario types represented in the application, not a guarantee of complete standards coverage or validated treatment for every fact pattern. Confirm the latest applicable authority guidance before relying on an answer.

| Transaction Type | Standards Applied | Statutory Citation | Treatment Highlights |
| :--- | :--- | :--- | :--- |
| **Machinery Trade-In & Derecognition** | IAS 16 / SFRS(I) 1-16, Singapore GST Act | §55, §67–§71 | 3-month catch-up depreciation before disposal; 9% output tax on gross trade-in consideration; net book value derecognition. |
| **Asset Purchase with Trade Discount** | IAS 16 / SFRS(I) 1-16, Singapore GST Act | §16(a) | Trade discounts deducted directly from list price; discounts are never recorded in accounts; 9% GST computed on net discounted price. |
| **Equipment Financing & Loans** | IFRS 9 / SFRS(I) 9 | §5.1.1 | Gross equipment loan payable recorded with upfront **Unexpired Loan Interest** contra-liability account. |
| **Leases & ROU Capitalization** | IFRS 16 / SFRS(I) 16 | §22, §26, §36 | Present value discount of future rentals at lessee's IBR; capitalization of Right-of-Use Asset and Lease Liability. |
| **Foreign Equity Investments & FX Gain** | IFRS 9 / SFRS(I) 9, IAS 21 / SFRS(I) 1-21 | §4.1.4, §21, §28 | FVTPL / FVTOCI classification; translation at transaction date spot rate; explicit bifurcation of stock price gain vs realized currency gain. |
| **Operating Expenses & Disbursements** | IAS 1 / SFRS(I) 1-1 | §27 (Accrual Basis) | Expense debit against cash at bank / accounts payable settlement. |

---

## 🛠️ Technology Stack

* **Frontend Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **Build Tool**: [Vite](https://vitejs.dev/)
* **Styling**: [Tailwind CSS](https://tailwindcss.com/) (Modern Dark Enterprise Palette)
* **Icons**: [Lucide React](https://lucide.dev/)
* **Spot FX Rates**: [Frankfurter API](https://www.frankfurter.app/) (European Central Bank Reference)
* **AI Integrations**: [Google Gemini API](https://ai.google.dev/), [OpenAI API](https://platform.openai.com/docs/), and Azure OpenAI; deterministic and offline paths are also present.

---

## 🚀 Getting Started

### Prerequisites
* [Node.js 22.x](https://nodejs.org/) — required; the exact major version is declared in [`.nvmrc`](.nvmrc) and `package.json`.
* npm (bundled with Node.js)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/dexrrick/accounting.git
   cd accounting
   ```

2. **Install dependencies**:
   ```bash
   npm ci
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173/` in your browser.

4. **Build for production**:
   ```bash
   npm run build
   ```

5. **Run the fast regression suite**:
   ```bash
   npm run test:smoke
   ```

   To run the complete regression suite, use:
   ```bash
   npm test
   ```

### Development workflow

The canonical Codex and contributor instructions are in [`AGENTS.md`](AGENTS.md). Keep this README focused on what the application does and how to run it; avoid duplicating detailed agent procedures here.

- **Deliver working behaviour first.** Define the requested outcome and a few real-world examples; passing CI alone is not proof that accounting or statutory answers are correct.
- **Keep scope small.** Reuse existing engines, statutory registries, retrieval, and verification paths. Avoid unrelated refactors, speculative abstractions, and unnecessary dependencies.
- **Plan and review proportionately.** Make straightforward changes directly; use brief plans and independent reviews for work whose complexity or risk warrants them.
- **Test according to impact.** Start with affected tests and `npm run test:smoke`; for substantive accounting changes use `npm run lint` and `npm run build`, and reserve `npm test` for broad or high-risk changes. Run live integration tests only when relevant.
- **Respect ongoing work.** Do not redo completed CI fixes or investigations without a new failure, and avoid changing unrelated branches or PR workstreams.

Statutory coverage and official-source discovery continue to evolve across IRAS, ACRA, CPF, MOM and MAS. Discovery of an official page is not, by itself, verified support for every claim or historical period. Review source evidence and representative questions before claiming production accuracy.

### Hosted Gemini access (testing)

The Cloudflare Worker can call Gemini without exposing Google's API key in the browser.
The existing personal Gemini-key mode and other AI providers remain available.

1. Configure encrypted Cloudflare Worker secrets `GEMINI_API_KEY` and **`GEMINI_PROXY_TOKEN`** (a distinct random access token of at least 20 characters; do not reuse the Gemini key). Keep both outside the repository. The Worker rejects requests if either secret or its rate limiter is unavailable.
2. Deploy this branch's Cloudflare Worker build and ensure `/api/gemini/*` routes to the Worker. The `GEMINI_RATE_LIMITER` binding enforces an approximate per-client-IP 30 requests/minute in each Cloudflare location. Rate limiting is not a replacement for authentication.
3. In the app's provider Settings, select **Gemini**, enable **Use hosted Gemini**, and enter the separate proxy access token once in a trusted browser. The token is stored in browser localStorage (a bearer credential); the Google API key is never stored there. Do not distribute the proxy token to public users.
4. For Codex-assisted direct provider checks, add `GEMINI_API_KEY_TEST` as a GitHub Actions secret. Run the **Gemini Live Test** workflow manually from Actions after it becomes available on the default branch. This check uses the test key but does not call the deployed website.
5. To test the **deployed** Worker instead, additionally configure `GEMINI_PROXY_TOKEN_TEST` in GitHub Actions Secrets with the same value as the Cloudflare `GEMINI_PROXY_TOKEN`. Run the manually dispatched workflow with **hosted_site** enabled. No live calls run for ordinary pushes or pull requests.

Local proxy access-control checks: `npm run test:gemini-proxy`. The test uses mocked upstream responses and requires no secrets.

**Before enabling public access:** Replace the shared testing token with per-user identity verification (such as Cloudflare Access or your application's authentication), user-based quotas, monitoring and abuse controls. Sharing one proxy token is suitable only for a private testing audience; exposing the route without authentication would allow unauthorized Gemini quota consumption.

### Feedback delivery

The footer's **Send feedback** form compiles the user's description, the last 12 chat messages, a safe scenario summary, browser/app details, the latest request telemetry, and build metadata (`app.version`, `app.gitCommit`, and `app.buildTime`). It deliberately excludes API keys and environment variables. The dialog shows the short build version for quick reference.

To deliver reports, deploy a secure endpoint (for example, a serverless function or Formspree endpoint) that accepts a JSON `POST` and emails it to your support inbox. Set its URL at build time:

```bash
VITE_FEEDBACK_ENDPOINT=https://your-feedback-endpoint.example/submit
```

The email recipient belongs in that endpoint's secure configuration, not in frontend code. The form also has **Copy report** so a user can preserve the diagnostic payload if delivery is unavailable.

Production builds resolve the commit from `APP_GIT_COMMIT`, then `VITE_GIT_COMMIT`, then GitHub Actions' `GITHUB_SHA`, and finally `git rev-parse HEAD`; if none is available, the build reports `unknown`. The included CI workflow passes `${{ github.sha }}` as `APP_GIT_COMMIT`. A deployment host that builds directly from Git can rely on the Git fallback or set `APP_GIT_COMMIT` to its full commit SHA. The build timestamp is generated when Vite loads its configuration.

Vite substitutes `VITE_*` values when it builds the browser bundle; adding a GitHub variable does not alter an already-deployed site. For GitHub Actions builds, set the repository variable `VITE_FEEDBACK_ENDPOINT` (or a secret with that name); the included CI workflow passes it to Vite. If the site is deployed through Vercel, Netlify, Cloudflare Pages, or another host connected to GitHub, add the same build-time variable in that host's project settings and redeploy.

---

## 📁 Project Structure

```text
├── public/                     # Static assets (Favicon, logos)
├── src/
│   ├── components/             # Reusable UI Components
│   │   ├── ChatPanel.tsx       # Conversational AI assistant & prompt cards
│   │   ├── Header.tsx          # Top navbar, font scaler, model config & ECB status
│   │   ├── InputHandlerPanel.tsx # Standardized Dynamic Transaction Facts
│   │   ├── JournalTable.tsx    # Balanced double-entry ledger table
│   │   └── ComplianceRationale.tsx # ASC Singapore & IASB statutory basis tab
│   ├── engine/                 # Core Accounting Calculation Engine
│   │   ├── accountingEngine.ts # Double-entry generator & math balance checks
│   │   └── scenarioParser.ts   # Natural language extractor & offline rule fallback
│   ├── services/               # External Services & APIs
│   │   ├── geminiService.ts    # Google Gemini API connector & response parser
│   │   └── frankfurterService.ts # Live ECB spot forex rate fetcher
│   ├── standards/              # Statutory knowledgebase and source governance
│   │   ├── statutes/           # Rule packs split by authority (IRAS, GST, ACRA, CPF, MOM, MAS)
│   │   └── singaporeStatutesKnowledge.ts # Stable statutory registry and lookup API
│   ├── utils/                  # Utilities
│   │   └── dateUtils.ts        # Singapore DD/MM/YYYY date formatting utilities
│   ├── types/                  # TypeScript Data Contracts
│   │   └── accounting.ts       # Journal groups, lines, facts, and standard types
│   ├── App.tsx                 # Root application controller & state
│   ├── index.css               # Tailwind directives & responsive font scales
│   └── main.tsx                # React DOM bootstrap
├── package.json
├── tests/
│   ├── regression/             # Offline regression suites
│   ├── integration/            # Opt-in live external-source checks
│   └── fixtures/               # Stored source and retrieval fixtures
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## ⚖️ Standards Reference
* **ACRA / ASC Singapore**: [Singapore Financial Reporting Standards (International)](https://www.acra.gov.sg/accountancy/accounting-standards)
* **IASB**: [IFRS Accounting Standards Navigator](https://www.ifrs.org/issued-standards/list-of-standards/)
* **IRAS Singapore**: [Goods & Services Tax (GST) Guide on Business Assets & Trade-ins](https://www.iras.gov.sg/)

---

## 📄 License
MIT License. Developed for enterprise accounting compliance and automated financial reporting.
