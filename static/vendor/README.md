# Vendored files

Served from this site only (no CDN), so the strict Content-Security-Policy stays `'self'`. Not in the offline precache: the service worker caches them at run time, the first time someone reads a screenshot. Files are copied unchanged; their `sourceMappingURL` comments point at maps that are not shipped.

| Files | Package | Version | Source | Licence |
| --- | --- | --- | --- | --- |
| `tesseract/tesseract.esm.min.js`, `tesseract/worker.min.js` | tesseract.js | 7.0.0 | npm `tesseract.js@7.0.0`, `dist/` | Apache-2.0 (`LICENSE-tesseract.js.md`, bundled third-party notices in `*.LICENSE.txt`) |
| `tesseract/core/tesseract-core-{lstm,simd-lstm,relaxedsimd-lstm}.wasm.js` | tesseract.js-core | 7.0.0 | npm `tesseract.js-core@7.0.0` | Apache-2.0 (`core/LICENSE-tesseract.js-core`) |
| `tessdata/{eng,hin,mar}.traineddata.gz` | tessdata_fast | main branch, fetched 5 Nov 2026 | raw.githubusercontent.com/tesseract-ocr/tessdata_fast, gzipped here with `gzip -9` | Apache-2.0 (`tessdata/LICENSE-tessdata_fast`) |

Only the LSTM builds of the core are shipped, because the app always uses the LSTM engine (`oem` 1); the worker picks one of the three by the phone's WebAssembly support.

## SHA-256

```
6e91abe55332b7b9a4aeafec76c080076196d3d2bae51a150a72b84f0a6eeb2c  ./README.md.tmp
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  ./tessdata/LICENSE-tessdata_fast
196c9965e191985e78b571b3ae0d6f695282177721fe5855a3b44d1477b96602  ./tessdata/eng.traineddata.gz
8f0a7bdb2fe66639e4d98ad4700cef8169ade6bcd07b8cd1bed1007f5ec62e99  ./tessdata/hin.traineddata.gz
aa1104871b8ec366d7d284cc50f1ba5f261ede75ef0e3bf405a852dca83b00ca  ./tessdata/mar.traineddata.gz
b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1  ./tesseract/LICENSE-tesseract.js.md
c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08  ./tesseract/core/LICENSE-tesseract.js-core
eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680  ./tesseract/core/tesseract-core-lstm.wasm.js
861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3  ./tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js
c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38  ./tesseract/core/tesseract-core-simd-lstm.wasm.js
64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29  ./tesseract/tesseract.esm.min.js
cdf963ced7d25a0f98901a547647b4d6e2dbe0197fd78c87a059a87b0e542fe2  ./tesseract/tesseract.min.js.LICENSE.txt
576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d  ./tesseract/worker.min.js
45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac  ./tesseract/worker.min.js.LICENSE.txt
```
