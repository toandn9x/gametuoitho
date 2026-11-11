# FreeJ2ME compatibility patches

`List.java` is the upstream FreeJ2ME class with its GPL header retained. The source
URL, retrieval date and exact hashes are recorded in `provenance.json`. The source
was compared with the bundled class using `javap`; the only behavior change is a
null check before drawing an optional list icon. MIDP games may supply an image
array with null entries. The old renderer dereferenced those entries, causing a
`NullPointerException` in Thạch Sanh's startup menu.

`LocalDevice.java` adds the Bluetooth lookup missing from the bundled emulator.
Ninja School 1 calls it after several launches with saved RMS data. Previously
this threw `NoClassDefFoundError`, which its `catch (Exception)` cannot handle.
The identity-only adapter now exposes a virtual address stored once per browser
installation in `pl.zb3.freej2me.bluetoothAddress`. The bootstrap passes it through
[CheerpJ javaProperties](https://cheerpj.com/docs/reference/cheerpjInit#javaproperties).
It stays stable across launches so games can retain their device-bound settings.
If persistence fails, the adapter reports `BluetoothStateException` instead of
issuing a changing temporary identity. This patch does not access host Bluetooth,
provide Bluetooth networking, modify game JARs or delete RMS data.

This is a patch of the existing emulator, not a replacement emulator. Game files
under `uploads/` are never modified or executed by this build.

From the repository root, with a JDK supporting `--release 8` and `jar --date`:

```powershell
powershell.exe -NoProfile -File apps/emulator-web/patches/rebuild.ps1
```

Tested with JDK 19.0.2. The script checks the input emulator hash, disables compiler
annotation processors, compiles only these trusted emulator sources, and creates
`build/freej2me-web.jar`. The input pins cover the original, menu-only patch and
current patch. Compared with the menu-patched JAR, the Bluetooth patch adds only
`javax/bluetooth/LocalDevice.class`; existing entries remain byte-for-byte identical.

After checking the output hash against `provenance.json`, distribute it to both
`apps/emulator-web/freej2me-web.jar` and
`apps/web/public/emulator/freej2me-web.jar`, then build the web application.
An upstream emulator update requires reviewing this patch and updating the pins.

Regression check: `node tests/pm/ninja-relaunch-review.cjs` launches the public
Ninja School 1 six times in an isolated Chrome profile with the local emulator
JAR/bootstrap substituted. All writes to the deployed API are intercepted locally.
Set `PLAYWRIGHT_MODULE_PATH` and `CHROME_PATH` for an existing Playwright/Chrome
installation. This check needs network access to the public game and CheerpJ CDN.
