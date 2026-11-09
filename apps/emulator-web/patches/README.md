# FreeJ2ME menu icon patch

`List.java` is the upstream FreeJ2ME class with its GPL header retained. The source
URL, retrieval date and exact hashes are recorded in `provenance.json`. The source
was compared with the bundled class using `javap`; the only behavior change is a
null check before drawing an optional list icon. MIDP games may supply an image
array with null entries. The old renderer dereferenced those entries, causing a
`NullPointerException` in Thạch Sanh's startup menu.

This is a patch of the existing emulator, not a replacement emulator. Game files
under `uploads/` are never modified or executed by this build.

From the repository root, with a JDK supporting `--release 8` and `jar --date`:

```powershell
powershell.exe -NoProfile -File apps/emulator-web/patches/rebuild.ps1
```

Tested with JDK 19.0.2. The script checks the input emulator hash, disables compiler
annotation processors, compiles only this trusted emulator source, and creates
`build/freej2me-web.jar`. Rebuilding from either the pinned original or patched
JAR produced the same output hash. Archive comparison confirmed that only
`javax/microedition/lcdui/List.class` changed; no entries were added or removed.

After checking the output hash against `provenance.json`, distribute it to both
`apps/emulator-web/freej2me-web.jar` and
`apps/web/public/emulator/freej2me-web.jar`, then build the web application.
An upstream emulator update requires reviewing this patch and updating the pins.
