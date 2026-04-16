# Delivery Items Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Delivery Items" tab to the Outbound Delivery Object Page that fetches and displays line items from the EWM sandbox API.

**Architecture:** A new `getDeliveryItems` action on `EwmService` proxies `A_OutbDeliveryItem` from the EWM sandbox and returns a typed array. A new custom section fragment (`DeliveryItems`) mirrors the existing `DeliveryMap` pattern — it reads the delivery document from binding context on render, calls the action, and populates a `sap.m.Table` via a `JSONModel`. Tab order is: Delivery Details → Delivery Items → Route & Map.

**Tech Stack:** CAP CDS (OData V4), SAP UI5 1.144 (sap.m.Table, sap.m.JSONModel), Fiori Elements custom sections, EWM OData V2 sandbox API.

---

## File Map

| File | Change |
|------|--------|
| `srv/ewm_srv.cds` | Add `DeliveryItems` entity + `getDeliveryItems` action |
| `srv/ewm_srv.js` | Add `getDeliveryItems` handler |
| `app/deliveries/webapp/ext/fragment/DeliveryItems.fragment.xml` | **Create** — sap.m.Table fragment |
| `app/deliveries/webapp/ext/fragment/DeliveryItems.js` | **Create** — controller |
| `app/deliveries/webapp/manifest.json` | Add DeliveryItems section, repoint DeliveryMap anchor |

---

### Task 1: Add `DeliveryItems` entity and action to `ewm_srv.cds`

**Files:**
- Modify: `srv/ewm_srv.cds`

- [ ] **Step 1: Add the entity and action**

Open `srv/ewm_srv.cds`. The full file after the change must look like this:

```cds
// srv/ewm_srv.cds
using { gmaps_schema } from '../db/gmaps_schema';

@requires: 'authenticated-user'
service EwmService {

    @readonly
    @restrict: [{ grant: 'READ', to: 'gmaps_user' }]
    entity OutboundDeliveries {
        key DeliveryDocument        : String(10);
            ActualDeliveryRoute     : String(6);
            ShippingPoint           : String(4);
            ShipToParty             : String(10);
            SalesOrganization       : String(4);
            ShippingCondition       : String(2);
            HeaderGrossWeight       : Decimal(13,3);
            HeaderNetWeight         : Decimal(13,3);
    }

    // Virtual entity — used only as action return type, not persisted
    entity DeliveryItems {
        key DeliveryDocumentItem : String(6);
            Material             : String(40);
            MaterialName         : String(100);
            DeliveryQuantity     : Decimal(13,3);
            DeliveryQuantityUnit : String(3);
            Plant                : String(4);
            StorageLocation      : String(4);
            TransportationGroup  : String(4);
    }

    // Expose RouteDirections so the action return type is valid within this service
    @readonly
    entity RouteDirections as projection on gmaps_schema.RouteDirections;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getDeliveryRoute(deliveryDoc: String) returns RouteDirections;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getDeliveryItems(deliveryDoc: String) returns array of DeliveryItems;
}
```

- [ ] **Step 2: Verify server starts cleanly**

```bash
cds compile srv/ewm_srv.cds 2>&1
```

Expected: no errors (warnings about virtual entity are OK).

- [ ] **Step 3: Commit**

```bash
git add srv/ewm_srv.cds
git commit -m "feat: add DeliveryItems entity and getDeliveryItems action to EwmService"
```

---

### Task 2: Implement `getDeliveryItems` handler in `ewm_srv.js`

**Files:**
- Modify: `srv/ewm_srv.js`

- [ ] **Step 1: Add handler inside `init()`**

In `srv/ewm_srv.js`, inside `async init()`, after the existing `this.on('getDeliveryRoute', ...)` block and before `return super.init();`, add:

```js
        // ── ACTION: fetch delivery line items from EWM ────────────────────
        this.on('getDeliveryItems', async (req) => {
            const { deliveryDoc } = req.data;
            if (!deliveryDoc) return req.error(400, 'deliveryDoc is required');

            try {
                const url = `/s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryItem` +
                    `?$filter=DeliveryDocument eq '${deliveryDoc}'` +
                    `&$select=DeliveryDocumentItem,Material,MaterialName,DeliveryQuantity,DeliveryQuantityUnit,Plant,StorageLocation,TransportationGroup`;

                const res = await ewmApi.send({
                    method: 'GET',
                    path: url,
                    headers: { 'APIKey': SANDBOX_KEY }
                });

                // OData V2 collection: { d: { results: [...] } }
                const rows = (res?.d?.results || res?.value || []).map(d => ({
                    DeliveryDocumentItem: d.DeliveryDocumentItem,
                    Material:             d.Material,
                    MaterialName:         d.MaterialName,
                    DeliveryQuantity:     parseFloat(d.DeliveryQuantity) || 0,
                    DeliveryQuantityUnit: d.DeliveryQuantityUnit,
                    Plant:                d.Plant,
                    StorageLocation:      d.StorageLocation,
                    TransportationGroup:  d.TransportationGroup
                }));

                return rows;
            } catch (error) {
                console.error('getDeliveryItems error:', error.message);
                return req.error(500, `Failed to get delivery items: ${error.message}`);
            }
        });
```

