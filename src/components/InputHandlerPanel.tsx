import React from 'react';
import type { AccountingScenarioState } from '../types/accounting';
import { Sliders, RefreshCw, Layers, Sparkles, Scale } from 'lucide-react';

interface InputHandlerPanelProps {
  scenario: AccountingScenarioState | null;
  onScenarioChange?: (updated: AccountingScenarioState) => void;
  onResetToDefaults: () => void;
}

export const InputHandlerPanel: React.FC<InputHandlerPanelProps> = ({
  scenario,
  onResetToDefaults
}) => {
  if (!scenario) {
    return (
      <div className="bg-white dark:bg-[#1C2538] rounded-2xl border border-slate-200 dark:border-[#2B374E] p-6 shadow-xl flex flex-col items-center justify-center text-center text-slate-500 min-h-[160px] transition-colors duration-200">
        <Sliders className="w-9 h-9 mb-2.5 text-slate-400 dark:text-slate-500 stroke-1" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-300 font-sans">
          Universal Transaction Parameters & Facts
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1">
          Ask any accounting question in the chat. The AI extracts key transaction facts and generates exact double entries automatically.
        </p>
      </div>
    );
  }

  // Build facts list dynamically
  const facts = scenario.keyParameters && scenario.keyParameters.length > 0
    ? scenario.keyParameters
    : [
        ...(scenario.amount ? [{ label: 'Transaction Amount', value: `${scenario.functionalCurrency} ${scenario.amount.toLocaleString()}`, badge: 'P&L Amount' }] : []),
        ...(scenario.expenseAccountName ? [{ label: 'Expense Category', value: scenario.expenseAccountName, badge: 'Operating' }] : []),
        ...(scenario.paymentMethodAccountName ? [{ label: 'Settlement Account', value: scenario.paymentMethodAccountName, badge: 'Disbursement' }] : []),
        ...(scenario.assetName ? [{ label: 'Asset / Security', value: scenario.assetName, badge: 'Instrument' }] : []),
        ...(scenario.purchaseAmountForeign ? [{ label: 'Cost / Value', value: `${scenario.transactionCurrency} ${scenario.purchaseAmountForeign.toLocaleString()}`, badge: 'Principal' }] : []),
        ...(scenario.purchaseFxRate ? [{ label: 'Purchase Spot Rate', value: `${scenario.purchaseFxRate} ${scenario.functionalCurrency}/${scenario.transactionCurrency}`, badge: 'FX Rate' }] : []),
        ...(scenario.saleAmountForeign ? [{ label: 'Disposal Proceeds', value: `${scenario.transactionCurrency} ${scenario.saleAmountForeign.toLocaleString()}`, badge: 'Sale Value' }] : []),
        ...(scenario.saleFxRate ? [{ label: 'Sale Spot Rate', value: `${scenario.saleFxRate} ${scenario.functionalCurrency}/${scenario.transactionCurrency}`, badge: 'FX Rate' }] : []),
        ...(scenario.leasePaymentMonthly ? [{ label: 'Monthly Rent', value: `${scenario.functionalCurrency} ${scenario.leasePaymentMonthly.toLocaleString()}`, badge: 'IFRS 16' }] : []),
        ...(scenario.leaseTermYears ? [{ label: 'Lease Term', value: `${scenario.leaseTermYears} Years`, badge: 'Duration' }] : [])
      ];

  return (
    <div className="bg-white dark:bg-[#1C2538] rounded-2xl border border-slate-200 dark:border-[#2B374E] shadow-xl overflow-hidden transition-colors duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-[#2B374E] bg-slate-50/80 dark:bg-[#151D2C]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-ynab-navy dark:bg-[#242F46] text-white flex items-center justify-center border border-slate-700/30 dark:border-[#2B374E] shadow-sm shrink-0">
              <Sparkles className="w-4 h-4 text-ynab-blue dark:text-blue-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider font-sans">
                  {scenario.queryIntent === 'STATUTORY_ADVISORY' ? 'Singapore Statutory Directives' : 'Transaction Facts & Extracted Parameters'}
                </h3>
                {scenario.transactionTitle && (
                  <span className="px-2.5 py-0.5 bg-slate-100 dark:bg-[#242F46] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-[#2B374E] rounded font-mono text-[11px] font-semibold">
                    {scenario.transactionTitle}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {scenario.queryIntent === 'STATUTORY_ADVISORY' ? 'Authoritative compliance facts grounded in Singapore law' : 'Live synchronized parameters extracted from natural language'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-[#151D2C] border border-emerald-200 dark:border-emerald-900/60 px-2.5 py-1 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-ynab-green"></span>
              Facts Synchronized
            </span>
            <button
              onClick={onResetToDefaults}
              className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#242F46] transition-colors"
              title="Reset scenario"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Key Facts Grid - Standardized Shapes & Fully Displayed Words */}
      <div className="p-4 space-y-3">
        {facts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {facts.map((fact, idx) => (
              <div
                key={idx}
                className={`p-3.5 rounded-xl border flex flex-col justify-between min-h-[84px] overflow-hidden transition-all shadow-xs ${
                  fact.highlight
                    ? 'border-amber-300 bg-amber-50/60 dark:border-amber-600/60 dark:bg-[#242F46]'
                    : 'bg-slate-50/70 dark:bg-[#111827] border-slate-200 dark:border-[#2B374E] hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-1.5 min-w-0">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider leading-snug break-words min-w-0">
                    {fact.label}
                  </span>
                  {fact.badge && (
                    <span className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-[#242F46] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#2B374E] font-medium leading-none whitespace-nowrap">
                      {fact.badge}
                    </span>
                  )}
                </div>
                <div className="text-sm font-bold font-mono text-slate-900 dark:text-white tracking-tight break-words mt-2.5">
                  {fact.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 bg-slate-50 dark:bg-[#111827] rounded-xl border border-slate-200 dark:border-[#2B374E] text-center text-xs text-slate-500 dark:text-slate-400">
            Transaction facts synchronized with accounting journal.
          </div>
        )}

        {/* Transaction / Statutory Summary Footer */}
        {scenario.queryIntent === 'STATUTORY_ADVISORY' ? (
          <div className="p-3 bg-slate-50 dark:bg-[#151D2C] rounded-xl border border-slate-200 dark:border-[#2B374E] flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
              <Scale className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Singapore Statutory Grounding Active</span>
            </div>
            <div className="font-mono text-slate-500 dark:text-slate-400 text-xs">
              Directives Verified: <strong className="text-slate-800 dark:text-white">IRAS / ACRA / SSO</strong>
            </div>
          </div>
        ) : scenario.directGroups && scenario.directGroups.length > 0 && scenario.directGroups.some(g => g.lines.length > 0) ? (
          <div className="p-3 bg-slate-50 dark:bg-[#151D2C] rounded-xl border border-slate-200 dark:border-[#2B374E] flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Layers className="w-4 h-4 text-ynab-blue dark:text-blue-400" />
              <span>
                <strong>{scenario.directGroups.length}</strong> Journal Entry {scenario.directGroups.length === 1 ? 'Group' : 'Groups'} Generated
              </span>
            </div>
            <div className="font-mono text-slate-500 dark:text-slate-400 text-xs">
              Currency: <strong className="text-slate-800 dark:text-white">{scenario.functionalCurrency}</strong>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
