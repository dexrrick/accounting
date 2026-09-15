export const invoiceVisionResponse = {
  imageEvidence: [{
    imageIndex: 1,
    documentType: 'supplier_invoice',
    confidence: 0.97,
    fields: { supplier: 'ABC Equipment Pte Ltd', invoiceDate: '15/09/2026', subtotal: 10000, gst: 900, total: 10900, currency: 'SGD' }
  }]
};

export const xeroJournalVisionResponse = {
  imageEvidence: [{ imageIndex: 1, documentType: 'xero_journal', confidence: 0.95, fields: { debitAccount: 'Office Equipment', creditAccount: 'Accounts Payable', total: 10900, currency: 'SGD' } }]
};

export const bankTransactionVisionResponse = {
  imageEvidence: [{ imageIndex: 1, documentType: 'bank_transaction', confidence: 0.93, fields: { transactionDate: '15/09/2026', amount: 10900, currency: 'SGD' } }]
};

export const investmentStatementVisionResponse = {
  imageEvidence: [{ imageIndex: 1, documentType: 'investment_statement', confidence: 0.92, fields: { instrument: 'Example Fund', quantity: 100, value: 18500, currency: 'SGD' } }]
};

export const leaseScheduleVisionResponse = {
  imageEvidence: [{ imageIndex: 1, documentType: 'lease_schedule', confidence: 0.91, fields: { commencementDate: '01/01/2026', monthlyPayment: 3000, leaseTermMonths: 36, currency: 'SGD' } }]
};

export const auditAdjustmentVisionResponse = {
  imageEvidence: [{ imageIndex: 1, documentType: 'audit_adjustment', confidence: 0.88, fields: { adjustmentAmount: 18650, adjustmentDate: '31/12/2026', currency: 'SGD' } }]
};
