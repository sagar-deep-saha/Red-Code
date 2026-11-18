Download `RedCode-Setup.exe` for Windows x64, or `RedCode-Setup-arm64.exe` for Windows on ARM.

### Fixed

- **The Red Code API panel works again.** The request panel was inert: the HTTP method list was
  empty, Base URL and request name never filled in, the Params and Headers tables stayed empty and
  the tab counters showed no numbers.
- The panel script is generated inside a template literal, and the regex `\/+$` in
  `retargetRequest` lost its backslash there. The emitted code contained `replace(//+$/, '')`,
  which starts a line comment, so the rest of that function was invalid JavaScript and the entire
  inline script failed to parse (`Unexpected token 'const'`) before it could add any `<option>`.
- The regex now uses a character class (`/[/]+$/`) and a new test renders the panel and parses the
  emitted script, so a broken escape fails the suite instead of shipping.

### Platforms

- Red Code ships **Windows x64 and Windows arm64** only, both with the Electron 43.8.9 native
  modules from 1.147.7.
