import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';

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
  'www.cpf.gov.sg'
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
  | 'PROVENANCE_MISMATCH';

export interface ExternalValidationResult {
  isValid: boolean;
  errorCode?: ExternalValidationErrorCode;
  reason?: string;
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
      if (!host.endsWith('iras.gov.sg') && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `IRAS guidance must point to iras.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'ACRA') {
      if (!host.endsWith('acra.gov.sg') && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `ACRA directives must point to acra.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'REFERENCE_API') {
      if (host !== 'api.frankfurter.dev') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `Reference API must point to api.frankfurter.dev, found '${host}'` };
      }
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
}

/**
 * Singleton instance of ExternalSourceValidator.
 */
export const defaultExternalSourceValidator = new ExternalSourceValidator();
