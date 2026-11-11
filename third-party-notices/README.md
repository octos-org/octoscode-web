# Vendored third-party notices

Some published packages omit their license file from the npm tarball even though
their repository carries one. `scripts/generate-third-party-licenses.mjs`
requires a notice per dependency, so the missing text is kept here, copied
verbatim from the upstream repository, and used only when the installed package
ships none.

| Package                                                     | Upstream licence                                                                          | Why it is here                                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remark-math`                                               | [remarkjs/remark-math](https://github.com/remarkjs/remark-math/blob/main/license) (MIT)   | the tarball ships `readme.md` and `package.json` only                                                                                                                               |
| `rehype-katex`                                              | same repository, same licence                                                             | published from the same monorepo, tarball omits the file                                                                                                                            |
| `@napi-rs/canvas-linux-x64-gnu`                             | [Brooooooklyn/canvas](https://github.com/Brooooooklyn/canvas/blob/main/LICENSE) (MIT)     | the platform binary tarball ships no license file                                                                                                                                   |
| `isarray`                                                   | [juliangruber/isarray](https://github.com/juliangruber/isarray/blob/master/LICENSE) (MIT) | the 1.0.0 tarball ships no license file                                                                                                                                             |
| `@tesseract.js-data/eng` (`eng.LICENSE`)                    | [naptha/tessdata](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE) (Apache-2.0)  | the tarball ships no license file; its `package.json` says MIT, the repository and the tesseract-ocr/tessdata models it repackages are Apache-2.0, so the repository's text is kept |
| `@tesseract.js-data/chi_sim` (`chi_sim.LICENSE`)            | same repository, same licence                                                             | same tarball layout                                                                                                                                                                 |
| `tr46` (0.0.3, via node-fetch in tesseract.js's Node build) | [jsdom/tr46](https://github.com/jsdom/tr46/blob/3a6f2972/LICENSE.md) (MIT)                | the 0.0.3 tarball and tag carry no license file; this is the MIT text the author added to the repository in 2016                                                                    |

Adding a file here is not a way around the check: it must be the real upstream
text for that exact package, and the generated notices say the text came from
the repository rather than the package.
