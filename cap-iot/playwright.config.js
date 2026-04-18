// playwright.config.js
// Configuration for E2E tests against the hybrid CAP server (http://localhost:4004)
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './test/e2e',
    timeout: 90000,        // long timeout: EWM sandbox + Google Maps API can be slow
    retries: 1,
    reporter: [['list'], ['html', { outputFolder: 'test/e2e/report', open: 'never' }]],

    use: {
        baseURL: 'http://127.0.0.1:4004',
        // macOS Chromium sandbox blocks loopback (localhost) connections — disable sandbox
        launchOptions: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-features=NetworkServiceSandbox',
                '--allow-insecure-localhost',
                '--host-resolver-rules=MAP localhost 127.0.0.1'
            ]
        },
        // Record traces on first retry to help diagnose failures
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        // Give ample time for API calls
        actionTimeout: 30000,
        navigationTimeout: 30000,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        }
    ],

    // Do NOT start the server — assumes `cds watch --profile hybrid` is already running
    // webServer: undefined
});
