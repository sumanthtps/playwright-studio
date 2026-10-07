# Marketplace improvement plan

## Baseline and positioning

The maintainer reports **20–30 downloads per week** as of September 12, 2026. Page views, conversion, retention and complaint counts are not available, so there is no evidence yet that search ranking is the primary bottleneck.

Position Studio around reusable run presets, failure artifacts, local history and snippets. The public listing currently describes older reporter setup and includes unsupported competitor comparisons; the prepared README explains the actual local behavior and removes those comparisons. Keep the existing extension ID so current users can update.

Prepared listing title: **Playwright Studio: Test Runner & Snippets**. Keywords describe supported workflows rather than repeat unrelated popular search terms. The README starts with four concrete jobs, a demo, installation, and the first test run. The full feature catalog and snippet reference remain available in expandable sections.

## Four-week evaluation

| Week | Action | Measure |
| --- | --- | --- |
| Before release | Record publisher-page views, installs, rating count and the top reported setup failures. Save the current listing for comparison. | Use the existing 20–30 weekly downloads as the install baseline. |
| 1 | Publish the validated update and verify its Marketplace title, screenshots, links, and installation in a clean VS Code profile. | First-run success on a standard project; views and installs after a full week. |
| 2 | Prepare one short demonstration of a saved preset and one of reviewing a failure. Share them in relevant communities where promotion is welcome. | Referral traffic where available; substantive questions and setup failures. |
| 3 | Fix the most common reported blocker before adding features. Invite users to describe their workflow through the issue templates. | Repeated reports, time to resolve, and verified fixes. |
| 4 | Compare full-week totals with baseline and inspect view-to-install conversion if publisher statistics provide both. | Installs, conversion, reviews, and reasons people stop using the extension. |

Do not infer retention from download counts, promise a search position, invent usage numbers, or buy installs/reviews. Request honest reviews in documentation without interrupting test runs. No tracking is added by this change.

Publication and public outreach have not been performed. Distribution experiments should start only after the package passes validation. Upload any demo assets referenced by the README with the corresponding source release.

## References

- [Current Marketplace listing](https://marketplace.visualstudio.com/items?itemName=sumanthtps.playwright-test-code-snippets)
- [VS Code publishing and Marketplace integration](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#marketplace-integration)
