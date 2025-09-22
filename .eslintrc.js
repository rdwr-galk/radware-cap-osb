module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script' // CommonJS (require/module.exports)
  },
  rules: {
    // formatting
    indent: ['error', 2, { SwitchCase: 1 }],
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
    'object-curly-spacing': ['error', 'always'],

    // hygiene
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    eqeqeq: ['error', 'smart'],
    curly: ['error', 'multi-line'],
    'no-var': 'error',
    'prefer-const': ['error', { destructuring: 'all' }],
    'no-return-await': 'error',
    'prefer-object-spread': 'error',
    'no-prototype-builtins': 'error',
    'no-undef-init': 'error',
    'no-useless-escape': 'error',
    'no-unsafe-finally': 'error',
    'no-shadow': ['error', { builtinGlobals: false, hoist: 'functions' }]
  },
  overrides: [
    {
      // Allow console in scripts and config files
      files: ['*.config.js', 'scripts/**/*.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // Loosen some rules for test files (if you add tests later)
      files: ['**/*.test.js', '**/__tests__/**/*.js'],
      env: { jest: true, node: true },
      rules: {
        'no-unused-expressions': 'off'
      }
    }
  ]
};
