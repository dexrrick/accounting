import { startsAttachedEvidenceQualification } from '../utils/evidenceTextBoundaries';
import { supportMasCmsRule } from './masCmsRuleSupport';

export interface BoundedStatutoryAdvisorySupportInput {
  authority: string;
  topicId: string;
  subject: string;
  originalQuery?: string;
  sourceText: string;
}

export type BoundedStatutoryAdvisoryRequest = Omit<BoundedStatutoryAdvisorySupportInput, 'sourceText'>;

type AdvisoryProfile = 'CPF_ORDINARY_WAGES' | 'MOM_PART_IV_OVERTIME';

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' ';
    });
}

function sourceBodyText(sourceText: string): string {
  return decodeHtmlEntities(sourceText
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|button|input|select|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd)\s*>/gi, '\n')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
    .toLowerCase();
}

function passages(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?;])\s+/)
    .map((passage) => passage.trim())
    .filter(Boolean);
}

function hasNegatedRequestCue(text: string): boolean {
  return /\b(?:not|never|without)\s+(?:asking|seeking|requesting|looking\s+for|interested\s+in)\b.{0,100}\b(?:definition|define|what\s+makes|criteria|coverage|eligibility|who\s+is\s+covered)\b/i.test(text)
    || /\bno\s+(?:need|request)\s+for\b.{0,80}\b(?:definition|criteria|coverage|eligibility)\b/i.test(text);
}

function hasCpfDefinitionAsk(subject: string, originalQuery: string | undefined): boolean {
  const hasTargetAsk = (value: string): boolean => value
    .split(/[?!.;]|\b(?:and|but)\b/i)
    .some((clause) => {
      const asksAboutOrdinaryWages = /\b(?:definition|define|what\s+is\s+meant\s+by)\b.{0,45}\bordinary\s+wages\b/i.test(clause)
        || /\bordinary\s+wages\b.{0,35}\b(?:definition|meaning|criteria|classification)\b/i.test(clause)
        || /\bwhat\s+makes\b.{0,60}\bordinary\s+wages\b/i.test(clause)
        || /\bwhat\s+counts\s+as\s+ordinary\s+wages\b/i.test(clause)
        || /\bhow\s+(?:are\s+)?(?:wages\s+)?classified\s+as\s+ordinary\s+wages\b/i.test(clause);
      return asksAboutOrdinaryWages && !hasNegatedRequestCue(clause);
    });
  return hasTargetAsk(subject) || hasTargetAsk(originalQuery ?? '');
}

function hasMomCoverageAsk(subject: string, originalQuery: string | undefined): boolean {
  const hasPartIvContext = (value: string): boolean =>
    /\bpart\s+(?:iv|4)\b|\bovertime\b/i.test(value);
  const hasCoverageCue = (value: string): boolean =>
    /\b(?:coverage|covered|eligibility|eligible|who\s+(?:is|are)\s+covered|applicability)\b/i.test(value);
  const hasEmployeeCoverageAsk = (value: string): boolean =>
    /\b(?:employee|employees|workmen?|non[\s-]?workmen?|managers?|executives?)\b/i.test(value)
    && hasCoverageCue(value)
    && !hasNegatedRequestCue(value);
  const hasTargetCoverageAsk = (value: string): boolean => value
    .split(/[?!.;]|\band\b/i)
    .some(clause => hasPartIvContext(clause)
      && hasCoverageCue(clause)
      && !hasNegatedRequestCue(clause));
  const query = originalQuery ?? '';
  const subjectHasTargetAsk = hasTargetCoverageAsk(subject) && !hasNegatedRequestCue(query);
  const queryClauses = query.split(/[?!.;]|\band\b/i);
  const queryHasTargetAsk = hasTargetCoverageAsk(query);
  const subjectHasTopicAndQueryAsksAboutEmployees = hasPartIvContext(subject)
    && queryClauses.some((clause) => hasEmployeeCoverageAsk(clause)
      && !/\b(?:mas|capital\s+markets\s+services\s+licence|cpf|iras|acra)\b/i.test(clause));
  return subjectHasTargetAsk || queryHasTargetAsk || subjectHasTopicAndQueryAsksAboutEmployees;
}

