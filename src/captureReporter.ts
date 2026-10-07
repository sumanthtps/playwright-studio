import * as path from 'path';
import { createRequire } from 'module';
import { revisionEvidence } from './intelligence/model';

// PW_TEST_REPORTER accepts a module path on older Playwright versions, not a
// built-in reporter name. Resolve the JSON reporter from the project's own
// Playwright installation so its output matches that installed version.
const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
let packageFile: string;
try {
  packageFile = projectRequire.resolve('playwright/package.json');
} catch {
  const testRequire = createRequire(projectRequire.resolve('@playwright/test'));
  packageFile = testRequire.resolve('playwright/package.json');
}
const JSONReporter = projectRequire(
  path.join(path.dirname(packageFile), 'lib', 'reporters', 'json.js'),
).default;

export default class StudioReporter extends JSONReporter {
  onConfigure(config: { metadata: Record<string, unknown> }): void {
    config.metadata = { ...config.metadata, playwrightStudio: revisionEvidence(process.cwd()) };
    super.onConfigure(config);
  }
  onBegin(...args: unknown[]): void {
    // Older reporter implementations receive (config, suite) here.
    if (args.length > 1) {
      const config = args[0] as { metadata: Record<string, unknown> };
      config.metadata = { ...config.metadata, playwrightStudio: revisionEvidence(process.cwd()) };
    }
    super.onBegin(...args);
  }
}
