import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { cleanHtmlText } from './sourceAdapters';

/**
 * Strict allowlist of authorized Singapore statutory authorities and verified reference APIs.
 */
export const ALLOWED_REGULATORY_HOSTNAMES = new Set([
  'sso.agc.gov.sg',
  'iras.gov.sg',
  'www.iras.gov.sg',
  'acra.gov.sg',
  'www.acra.gov.sg',
  'mom.gov.sg',
  'www.mom.gov.sg',
  'cpf.gov.sg',
  'www.cpf.gov.sg',
  'mas.gov.sg',
  'www.mas.gov.sg',
  // Ask.gov.sg publishes first-party FAQs for MAS, IRAS, CPF and other
  // Singapore agencies. It is guidance, not a substitute for legislation.
  'ask.gov.sg'
]);

export const ALLOWED_REFERENCE_HOSTNAMES = new Set([
  'api.frankfurter.dev'
]);

export const ALL_ALLOWED_HOSTNAMES = new Set([
  ...ALLOWED_REGULATORY_HOSTNAMES,
  ...ALLOWED_REFERENCE_HOSTNAMES
]);

export type ExternalValidationErrorCode =
  | 'INVALID_URL'
  | 'INSECURE_PROTOCOL'
  | 'NON_STANDARD_PORT'
  | 'CREDENTIALS_DISALLOWED'
  | 'UNAUTHORIZED_DOMAIN_ACCESS'
  | 'REDIRECT_REJECTED'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'MALFORMED_DOCUMENT_STRUCTURE'
  | 'CANONICAL_URL_MISMATCH'
  | 'PROVENANCE_MISMATCH'
  | 'INVALID_VERBATIM_CLAIM'
  | 'PROVISION_MAPPING_MISMATCH'
  | 'EXTRACTION_FAILED'
  | 'PARTIAL_PROVISION';

export interface ExternalValidationResult {
  isValid: boolean;
  errorCode?: ExternalValidationErrorCode;
  reason?: string;
}

/**
 * Deterministic mapping between full legislative titles and statutory short codes.
 */
export const CANONICAL_ACT_MAP: Record<string, string> = {
  'Companies Act 1967': 'CoA1967',
  'CoA1967': 'CoA1967',
  'Income Tax Act 1947': 'ITA1947',
  'ITA1947': 'ITA1947',
  'Employment Act 1968': 'EA1968',
  'EA1968': 'EA1968',
  'Central Provident Fund Act 1953': 'CPFA1953',
  'CPFA1953': 'CPFA1953',
  'Goods and Services Tax Act 1993': 'GSTA1993',
  'GSTA1993': 'GSTA1993',
  'Variable Capital Companies Act 2018': 'VCCA2018',
  'VCCA2018': 'VCCA2018',
  'FX_OBSERVATION': 'FX_OBSERVATION'
};

export function getCanonicalActCode(actOrCode?: string): string | undefined {
  if (!actOrCode) return undefined;
  const trimmed = actOrCode.trim();
  return CANONICAL_ACT_MAP[trimmed] || trimmed;
}

/**
 * External Source Validator.
 * Enforces security gates, exact hostname checks, HTTPS/port 443 enforcement,
 * redirect validation, and document structural checks.
 */
export class ExternalSourceValidator {
  /**
   * Validates URL security, protocol, port, credentials, and exact hostname.
   */
  public validateUrlSecurity(rawUrl: string): ExternalValidationResult {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { isValid: false, errorCode: 'INVALID_URL', reason: `Malformed URL: '${rawUrl}'` };
    }

    // 1. Protocol: HTTPS only
    if (parsed.protocol !== 'https:') {
      return { isValid: false, errorCode: 'INSECURE_PROTOCOL', reason: `Protocol '${parsed.protocol}' is forbidden; HTTPS on port 443 is strictly required` };
    }

    // 2. Port: 443 or default HTTPS port only
    if (parsed.port !== '' && parsed.port !== '443') {
      return { isValid: false, errorCode: 'NON_STANDARD_PORT', reason: `Port '${parsed.port}' is forbidden; only default HTTPS port 443 is permitted` };
    }

    // 3. Exact hostname matching
    const hostname = parsed.hostname.toLowerCase();
    if (!ALL_ALLOWED_HOSTNAMES.has(hostname)) {
      return {
        isValid: false,
        errorCode: 'UNAUTHORIZED_DOMAIN_ACCESS',
        reason: `Hostname '${hostname}' is not in the authorized statutory or reference domain allowlist`
      };
    }

