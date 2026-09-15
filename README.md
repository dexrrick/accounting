# 📊 IFRS & SFRS(I) Accounting Double-Entry Assistant

An enterprise-grade, statutory-compliant dual-framework accounting application that translates complex natural language business transactions into balanced, audit-ready double-entry journal entries with paragraph citations from the **Accounting Standards Council (ASC) Singapore** and the **International Accounting Standards Board (IASB)**.

---

## 🌟 Key Highlights

* **Dual Framework Compliance**: Fully compliant with **Singapore Financial Reporting Standards (International) [SFRS(I)]** and **International Financial Reporting Standards [IFRS]**.
* **Universal Dynamic Engine**: Extracts transaction facts (cost, trade discounts, loan principal, unexpired interest, GST, ROU assets, lease liabilities, spot rates) into standardized badges without requiring rigid scenario templates.
* **Live Foreign Exchange Integration**: Fetches real-time spot exchange rates directly from the **European Central Bank (ECB)** via the **Frankfurter API**.
* **Strict Double-Entry Equilibrium**: Automated mathematical verification ensures $\sum \text{Debits} == \sum \text{Credits}$ before rendering any ledger entries.
* **Singapore Localization**:
  * Date sequence strictly formatted as **`DD/MM/YYYY`** (e.g. `13/11/2026`, `01/04/2026`).
  * Singapore 9% GST tax treatment (IRAS input tax claimability and output tax on asset disposals/trade-ins).
  * Functional currency defaults to **SGD**.
* **AI Model Selection**:
  * **Gemini 3.5 Flash Lite** (Default - 500 requests/day quota).
  * **Gemini 3.1 Flash Lite** (500 requests/day).
  * **Gemini 3.8 Flash** (High-capacity reasoning - 20 requests/day).
* **Accessibility & Ergonomics**: Default enlarged typography (17px base) with interactive font size adjustment controls (`A-`, `A`, `A+`) in the navigation bar.
* **Screenshot attachments & Gemini vision**: Paste, drag/drop, or select up to five PNG, JPEG, or WEBP screenshots per message. Images are validated (10 MB each), downscaled in browser memory to a 2400 px maximum side, and are not persisted to localStorage. Gemini first extracts visible evidence and then applies the established accounting/source workflow; extracted evidence is displayed separately from the accounting conclusion. Feedback includes only attachment count and MIME types, never image content.

---

## 🏛️ Supported Statutory Accounting Scenarios

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
* **AI Cognitive Engine**: [Google Gemini API](https://ai.google.dev/) (Flash Lite & Flash Models)

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

### Feedback delivery

The footer's **Send feedback** form compiles the user's description, the last 12 chat messages, a safe scenario summary, browser/app details, and the latest request telemetry. It deliberately excludes API keys.

To deliver reports, deploy a secure endpoint (for example, a serverless function or Formspree endpoint) that accepts a JSON `POST` and emails it to your support inbox. Set its URL at build time:

```bash
VITE_FEEDBACK_ENDPOINT=https://your-feedback-endpoint.example/submit
```

The email recipient belongs in that endpoint's secure configuration, not in frontend code. The form also has **Copy report** so a user can preserve the diagnostic payload if delivery is unavailable.

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
