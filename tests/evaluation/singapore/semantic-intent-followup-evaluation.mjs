import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSemanticContractFollowupEvaluation } from './semantic-contract-followup-evaluation.mjs';

const SUPPORTED_PROFILES = new Set([
  'intent-targeted', 'intent-final', 'authority-relief-targeted-live', 'authority-relief-final-live',
  'semantic-wire-format-targeted-live', 'semantic-wire-format-final-live'
]);
const SAFE_ERRORS = new Set([
  'A semantic contract follow-up output file already exists.',
  'A required fixed evaluation case is missing.',
  'GEMINI_API_KEY is not configured.',
  'Source or fixture hash changed during live capture.',
  'A fixed evaluation case did not make exactly one provider request.',
  'The authority-relief targeted profile has not passed; final live capture is gated.',
  'A protected semantic evaluation artifact has changed.',
  'The semantic wire-format targeted profile has not passed; final live capture is gated.'
]);

export function parseSemanticIntentProfileArgs(args) {
  if (!Array.isArray(args) || args.length !== 3 || args[0] !== '--profile' ||
      !SUPPORTED_PROFILES.has(args[1]) || args[2] !== '--live') {
    throw new Error('Usage: --profile intent-targeted|intent-final|authority-relief-targeted-live|authority-relief-final-live|semantic-wire-format-targeted-live|semantic-wire-format-final-live --live');
  }
  return args[1];
}

async function main() {
  let evaluationProfile;
  try {
    evaluationProfile = parseSemanticIntentProfileArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runSemanticContractFollowupEvaluation({ live: true, evaluationProfile });
    process.stdout.write(`${JSON.stringify({
      evaluationProfile,
      outputPrefix: result.outputPrefix,
      requestCount: result.requestCount,
      summaries: result.summaries,
      ...(result.authorityReliefAcceptance ? { authorityReliefAcceptance: result.authorityReliefAcceptance } : {})
    }, null, 2)}\n`);
  } catch (error) {
    const message = SAFE_ERRORS.has(error?.message) ? error.message : 'Semantic intent follow-up runner failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
