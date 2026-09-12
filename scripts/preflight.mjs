import os from 'node:os';

const supportedMajor = 22;
const currentMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const failures = [];

if (currentMajor !== supportedMajor) {
  failures.push(
    `Unsupported Node.js ${process.version}. This project requires Node.js ${supportedMajor}.x; see .nvmrc.`
  );
}

try {
  os.userInfo();
} catch (error) {
  failures.push(
    `The operating-system user profile is unavailable to Node (${error.code || error.name}). ` +
    'tsx cannot initialise its temporary directory until this is resolved.'
  );
}

if (failures.length > 0) {
  console.error('\nTEST INFRASTRUCTURE PRECHECK FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('\nInstall/use Node.js 22.x, then rerun npm test. No product test results were produced.\n');
  process.exit(2);
}

console.log(`Test environment ready: Node.js ${process.version} on ${process.platform}.`);
