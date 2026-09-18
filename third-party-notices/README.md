# Vendored third-party notices

Some published packages omit their license file from the npm tarball even though
their repository carries one. `scripts/generate-third-party-licenses.mjs`
requires a notice per dependency, so the missing text is kept here, copied
verbatim from the upstream repository, and used only when the installed package
ships none.

| Package        | Upstream licence                                                                        | Why it is here                                           |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `remark-math`  | [remarkjs/remark-math](https://github.com/remarkjs/remark-math/blob/main/license) (MIT) | the tarball ships `readme.md` and `package.json` only    |
| `rehype-katex` | same repository, same licence                                                           | published from the same monorepo, tarball omits the file |

Adding a file here is not a way around the check: it must be the real upstream
text for that exact package, and the generated notices say the text came from
the repository rather than the package.
