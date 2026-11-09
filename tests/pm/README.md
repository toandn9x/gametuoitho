# Independent PM acceptance checks

From the repository root, run:

```powershell
pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/asset-review.ts
```

`asset-review.ts` checks the R01-A/B contract in `docs/review-round-01.md` through
the existing Hono application's request interface. Each check has a fresh SQLite
database in memory, synthetic byte fixtures, and a storage read spy. It reads the
initial migration SQL only. It does not start a server, contact a network, write
uploads, execute JARs, or use real users/credentials. Test tokens are synthetic.

A nonzero exit means at least one acceptance check failed. Existing application
test scripts are separate: this file does not modify or replace them. Keep these
expectations unchanged while reviewing application fixes.

Coverage includes private access by owner/other/anonymous/admin, current database
role/status rather than stale JWT claims, metadata and asset state, legitimate
Catalog references, public versions/detail eligibility, GET/HEAD/single ranges,
cache behavior, deny-before-storage reads, and revocation after hide/quarantine.
Unsupported/malformed ranges may consistently return a full 200, a 400/416, or a
proper multipart response; invalid numeric Content-Range values are rejected.

Limits: this suite does not establish real filesystem containment or symlink
safety, Cloudflare/CDN behavior, static server routing, browser execution, full
session/logout revocation, upload validation, emulator compatibility, or safe
DOM rendering. These need separate checks. It intentionally does not import the
unified server because that module performs startup side effects.