function recognizeProfile(input: BoundedStatutoryAdvisorySupportInput): AdvisoryProfile | undefined {
  const authority = compact(input.authority);
  const topicId = compact(input.topicId);

  if (['cpf', 'cpfboard', 'centralprovidentfundboard'].includes(authority)
    && topicId === 'cpfordinarywages'
    && hasCpfDefinitionAsk(input.subject, input.originalQuery)) {
    return 'CPF_ORDINARY_WAGES';
  }

  if (['mom', 'ministryofmanpower'].includes(authority)
    && topicId === 'mompartivovertime'
    && hasMomCoverageAsk(input.subject, input.originalQuery)) {
    return 'MOM_PART_IV_OVERTIME';
  }

  return undefined;
}

/** Identifies only the bounded requests for which complete source coverage is required. */
export function isBoundedStatutoryAdvisoryRequest(input: BoundedStatutoryAdvisoryRequest): boolean {
  return recognizeProfile({ ...input, sourceText: '' }) !== undefined;
}

function hasAffirmativeCpfDefinition(text: string): boolean {
  return /\bordinary\s+wages\b.{0,90}\b(?:means|refers\s+to|is\s+defined\s+as|are\s+defined\s+as)\b/.test(text)
    || ( /\bclassified\s+as\s+ordinary\s+wages\b.{0,80}\b(?:for\s+the\s+month|each\s+month|monthly)\b/.test(text)
      && !/\b(?:not|never|cannot|must\s+not)\s+(?:be\s+)?classified\s+as\s+ordinary\s+wages\b/.test(text));
}

function hasCpfCriteriaLinkage(text: string): boolean {
  return /\bfor\s+wages\s+to\s+be\s+classified\s+as\s+ordinary\s+wages\s+for\s+the\s+month\b.{0,140}\bthey\s+must\s+meet\s+both\s+(?:(?:of\s+)?the\s+)?following\s+(?:criteria|conditions)\b/.test(text);
}

function hasContradictoryCpfDefinition(text: string): boolean {
  return /\borderinary\s+wages\b.{0,80}\b(?:does\s+not\s+mean|do\s+not\s+mean|is\s+not\s+defined\s+as|are\s+not\s+defined\s+as|are\s+not)\b/.test(text)
    || /\b(?:not|never|cannot|must\s+not|does\s+not|do\s+not)\b.{0,35}\bclassified\s+as\s+ordinary\s+wages\b/.test(text);
}

function hasMonthOfEmploymentCondition(text: string): boolean {
  return passages(text).some((passage) => {
    const hasMonthLink = /\b(?:employment|employed)\b.{0,60}\bin\s+that\s+month\b/.test(passage);
    const namesTheWageSubject = /\b(?:they|these|wages|ordinary\s+wages|such\s+wages)\b/.test(passage);
    const hasAffirmativeCondition = /\b(?:given|paid|earned|received|provided|granted|relates?\s+to|in\s+respect\s+of)\b/.test(passage);
    const negatesCondition = /\b(?:not|never|cannot|must\s+not|does\s+not|do\s+not|is\s+not|are\s+not)\b.{0,100}\b(?:given|paid|earned|received|employment|employed|in\s+that\s+month)\b/.test(passage)
      || /\b(?:given|paid|earned|received|employment|employed)\b.{0,60}\bnot\s+in\s+that\s+month\b/.test(passage);
    return hasMonthLink && namesTheWageSubject && hasAffirmativeCondition && !negatesCondition;
  });
}

function hasFollowingMonthPaymentCondition(text: string): boolean {
  const dayOfFollowingMonth = String.raw`\b(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\b.{0,30}\b(?:of\s+the\s+)?(?:following|next)\s+month\b`;
  const paymentDeadline = new RegExp(
    String.raw`\b(?:payable|paid|payment\s+(?:is\s+)?due|payment\s+must\s+be\s+made)\b.{0,50}\bby\b.{0,25}${dayOfFollowingMonth}`
  );
  return passages(text).some((passage) => /\b(?:they|these|wages|ordinary\s+wages|such\s+wages)\b/.test(passage)
    && paymentDeadline.test(passage)
    && !/\b(?:not|never|cannot|must\s+not|is\s+not|are\s+not)\s+(?:be\s+)?(?:payable|paid|due|made)\b/.test(passage));
}

