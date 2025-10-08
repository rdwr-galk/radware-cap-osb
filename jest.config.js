module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupNock.js', 'jest-extended/all'],
  testTimeout: 30000,
  collectCoverageFrom: [
    'src/**/*.js',
    'server.js',
    '!src/**/index.js'
  ],
  coverageThreshold: {
    global: { branches: 60, functions: 70, lines: 75, statements: 75 }
  }
};
