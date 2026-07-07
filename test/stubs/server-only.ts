// Empty stand-in for the `server-only` package under test. The real package
// throws when imported outside an RSC build; aliased here (see vitest.config.ts)
// so server modules can be exercised in Node unit tests.
export {};
