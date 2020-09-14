import { builtinModules } from 'module';

import json from '@rollup/plugin-json';

import pkg from './package.json';

const externals = new Set([...Object.keys(pkg.dependencies), ...builtinModules]);

export default {
  external: (id) => externals.has(id) || id.startsWith('rollup/'),
  input: ['./src/index', './src/cli'],
  plugins: [json()],
  output: {
    dir: 'dist',
    format: 'cjs',
  },
};
