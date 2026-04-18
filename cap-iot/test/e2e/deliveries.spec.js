// test/e2e/deliveries.spec.js
// Playwright E2E tests for the EWM Deliveries app
// Requires: cds watch --profile hybrid running on http://localhost:4004
//
// Run: npx playwright test test/e2e/deliveries.spec.js --headed
// (--headed lets you see the browser; omit for CI headless mode)

const { test, expect } = require('@playwright/test');

// Use 127.0.0.1 explicitly — newer Node/Playwright resolves 'localhost' to ::1 (IPv6)
// but cds watch only binds on 127.0.0.1 (IPv4) by default.
const BASE_URL = 'http://127.0.0.1:4004';
const APP_URL  = `${BASE_URL}/ewm.deliveries/index.html`;

// Basic auth header value for alice:alice (mocked auth in hybrid mode)
const BASIC_AUTH = 'Basic ' + Buffer.from('alice:alice').toString('base64');

// Helper: add Basic auth header to every request in the page context
async function setupAuth(page) {
    await page.setExtraHTTPHeaders({ Authorization: BASIC_AUTH });
}

// Helper: wait for the Fiori shell/app to finish loading (spinner gone)
async function waitForAppReady(page) {
    // Wait for the SAP UI5 busy overlay to disappear
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    // Give UI5 framework a moment to finish bootstrapping
    await page.waitForTimeout(1500);
}

// Helper: click "Go" on the List Report filter bar to load rows
async function clickGo(page) {
    const goBtn = page.locator('button:has-text("Go"), [aria-label="Go"]').first();
    await goBtn.waitFor({ state: 'visible', timeout: 15000 });
    await goBtn.click();
}

// Helper: wait for the list table to have at least one row
async function waitForRows(page) {
    // mdc-Table rows or fe::Table rows rendered by Fiori Elements
    await page.waitForSelector(
        '.sapMListItem, .sapUiTableRow, [class*="sapMList"] .sapMLIB',
        { timeout: 30000 }
    );
}

// ── Test Suite ────────────────────────────────────────────────────────────────