function supportsCpfOrdinaryWages(text: string): boolean {
  const definitionPattern = /\bordinary\s+wages\b.{0,90}\b(?:means|refers\s+to|is\s+defined\s+as|are\s+defined\s+as)\b|\bclassified\s+as\s+ordinary\s+wages\b.{0,80}\b(?:for\s+the\s+month|each\s+month|monthly)\b/g;
  return [...text.matchAll(definitionPattern)].some((match) => {
    const start = Math.max(0, match.index - 120);
    const linkedContext = text.slice(start, match.index + match[0].length + 700);
    return hasAffirmativeCpfDefinition(linkedContext)
      && hasCpfCriteriaLinkage(linkedContext)
      && !hasContradictoryCpfDefinition(linkedContext)
      && hasMonthOfEmploymentCondition(linkedContext)
      && hasFollowingMonthPaymentCondition(linkedContext);
  });
}

const basicMonthlySalary = String.raw`\b(?:basic\s+monthly|monthly\s+basic)\s+salary\b`;
const numericThreshold = String.raw`(?:s\s?\$|sgd\s*)?\$?\s*\d[\d,]*(?:\.\d{1,2})?`;
const upperBound = String.raw`(?:or\s+less|or\s+below|and\s+below|at\s+most|up\s+to|not\s+more\s+than|no\s+more\s+than|does\s+not\s+exceed|not\s+exceeding|less\s+than\s+or\s+equal\s+to|at\s+or\s+below|not\s+above)`;

function hasQualifiedMonthlyBasicSalaryThreshold(passage: string): boolean {
  const salaryAndBound = new RegExp(
    String.raw`${basicMonthlySalary}.{0,45}${numericThreshold}.{0,25}${upperBound}`
      + String.raw`|${basicMonthlySalary}.{0,30}${upperBound}.{0,30}${numericThreshold}`
  );
  return salaryAndBound.test(passage);
}

function hasPartIvEmploymentActAnchor(text: string): boolean {
  return /\bpart\s+(?:iv|4)\b.{0,100}\bemployment\s+act\b/.test(text)
    || /\bemployment\s+act\b.{0,100}\bpart\s+(?:iv|4)\b/.test(text);
}

function hasQualifiedWorkmanCategory(text: string): boolean {
  const sourcePassages = passages(text);
  if (hasNegatedOvertimeCategory(sourcePassages, /\bwork(?:man|men)\b/)) return false;
  return sourcePassages.some((passage, index) => {
    const hasWorkmanCategory = [...passage.matchAll(/\bwork(?:man|men)\b/g)].some((match) =>
      !/non[\s-]*$/i.test(passage.slice(Math.max(0, match.index - 8), match.index)));
    return hasWorkmanCategory
      && hasQualifiedMonthlyBasicSalaryThreshold(passage)
      && hasAffirmativeOvertimeCategory(passage, index, sourcePassages, /\bwork(?:man|men)\b/);
  });
}

function hasQualifiedNonWorkmanCategory(text: string): boolean {
  const sourcePassages = passages(text);
  if (hasNegatedOvertimeCategory(sourcePassages, /\bnon[\s-]?work(?:man|men)\b/)) return false;
  return sourcePassages.some((passage, index) =>
    /\bnon[\s-]?work(?:man|men)\b/.test(passage)
    && hasQualifiedMonthlyBasicSalaryThreshold(passage)
    && hasAffirmativeOvertimeCategory(passage, index, sourcePassages, /\bnon[\s-]?work(?:man|men)\b/));
}

