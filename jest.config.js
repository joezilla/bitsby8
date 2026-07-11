module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  verbose: true,
  // All suites pass, but a pre-existing test leaves an open handle (a lingering
  // timer/socket in one of the hardware-mock suites) that keeps the Jest
  // process alive after completion — hanging CI, which runs `jest --runInBand`
  // with no TTY. Force a clean exit once every test has finished. (Run
  // `jest --detectOpenHandles` to hunt the leak if you want to remove this.)
  forceExit: true,
};
