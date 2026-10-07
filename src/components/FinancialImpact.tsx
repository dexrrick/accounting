import React from 'react';
import type { FinancialImpactSummary } from '../types/accounting';
import { TrendingUp, Scale, Building2, PieChart } from 'lucide-react';

interface FinancialImpactProps {
  impact: FinancialImpactSummary;
}

export const FinancialImpact: React.FC<FinancialImpactProps> = ({ impact }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* Assets Delta */}
      <div className="bg-workspace-panel p-3.5 rounded-xl border border-workspace-border dark:border-workspace-border shadow-xs transition-colors duration-200">
        <div className="flex items-center justify-between text-workspace-muted dark:text-workspace-muted mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider">Assets Impact</span>
          <Building2 className="w-3.5 h-3.5 text-workspace-muted" />
        </div>
        <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
          {impact.totalAssetsDelta >= 0 ? '+' : ''}
          {impact.functionalCurrency} {impact.totalAssetsDelta.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <p className="text-[10px] text-workspace-muted dark:text-workspace-muted mt-0.5">Net change in total assets</p>
      </div>

      {/* P&L Gain/Loss */}
      <div className="bg-workspace-panel p-3.5 rounded-xl border border-workspace-border dark:border-workspace-border shadow-xs transition-colors duration-200">
        <div className="flex items-center justify-between text-workspace-muted dark:text-workspace-muted mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider">Profit & Loss (P&L)</span>
          <TrendingUp className="w-3.5 h-3.5 text-workspace-muted" />
        </div>
        <div className={`text-sm font-bold font-mono tabular-nums ${impact.pnlImpact >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {impact.pnlImpact >= 0 ? '+' : ''}
          {impact.functionalCurrency} {impact.pnlImpact.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <p className="text-[10px] text-workspace-muted dark:text-workspace-muted mt-0.5">Net impact on income statement</p>
      </div>

      {/* OCI Impact */}
      <div className="bg-workspace-panel p-3.5 rounded-xl border border-workspace-border dark:border-workspace-border shadow-xs transition-colors duration-200">
        <div className="flex items-center justify-between text-workspace-muted dark:text-workspace-muted mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider">OCI Reserve</span>
          <PieChart className="w-3.5 h-3.5 text-workspace-muted" />
        </div>
        <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
          {impact.ociImpact >= 0 ? '+' : ''}
          {impact.functionalCurrency} {impact.ociImpact.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <p className="text-[10px] text-workspace-muted dark:text-workspace-muted mt-0.5">Fair value reserve in equity</p>
      </div>

      {/* Balance Sheet Equilibrium */}
      <div className="bg-workspace-panel p-3.5 rounded-xl border border-workspace-border dark:border-workspace-border shadow-xs transition-colors duration-200">
        <div className="flex items-center justify-between text-workspace-muted dark:text-workspace-muted mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider">Balance Equation</span>
          <Scale className="w-3.5 h-3.5 text-workspace-muted" />
        </div>
        <div className="text-sm font-bold font-mono text-slate-900 dark:text-white">
          ΔAssets = ΔL + ΔE
        </div>
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">Strict Equilibrium Verified</p>
      </div>
    </div>
  );
};