    // 4. Credentials in URL: strictly rejected
    if (parsed.username || parsed.password) {
      return { isValid: false, errorCode: 'CREDENTIALS_DISALLOWED', reason: 'Embedded username or password in URL is strictly forbidden' };
    }

    return { isValid: true };
  }

  /**
   * Validates domain specifically against the allowlist
   */
  public validateDomain(url: string): boolean {
    return this.validateUrlSecurity(url).isValid;
  }

  /**
   * Validates protocol (HTTPS only)
   */
  public validateProtocol(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Validates redirect destinations against the same strict domain allowlist.
   */
  public validateRedirect(originalUrl: string, targetUrl: string): ExternalValidationResult {
    const origCheck = this.validateUrlSecurity(originalUrl);
    if (!origCheck.isValid) return origCheck;

    const targetCheck = this.validateUrlSecurity(targetUrl);
    if (!targetCheck.isValid) {
      return {
        isValid: false,
        errorCode: 'REDIRECT_REJECTED',
        reason: `Redirect to unauthorized destination '${targetUrl}' was rejected: ${targetCheck.reason}`
      };
    }

    return { isValid: true };
  }

  /**
   * Validates HTTP content type
   */
  public validateContentType(contentType?: string): boolean {
    if (!contentType) return false;
    const lower = contentType.toLowerCase();
    return (
      lower.includes('application/json') ||
      lower.includes('text/plain') ||
      lower.includes('text/html') ||
      lower.includes('application/xml')
    );
  }

  /**
   * Validates candidate document structure before allowing candidate registration.
   */
  public validateDocumentStructure(doc: any): ExternalValidationResult {
    if (!doc || typeof doc !== 'object') {
      return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Document payload is empty or not an object' };
    }

    const requiredFields = ['standardOrActCode', 'paragraphOrSection', 'sourceText', 'documentTitle'];
    for (const field of requiredFields) {
      if (!doc[field] || typeof doc[field] !== 'string' || doc[field].trim().length === 0) {
        return {
          isValid: false,
          errorCode: 'MALFORMED_DOCUMENT_STRUCTURE',
          reason: `Required statutory field '${field}' is missing or empty`
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Validates canonical URL aligns with statutory authority.
   */
  public validateCanonicalUrl(url: string, authority: string): ExternalValidationResult {
    const secCheck = this.validateUrlSecurity(url);
    if (!secCheck.isValid) return secCheck;

    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    if (authority === 'AGC' || authority === 'SSO') {
      if (host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `AGC/SSO statutory law must point to sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'IRAS') {
      if (host !== 'iras.gov.sg' && host !== 'www.iras.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `IRAS guidance must point to iras.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'ACRA') {
      if (host !== 'acra.gov.sg' && host !== 'www.acra.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `ACRA directives must point to acra.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'MOM') {
      if (host !== 'mom.gov.sg' && host !== 'www.mom.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `MOM statutory guidance must point to mom.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'CPF') {
      if (host !== 'cpf.gov.sg' && host !== 'www.cpf.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `CPF statutory guidance must point to cpf.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'REFERENCE_API') {
      if (host !== 'api.frankfurter.dev') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `Reference API must point to api.frankfurter.dev, found '${host}'` };
      }
    } else {
      return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `Unrecognized authority '${authority}' for canonical URL validation` };
    }

    return { isValid: true };
  }

  /**
   * Validates source provenance.
   * Proves that external content does not falsely claim local static provenance or unverified primary tier.
   */
  public validateProvenance(record: AuthoritativeSourceRecord, sourceUrl: string): ExternalValidationResult {
    const urlCheck = this.validateUrlSecurity(sourceUrl);
    if (!urlCheck.isValid) return urlCheck;

    // External fetched content cannot declare itself LOCAL_STATIC
    if (record.provenance === 'LOCAL_STATIC') {
      return {
        isValid: false,
        errorCode: 'PROVENANCE_MISMATCH',
        reason: 'Externally retrieved candidate cannot declare provenance as LOCAL_STATIC'
      };
    }

    return { isValid: true };
  }

  /**
   * Validates that candidate sourceText can be deterministically tied back to the recorded source boundary in the raw document.
   */
  public validateSourceBoundary(record: AuthoritativeSourceRecord, rawDocument: string): ExternalValidationResult {
    if (!rawDocument || typeof rawDocument !== 'string' || rawDocument.length === 0) {
      return {
        isValid: false,
        errorCode: 'MALFORMED_DOCUMENT_STRUCTURE',
        reason: 'Raw document is required to validate source boundary'
      };
    }

    if (record.extractionStatus === 'FAILED') {
      return {
        isValid: false,
        errorCode: 'EXTRACTION_FAILED',
        reason: `Extraction failed: could not locate provision '${record.paragraphOrSection}' in source '${record.standardOrActCode}'`
      };
    }

    if (record.extractionStatus === 'PARTIAL') {
      if (record.isVerbatimText) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Partial extraction cannot be declared as isVerbatimText = true'
        };
      }
      return {
        isValid: false,
        errorCode: 'PARTIAL_PROVISION',
        reason: `Partial extraction is not eligible for authoritative verification for '${record.id}'`
      };
    }

    const locator = record.sourceLocator;
    if (!locator) {
      return {
        isValid: false,
        errorCode: 'PROVISION_MAPPING_MISMATCH',
        reason: 'Missing source locator for source boundary verification'
      };
    }

    const startOffset = locator.boundary?.startOffset ?? locator.startOffset;
    const endOffset = locator.boundary?.endOffset ?? locator.endOffset;

    if (
      startOffset === undefined ||
      endOffset === undefined ||
      typeof startOffset !== 'number' ||
      typeof endOffset !== 'number' ||
      startOffset < 0 ||
      endOffset > rawDocument.length ||
      startOffset >= endOffset
    ) {
      return {
        isValid: false,
        errorCode: 'PROVISION_MAPPING_MISMATCH',
        reason: `Invalid provision boundaries: startOffset=${startOffset}, endOffset=${endOffset}, docLength=${rawDocument.length}`
      };
    }

    const rawSlice = rawDocument.slice(startOffset, endOffset);

    // If source format is JSON or authority is REFERENCE_API
    if (record.authority === 'REFERENCE_API' || locator.sourceType === 'JSON') {
      let parsedSlice: any;
      try {
        parsedSlice = JSON.parse(rawSlice);
        if (!parsedSlice || typeof parsedSlice !== 'object') {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: 'Source boundary does not contain a valid JSON object'
          };
        }
      } catch {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: 'Source boundary does not parse as valid JSON'
        };
      }

      // JSON payload must deterministically correspond to fxObservation
      if (record.fxObservation) {
        const obs = record.fxObservation;
        if (obs.date && parsedSlice.date !== obs.date) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `JSON boundary payload date mismatch: expected '${obs.date}', got '${parsedSlice.date}'`
          };
        }
        if (obs.base && parsedSlice.base !== obs.base) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `JSON boundary payload base mismatch: expected '${obs.base}', got '${parsedSlice.base}'`
          };
        }
        if (obs.rates && typeof obs.rates === 'object') {
          if (!parsedSlice.rates || typeof parsedSlice.rates !== 'object') {
            return {
              isValid: false,
              errorCode: 'PROVISION_MAPPING_MISMATCH',
              reason: 'JSON boundary payload is missing rates object required by fxObservation'
            };
          }
          for (const [sym, rate] of Object.entries(obs.rates)) {
            if (parsedSlice.rates[sym] !== rate) {
              return {
                isValid: false,
                errorCode: 'PROVISION_MAPPING_MISMATCH',
                reason: `JSON boundary payload rate mismatch for currency '${sym}': expected ${rate}, got ${parsedSlice.rates[sym]}`
              };
            }
          }
        }
      } else if (record.authority === 'REFERENCE_API') {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: 'Reference API record is missing fxObservation payload for boundary verification'
        };
      }

      return { isValid: true };
    }

    // For HTML/text records: cleanHtmlText of the raw slice must match record.sourceText
    const reconstructed = cleanHtmlText(rawSlice);
    if (reconstructed.trim() !== record.sourceText.trim()) {
      return {
        isValid: false,
        errorCode: 'PROVISION_MAPPING_MISMATCH',
        reason: `Source text mismatch: candidate sourceText does not match content reconstructed from raw document boundary offsets [${startOffset}, ${endOffset}]`
      };
    }

    return { isValid: true };
  }

  /**
   * Validates exact provision extraction, anti-truncation verbatim integrity,
   * and structural section/provision mapping with affirmative canonical Act and section identity.
   */
  public validateProvisionMapping(doc: AuthoritativeSourceRecord): ExternalValidationResult {
    // 1. Extraction Status Check
    if (doc.extractionStatus === 'FAILED') {
      return {
        isValid: false,
        errorCode: 'EXTRACTION_FAILED',
        reason: `Extraction failed: could not locate provision '${doc.paragraphOrSection}' in source '${doc.standardOrActCode}'`
      };
    }

    if (doc.extractionStatus === 'PARTIAL') {
      if (doc.isVerbatimText) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Partial extraction cannot be declared as isVerbatimText = true'
        };
      }
      return {
        isValid: false,
        errorCode: 'PARTIAL_PROVISION',
        reason: `Partial extraction is not eligible for authoritative verification for '${doc.id}'`
      };
    }

    // 2. Anti-truncation Verbatim Check
    if (doc.isVerbatimText) {
      if (!doc.sourceText || doc.sourceText.trim().length === 0) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Verbatim record has empty sourceText'
        };
      }

      // Check for truncation markers
      const truncationMarkers = ['...', '…', '[truncated]', '[abridged]', '[content truncated]', '[continued]'];
      for (const marker of truncationMarkers) {
        if (doc.sourceText.includes(marker)) {
          return {
            isValid: false,
            errorCode: 'INVALID_VERBATIM_CLAIM',
            reason: `Verbatim record contains truncation marker '${marker}'. Verbatim text must be complete and unabridged.`
          };
        }
      }

      // Assert source locator presence
      if (!doc.sourceLocator || (!doc.sourceLocator.heading && !doc.sourceLocator.elementId && !doc.sourceLocator.sourceNode)) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Verbatim record must have a populated sourceLocator with heading, elementId, or sourceNode'
        };
      }
    }

    // 3. Deterministic Source Mapping & Affirmative Identity Verification
    if (doc.sourceLocator) {
      // Affirmative Canonical Act Mapping
      if (doc.sourceLocator.act) {
        const docActCanonical = getCanonicalActCode(doc.standardOrActCode);
        const locActCanonical = getCanonicalActCode(doc.sourceLocator.act);
        if (docActCanonical && locActCanonical && docActCanonical !== locActCanonical) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Canonical Act mismatch: document '${doc.standardOrActCode}' (${docActCanonical}) contradicts locator act '${doc.sourceLocator.act}' (${locActCanonical})`
          };
        }
      }

      // Affirmative Section Check
      if (doc.sourceLocator.section) {
        const claimedSecNum = doc.paragraphOrSection.match(/(?:Section|Sec\.?|S\.?)\s*(\d+)/i)?.[1];
        const locSecNum = doc.sourceLocator.section.match(/\d+/)?.[0];
        if (claimedSecNum && locSecNum && claimedSecNum !== locSecNum) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator section '${doc.sourceLocator.section}'`
          };
        }

        // Check schedule / part identity if non-numeric
        const claimedSchedule = doc.paragraphOrSection.match(/((?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Part\s+[IVXLCDM]+)\s*(?:Schedule|Part)?)/i)?.[1];
        const locSchedule = doc.sourceLocator.section.match(/((?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Part\s+[IVXLCDM]+)\s*(?:Schedule|Part)?)/i)?.[1];
        if (claimedSchedule && locSchedule) {
          const normClaimed = claimedSchedule.toLowerCase().replace(/\s+/g, '');
          const normLocator = locSchedule.toLowerCase().replace(/\s+/g, '');
          if (normClaimed !== normLocator) {
            return {
              isValid: false,
              errorCode: 'PROVISION_MAPPING_MISMATCH',
              reason: `Provision mapping mismatch: claimed schedule/part '${doc.paragraphOrSection}' contradicts locator section '${doc.sourceLocator.section}'`
            };
          }
        }
      }

      // Affirmative Subsection Check
      if (doc.sourceLocator.subsection) {
        const claimedSub = doc.paragraphOrSection.match(/\((\d+[a-zA-Z]?)\)/)?.[1];
        const locSub = doc.sourceLocator.subsection.replace(/[()]/g, '').trim();
        if (claimedSub && locSub && claimedSub !== locSub) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Provision mapping mismatch: claimed subsection '(${claimedSub})' contradicts locator subsection '${doc.sourceLocator.subsection}'`
          };
        }
      }

      // Explicit contradiction in heading check
      const sectionNormalized = doc.paragraphOrSection.toLowerCase().replace(/[\s\-_(),.]/g, '');
      const headingNormalized = (doc.sourceLocator.heading || '').toLowerCase().replace(/[\s\-_(),.]/g, '');

      if (headingNormalized && headingNormalized.includes('section') && sectionNormalized.includes('section')) {
        const claimedNum = sectionNormalized.match(/\d+/)?.[0];
        const headingNum = headingNormalized.match(/\d+/)?.[0];
        if (claimedNum && headingNum && claimedNum !== headingNum) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator heading '${doc.sourceLocator.heading}'`
          };
        }

        const claimedSub = doc.paragraphOrSection.match(/\((\d+)\)/)?.[1];
        const headingSub = (doc.sourceLocator.heading || '').match(/\((\d+)\)/)?.[1];
        if (claimedSub && headingSub && claimedSub !== headingSub) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator heading '${doc.sourceLocator.heading}'`
          };
        }
      }

      // Check boundary offsets if provided
      if (doc.sourceLocator.boundary) {
        if (doc.sourceLocator.boundary.endOffset <= doc.sourceLocator.boundary.startOffset || doc.sourceLocator.boundary.startOffset < 0) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: 'Invalid provision boundaries: boundary offsets are invalid (endOffset must be strictly greater than startOffset)'
          };
        }
      }

      if (doc.sourceLocator.startOffset !== undefined && doc.sourceLocator.endOffset !== undefined) {
        if (doc.sourceLocator.endOffset <= doc.sourceLocator.startOffset || doc.sourceLocator.startOffset < 0) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: 'Invalid provision boundaries: boundary offsets are invalid (endOffset must be strictly greater than startOffset)'
          };
        }
      }
    }

    // 4. Guidance vs Primary Source Enforcement
    const isGuidanceAuthority = ['IRAS', 'ACRA', 'MOM', 'CPF'].includes(doc.authority);
    const isAgcSource = doc.officialSourceUrl && doc.officialSourceUrl.includes('sso.agc.gov.sg');

    if (isGuidanceAuthority && !isAgcSource) {
      if (doc.evidenceTier === 'PRIMARY_SOURCE' || doc.sourceType === 'AUTHORITATIVE_SOURCE') {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `Administrative guidance portal from '${doc.authority}' cannot claim PRIMARY_SOURCE or AUTHORITATIVE_SOURCE statutory status; must be modeled as OFFICIAL_GUIDANCE`
        };
      }

      // Verify structural node identifies guidance topic
      const nodeIdentifier = `${doc.sourceLocator?.sourceNode || ''} ${doc.sourceLocator?.elementId || ''}`.toLowerCase();
      if (doc.authority === 'IRAS' && !nodeIdentifier.includes('cit-rate') && !nodeIdentifier.includes('cit-rebate')) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `IRAS guidance structural node must identify tax rate/rebate topic (e.g. cit-rate), found '${nodeIdentifier}'`
        };
      }
      if (doc.authority === 'ACRA' && !nodeIdentifier.includes('small-company')) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `ACRA guidance structural node must identify small-company topic, found '${nodeIdentifier}'`
        };
      }
      if (doc.authority === 'MOM' && !nodeIdentifier.includes('itemised-payslips') && !nodeIdentifier.includes('payslip')) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `MOM guidance structural node must identify itemised-payslip topic, found '${nodeIdentifier}'`
        };
      }
      if (doc.authority === 'CPF' && !nodeIdentifier.includes('ow-ceiling')) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `CPF guidance structural node must identify ow-ceiling topic, found '${nodeIdentifier}'`
        };
      }
    }

    // 5. Reference API & FX Observation Validation
    if (doc.authority === 'REFERENCE_API' || doc.standardOrActCode === 'FX_OBSERVATION') {
      if (doc.isVerbatimText) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Reference API observations cannot claim isVerbatimText = true because summary text is generated/curated'
        };
      }

      if (!doc.fxObservation || !doc.fxObservation.rates || !doc.fxObservation.base || !doc.fxObservation.date) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: 'Reference API observation is missing structured fxObservation payload'
        };
      }
    }

    return { isValid: true };
  }
}

/**
 * Singleton instance of ExternalSourceValidator.
 */
export const defaultExternalSourceValidator = new ExternalSourceValidator();
