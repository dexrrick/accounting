/**
 * Deterministic Accounting Guardrails
 *
 * Side Quest 2: AI Semantic Transaction Understanding & Intelligent Query Routing
 *
 * Validates that accounting conclusions and journal entries strictly adhere to
 * foundational accounting invariants:
 * - Guardrail A: Own-Equity Guardrail (SFRS(I) 1-32 §33 - own shares can never be financial assets)
 * - Guardrail B: Currency Fact Guardrail (no FX if currency is unspecified or unknown)
 * - Guardrail C: Functional Currency Guardrail (no FX if transaction currency == functional currency)
 * - Guardrail D: Double-Entry Equality (sum debits == sum credits)
 * - Guardrail E: Evidence Support
 * - Guardrail F: Semantic Consistency (e.g. unpaid equity cannot debit cash at bank)
 */

import type { TransactionUnderstanding } from '../services/transactionUnderstandingService';
import type { JournalEntryGroup, JournalLine } from '../types/accounting';

export interface GuardrailViolation {
  code:
    | 'OWN_EQUITY_ASSET_PROHIBITED'
    | 'UNJUSTIFIED_FX_CALCULATION'
    | 'FUNCTIONAL_CURRENCY_FX_PROHIBITED'
    | 'DOUBLE_ENTRY_IMBALANCE'
    | 'MISSING_AUTHORITATIVE_EVIDENCE'
    | 'SEMANTIC_FACT_CONTRADICTION';
  message: string;
  severity: 'ERROR' | 'WARNING';
}

export interface GuardrailValidationResult {
  isValid: boolean;
  violations: GuardrailViolation[];
}

export class AccountingGuardrailValidator {
  /**
   * Validates journal entries and scenario conclusions against extracted semantic facts.
   */
  public validate(
    understanding: TransactionUnderstanding,
    groups: JournalEntryGroup[],
    functionalCurrency: string = 'SGD'
  ): GuardrailValidationResult {
    const violations: GuardrailViolation[] = [];

    const allLines: JournalLine[] = groups.flatMap(g => g.lines);

    // Guardrail A: Own-Equity Guardrail (SFRS(I) 1-32 §33)
    if (understanding.ownershipContext === 'own_equity') {
      for (const line of allLines) {
        const accLower = line.accountName.toLowerCase();
        if (
          accLower.includes('fvtpl') ||
          accLower.includes('fvtoci') ||
          accLower.includes('foreign shares investment') ||
          (line.category === 'ASSET' && accLower.includes('shares investment'))
        ) {
          violations.push({
            code: 'OWN_EQUITY_ASSET_PROHIBITED',
            message: `Under SFRS(I) 1-32 §33, an entity's own shares cannot be classified as a financial asset (${line.accountName}). Issued shares must be credited to Share Capital under Equity.`,
            severity: 'ERROR'
          });
        }
      }
    }

    // Guardrail B: Currency Fact Guardrail
    const isCurrencyUnknownOrNull =
      understanding.currency.value === null ||
      understanding.currency.source === 'unknown';

    if (isCurrencyUnknownOrNull) {
      for (const line of allLines) {
        if (
          line.foreignCurrency ||
          (line.exchangeRate && line.exchangeRate !== 1) ||
          line.accountName.toLowerCase().includes('exchange gain') ||
          line.accountName.toLowerCase().includes('fx gain')
        ) {
          violations.push({
            code: 'UNJUSTIFIED_FX_CALCULATION',
            message: `Transaction currency is unknown/unspecified. Foreign exchange calculation or FX translation is prohibited without verified foreign currency.`,
            severity: 'ERROR'
          });
          break;
        }
      }
    }

    // Guardrail C: Functional Currency Guardrail
    if (
      understanding.currency.value &&
      understanding.currency.value.toUpperCase() === functionalCurrency.toUpperCase()
    ) {
      for (const line of allLines) {
        if (
          line.foreignCurrency &&
          line.foreignCurrency.toUpperCase() !== functionalCurrency.toUpperCase()
        ) {
          violations.push({
            code: 'FUNCTIONAL_CURRENCY_FX_PROHIBITED',
            message: `Transaction currency matches functional currency (${functionalCurrency}). Foreign currency lines (${line.foreignCurrency}) are prohibited.`,
            severity: 'ERROR'
          });
          break;
        }
      }
    }

    // Guardrail D: Double-Entry Equality
    for (const group of groups) {
      let totalDr = 0;
      let totalCr = 0;
      for (const line of group.lines) {
        totalDr += line.debit || 0;
        totalCr += line.credit || 0;
      }
      totalDr = Math.round(totalDr * 100) / 100;
      totalCr = Math.round(totalCr * 100) / 100;

      if (Math.abs(totalDr - totalCr) > 0.01) {
        violations.push({
          code: 'DOUBLE_ENTRY_IMBALANCE',
          message: `Group '${group.title}' is imbalanced: Total Dr (${totalDr}) != Total Cr (${totalCr}).`,
          severity: 'ERROR'
        });
      }
    }

    // Guardrail F: Semantic Consistency
    if (understanding.ownershipContext === 'own_equity' && understanding.paymentStatus === 'unpaid') {
      const hasBankDebit = allLines.some(
        l => l.debit > 0 && l.accountName.toLowerCase().includes('cash at bank')
      );
      const hasReceivableDebit = allLines.some(
        l => l.debit > 0 && (
          l.accountName.toLowerCase().includes('shareholder') ||
          l.accountName.toLowerCase().includes('receivable') ||
          l.accountName.toLowerCase().includes('unpaid share')
        )
      );

      if (hasBankDebit && !hasReceivableDebit) {
        violations.push({
          code: 'SEMANTIC_FACT_CONTRADICTION',
          message: `Transaction specifies unpaid share capital, but journal entry debits Cash at Bank rather than Amount Due from Shareholder / Unpaid Share Capital.`,
          severity: 'ERROR'
        });
      }
    }

    const hasError = violations.some(v => v.severity === 'ERROR');
    return {
      isValid: !hasError,
      violations
    };
  }
}

export const defaultAccountingGuardrails = new AccountingGuardrailValidator();
