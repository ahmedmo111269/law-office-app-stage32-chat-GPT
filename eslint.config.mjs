import globals from './qa/node_modules/globals/index.js';

export default [{
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  files: ['**/*.js'],
  languageOptions: {
    ecmaVersion: 'latest', sourceType: 'module',
    globals: { ...globals.browser, ...globals.serviceworker, ...globals.es2021, ...globals.worker, URLPattern: 'readonly' }
  },
  rules: { 'no-undef': 'error' }
}];