- [ ] **Step 2: Test the action via curl**

Start server (`cds watch`) then in another terminal:

```bash
curl -s -u alice:alice \
  -X POST "http://localhost:4004/odata/v4/ewm/getDeliveryItems" \
  -H "Content-Type: application/json" \
  -d '{"deliveryDoc":"80000000"}' | python3 -m json.tool | head -40
```

Expected: JSON array with `DeliveryDocumentItem`, `Material`, `DeliveryQuantity`, etc. fields. If sandbox returns no results for `80000000`, try `80000001`.

- [ ] **Step 3: Commit**

```bash
git add srv/ewm_srv.js
git commit -m "feat: implement getDeliveryItems handler — proxies EWM A_OutbDeliveryItem"
```

---

### Task 3: Create `DeliveryItems.fragment.xml`

**Files:**
- Create: `app/deliveries/webapp/ext/fragment/DeliveryItems.fragment.xml`

- [ ] **Step 1: Create the fragment file**

```xml
<core:FragmentDefinition
    xmlns:core="sap.ui.core"
    xmlns="sap.m"
    xmlns:l="sap.ui.layout">

    <VBox id="deliveryItemsContainer"
          core:require="{ handler: 'ewm/deliveries/ext/fragment/DeliveryItems' }">

        <!-- Error message -->
        <MessageStrip id="itemsErrorStrip" visible="false" type="Error"
                      showCloseButton="true" class="sapUiSmallMarginBottom"/>

        <!-- Items table -->
        <Table id="deliveryItemsTable"
               noDataText="No items found for this delivery."
               class="sapUiSmallMarginTop">
            <columns>
                <Column width="6rem">
                    <Text text="Item"/>
                </Column>
                <Column width="10rem">
                    <Text text="Material"/>
                </Column>
                <Column>
                    <Text text="Description"/>
                </Column>
                <Column width="8rem" hAlign="Right">
                    <Text text="Quantity"/>
                </Column>
                <Column width="6rem">
                    <Text text="Plant"/>
                </Column>
                <Column width="7rem">
                    <Text text="Storage Loc."/>
                </Column>
                <Column width="8rem">
                    <Text text="Transport Grp"/>
                </Column>
            </columns>
            <items>
                <ColumnListItem>
                    <cells>
                        <Text text="{items>DeliveryDocumentItem}"/>
                        <Text text="{items>Material}"/>
                        <Text text="{items>MaterialName}"/>
                        <Text text="{= ${items>DeliveryQuantity} + ' ' + ${items>DeliveryQuantityUnit} }"/>
                        <Text text="{items>Plant}"/>
                        <Text text="{items>StorageLocation}"/>
                        <Text text="{items>TransportationGroup}"/>
                    </cells>
                </ColumnListItem>
            </items>
        </Table>

    </VBox>
</core:FragmentDefinition>
```

- [ ] **Step 2: Commit**

```bash
git add app/deliveries/webapp/ext/fragment/DeliveryItems.fragment.xml
git commit -m "feat: add DeliveryItems fragment XML with sap.m.Table"
```

---

### Task 4: Create `DeliveryItems.js` controller

**Files:**
- Create: `app/deliveries/webapp/ext/fragment/DeliveryItems.js`

- [ ] **Step 1: Create the controller**

```js
// app/deliveries/webapp/ext/fragment/DeliveryItems.js
sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    const handler = {

        // Called by Fiori Elements after the fragment is rendered
        onAfterRendering: function (oEvent) {
            const oContainer = oEvent.getSource ? oEvent.getSource() : null;
            handler._loadWithRetry(oContainer, 0);
        },

        _loadWithRetry: function (oContainer, attempt) {
            const MAX = 10;
            const oCtx = oContainer && oContainer.getBindingContext
                ? oContainer.getBindingContext()
                : null;

            if (!oCtx) {
                if (attempt < MAX) {
                    setTimeout(() => handler._loadWithRetry(oContainer, attempt + 1), 300);
                }
                return;
            }

            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) return;

            handler._fetchItems(oCtx.getModel(), deliveryDoc);
        },

        _fetchItems: function (oModel, deliveryDoc) {
            // Show table busy
            const oTable = handler._find("deliveryItemsTable");
            if (oTable) oTable.setBusy(true);
            handler._hideError();

            const oBinding = oModel.bindContext("/getDeliveryItems(...)");
            oBinding.setParameter("deliveryDoc", deliveryDoc);

            oBinding.execute().then(() => {
                const oBoundCtx = oBinding.getBoundContext();
                if (!oBoundCtx) throw new Error("No items returned.");
                return oBoundCtx.requestObject();
            }).then(oResult => {
                const items = Array.isArray(oResult) ? oResult : (oResult && oResult.value) || [];
                const oItemsModel = new JSONModel({ items: items });
                const oTable = handler._find("deliveryItemsTable");
                if (oTable) {
                    oTable.setModel(oItemsModel, "items");
                    oTable.bindItems({
                        path: "items>/items",
                        template: oTable.getBindingInfo("items") && oTable.getBindingInfo("items").template
                            || oTable.getItems()[0]
                    });
                }
            }).catch(err => {
                handler._showError(err.message || "Failed to load delivery items.");
            }).finally(() => {
                const oTable = handler._find("deliveryItemsTable");
                if (oTable) oTable.setBusy(false);
            });
        },

        _showError: function (msg) {
            const o = handler._find("itemsErrorStrip");
            if (o) { o.setText(msg); o.setVisible(true); }
        },

        _hideError: function () {
            const o = handler._find("itemsErrorStrip");
            if (o) o.setVisible(false);
        },

        _find: function (sLocalId) {
            const el = document.querySelector(`[id$="--${sLocalId}"]`);
            if (!el) return null;
            const fullId = el.id.replace(/^sap-ui-invisible-/, "");
            return sap.ui.getCore().byId(fullId) || null;
        }
    };

    return handler;
});
```

