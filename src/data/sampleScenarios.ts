export interface SamplePrompt {
  id: string;
  title: string;
  standard: 'SFRS(I) 9 & 1-21' | 'SFRS(I) 16' | 'IFRS 16';
  query: string;
  tag: string;
}

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    id: 'apple-shares-fx',
    title: 'Apple Shares (USD 300k to 400k, SGD functional)',
    standard: 'SFRS(I) 9 & 1-21',
    query: 'A company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. What are the double entries and FX gain?',
    tag: 'Your FX Example'
  },
  {
    id: 'rental-lease-ifrs16',
    title: 'Rental Agreement (3 years, SGD 3,000/month)',
    standard: 'SFRS(I) 16',
    query: 'I have a rental agreement for 3 years, paying 1 month SGD 3,000. What is the double entry under SFRS(I) 16 / IFRS 16?',
    tag: 'Your Lease Example'
  },
  {
    id: 'fvtoci-equity',
    title: 'Strategic Foreign Shares (FVTOCI Election)',
    standard: 'SFRS(I) 9 & 1-21',
    query: 'Company with SGD functional currency buys USD 500k foreign equity shares at spot rate 1.34 under FVTOCI election. Sold for USD 650k at spot rate 1.37. Show OCI reserve and non-recycling double entries.',
    tag: 'FVTOCI Equity'
  }
];
