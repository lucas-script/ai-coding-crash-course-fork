Most modules in `app/services` and `app/lib` open with a `// ─── Name ───` header recording the module's job and the reasoning behind its non-obvious decisions — read it before changing the module.

Typecheck with `npm run typecheck`; it generates the `./+types/*` modules that `tsc` needs.

Setup, scripts, and lesson navigation: `README.md`.
