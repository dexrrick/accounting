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

* **Frontend Framework**: [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **Build Tool**: [Vite](https://vitejs.dev/)
* **Styling**: [Tailwind CSS](https://tailwindcss.com/) (Modern Dark Enterprise Palette)
* **Icons**: [Lucide React](https://lucide.dev/)
* **Spot FX Rates**: [Frankfurter API](https://www.frankfurter.app/) (European Central Bank Reference)
* **AI Cognitive Engine**: [Google Gemini API](https://ai.google.dev/) (Flash Lite & Flash Models)

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (version 18+ recommended)
* npm (bundled with Node.js)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/dexrrick/accounting.git
   cd accounting
   ```

2. **Install dependencies**:
   ```bash
   npm install
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

5. **Run automated engine verification test suite**:
   ```bash
   npx tsx test_universal.mjs
   ```

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
│   ├── standards/              # Statutory Knowledgebase
│   │   └── standardsKnowledge.ts # Official ASC Singapore & IASB citations
│   ├── utils/                  # Utilities
│   │   └── dateUtils.ts        # Singapore DD/MM/YYYY date formatting utilities
│   ├── types/                  # TypeScript Data Contracts
│   │   └── accounting.ts       # Journal groups, lines, facts, and standard types
│   ├── App.tsx                 # Root application controller & state
│   ├── index.css               # Tailwind directives & responsive font scales
│   └── main.tsx                # React DOM bootstrap
├── package.json
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

