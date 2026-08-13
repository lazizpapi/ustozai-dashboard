/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * The real package throws on import outside a React Server Component graph,
 * which is exactly what we want in the app and exactly what breaks a plain Node
 * test. Aliasing it here keeps the production guard intact while letting the
 * server modules be unit tested directly. See vitest.config.ts.
 */
export {};
