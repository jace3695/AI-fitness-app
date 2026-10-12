# Development dependency security checkpoint

The 2026-10-09 audit of the previous lock found 18 affected package records
(2 critical, 13 high, 3 moderate). These dependencies predated this handoff.
Audit records can share an underlying advisory and do not establish exploitation.

This development candidate pins Next.js and its ESLint config to 16.3.8 and the
MCP SDK to 1.31.0. Compatible transitive updates include Sharp 0.35.5,
proxy-addr 2.0.8, fast-uri 3.1.8, source-map-js 1.2.2 and patched brace-expansion
versions within their existing major lines. No dependency paths were added or
removed and no major versions, forced overrides or lifecycle scripts were used.

Official references:
- https://github.com/vercel/next.js/releases/tag/v16.3.8
- https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h
- https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h
- https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w

The frozen lock-only candidate audit found zero production dependency records
and nine development-only records (7 high, 2 moderate). Seven inherit the
unpatched braces issue; two concern selector-parser and its postcss-nested
parent. These are disclosed exceptions, not suppressed findings:
- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf

The remaining paths process checked-in build configuration/CSS here. Continue
isolating builds from production secrets and review untrusted contributions.
Do not migrate Tailwind to v4, downgrade Next ESLint to v14 or force a parser
major solely to make the audit count zero. Revisit compatible upstream fixes.

Installation with `npm ci --ignore-scripts` succeeded. Final application,
browser and deployment results belong to their exact candidate commit and
must be reported separately. A clean production dependency audit is not proof
of application security or production safety. No operating deployment,
credential, security setting or hosted database was changed by this patch.
