# Third-party notices

Full notices for bundled Source Serif 4, DM Sans, Roboto Flex, Noto Sans JP, Noto Sans Arabic, the MIT-licensed `linebreak` dependency, and the adapted Pretext technique are included in [`public/THIRD_PARTY_LICENSES.txt`](public/THIRD_PARTY_LICENSES.txt), which Vite copies into the production build. Font packages retain their SIL Open Font License notices. The paragraph optimizer and diagnostic rendering are our own implementation.

## Pretext measurement technique

`src/text-metrics.ts` adapts the tiny nonzero Canvas letter-spacing technique from `src/measurement.ts` in [chenglou/pretext](https://github.com/chenglou/pretext), inspected at commit `0d102a5`. Its preparation/cache separation and grapheme-aware measurement also informed this prototype. No engine tables, browser profiles, or complete line-breaking implementation were copied.

MIT License

Copyright (c) 2026 Pretext contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
