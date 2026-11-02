import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  resolve:{alias:{obsidian:fileURLToPath(new URL('./tests/obsidian-stub.ts',import.meta.url))}},
  // The stub is also a setup file so its DOM helpers never depend on which module imports `obsidian` at runtime.
  test:{include:['tests/**/*.test.ts'],setupFiles:['./tests/obsidian-stub.ts'],clearMocks:true},
});