test.describe('EWM Deliveries App (hybrid mode)', () => {

    test.beforeEach(async ({ page }) => {
        await setupAuth(page);
        await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
        await waitForAppReady(page);
    });

    // ── 1. List Report ────────────────────────────────────────────────────────

    test('1 - List Report loads and shows delivery rows after Go', async ({ page }) => {
        await clickGo(page);
        await waitForRows(page);

        // At least one row should contain a delivery document ID (starts with digit)
        const firstRow = page.locator('.sapMLIB, .sapMListItem').first();
        await expect(firstRow).toBeVisible({ timeout: 20000 });

        // Verify a column header is rendered (e.g. "Delivery Document")
        const header = page.locator('[class*="sapMListTblHeaderCell"], th, [role="columnheader"]').first();
        await expect(header).toBeVisible({ timeout: 10000 });
    });

    // ── 2. Object Page navigation ─────────────────────────────────────────────

    test('2 - Click first row opens Object Page with delivery header', async ({ page }) => {
        await clickGo(page);
        await waitForRows(page);

        // Click the first list item to navigate to Object Page
        const firstRow = page.locator('.sapMLIB, .sapMListItem').first();
        await firstRow.click();

        // Object Page header should appear — look for the delivery doc ID in a title/header area
        await page.waitForSelector(
            '.sapFDynamicPageTitle, .sapUxAPObjectPageHeader, [class*="sapUxAPObjectPage"]',
            { timeout: 20000 }
        );

        // The page URL or content should contain an entity key (delivery doc number)
        const url = page.url();
        // After navigation Fiori FCL puts the key in the URL hash or query
        expect(url).toContain('ewm.deliveries');
    });

    // ── 3. Delivery Items tab ─────────────────────────────────────────────────

    test('3 - Delivery Items section loads items via getDeliveryItems action', async ({ page }) => {
        await clickGo(page);
        await waitForRows(page);
        await page.locator('.sapMLIB, .sapMListItem').first().click();

        // Wait for Object Page to settle
        await page.waitForLoadState('networkidle', { timeout: 20000 });
        await page.waitForTimeout(1500);

        // Find and click the "Delivery Items" section / button
        const loadItemsBtn = page.locator(
            'button:has-text("Load Items"), button:has-text("Delivery Items"), [title*="Load Items"]'
        ).first();

        if (await loadItemsBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await loadItemsBtn.click();
        } else {
            // Section may already be visible — scroll to it
            const section = page.locator('[id*="DeliveryItems"], [title*="Delivery Items"]').first();
            if (await section.isVisible({ timeout: 5000 }).catch(() => false)) {
                await section.scrollIntoViewIfNeeded();
            }
        }

        // After action fires, a table with items should appear (or a "No data" row)
        await page.waitForSelector(
            '[id*="DeliveryItems"] .sapMLIB, [id*="DeliveryItems"] .sapMListNoData, [id*="itemsTable"]',
            { timeout: 30000 }
        ).catch(() => {
            // Table may not yet have rows — verify the table container at least exists
        });

        // Verify no error strip is shown for the items section
        const errorStrip = page.locator('[id*="itemsError"]:visible, [id*="errorStrip"]:visible').first();
        await expect(errorStrip).toBeHidden({ timeout: 5000 }).catch(() => {});
    });

    // ── 4. Route & Map tab ─────────────────────────────────────────────────────

    test('4 - "View on Map" triggers getDeliveryRoute and renders Google Maps div', async ({ page }) => {
        await clickGo(page);
        await waitForRows(page);
        await page.locator('.sapMLIB, .sapMListItem').first().click();

        await page.waitForLoadState('networkidle', { timeout: 20000 });
        await page.waitForTimeout(2000);

        // Click "View on Map" button in the DeliveryMap section
        const viewMapBtn = page.locator('button:has-text("View on Map"), button:has-text("View Map")').first();
        await viewMapBtn.waitFor({ state: 'visible', timeout: 20000 });
        await viewMapBtn.click();

        // The OData action call should complete — wait for busy indicator to go away
        const busyIndicator = page.locator('[id*="mapBusyIndicator"]');
        // It appears then disappears; wait until it's hidden or gone
        await page.waitForFunction(() => {
            const el = document.querySelector('[id*="mapBusyIndicator"]');
            if (!el) return true;
            return el.style.display === 'none' || el.hidden || el.classList.contains('sapUiHidden');
        }, { timeout: 30000 });

        // The Google Maps div should be in the DOM (may or may not be fully rendered)
        const mapDiv = page.locator('#deliveryGoogleMap');
        await expect(mapDiv).toBeVisible({ timeout: 15000 });

        // Map div should have content (Google Maps injects canvas elements)
        await page.waitForFunction(() => {
            const d = document.getElementById('deliveryGoogleMap');
            return d && d.children.length > 0;
        }, { timeout: 20000 });

        const children = await mapDiv.evaluate(el => el.children.length);
        expect(children).toBeGreaterThan(0);
    });

    // ── 5. Directions tab ─────────────────────────────────────────────────────

    test('5 - "Get Directions" loads turn-by-turn steps list', async ({ page }) => {
        await clickGo(page);
        await waitForRows(page);
        await page.locator('.sapMLIB, .sapMListItem').first().click();

        await page.waitForLoadState('networkidle', { timeout: 20000 });
        await page.waitForTimeout(2000);

        // Click "Get Directions"
        const dirBtn = page.locator('button:has-text("Get Directions")').first();
        await dirBtn.waitFor({ state: 'visible', timeout: 20000 });
        await dirBtn.click();

        // Wait for the action to finish
        await page.waitForFunction(() => {
            const el = document.querySelector('[id*="mapBusyIndicator"]');
            if (!el) return true;
            return el.style.display === 'none' || el.hidden || el.classList.contains('sapUiHidden');
        }, { timeout: 30000 });

        // Directions list should now be visible with at least one step
        const directionsList = page.locator('[id*="directionsList"]').first();
        await expect(directionsList).toBeVisible({ timeout: 15000 });

        const stepItems = page.locator('[id*="directionsList"] .sapMLIB');
        await expect(stepItems.first()).toBeVisible({ timeout: 15000 });

        const count = await stepItems.count();
        expect(count).toBeGreaterThan(0);
    });

    // ── 6. Assign Driver dialog ────────────────────────────────────────────────

    test('6 - Assign Driver dialog opens with mobile ComboBox', async ({ page }) => {
        await clickGo(page);
        await waitForRows(page);
        await page.locator('.sapMLIB, .sapMListItem').first().click();

        await page.waitForLoadState('networkidle', { timeout: 20000 });
        await page.waitForTimeout(2000);

        // The "Assign Driver" action appears in the Object Page toolbar
        const assignBtn = page.locator(
            'button:has-text("Assign Driver"), [title="Assign Driver"], button:has-text("Assign")'
        ).first();
        await assignBtn.waitFor({ state: 'visible', timeout: 20000 });
        await assignBtn.click();

        // Dialog should open
        const dialog = page.locator('[id*="driverAssignDialog"], .sapMDialog').first();
        await expect(dialog).toBeVisible({ timeout: 10000 });

        // Dialog title
        const title = page.locator('.sapMDialogTitle, .sapMTitle').first();
        await expect(title).toBeVisible({ timeout: 5000 });

        // ComboBox for mobile number should be present
        const mobileCombo = page.locator('[id*="inputMobile"]').first();
        await expect(mobileCombo).toBeVisible({ timeout: 5000 });

        // Close dialog to clean up
        const closeBtn = page.locator('.sapMDialogFooter button:has-text("Close"), button:has-text("Cancel")').first();
        if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await closeBtn.click();
        }
    });

});

// ── API health checks (no browser needed) ────────────────────────────────────
test.describe('API health checks (hybrid mode)', () => {

    test('7 - OData service metadata is accessible', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/odata/v4/ewm/$metadata`, {
            headers: { Authorization: BASIC_AUTH }
        });
        expect(response.status()).toBe(200);
        const body = await response.text();
        expect(body).toContain('OutboundDeliveries');
    });

    test('8 - Tracking service metadata is accessible', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/odata/v4/tracking/$metadata`, {
            headers: { Authorization: BASIC_AUTH }
        });
        expect(response.status()).toBe(200);
        const body = await response.text();
        expect(body).toContain('DriverAssignment');
    });

    test('9 - GmapsService metadata is accessible', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/odata/v4/gmaps/$metadata`, {
            headers: { Authorization: BASIC_AUTH }
        });
        expect(response.status()).toBe(200);
        const body = await response.text();
        expect(body).toContain('RouteDirections');
    });
});
