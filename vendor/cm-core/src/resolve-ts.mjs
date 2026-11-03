// Lets Node run the sources of this package directly: the apps' build tools (Angular's webpack, Vite, esbuild) resolve
// `import './x'` to `x.ts` by themselves, but Node does not. This hook adds the file ending (`./x` -> `./x.ts`,
// `./dir` -> `./dir/index.ts`) for relative imports. It is used by the tests only (`npm test`); nothing else loads it.
import { register } from 'node:module';

register(new URL('./resolve-ts-hook.mjs', import.meta.url));
