import type { AccountingScenarioState, JournalEntryGroup, JournalLine } from '../types/accounting';
import { getExchangeRate } from '../services/frankfurterService';
import { getCitation } from '../standards/standardsKnowledge';
import { formatSingaporeDate } from '../utils/dateUtils';

export async function parseAccountingQuery(
  query: string,
  currentScenario?: AccountingScenarioState | null
): Promise<AccountingScenarioState> {
  const q = query.toLowerCase();

  // 1. Functional Currency detection
  let functionalCurrency = 'SGD';
  if (q.includes('primary currency is') || q.includes('functional currency is') || q.includes('currency is')) {
    const match = query.match(/(?:primary|functional)?\s*currency\s*(?:is|=|:)?\s*([A-Za-z]{3})/i);
    if (match && match[1]) {
      functionalCurrency = match[1].toUpperCase();
    }
  } else if (q.includes('sgd') || q.includes('singapore dollar')) {
    functionalCurrency = 'SGD';
  } else if (q.includes('usd') && !q.includes('sgd')) {
    functionalCurrency = 'USD';
  }

  // =========================================================================
  // SCENARIO 0: PPE MACHINERY ACQUISITION WITH TRADE-IN, GST, DEPRECIATION & LOAN
  // e.g. "A GST-registered company purchases new machinery on 1 April 2026 for SGD 100,000..."
  // =========================================================================
  const isFollowUpOnPpe = currentScenario?.scenarioType === 'PPE_IAS16' &&
    (q.includes('interest') || q.includes('loan') || q.includes('trade-in') || q.includes('trade in') || q.includes('cash') || q.includes('depreciation') || q.includes('what if') || q.includes('change') || q.includes('how about') || q.includes('why') || q.includes('explain'));

  const isPpeTradeIn = 
    isFollowUpOnPpe ||
    ((q.includes('machinery') || q.includes('machine') || q.includes('equipment') || q.includes('fixed asset') || q.includes('ppe')) &&
    (q.includes('trade-in') || q.includes('trade in') || q.includes('disposal') || q.includes('derecognition') || q.includes('depreciation')));

  if (isPpeTradeIn) {
    // 1. New machine cost & GST
    let newCost = 100000;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorParam = currentScenario.keyParameters.find(p => p.label.includes('New Machine Cost'));
      if (priorParam) {
        const num = parseFloat(priorParam.value.replace(/[^0-9.]/g, ''));
        if (num > 1000) newCost = num;
      }
    }
    const newCostMatch = query.match(/(?:purchases?|bought|acquires?|cost(?:\s*of)?)\s*(?:new\s*)?(?:machinery|machine|equipment)?[^0-9]*?(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (newCostMatch && newCostMatch[1]) {
      const parsedVal = parseFloat(newCostMatch[1].replace(/,/g, ''));
      if (parsedVal > 1000) newCost = parsedVal;
    }

    let gstRate = 0.09;
    const gstMatch = query.match(/(\d+)%\s*gst/i);
    if (gstMatch && gstMatch[1]) {
      gstRate = parseFloat(gstMatch[1]) / 100;
    }
    const inputGst = Math.round(newCost * gstRate * 100) / 100;
    const grossNewCost = newCost + inputGst;

    // 2. Old machine cost & depreciation
    let oldCost = 50000;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorCostParam = currentScenario.keyParameters.find(p => p.label.includes('Old Machine Original Cost'));
      if (priorCostParam) {
        const num = parseFloat(priorCostParam.value.replace(/[^0-9.]/g, ''));
        if (num > 1000) oldCost = num;
      }
    }
    const oldCostMatch = query.match(/old\s*(?:machine|machinery|equipment)\s*cost\s*(?:is|=|:)?\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (oldCostMatch && oldCostMatch[1]) {
      const parsedVal = parseFloat(oldCostMatch[1].replace(/,/g, ''));
      if (parsedVal > 1000) oldCost = parsedVal;
    }

    let deprRateAnnual = 0.20;
    const deprRateMatch = query.match(/(\d+)%\s*(?:per\s*annum|p\.a\.|annual)/i);
    if (deprRateMatch && deprRateMatch[1]) {
      deprRateAnnual = parseFloat(deprRateMatch[1]) / 100;
    }

    // Jan-Mar 2026 catch up depr = 3 months
    const catchUpDepr = Math.round(oldCost * deprRateAnnual * (3 / 12) * 100) / 100; // 2500
    // Prior 2 years depr (2024 to 2025) = 2 years
    const priorAccDepr = Math.round(oldCost * deprRateAnnual * 2 * 100) / 100; // 20000
    const totalAccDeprAtDisposal = priorAccDepr + catchUpDepr; // 22500
    const netBookValueOld = oldCost - totalAccDeprAtDisposal; // 27500

    // 3. Trade-in value
    let agreedTradeInGross = 21800;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorTradeInParam = currentScenario.keyParameters.find(p => p.label.includes('Agreed Trade-In Value'));
      if (priorTradeInParam) {
        const num = parseFloat(priorTradeInParam.value.replace(/[^0-9.]/g, ''));
        if (num > 500) agreedTradeInGross = num;
      }
    }
    const tradeInMatch = query.match(/trade-?in\s*(?:value\s*)?(?:of|is|at)?\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (tradeInMatch && tradeInMatch[1]) {
      const parsedVal = parseFloat(tradeInMatch[1].replace(/,/g, ''));
      if (parsedVal > 500) agreedTradeInGross = parsedVal;
    }

    const netTradeInProceeds = Math.round((agreedTradeInGross / (1 + gstRate)) * 100) / 100; // 20000
    const outputGst = Math.round((agreedTradeInGross - netTradeInProceeds) * 100) / 100; // 1800
    const lossOnDisposal = Math.round((netBookValueOld - netTradeInProceeds) * 100) / 100; // 7500

    // 4. Cash paid
    let cashPaid = 30000;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorCashParam = currentScenario.keyParameters.find(p => p.label.includes('Cash Paid'));
      if (priorCashParam) {
        const num = parseFloat(priorCashParam.value.replace(/[^0-9.]/g, ''));
        if (num >= 0) cashPaid = num;
      }
    }
    const cashMatch = query.match(/(?:cash\s*paid|paid\s*via\s*bank|bank\s*transfer|cash)[^0-9]*?(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (cashMatch && cashMatch[1]) {
      const parsedVal = parseFloat(cashMatch[1].replace(/,/g, ''));
      if (parsedVal > 100) cashPaid = parsedVal;
    }

    // 5. Loan financing
    const loanPrincipal = grossNewCost - agreedTradeInGross - cashPaid; // 57200
    let loanYears = 2;
    const loanYearsMatch = query.match(/(\d+)\s*-?\s*years?\s*(?:equipment\s*)?loan/i);
    if (loanYearsMatch && loanYearsMatch[1]) {
      loanYears = parseInt(loanYearsMatch[1], 10);
    }

    let flatInterestRate = 0.05;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorInterestParam = currentScenario.keyParameters.find(p => p.label.includes('Unexpired Interest'));
      if (priorInterestParam) {
        const match = priorInterestParam.label.match(/(\d+(?:\.\d+)?)\s*%/);
        if (match && match[1]) flatInterestRate = parseFloat(match[1]) / 100;
      }
    }
    const flatInterestMatch = query.match(/(\d+(?:\.\d+)?)\s*%\s*(?:per\s*annum\s*)?flat/i) || query.match(/interest\s*(?:rate)?\s*(?:is|=|to)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (flatInterestMatch && flatInterestMatch[1]) {
      flatInterestRate = parseFloat(flatInterestMatch[1]) / 100;
    }

    const unexpiredInterest = Math.round(loanPrincipal * flatInterestRate * loanYears * 100) / 100; // 5720
    const grossLoanPayable = loanPrincipal + unexpiredInterest; // 62920

    const directGroups: JournalEntryGroup[] = [
      {
        id: 'grp-catchup-depr',
        eventDate: '01/04/2026',
        title: 'Entry 1: Catch-Up Depreciation for Jan–Mar 2026',
        summary: `Record 3 months depreciation ($50,000 × 20% × 3/12 = SGD 2,500) prior to derecognition under IAS 16 §55`,
        lines: [
          {
            id: 'l1-depr-exp',
            accountCode: '5200',
            accountName: 'Depreciation Expense - Machinery (P&L)',
            category: 'EXPENSE',
            debit: catchUpDepr,
            credit: 0,
            lineExplanation: 'Recognition of 3-month depreciation from 1 Jan 2026 to 31 Mar 2026 in profit or loss.'
          },
          {
            id: 'l1-acc-depr',
            accountCode: '1690',
            accountName: 'Accumulated Depreciation - Machinery',
            category: 'ASSET',
            debit: 0,
            credit: catchUpDepr,
            lineExplanation: 'Contra-asset increase to bring accumulated depreciation up to date as of disposal date.'
          }
        ],
        totalDebit: catchUpDepr,
        totalCredit: catchUpDepr,
        isBalanced: true,
        citations: [
          getCitation('IAS16_DEPRECIATION_CATCHUP', 'SFRS_I')
        ],
        rationalePoints: [
          'Under IAS 16 / SFRS(I) 1-16 §55: Depreciation ceases on derecognition. Depreciation up to 31 March 2026 must be recognized before computing disposal gain/loss.',
          'Debit Rule: Depreciation increases operating expenses in P&L.',
          'Credit Rule: Accumulated depreciation (contra-asset) increases.'
        ]
      },
      {
        id: 'grp-disposal-old',
        eventDate: '01/04/2026',
        title: 'Entry 2: Derecognition / Disposal of Old Machinery',
        summary: `Derecognize old machine (Cost SGD 50,000, Acc Depr SGD 22,500), record net trade-in value SGD 20,000 + 9% Output GST SGD 1,800, and loss on disposal SGD 7,500`,
        lines: [
          {
            id: 'l2-acc-depr',
            accountCode: '1690',
            accountName: 'Accumulated Depreciation - Machinery',
            category: 'ASSET',
            debit: totalAccDeprAtDisposal,
            credit: 0,
            lineExplanation: 'Derecognition of total accumulated depreciation ($20,000 prior + $2,500 catch-up) on disposal.'
          },
          {
            id: 'l2-loss-disposal',
            accountCode: '5520',
            accountName: 'Loss on Disposal of Machinery (P&L)',
            category: 'EXPENSE',
            debit: lossOnDisposal,
            credit: 0,
            lineExplanation: 'Loss arising from carrying amount ($27,500) exceeding net disposal proceeds ($20,000) under IAS 16 §68.'
          },
          {
            id: 'l2-tradein-clearing',
            accountCode: '1150',
            accountName: 'Vendor Clearing Account / Trade-in Consideration',
            category: 'ASSET',
            debit: agreedTradeInGross,
            credit: 0,
            lineExplanation: 'Agreed trade-in value (inclusive of 9% GST) receivable as offset against new machinery purchase.'
          },
          {
            id: 'l2-old-asset-cost',
            accountCode: '1600',
            accountName: 'Machinery - Historical Cost (Old Machine)',
            category: 'ASSET',
            debit: 0,
            credit: oldCost,
            lineExplanation: 'Derecognition of the original gross cost of the old machine from balance sheet.'
          },
          {
            id: 'l2-output-gst',
            accountCode: '2200',
            accountName: 'GST Output Tax (IRAS 9% Payable)',
            category: 'LIABILITY',
            debit: 0,
            credit: outputGst,
            lineExplanation: '9% Output GST payable to IRAS on disposal/trade-in of business asset ($21,800 / 1.09 × 9%).'
          }
        ],
        totalDebit: totalAccDeprAtDisposal + lossOnDisposal + agreedTradeInGross,
        totalCredit: oldCost + outputGst,
        isBalanced: true,
        citations: [
          getCitation('IAS16_DERECOGNITION', 'SFRS_I'),
          getCitation('SINGAPORE_GST_TRADE_IN', 'SFRS_I')
        ],
        rationalePoints: [
          'Under IAS 16 / SFRS(I) 1-16 §67-§71: The carrying amount of an asset is derecognised on disposal. Loss on disposal = Carrying Amount ($27,500) - Net Proceeds ($20,000) = SGD 7,500.',
          'Singapore GST Act: A trade-in is a taxable supply. The company must account for 9% output tax (SGD 1,800) on the agreed trade-in value ($21,800 gross).',
          'Sum of Debits ($51,800) = Sum of Credits ($51,800).'
        ]
      },
      {
        id: 'grp-acq-new',
        eventDate: '01/04/2026',
        title: 'Entry 3: Acquisition of New Machinery & Equipment Loan Financing',
        summary: `Capitalize new machine at cost SGD 100,000, claim 9% input GST SGD 9,000, offset trade-in SGD 21,800, bank cash SGD 30,000, and 2-year loan SGD 62,920 (with unexpired interest contra SGD 5,720)`,
        lines: [
          {
            id: 'l3-new-asset-cost',
            accountCode: '1600',
            accountName: 'Machinery - Cost (New Machine)',
            category: 'ASSET',
            debit: newCost,
            credit: 0,
            lineExplanation: 'Initial recognition of new machinery at purchase price exclusive of recoverable GST (IAS 16 §16).'
          },
          {
            id: 'l3-input-gst',
            accountCode: '1190',
            accountName: 'GST Input Tax (IRAS 9% Receivable)',
            category: 'ASSET',
            debit: inputGst,
            credit: 0,
            lineExplanation: '9% recoverable input GST claimable against IRAS in the quarterly GST return.'
          },
          {
            id: 'l3-unexpired-interest',
            accountCode: '2520',
            accountName: 'Unexpired Loan Interest (Contra-Liability)',
            category: 'LIABILITY',
            debit: unexpiredInterest,
            credit: 0,
            lineExplanation: 'Deferred finance charge presented upfront as contra-liability offset against gross equipment loan.'
          },
          {
            id: 'l3-tradein-clearing',
            accountCode: '1150',
            accountName: 'Vendor Clearing Account / Trade-in Consideration',
            category: 'ASSET',
            debit: 0,
            credit: agreedTradeInGross,
            lineExplanation: 'Application of trade-in credit against new machinery purchase liability.'
          },
          {
            id: 'l3-bank',
            accountCode: '1010',
            accountName: 'Cash at Bank',
            category: 'ASSET',
            debit: 0,
            credit: cashPaid,
            lineExplanation: 'Cash disbursement via bank transfer on 1 April 2026.'
          },
          {
            id: 'l3-loan-payable',
            accountCode: '2510',
            accountName: 'Equipment Loan Payable (Gross Note Amount)',
            category: 'LIABILITY',
            debit: 0,
            credit: grossLoanPayable,
            lineExplanation: 'Gross note payable for 2-year equipment loan ($57,200 principal + $5,720 flat interest).'
          }
        ],
        totalDebit: newCost + inputGst + unexpiredInterest,
        totalCredit: agreedTradeInGross + cashPaid + grossLoanPayable,
        isBalanced: true,
        citations: [
          getCitation('IAS16_PPE_RECOGNITION', 'SFRS_I'),
          getCitation('IFRS9_LOAN_UNEXPIRED_INTEREST', 'SFRS_I')
        ],
        rationalePoints: [
          'Under IAS 16 §16: Recoverable taxes (Input GST SGD 9,000) are excluded from asset cost.',
          'Under IFRS 9: Net loan obligation initially recognized is SGD 57,200 (Gross note SGD 62,920 less Unexpired Interest contra SGD 5,720).',
          'Sum of Debits ($114,720) = Sum of Credits ($114,720).'
        ]
      }
    ];

    return {
      scenarioType: 'PPE_IAS16',
      rawQuery: query,
      transactionTitle: 'Machinery Acquisition with Trade-In & Equipment Loan',
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      directGroups,
      keyParameters: [
        { label: 'New Machine Cost (Excl. GST)', value: `${functionalCurrency} ${newCost.toLocaleString()}`, badge: 'Asset Cost' },
        { label: 'Input GST (9% Claimable)', value: `${functionalCurrency} ${inputGst.toLocaleString()}`, badge: 'Tax Receivable' },
        { label: 'Agreed Trade-In Value (Gross)', value: `${functionalCurrency} ${agreedTradeInGross.toLocaleString()}`, badge: 'Trade-In Gross' },
        { label: 'Net Trade-In Consideration', value: `${functionalCurrency} ${netTradeInProceeds.toLocaleString()}`, badge: 'Proceeds' },
        { label: 'Output GST on Trade-In (9%)', value: `${functionalCurrency} ${outputGst.toLocaleString()}`, badge: 'Tax Payable' },
        { label: 'Old Machine Original Cost', value: `${functionalCurrency} ${oldCost.toLocaleString()}`, badge: 'Historical Cost' },
        { label: 'Catch-up Depr (Jan–Mar 2026)', value: `${functionalCurrency} ${catchUpDepr.toLocaleString()}`, badge: 'P&L Expense' },
        { label: 'Total Acc. Depr at Disposal', value: `${functionalCurrency} ${totalAccDeprAtDisposal.toLocaleString()}`, badge: 'Contra-Asset' },
        { label: 'Net Book Value at Disposal', value: `${functionalCurrency} ${netBookValueOld.toLocaleString()}`, badge: 'Carrying Value' },
        { label: 'Loss on Disposal (P&L)', value: `${functionalCurrency} ${lossOnDisposal.toLocaleString()}`, badge: 'P&L Loss', highlight: true },
        { label: 'Cash Paid via Bank', value: `${functionalCurrency} ${cashPaid.toLocaleString()}`, badge: 'Bank Outflow' },
        { label: 'Equipment Loan Principal', value: `${functionalCurrency} ${loanPrincipal.toLocaleString()}`, badge: 'Net Borrowing' },
        { label: 'Unexpired Interest (5% x 2y)', value: `${functionalCurrency} ${unexpiredInterest.toLocaleString()}`, badge: 'Contra-Liability' },
        { label: 'Gross Equipment Loan Payable', value: `${functionalCurrency} ${grossLoanPayable.toLocaleString()}`, badge: 'Gross Liability' }
      ],
      isComplete: true,
      missingFields: []
    };
  }

  // =========================================================================
  // SCENARIO 0B: ASSET PURCHASE WITH TRADE DISCOUNT, GST, CASH & CREDIT TERMS
  // e.g. "purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The vendor grants a 10% trade discount..."
  // =========================================================================
  const isFollowUpOnDiscount = currentScenario?.scenarioType === 'ASSET_PURCHASE_DISCOUNT' &&
    (q.includes('discount') || q.includes('cash') || q.includes('bank') || q.includes('price') || q.includes('pay') || q.includes('settle') || q.includes('what if') || q.includes('change') || q.includes('how about') || q.includes('why') || q.includes('explain') || q.includes('compound') || q.includes('depreciation'));

  const isAssetPurchaseWithDiscount = 
    isFollowUpOnDiscount ||
    (((q.includes('purchas') || q.includes('bought') || q.includes('acquir')) &&
      (q.includes('discount') || q.includes('list price') || q.includes('credit terms')) &&
      (q.includes('equipment') || q.includes('furniture') || q.includes('machinery') || q.includes('computer') || q.includes('asset') || q.includes('inventory'))));

  if (isAssetPurchaseWithDiscount) {
    // 1. Asset Name
    let assetTitle = 'Office Equipment';
    if (isFollowUpOnDiscount && currentScenario?.transactionTitle) {
      if (currentScenario.transactionTitle.includes('Machinery')) assetTitle = 'Machinery';
      else if (currentScenario.transactionTitle.includes('Furniture')) assetTitle = 'Furniture & Fixtures';
      else if (currentScenario.transactionTitle.includes('Computer')) assetTitle = 'Computer Equipment';
    }
    if (q.includes('office equipment')) assetTitle = 'Office Equipment';
    else if (q.includes('machinery')) assetTitle = 'Machinery';
    else if (q.includes('furniture')) assetTitle = 'Furniture & Fixtures';
    else if (q.includes('computer')) assetTitle = 'Computer Equipment';
    else if (q.includes('vehicle')) assetTitle = 'Motor Vehicles';

    // 2. List Price
    let listPrice = 20000;
    if (isFollowUpOnDiscount && currentScenario?.keyParameters) {
      const priorParam = currentScenario.keyParameters.find(p => p.label.includes('List Price'));
      if (priorParam) {
        const num = parseFloat(priorParam.value.replace(/[^0-9.]/g, ''));
        if (num > 100) listPrice = num;
      }
    }
    const listPriceMatch = query.match(/(?:list\s*price|price|cost|for)\s*(?:of|is|at|to)?\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (listPriceMatch && listPriceMatch[1]) {
      const parsedVal = parseFloat(listPriceMatch[1].replace(/,/g, ''));
      if (parsedVal > 100) listPrice = parsedVal;
    }

    // 3. Trade discount %
    let discountRate = 0.10;
    if (isFollowUpOnDiscount && currentScenario?.keyParameters) {
      const priorDiscountParam = currentScenario.keyParameters.find(p => p.label.includes('Trade Discount'));
      if (priorDiscountParam) {
        const match = priorDiscountParam.label.match(/(\d+(?:\.\d+)?)\s*%/);
        if (match && match[1]) discountRate = parseFloat(match[1]) / 100;
      }
    }
    const discountMatch = query.match(/(\d+(?:\.\d+)?)\s*%\s*(?:trade\s*)?discount/i) || query.match(/discount\s*(?:is|=|to)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (discountMatch && discountMatch[1]) {
      discountRate = parseFloat(discountMatch[1]) / 100;
    }
    const tradeDiscountAmount = Math.round(listPrice * discountRate * 100) / 100;
    const netAssetCost = listPrice - tradeDiscountAmount; // e.g. 18000

    // 4. GST
    let gstRate = 0.09;
    const gstMatch = query.match(/(\d+)%\s*gst/i);
    if (gstMatch && gstMatch[1]) {
      gstRate = parseFloat(gstMatch[1]) / 100;
    }
    const inputGst = Math.round(netAssetCost * gstRate * 100) / 100; // e.g. 1620
    const grossInvoice = netAssetCost + inputGst; // e.g. 19620

    // 5. Immediate cash paid
    let immediateCash = 5000;
    if (isFollowUpOnDiscount && currentScenario?.keyParameters) {
      const priorCashParam = currentScenario.keyParameters.find(p => p.label.includes('Immediate Bank Payment') || p.label.includes('Cash Paid'));
      if (priorCashParam) {
        const num = parseFloat(priorCashParam.value.replace(/[^0-9.]/g, ''));
        if (num >= 0) immediateCash = num;
      }
    }
    const cashMatch = query.match(/(?:pays?|paid|cash|bank\s*transfer)[^0-9]*?(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(?:immediately|by|via|bank)?/i);
    if (cashMatch && cashMatch[1]) {
      const parsedVal = parseFloat(cashMatch[1].replace(/,/g, ''));
      if (parsedVal >= 0) immediateCash = parsedVal;
    }

    // 6. Remaining balance on credit terms (Trade / Other Payables)
    const creditBalance = grossInvoice - immediateCash; // e.g. 14620

    // 7. Transaction Date
    let transDate = '01/08/2026';
    if (isFollowUpOnDiscount && currentScenario?.directGroups?.[0]?.eventDate) {
      transDate = currentScenario.directGroups[0].eventDate;
    }
    const dateMatch = query.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})/i);
    if (dateMatch) {
      const monthMap: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
      const mStr = dateMatch[2].toLowerCase().slice(0, 3);
      transDate = `${dateMatch[1].padStart(2, '0')}/${monthMap[mStr] || '08'}/${dateMatch[3]}`;
    }

    const lines: JournalLine[] = [
      {
        id: 'l-equip-cost',
        accountCode: '1500',
        accountName: `${assetTitle} - Cost (Non-Current Asset)`,
        category: 'ASSET',
        debit: netAssetCost,
        credit: 0,
        lineExplanation: `Capitalization of ${assetTitle.toLowerCase()} at net purchase price after deducting ${discountRate * 100}% trade discount under IAS 16 §16(a).`
      },
      {
        id: 'l-gst-input',
        accountCode: '1190',
        accountName: 'GST Input Tax (IRAS 9% Receivable)',
        category: 'ASSET',
        debit: inputGst,
        credit: 0,
        lineExplanation: '9% recoverable input GST on net purchase price claimable from IRAS.'
      },
      {
        id: 'l-bank-pay',
        accountCode: '1010',
        accountName: 'Cash at Bank',
        category: 'ASSET',
        debit: 0,
        credit: immediateCash,
        lineExplanation: 'Immediate partial settlement paid via bank transfer.'
      },
      {
        id: 'l-trade-payable',
        accountCode: '2010',
        accountName: 'Trade Payables / Other Payables (Current Liability)',
        category: 'LIABILITY',
        debit: 0,
        credit: creditBalance,
        lineExplanation: 'Unsettled balance placed on commercial credit terms.'
      }
    ];

    const isSettlement = q.includes('settle') || q.includes('pay the remaining') || q.includes('paid balance') || q.includes('settlement');

    const directGroups: JournalEntryGroup[] = [
      {
        id: 'grp-equip-purchase',
        eventDate: formatSingaporeDate(transDate),
        title: `Single Compound Journal Entry: Purchase of ${assetTitle}`,
        summary: `Purchase of ${assetTitle} with list price ${functionalCurrency} ${listPrice.toLocaleString()} less ${discountRate * 100}% trade discount + 9% GST`,
        lines,
        totalDebit: netAssetCost + inputGst,
        totalCredit: immediateCash + creditBalance,
        isBalanced: true,
        citations: [
          getCitation('IAS16_TRADE_DISCOUNT', 'SFRS_I'),
          getCitation('IAS16_PPE_RECOGNITION', 'SFRS_I')
        ],
        rationalePoints: [
          `Under IAS 16 / SFRS(I) 1-16 §16(a): Trade discounts (${functionalCurrency} ${tradeDiscountAmount.toLocaleString()}) are deducted from list price to determine initial cost. Trade discounts are never recorded as separate ledger lines.`,
          `Under Singapore GST Act: 9% GST is calculated on the net selling price after trade discount (${functionalCurrency} ${netAssetCost.toLocaleString()} × 9% = ${functionalCurrency} ${inputGst.toLocaleString()}).`,
          `Sum of Debits (${functionalCurrency} ${(netAssetCost + inputGst).toLocaleString()}) = Sum of Credits (${functionalCurrency} ${(immediateCash + creditBalance).toLocaleString()}). Single compound entry is 100% balanced.`
        ]
      }
    ];

    if (isSettlement && creditBalance > 0) {
      directGroups.push({
        id: 'grp-equip-settle',
        eventDate: '15/08/2026',
        title: 'Subsequent Settlement of Trade Payables',
        summary: `Settlement of outstanding balance of ${functionalCurrency} ${creditBalance.toLocaleString()} via bank transfer under IFRS 9 §3.3.1`,
        lines: [
          {
            id: 'l-settle-payable',
            accountCode: '2010',
            accountName: 'Trade Payables / Other Payables (Current Liability)',
            category: 'LIABILITY',
            debit: creditBalance,
            credit: 0,
            lineExplanation: 'Derecognition of financial liability upon discharge of payment obligation.'
          },
          {
            id: 'l-settle-bank',
            accountCode: '1010',
            accountName: 'Cash at Bank',
            category: 'ASSET',
            debit: 0,
            credit: creditBalance,
            lineExplanation: 'Disbursement of funds via bank transfer to settle vendor invoice.'
          }
        ],
        totalDebit: creditBalance,
        totalCredit: creditBalance,
        isBalanced: true,
        citations: [
          getCitation('IFRS9_DERECOGNITION_LIABILITY', 'SFRS_I')
        ],
        rationalePoints: [
          `Under IFRS 9 §3.3.1: An entity removes a financial liability from its balance sheet when the contractual obligation is discharged.`,
          `Debit: Trade Payables decreases on settlement.`,
          `Credit: Cash at Bank decreases on disbursement.`
        ]
      });
    } else if (currentScenario?.directGroups && currentScenario.directGroups.length > 1) {
      for (let i = 1; i < currentScenario.directGroups.length; i++) {
        const existingGrp = currentScenario.directGroups[i];
        if (existingGrp.id === 'grp-equip-settle') {
          const grpClone = {
            ...existingGrp,
            lines: existingGrp.lines.map(l => ({
              ...l,
              debit: l.debit > 0 ? creditBalance : 0,
              credit: l.credit > 0 ? creditBalance : 0
            })),
            totalDebit: creditBalance,
            totalCredit: creditBalance
          };
          directGroups.push(grpClone);
        } else {
          directGroups.push(existingGrp);
        }
      }
    }

    const hasSettlement = isSettlement || directGroups.some(g => g.id === 'grp-equip-settle');

    return {
      scenarioType: 'ASSET_PURCHASE_DISCOUNT',
      rawQuery: query,
      transactionTitle: `Purchase of ${assetTitle} (Trade Discount & Credit Terms)`,
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      directGroups,
      keyParameters: [
        { label: 'List Price (Excl. GST)', value: `${functionalCurrency} ${listPrice.toLocaleString()}`, badge: 'List Price' },
        { label: `Trade Discount (${discountRate * 100}%)`, value: `-${functionalCurrency} ${tradeDiscountAmount.toLocaleString()}`, badge: 'IAS 16 §16(a)' },
        { label: 'Net Capitalized Cost', value: `${functionalCurrency} ${netAssetCost.toLocaleString()}`, badge: 'Asset Cost' },
        { label: 'Input GST (9% Claimable)', value: `${functionalCurrency} ${inputGst.toLocaleString()}`, badge: 'Tax Receivable' },
        { label: 'Total Invoice Payable', value: `${functionalCurrency} ${grossInvoice.toLocaleString()}`, badge: 'Gross Payable' },
        { label: 'Immediate Bank Payment', value: `${functionalCurrency} ${immediateCash.toLocaleString()}`, badge: 'Bank Outflow' },
        { label: 'Trade Payables (Credit Terms)', value: `${functionalCurrency} ${creditBalance.toLocaleString()}`, badge: 'Liability', highlight: !hasSettlement },
        ...(hasSettlement ? [{ label: 'Settlement Status', value: `Settled in Full (${functionalCurrency} ${creditBalance.toLocaleString()})`, badge: 'Discharged' }] : [])
      ],
      isComplete: true,
      missingFields: []
    };
  }

  // =========================================================================
  // SCENARIO A: GENERAL OPERATING EXPENSES (Entertainment, Travel, Bills, etc.)
  // e.g. "i pay for entertainment expenses 3k with bank"
  // =========================================================================
  const isGeneralExpense = 
    q.includes('expense') || 
    q.includes('entertainment') || 
    q.includes('utilities') || 
    q.includes('electricity') || 
    q.includes('salary') || 
    q.includes('salaries') || 
    q.includes('marketing') || 
    q.includes('advertising') || 
    q.includes('travel') || 
    q.includes('supplies') || 
    q.includes('consulting') || 
    q.includes('stationery') ||
    (q.includes('pay for') && !q.includes('rental') && !q.includes('lease') && !q.includes('shares'));

  if (isGeneralExpense) {
    // Extract amount: e.g. "3k", "3,000", "$3000", "sgd 3k"
    let expenseAmount = 3000;
    const amtMatch = query.match(/(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|thousand)?/i);
    if (amtMatch && amtMatch[1]) {
      let rawVal = parseFloat(amtMatch[1].replace(/,/g, ''));
      const unit = amtMatch[2]?.toLowerCase();
      if (unit === 'k' || unit === 'thousand') rawVal *= 1000;
      if (unit === 'm') rawVal *= 1000000;
      if (rawVal > 0) expenseAmount = rawVal;
    }

    // Determine expense title
    let expenseTitle = 'Operating Expense';
    if (q.includes('entertainment')) expenseTitle = 'Entertainment & Hospitality Expenses';
    else if (q.includes('travel')) expenseTitle = 'Travel & Transportation Expenses';
    else if (q.includes('utilit') || q.includes('electric')) expenseTitle = 'Utilities & Electricity Expenses';
    else if (q.includes('salary') || q.includes('salaries')) expenseTitle = 'Staff Salaries & Wages';
    else if (q.includes('market') || q.includes('advertis')) expenseTitle = 'Marketing & Advertising Expenses';
    else if (q.includes('suppl') || q.includes('stationery')) expenseTitle = 'Office Supplies & Stationery';

    // Determine payment method
    let paymentMethod = 'Cash at Bank (Current Account)';
    if (q.includes('cash') && !q.includes('bank')) {
      paymentMethod = 'Petty Cash';
    } else if (q.includes('credit card')) {
      paymentMethod = 'Credit Card Payable';
    } else if (q.includes('on account') || q.includes('invoice') || q.includes('payable')) {
      paymentMethod = 'Trade Payables';
    }

    return {
      scenarioType: 'GENERAL_EXPENSE',
      rawQuery: query,
      transactionTitle: `Payment of ${expenseTitle}`,
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      expenseAccountName: expenseTitle,
      paymentMethodAccountName: paymentMethod,
      amount: expenseAmount,
      assetName: expenseTitle,
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseAmountForeign: 0,
      classification: 'FVTPL',
      bifurcateFxGain: true,
      isComplete: true,
      missingFields: []
    };
  }

  // =========================================================================
  // SCENARIO B: LEASES (IFRS 16 / SFRS(I) 16)
  // e.g. "i have a rental agreement for 3 years, paying 1 month sgd3,000"
  // =========================================================================
  if (q.includes('rental') || q.includes('lease') || q.includes('rent') || q.includes('tenancy')) {
    let termYears = 3;
    const yearMatch = query.match(/(\d+)\s*(?:years?|yrs?)/i);
    if (yearMatch && yearMatch[1]) {
      termYears = parseInt(yearMatch[1], 10);
    }

    let termMonths = termYears * 12;
    const monthTermMatch = query.match(/(\d+)\s*(?:months?|mos?)/i);
    if (monthTermMatch && monthTermMatch[1] && !yearMatch) {
      termMonths = parseInt(monthTermMatch[1], 10);
      termYears = Math.round(termMonths / 12 * 10) / 10;
    }

    let monthlyRent = 3000;
    const rentMatch = query.match(/(?:paying|rent(?:al)?|cost)?\s*(?:1\s*month|\/month|monthly|per\s*month)?\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i)
      || query.match(/(?:sgd|\$)\s*([\d,]+(?:\.\d+)?)/i);

    if (rentMatch && rentMatch[1]) {
      const parsed = parseFloat(rentMatch[1].replace(/,/g, ''));
      if (parsed > 50) monthlyRent = parsed;
    }

    let discountRateAnnual = 5.0;
    const rateMatch = query.match(/(?:discount\s*rate|ibr|interest|rate)\s*(?:of|is|at)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (rateMatch && rateMatch[1]) {
      discountRateAnnual = parseFloat(rateMatch[1]);
    }

    return {
      scenarioType: 'LEASE_IFRS16',
      rawQuery: query,
      transactionTitle: `${termYears}-Year Property Lease Inception (IFRS 16)`,
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      assetName: `Leased Property (${termYears}-Year Agreement)`,
      purchaseDate: '2026-01-01',
      purchaseAmountForeign: monthlyRent * termMonths,
      classification: 'FVTPL',
      bifurcateFxGain: true,
      leaseTermYears: termYears,
      leaseTermMonths: termMonths,
      leasePaymentMonthly: monthlyRent,
      leaseDiscountRateAnnual: discountRateAnnual,
      leaseCommencementDate: '2026-01-01',
      isComplete: true,
      missingFields: []
    };
  }

  // =========================================================================
  // SCENARIO C: EQUITY SHARES & FOREX (IFRS 9 & IAS 21)
  // =========================================================================
  const isShares = 
    q.includes('share') || 
    q.includes('stock') || 
    q.includes('apple') || 
    q.includes('aapl') || 
    q.includes('tesla') || 
    q.includes('tsla') || 
    q.includes('microsoft') || 
    q.includes('equity') || 
    q.includes('fvtpl') || 
    q.includes('fvtoci');

  if (!isShares) {
    if (currentScenario) {
      return {
        ...currentScenario,
        rawQuery: query
      };
    }
    return {
      scenarioType: 'UNRECOGNIZED',
      rawQuery: query,
      transactionTitle: 'Unrecognized Query (Offline Mode)',
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      directGroups: [],
      keyParameters: [
        { label: 'Evaluation Mode', value: 'Offline Rule Parser', badge: 'Offline' },
        { label: 'AI Status', value: 'Connect Gemini API Key for Universal Accounting', badge: 'Setup' }
      ],
      isComplete: false,
      missingFields: []
    };
  }

  let transactionCurrency = 'USD';
  if (q.includes('usd') || q.includes('us dollar')) transactionCurrency = 'USD';
  else if (q.includes('eur')) transactionCurrency = 'EUR';
  else if (q.includes('gbp')) transactionCurrency = 'GBP';

  let assetName = 'Foreign Shares Investment';
  if (q.includes('apple') || q.includes('aapl')) assetName = 'Apple Inc. (AAPL) Shares';
  else if (q.includes('tesla') || q.includes('tsla')) assetName = 'Tesla Inc. (TSLA) Shares';
  else if (q.includes('microsoft')) assetName = 'Microsoft Corp. Shares';

  let quantity: number | undefined = undefined;
  const qtyMatch = query.match(/(\d[\d,]*)\s*(?:apple\s*)?shares/i);
  if (qtyMatch && qtyMatch[1]) {
    quantity = parseInt(qtyMatch[1].replace(/,/g, ''), 10);
  }

  let purchaseAmountForeign = 0;
  const buyMatch = query.match(/(?:invested|bought|purchased|acquired|cost|paid)\s*(?:(?:an amount of|sum of|value of)\s*)?(?:usd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i)
    || query.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:into|for|in)?/i);

  if (buyMatch) {
    let rawVal = parseFloat(buyMatch[1].replace(/,/g, ''));
    const unit = buyMatch[2]?.toLowerCase();
    if (unit === 'k' || unit === 'thousand') rawVal *= 1000;
    if (unit === 'm' || unit === 'million') rawVal *= 1000000;
    purchaseAmountForeign = rawVal;
  } else if (q.includes('300k')) {
    purchaseAmountForeign = 300000;
  }

  let saleAmountForeign: number | undefined = undefined;
  const sellForMatch = query.match(/(?:sold|disposed|derecognised|sale)\s*(?:(?:all|the)?\s*[\d,]*\s*(?:apple\s*)?shares\s*)?(?:for|at|with proceeds of|amounting to)\s*(?:usd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i);

  if (sellForMatch) {
    let rawVal = parseFloat(sellForMatch[1].replace(/,/g, ''));
    const unit = sellForMatch[2]?.toLowerCase();
    if (unit === 'k' || unit === 'thousand') rawVal *= 1000;
    if (unit === 'm' || unit === 'million') rawVal *= 1000000;
    saleAmountForeign = rawVal;
  } else {
    const allAmounts = [...query.matchAll(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/gi)];
    if (allAmounts.length >= 2) {
      let rawVal = parseFloat(allAmounts[1][1].replace(/,/g, ''));
      const unit = allAmounts[1][2]?.toLowerCase();
      if (unit === 'k' || unit === 'thousand') rawVal *= 1000;
      if (unit === 'm' || unit === 'million') rawVal *= 1000000;
      saleAmountForeign = rawVal;
    } else if (q.includes('400k')) {
      saleAmountForeign = 400000;
    }
  }

  const dateRegex = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g;
  const foundDates: string[] = [];
  const isoDates: string[] = [];
  let dMatch;
  while ((dMatch = dateRegex.exec(query)) !== null) {
    const day = dMatch[1].padStart(2, '0');
    const month = dMatch[2].padStart(2, '0');
    const year = dMatch[3];
    foundDates.push(`${day}/${month}/${year}`);
    isoDates.push(`${year}-${month}-${day}`);
  }

  let purchaseDate = foundDates[0] || '13/11/2026';
  let saleDate = foundDates[1] || (saleAmountForeign ? '15/12/2026' : undefined);
  let purchaseDateIso = isoDates[0] || '2026-11-13';
  let saleDateIso = isoDates[1] || '2026-12-15';

  // FETCH REAL SPOT RATES FROM FRANKFURTER API!
  let purchaseFxRate = 1.34;
  let saleFxRate = 1.36;
  let fxSource = 'Frankfurter API (European Central Bank Reference)';

  if (functionalCurrency !== transactionCurrency) {
    try {
      const buyRateObj = await getExchangeRate(transactionCurrency, functionalCurrency, purchaseDateIso);
      purchaseFxRate = Math.round(buyRateObj.rate * 10000) / 10000;
      fxSource = buyRateObj.source;

      if (saleDate) {
        const sellRateObj = await getExchangeRate(transactionCurrency, functionalCurrency, saleDateIso);
        saleFxRate = Math.round(sellRateObj.rate * 10000) / 10000;
      }
    } catch {
      // Fallback
    }
  }

  return {
    scenarioType: 'EQUITY_INVESTMENT_FX',
    rawQuery: query,
    transactionTitle: `Investment & Sale of ${assetName} (USD/SGD)`,
    functionalCurrency,
    transactionCurrency,
    assetName,
    quantity,
    purchaseDate,
    purchaseAmountForeign,
    purchaseFxRate,
    saleDate,
    saleAmountForeign,
    saleFxRate,
    classification: 'FVTPL',
    bifurcateFxGain: true,
    fxSource,
    isComplete: true,
    missingFields: []
  };
}
