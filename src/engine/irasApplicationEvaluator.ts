import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';

export interface IrasApplicationConclusion {
  text: string;
  sourceRecordId: string;
  certainty: 'DETERMINISTIC' | 'CONDITIONAL';
}

function admittedLocalRecord(records: AuthoritativeSourceRecord[], id: string, targetDate?: string): AuthoritativeSourceRecord | undefined {
  return records.find(record => record.id === id && record.provenance === 'LOCAL_STATIC' &&
    (record.sourceStatus === 'VERIFIED' || record.sourceStatus === 'HISTORICAL') &&
    (!targetDate || ((!record.validFrom || record.validFrom <= targetDate) &&
      (!record.validTo || targetDate <= record.validTo))));
}

/** Applies only facts stated by the user to already admitted IRAS local rules. */
export function evaluateIrasApplications(
  query: string,
  eligibleRecords: AuthoritativeSourceRecord[],
  targetDate?: string
): IrasApplicationConclusion[] {
  const conclusions: IrasApplicationConclusion[] = [];
  const formRule = admittedLocalRecord(eligibleRecords, 'IRAS_FORM_CS_LITE_CRITERIA', targetDate);
  if (formRule && /\bform\s+c-s(?:\s*\(lite\)|\s+lite)?\b/i.test(query)) {
    const creditClaim = /\b(?:claims?|claiming|will claim|intends? to claim)\s+(?:a\s+)?foreign\s+tax\s+credit\b/i.exec(query);
    if (creditClaim) {
      const before = query.slice(Math.max(0, creditClaim.index - 35), creditClaim.index);
      if (!/\b(?:not|never|no|without|doesn't|don't|will not)\b[^.!?;]{0,25}$/i.test(before)) {
        const conditional = /\b(?:if|whether|assuming|suppose|provided that)\b[^.!?;]{0,30}$/i.test(before);
        conclusions.push({
          sourceRecordId: formRule.id,
          certainty: conditional ? 'CONDITIONAL' : 'DETERMINISTIC',
          text: conditional
            ? 'If the company claims a foreign tax credit for that Year of Assessment, it cannot use Form C-S or Form C-S (Lite); Form C is required.'
            : 'A company claiming a foreign tax credit for that Year of Assessment cannot use Form C-S or Form C-S (Lite); Form C is required.'
        });
      }
    }
  }

  if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) &&
      /\b(?:section\s*)?13w\b/i.test(query) &&
      /\b(?:dispos\w*|sale|sold)\b/i.test(query) &&
      /\b(?:ordinary|preference)\s+shares?\b/i.test(query) &&
      /\b20\d{2}\b/.test(query)) {
    const historical = admittedLocalRecord(eligibleRecords, 'ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR', targetDate);
    const current = admittedLocalRecord(eligibleRecords, 'ITA_SEC13W_EQUITY_DISPOSAL_2026', targetDate);
    const rule = historical || current;
    if (rule && !(historical && /\bpreference\s+shares?\b/i.test(query))) {
      conclusions.push({
        sourceRecordId: rule.id,
        certainty: 'CONDITIONAL',
        text: `The disposal date selects the ${historical ? 'pre-2026 ordinary-share' : 'from-2026 ordinary/qualifying-preference-share'} Section 13W rule. Non-taxation remains conditional on the qualifying share class, required continuous holding, interest threshold and applicable exclusions; those conditions must be checked before treating the gain as exempt.`
      });
    }
  }
  return conclusions;
}