function hasNegatedOvertimeCategory(passagesToCheck: string[], categoryPattern: RegExp): boolean {
  return passagesToCheck.some((passage) => categoryPattern.test(passage)
    && /\b(?:not\s+(?:covered|eligible|entitled|subject\s+to|applicable)|(?:cannot|may\s+not|do\s+not|does\s+not)\s+(?:claim|qualify|fall|apply|cover)|ineligible)\b/i.test(passage));
}

function hasAffirmativeOvertimeCategory(
  passage: string,
  passageIndex: number,
  sourcePassages: string[],
  categoryPattern: RegExp
): boolean {
  const categoryIndex = passage.search(categoryPattern);
  const linkedText = passage.slice(Math.max(0, categoryIndex - 90), categoryIndex + 240);
  const negatedCoverage = /\b(?:not\s+(?:covered|eligible|entitled|subject\s+to|applicable)|(?:cannot|may\s+not|do\s+not|does\s+not)\s+(?:claim|qualify|fall|apply|cover)|ineligible)\b/i.test(linkedText);
  if (negatedCoverage) return false;

  const affirmativeOvertimeClaim = /\b(?:covered|eligible|entitled|can\s+claim|may\s+claim)\b.{0,100}\b(?:part\s+(?:iv|4)|overtime(?:\s+pay)?|hours\s+of\s+work)\b/i.test(linkedText)
    || /\b(?:part\s+(?:iv|4)|overtime(?:\s+pay)?|hours\s+of\s+work)\b.{0,100}\b(?:covered|eligible|entitled|can\s+claim|may\s+claim)\b/i.test(linkedText);
  if (affirmativeOvertimeClaim) return true;

  const previousPassage = sourcePassages[passageIndex - 1] ?? '';
  const continuesAffirmativeCategoryList = /\b(?:also|likewise|similarly)\s+(?:covered|eligible|entitled)\b/i.test(passage)
    && /\b(?:part\s+(?:iv|4)|overtime)\b/i.test(previousPassage)
    && /\b(?:covered|eligible|entitled)\b/i.test(previousPassage)
    && /\b(?:work(?:man|men)|non[\s-]?work(?:man|men))\b/i.test(previousPassage)
    && hasQualifiedMonthlyBasicSalaryThreshold(previousPassage);
  if (continuesAffirmativeCategoryList) return true;

  const claimOvertimeLeadIn = /\byou\s+can\s+claim\s+overtime\s+if\s+you\s+are\b/i;
  for (let index = passageIndex; index >= 0; index -= 1) {
    if (claimOvertimeLeadIn.test(sourcePassages[index])) return true;
    if (index === passageIndex) continue;
    if (/\b(?:work(?:man|men)|non[\s-]?work(?:man|men)|managers?|executives?)\b/i.test(sourcePassages[index])) continue;
    break;
  }
  return false;
}

function hasManagersAndExecutivesExclusion(text: string): boolean {
  return passages(text).some((passage) => {
    const managersAndExecutives = /\bmanagers?\b.{0,40}\bexecutives?\b/;
    const exclusionAfterCategories = new RegExp(
      String.raw`\bmanagers?\b.{0,40}\bexecutives?\b.{0,60}\b(?:are\s+)?(?:not\s+(?:covered|eligible|entitled|subject\s+to)|excluded\s+(?:from|under|by)|outside\s+(?:the\s+)?scope)\b`
    );
    const exclusionBeforeCategories = new RegExp(
      String.raw`\b(?:does\s+not\s+(?:cover|apply\s+to)|do\s+not\s+apply\s+to|excludes?)\b.{0,60}\bmanagers?\b.{0,40}\bexecutives?\b`
    );
    return managersAndExecutives.test(passage)
      && !/\bnot\s+excluded\b/.test(passage)
      && (exclusionAfterCategories.test(passage) || exclusionBeforeCategories.test(passage));
  });
}

function supportsMomPartIvOvertime(text: string): boolean {
  return hasPartIvEmploymentActAnchor(text)
    && hasQualifiedWorkmanCategory(text)
    && hasQualifiedNonWorkmanCategory(text)
    && hasManagersAndExecutivesExclusion(text);
}