- [ ] **Step 2: Commit**

```bash
git add app/deliveries/webapp/ext/fragment/DeliveryItems.js
git commit -m "feat: add DeliveryItems fragment controller"
```

---

### Task 5: Wire fragment into `manifest.json` and fix tab order

**Files:**
- Modify: `app/deliveries/webapp/manifest.json`

- [ ] **Step 1: Update the `sections` block in `manifest.json`**

Find the `"sections"` block inside `DeliveryObjectPage` → `options.settings.content.body`. Replace the current single-section block:

```json
"sections": {
  "DeliveryMap": {
    "template": "ewm.deliveries.ext.fragment.DeliveryMap",
    "position": {
      "placement": "After",
      "anchor": "fe::FacetSection::GeneralInfo"
    },
    "title": "Route & Map"
  }
}
```

With:

```json
"sections": {
  "DeliveryItems": {
    "template": "ewm.deliveries.ext.fragment.DeliveryItems",
    "position": {
      "placement": "After",
      "anchor": "fe::FacetSection::GeneralInfo"
    },
    "title": "Delivery Items"
  },
  "DeliveryMap": {
    "template": "ewm.deliveries.ext.fragment.DeliveryMap",
    "position": {
      "placement": "After",
      "anchor": "fe::CustomSubSection::DeliveryItems"
    },
    "title": "Route & Map"
  }
}
```

- [ ] **Step 2: Verify server still starts**

```bash
cds watch 2>&1 | head -20
```

Expected: both `EwmService` and `GmapsService` served with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/deliveries/webapp/manifest.json
git commit -m "feat: register DeliveryItems custom section, reorder tabs (Details → Items → Map)"
```

---

### Task 6: Verify end-to-end with Playwright

**Files:** none — verification only

- [ ] **Step 1: Run Playwright test**

```python
# Run as: python3 test_items.py
import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(http_credentials={"username":"alice","password":"alice"})
        page = await ctx.new_page()

        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        await page.goto("http://localhost:4004/ewm.deliveries/index.html", wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(3000)
        await page.locator("button:has-text('Go')").first.click()
        await page.wait_for_timeout(4000)
        await page.locator(".sapMListItem, .sapMLIB, tr.sapUiTableRow").first.click()
        await page.wait_for_timeout(3000)

        # Check tab order
        tabs = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('.sapUxAPAnchorBarButton')).map(b => b.textContent.trim());
        }""")
        print("Tab order:", tabs)

        # Navigate to Delivery Items tab
        await page.locator("text=Delivery Items").first.click()
        await page.wait_for_timeout(5000)

        # Check table rows
        row_count = await page.evaluate("""() => {
            return document.querySelectorAll('[id$="--deliveryItemsTable"] .sapMLIB').length;
        }""")
        print("Item rows:", row_count)

        # Check no error strip
        err_visible = await page.evaluate("""() => {
            const el = document.querySelector('[id$="--itemsErrorStrip"]');
            if (!el) return false;
            const id = el.id.replace('sap-ui-invisible-','');
            const c = sap.ui.getCore().byId(id);
            return c ? c.getVisible() : false;
        }""")
        print("Error strip visible:", err_visible)

        await page.screenshot(path="/tmp/delivery_items_tab.png")
        print("Screenshot: /tmp/delivery_items_tab.png")

        # Check tab order correctness
        expected_order = ["Delivery Details", "Delivery Items", "Route & Map"]
        for i, expected in enumerate(expected_order):
            assert i < len(tabs) and expected in tabs[i], f"Expected tab {i} to be '{expected}', got {tabs}"
        assert row_count > 0, "Expected at least one item row"
        assert not err_visible, "Error strip should be hidden"

        print("ALL CHECKS PASSED")
        await browser.close()

asyncio.run(test())
```

Expected output:
```
Tab order: ['Delivery Details', 'Delivery Items', 'Route & Map']
Item rows: <N> (≥ 1)
Error strip visible: False
ALL CHECKS PASSED
```

- [ ] **Step 2: Final commit if any fixes were needed**

```bash
git add -p  # stage only what changed
git commit -m "fix: <describe fix>"
```
