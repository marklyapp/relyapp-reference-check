/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testTimeout: 60000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          strict: false,
        },
      },
    ],
  },
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
};