/**
 * Supplies bounded content support for two explicit Singapore statutory advisory asks.
 * This is only a content-support check: callers must still verify official provenance,
 * source quotation, authority/topic fit, and claim coverage independently.
 */
export function supportBoundedStatutoryAdvisory(
  input: BoundedStatutoryAdvisorySupportInput
): boolean | undefined {
  const masSupport = supportMasCmsRule(input);
  if (masSupport !== undefined) return masSupport;

  const profile = recognizeProfile(input);
  if (profile === undefined) return undefined;

  const text = sourceBodyText(input.sourceText);
  if (text.length === 0) return false;

  return profile === 'CPF_ORDINARY_WAGES'
    ? supportsCpfOrdinaryWages(text)
    : supportsMomPartIvOvertime(text);
}

/**
 * Returns one shortest exact, contiguous paragraph/list span that completely
 * supports a recognized bounded advisory request. Limits keep selection work
 * predictable on long fetched pages.
 */
export function selectBoundedStatutoryAdvisoryPassage(
  input: BoundedStatutoryAdvisorySupportInput,
  maxChars = 5_000
): string | undefined {
  if (!Number.isInteger(maxChars) || maxChars <= 0 || maxChars > 5_000 || recognizeProfile(input) === undefined) {
    return undefined;
  }

  const sourceText = input.sourceText;
  if (sourceText.length === 0 || sourceText.length > 100_000) return undefined;
  if (sourceText.length <= maxChars) {
    return supportBoundedStatutoryAdvisory(input) === true ? sourceText.trim() : undefined;
  }

  const rawBlocks = sourceText.split(/\r?\n[\t ]*\r?\n+/);
  if (rawBlocks.length > 300) return undefined;
  const blocks: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  for (const rawBlock of rawBlocks) {
    const rawStart = sourceText.indexOf(rawBlock, searchFrom);
    if (rawStart < 0) return undefined;
    const block = rawBlock.trim();
    searchFrom = rawStart + rawBlock.length;
    if (!block) continue;
    const relativeStart = rawBlock.indexOf(block);
    const start = rawStart + relativeStart;
    blocks.push({ start, end: start + block.length });
  }

  const blockText = blocks.map(({ start, end }) => sourceText.slice(start, end));
  const requiredEndIndices = blocks.map((_block, index) => index);
  for (let index = blocks.length - 2; index >= 0; index -= 1) {
    const nextBlock = blockText[index + 1];
    if (/^(?:\|\s*)*[•◦▪]\s+/u.test(nextBlock) || startsAttachedEvidenceQualification(nextBlock)) {
      requiredEndIndices[index] = requiredEndIndices[index + 1];
    }
  }

  let supportChecks = 0;
  let best: { start: number; end: number } | undefined;
  for (let startIndex = 0; startIndex < blocks.length && supportChecks < 2_000; startIndex += 1) {
    if (/^(?:\|\s*)*[•◦▪]\s+/u.test(blockText[startIndex])) continue;
    for (let endIndex = startIndex; endIndex < blocks.length && supportChecks < 2_000; endIndex += 1) {
      const start = blocks[startIndex].start;
      const end = blocks[endIndex].end;
      if (end - start > maxChars) break;
      if (best && end - start >= best.end - best.start) break;

      supportChecks += 1;
      if (supportBoundedStatutoryAdvisory({ ...input, sourceText: sourceText.slice(start, end) }) === true) {
        const completeEndIndex = requiredEndIndices[endIndex];
        const completeEnd = blocks[completeEndIndex].end;
        if (completeEnd - start > maxChars) continue;
        if (completeEndIndex !== endIndex) {
          supportChecks += 1;
          if (supportChecks > 2_000 || supportBoundedStatutoryAdvisory({
            ...input,
            sourceText: sourceText.slice(start, completeEnd)
          }) !== true) continue;
        }
        if (!best || completeEnd - start < best.end - best.start) best = { start, end: completeEnd };
        break;
      }
    }
  }

  return best ? sourceText.slice(best.start, best.end) : undefined;
}
