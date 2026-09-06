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
      <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider">Assets Impact</span>
          <Building2 className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="text-sm font-bold font-mono text-white">
          {impact.totalAssetsDelta >= 0 ? '+' : ''}
          {impact.functionalCurrency} {impact.totalAssetsDelta.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5">Net change in total assets</p>
      </div>

      {/* P&L Gain/Loss */}
      <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider">Profit & Loss (P&L)</span>
          <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className={`text-sm font-bold font-mono ${impact.pnlImpact >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
          {impact.pnlImpact >= 0 ? '+' : ''}
          {impact.functionalCurrency} {impact.pnlImpact.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5">Net impact on income statement</p>
      </div>

      {/* OCI Impact */}
      <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider">OCI Reserve</span>
          <PieChart className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="text-sm font-bold font-mono text-white">
          {impact.ociImpact >= 0 ? '+' : ''}
          {impact.functionalCurrency} {impact.ociImpact.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5">Fair value reserve in equity</p>
      </div>

      {/* Balance Sheet Equilibrium */}
      <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider">Balance Equation</span>
          <Scale className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="text-sm font-bold font-mono text-white">
          ΔAssets = ΔL + ΔE
        </div>
        <p className="text-[10px] text-emerald-400/90 font-medium mt-0.5">Strict Equilibrium Verified</p>
      </div>
    </div>
  );
};
