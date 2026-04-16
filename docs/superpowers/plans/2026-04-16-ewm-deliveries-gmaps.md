# EWM Deliveries + Google Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Fiori app that lists EWM Outbound Deliveries (live from SAP sandbox API), allows filtering, and on row selection shows a 2-column Object Page with an IconTabBar — "View on Map" tab renders a Google Map, "Get Directions" tab renders step-by-step turn-by-turn directions.

**Architecture:** Pure passthrough — no persistence of delivery data. CAP `EwmService` proxies live calls to `API_OUTBOUND_DELIVERY_SRV` and `API_BUSINESS_PARTNER` sandbox APIs. `getDeliveryRoute` action resolves addresses via BP API then delegates to the existing `GmapsService.getDirections`. New Fiori app `ewm.deliveries` in `app/deliveries/` with FCL 2-column layout; a custom fragment `DeliveryMap` handles both the map render and directions list via IconTabBar tab switching.

**Tech Stack:** SAP CAP (CDS + Node.js), SAP Fiori Elements (sap.fe.templates), UI5 1.144, Google Maps JS SDK (dynamically loaded), SAP API Business Hub sandbox (`API_OUTBOUND_DELIVERY_SRV`, `API_BUSINESS_PARTNER`).

---

## File Map

| File | Create/Modify | Responsibility |
|------|--------------|----------------|
| `srv/ewm_srv.cds` | Create | Virtual entities `OutboundDeliveries`, bound action `getDeliveryRoute` |
| `srv/ewm_srv.js` | Create | Proxy to EWM API, BP address resolution, delegate to getDirections |
| `package.json` | Modify | Add `EWM-API` and `BP-API` cds.requires entries |
| `app/deliveries/package.json` | Create | UI5 app package config |
| `app/deliveries/ui5.yaml` | Create | UI5 tooling config |
| `app/deliveries/webapp/index.html` | Create | UI5 bootstrap |
| `app/deliveries/webapp/Component.js` | Create | sap.fe.core.AppComponent extension |
| `app/deliveries/webapp/manifest.json` | Create | FCL routing, models, custom sections |
| `app/deliveries/webapp/i18n/i18n.properties` | Create | App title/description strings |
| `app/deliveries/annotations.cds` | Create | UI.LineItem, UI.SelectionFields, UI.HeaderInfo, UI.Facets annotations |
| `app/deliveries/webapp/ext/fragment/DeliveryMap.fragment.xml` | Create | IconTabBar with Map tab + Directions tab |
| `app/deliveries/webapp/ext/fragment/DeliveryMap.js` | Create | Fragment controller: calls action, renders map/directions |
| `app/deliveries/webapp/utils/Config.js` | Create | Google Maps API key helper |
| `app/services.cds` | Modify | Add `using from './deliveries/annotations'` |

---

## Task 1: Add EWM-API and BP-API to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the two new cds.requires entries**

In `package.json`, inside `"cds": { "requires": { ... } }`, add after the `"GoogleAPI-SR"` block:

```json
"EWM-API": {
  "kind": "rest",
  "credentials": {
    "url": "https://sandbox.api.sap.com"
  }
},
"BP-API": {
  "kind": "rest",
  "credentials": {
    "url": "https://sandbox.api.sap.com"
  }
},
```

Also add the production profile overrides inside `"[production]"`:

```json
"EWM-API": {
  "kind": "rest",
  "credentials": {
    "destination": "EWM-API"
  }
},
"BP-API": {
  "kind": "rest",
  "credentials": {
    "destination": "BP-API"
  }
}
```

- [ ] **Step 2: Verify CDS can still parse the config**

```bash
cds env | grep -A5 EWM-API
```

Expected output: shows `EWM-API` with url `https://sandbox.api.sap.com`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add EWM-API and BP-API cds.requires entries"
```

---

## Task 2: Create EwmService CDS definition

**Files:**
- Create: `srv/ewm_srv.cds`

- [ ] **Step 1: Create the file**

```cds
// srv/ewm_srv.cds
using { GmapsService } from './gmap_srv';

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
            ShippingLocationTimezone: String(10);
    }

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getDeliveryRoute(deliveryDoc: String) returns GmapsService.RouteDirections;
}
```

- [ ] **Step 2: Verify CDS compiles**

```bash
cds compile srv/ewm_srv.cds
```

Expected: no errors, outputs compiled JSON to stdout.

- [ ] **Step 3: Commit**

```bash
git add srv/ewm_srv.cds
git commit -m "feat: add EwmService CDS definition with OutboundDeliveries and getDeliveryRoute"
```

---

## Task 3: Create EwmService JS handler

**Files:**
- Create: `srv/ewm_srv.js`

- [ ] **Step 1: Create the handler**

```js
// srv/ewm_srv.js
const cds = require('@sap/cds');

module.exports = class EwmService extends cds.ApplicationService {

    async init() {
        const ewmApi = await cds.connect.to('EWM-API');
        const bpApi  = await cds.connect.to('BP-API');
        const SANDBOX_KEY = process.env.SAP_SANDBOX_API_KEY || '';

        // ── LIST: proxy to EWM OData ──────────────────────────────────────
        this.on('READ', 'OutboundDeliveries', async (req) => {
            const { query } = req;

            // Build OData $filter from CDS WHERE clause
            const filters = [];
            const where = query.SELECT?.where;
            if (where) {
                const pairs = _extractFilters(where);
                pairs.forEach(({ field, value }) => {
                    const map = {
                        DeliveryDocument:     'DeliveryDocument',
                        ActualDeliveryRoute:  'ActualDeliveryRoute',
                        SalesOrganization:    'SalesOrganization',
                        ShipToParty:          'ShipToParty',
                        ShippingPoint:        'ShippingPoint'
                    };
                    if (map[field]) filters.push(`${map[field]} eq '${value}'`);
                });
            }

            const top   = query.SELECT?.limit?.rows?.val || 50;
            const skip  = query.SELECT?.limit?.offset?.val || 0;

            let url = `/s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader?$top=${top}&$skip=${skip}`;
            if (filters.length) url += `&$filter=${filters.join(' and ')}`;
            url += `&$select=DeliveryDocument,ActualDeliveryRoute,ShippingPoint,ShipToParty,SalesOrganization,ShippingCondition,HeaderGrossWeight,HeaderNetWeight,ShippingLocationTimezone`;

            const res = await ewmApi.send({
                method: 'GET',
                path: url,
                headers: { 'APIKey': SANDBOX_KEY }
            });

            const rows = (res.value || []).map(d => ({
                DeliveryDocument:        d.DeliveryDocument,
                ActualDeliveryRoute:     d.ActualDeliveryRoute,
                ShippingPoint:           d.ShippingPoint,
                ShipToParty:             d.ShipToParty,
                SalesOrganization:       d.SalesOrganization,
                ShippingCondition:       d.ShippingCondition,
                HeaderGrossWeight:       parseFloat(d.HeaderGrossWeight) || 0,
                HeaderNetWeight:         parseFloat(d.HeaderNetWeight) || 0,
                ShippingLocationTimezone:d.ShippingLocationTimezone
            }));

            return rows;
        });

        // ── ACTION: resolve addresses → call getDirections ────────────────
        this.on('getDeliveryRoute', async (req) => {
            const { deliveryDoc } = req.data;
            if (!deliveryDoc) return req.error(400, 'deliveryDoc is required');

            // 1. Fetch delivery header to get ShippingPoint + ShipToParty
            const headerUrl = `/s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader('${deliveryDoc}')?$select=ShippingPoint,ShipToParty`;
            const header = await ewmApi.send({
                method: 'GET', path: headerUrl,
                headers: { 'APIKey': SANDBOX_KEY }
            });
            if (!header || !header.ShippingPoint || !header.ShipToParty) {
                return req.error(404, `Delivery ${deliveryDoc} not found or missing ShippingPoint/ShipToParty`);
            }

            // 2. Resolve ShippingPoint address via BP API
            const fromAddress = await _resolveAddress(bpApi, header.ShippingPoint, SANDBOX_KEY);
            if (!fromAddress) return req.error(404, `Could not resolve address for ShippingPoint ${header.ShippingPoint}`);

            // 3. Resolve ShipToParty address via BP API
            const toAddress = await _resolveAddress(bpApi, header.ShipToParty, SANDBOX_KEY);
            if (!toAddress) return req.error(404, `Could not resolve address for ShipToParty ${header.ShipToParty}`);

            // 4. Delegate to GmapsService.getDirections
            const gmaps = await cds.connect.to('GmapsService');
            const result = await gmaps.send('getDirections', { from: fromAddress, to: toAddress });
            return result;
        });

        return super.init();
    }
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function _resolveAddress(bpApi, businessPartner, sandboxKey) {
    try {
        const url = `/s4hanacloud/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('${businessPartner}')/to_BusinessPartnerAddress?$top=1&$select=StreetName,CityName,PostalCode,Country`;
        const res = await bpApi.send({
            method: 'GET', path: url,
            headers: { 'APIKey': sandboxKey }
        });
        const addr = (res.value || [])[0];
        if (!addr) return null;
        return [addr.StreetName, addr.CityName, addr.PostalCode, addr.Country]
            .filter(Boolean).join(', ');
    } catch (e) {
        console.error(`BP address lookup failed for ${businessPartner}:`, e.message);
        return null;
    }
}

function _extractFilters(whereClause) {
    const pairs = [];
    if (!whereClause) return pairs;

    // CDS WHERE AST: [{ref:[field]}, '=', {val:value}, 'and', ...]
    for (let i = 0; i < whereClause.length - 2; i++) {
        const left  = whereClause[i];
        const op    = whereClause[i + 1];
        const right = whereClause[i + 2];
        if (left?.ref && (op === '=' || op === 'eq') && right?.val !== undefined) {
            pairs.push({ field: left.ref[left.ref.length - 1], value: String(right.val) });
            i += 2;
        }
    }
    return pairs;
}
```

- [ ] **Step 2: Start the CAP server and verify both services load**

```bash
npm start
```

Expected output includes:
```
[cds] - serving EwmService { path: '/odata/v4/ewm' }
[cds] - serving GmapsService { path: '/odata/v4/gmaps' }
```

- [ ] **Step 3: Test OutboundDeliveries READ via curl**

```bash
curl -s "http://localhost:4004/odata/v4/ewm/OutboundDeliveries?\$top=3" \
  -H "Authorization: Basic YWxpY2U6" | python3 -m json.tool | head -40
```

Expected: JSON with `value` array of delivery objects with `DeliveryDocument`, `ShippingPoint`, etc.

- [ ] **Step 4: Commit**

```bash
git add srv/ewm_srv.js
git commit -m "feat: add EwmService handler with EWM proxy and getDeliveryRoute action"
```

---

## Task 4: Create Deliveries Fiori app scaffold

**Files:**
- Create: `app/deliveries/package.json`
- Create: `app/deliveries/ui5.yaml`
- Create: `app/deliveries/webapp/index.html`
- Create: `app/deliveries/webapp/Component.js`
- Create: `app/deliveries/webapp/i18n/i18n.properties`

- [ ] **Step 1: Create `app/deliveries/package.json`**

```json
{
  "name": "deliveries",
  "version": "0.0.1",
  "description": "EWM Outbound Deliveries with Google Maps",
  "keywords": ["ui5", "sapui5"],
  "main": "webapp/index.html",
  "dependencies": {},
  "devDependencies": {
    "@ui5/cli": "^4.0.33",
    "@sap/ux-ui5-tooling": "1"
  },
  "scripts": {
    "build": "ui5 build preload --clean-dest"
  }
}
```

- [ ] **Step 2: Create `app/deliveries/ui5.yaml`**

```yaml
specVersion: "4.0"
metadata:
  name: ewm.deliveries
type: application
server:
  customMiddleware:
    - name: fiori-tools-proxy
      afterMiddleware: compression
      configuration:
        ignoreCertErrors: false
        ui5:
          path:
            - /resources
            - /test-resources
          url: https://sapui5.hana.ondemand.com
    - name: fiori-tools-appreload
      afterMiddleware: compression
      configuration:
        port: 35730
        path: webapp
        delay: 300
    - name: fiori-tools-preview
      afterMiddleware: fiori-tools-appreload
      configuration:
        component: ewm.deliveries
        ui5Theme: sap_horizon
```

- [ ] **Step 3: Create `app/deliveries/webapp/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EWM Deliveries</title>
    <style>
        html, body, body > div, #container, #container-uiarea { height: 100%; }
    </style>
    <script
        id="sap-ui-bootstrap"
        src="https://sapui5.hana.ondemand.com/1.144.0/resources/sap-ui-core.js"
        data-sap-ui-theme="sap_horizon"
        data-sap-ui-resource-roots='{ "ewm.deliveries": "./" }'
        data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"
        data-sap-ui-compat-version="edge"
        data-sap-ui-async="true"
        data-sap-ui-frame-options="trusted"
    ></script>
</head>
<body class="sapUiBody sapUiSizeCompact" id="content">
    <div data-sap-ui-component data-name="ewm.deliveries" data-id="container"
         data-settings='{"id":"ewm.deliveries"}' class="sapUiBody" style="height:100%"></div>
</body>
</html>
```

- [ ] **Step 4: Create `app/deliveries/webapp/Component.js`**

```js
sap.ui.define(["sap/fe/core/AppComponent"], function (Component) {
    "use strict";
    return Component.extend("ewm.deliveries.Component", {
        metadata: { manifest: "json" }
    });
});
```

- [ ] **Step 5: Create `app/deliveries/webapp/i18n/i18n.properties`**

```properties
appTitle=EWM Outbound Deliveries
appDescription=View and route EWM outbound deliveries on Google Maps
```

- [ ] **Step 6: Commit**

```bash
git add app/deliveries/
git commit -m "feat: scaffold ewm.deliveries Fiori app"
```

---

## Task 5: Create manifest.json for the deliveries app

**Files:**
- Create: `app/deliveries/webapp/manifest.json`

- [ ] **Step 1: Create the manifest**

```json
{
  "_version": "1.76.0",
  "sap.app": {
    "id": "ewm.deliveries",
    "type": "application",
    "i18n": "i18n/i18n.properties",
    "applicationVersion": { "version": "0.0.1" },
    "title": "{{appTitle}}",
    "description": "{{appDescription}}",
    "dataSources": {
      "mainService": {
        "uri": "/odata/v4/ewm/",
        "type": "OData",
        "settings": {
          "annotations": [],
          "odataVersion": "4.0"
        }
      }
    }
  },
  "sap.ui": {
    "technology": "UI5",
    "deviceTypes": { "desktop": true, "tablet": true, "phone": true }
  },
  "sap.ui5": {
    "flexEnabled": true,
    "dependencies": {
      "minUI5Version": "1.144.0",
      "libs": {
        "sap.m": {},
        "sap.ui.core": {},
        "sap.fe.templates": {},
        "sap.f": {}
      }
    },
    "contentDensities": { "compact": true, "cozy": true },
    "models": {
      "i18n": {
        "type": "sap.ui.model.resource.ResourceModel",
        "settings": { "bundleName": "ewm.deliveries.i18n.i18n" }
      },
      "": {
        "dataSource": "mainService",
        "preload": true,
        "settings": {
          "operationMode": "Server",
          "autoExpandSelect": true,
          "earlyRequests": true
        }
      }
    },
    "routing": {
      "config": {
        "flexibleColumnLayout": {
          "defaultTwoColumnLayoutType": "TwoColumnsMidExpanded"
        },
        "routerClass": "sap.f.routing.Router"
      },
      "routes": [
        {
          "pattern": ":?query:",
          "name": "DeliveriesList",
          "target": ["DeliveriesList"]
        },
        {
          "pattern": "OutboundDeliveries({key}):?query:",
          "name": "DeliveryObjectPage",
          "target": ["DeliveriesList", "DeliveryObjectPage"]
        }
      ],
      "targets": {
        "DeliveriesList": {
          "type": "Component",
          "id": "DeliveriesList",
          "name": "sap.fe.templates.ListReport",
          "options": {
            "settings": {
              "contextPath": "/OutboundDeliveries",
              "variantManagement": "Page",
              "navigation": {
                "OutboundDeliveries": {
                  "detail": { "route": "DeliveryObjectPage" }
                }
              },
              "controlConfiguration": {
                "@com.sap.vocabularies.UI.v1.LineItem": {
                  "tableSettings": { "type": "ResponsiveTable" }
                }
              }
            }
          },
          "controlAggregation": "beginColumnPages",
          "contextPattern": ""
        },
        "DeliveryObjectPage": {
          "type": "Component",
          "id": "DeliveryObjectPage",
          "name": "sap.fe.templates.ObjectPage",
          "options": {
            "settings": {
              "editableHeaderContent": false,
              "contextPath": "/OutboundDeliveries",
              "content": {
                "body": {
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
                },
                "header": {
                  "anchorBarVisible": true,
                  "visible": true
                }
              }
            }
          },
          "controlAggregation": "midColumnPages",
          "contextPattern": "/OutboundDeliveries({key})"
        }
      }
    },
    "rootView": {
      "viewName": "sap.fe.templates.RootContainer.view.Fcl",
      "type": "XML",
      "async": true,
      "id": "appRootView"
    }
  },
  "sap.fiori": {
    "registrationIds": [],
    "archeType": "transactional"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/deliveries/webapp/manifest.json
git commit -m "feat: add manifest.json for ewm.deliveries app with FCL 2-column layout"
```

---

## Task 6: Create CDS annotations for the deliveries app

**Files:**
- Create: `app/deliveries/annotations.cds`
- Modify: `app/services.cds`

- [ ] **Step 1: Create `app/deliveries/annotations.cds`**

```cds
using EwmService as service from '../../srv/ewm_srv';

annotate service.OutboundDeliveries with @(
    UI.HeaderInfo: {
        TypeName:       'Outbound Delivery',
        TypeNamePlural: 'Outbound Deliveries',
        Title: {
            $Type: 'UI.DataField',
            Value: DeliveryDocument
        },
        Description: {
            $Type: 'UI.DataField',
            Value: ActualDeliveryRoute
        }
    },
    UI.SelectionFields: [
        DeliveryDocument,
        ActualDeliveryRoute,
        SalesOrganization,
        ShipToParty,
        ShippingPoint
    ],
    UI.LineItem: [
        { $Type: 'UI.DataField', Value: DeliveryDocument,        Label: 'Delivery' },
        { $Type: 'UI.DataField', Value: ActualDeliveryRoute,     Label: 'Route' },
        { $Type: 'UI.DataField', Value: ShippingPoint,           Label: 'Shipping Point' },
        { $Type: 'UI.DataField', Value: ShipToParty,             Label: 'Ship-To Party' },
        { $Type: 'UI.DataField', Value: SalesOrganization,       Label: 'Sales Org' },
        { $Type: 'UI.DataField', Value: ShippingCondition,       Label: 'Shipping Cond.' },
        { $Type: 'UI.DataField', Value: HeaderGrossWeight,       Label: 'Gross Weight' },
        { $Type: 'UI.DataField', Value: HeaderNetWeight,         Label: 'Net Weight' }
    ],
    UI.Facets: [
        {
            $Type:  'UI.ReferenceFacet',
            ID:     'GeneralInfo',
            Label:  'Delivery Details',
            Target: '@UI.FieldGroup#DeliveryDetails'
        }
    ],
    UI.FieldGroup #DeliveryDetails: {
        $Type: 'UI.FieldGroupType',
        Data: [
            { $Type: 'UI.DataField', Value: DeliveryDocument,        Label: 'Delivery Document' },
            { $Type: 'UI.DataField', Value: ActualDeliveryRoute,     Label: 'Delivery Route' },
            { $Type: 'UI.DataField', Value: ShippingPoint,           Label: 'Shipping Point' },
            { $Type: 'UI.DataField', Value: ShipToParty,             Label: 'Ship-To Party' },
            { $Type: 'UI.DataField', Value: SalesOrganization,       Label: 'Sales Organization' },
            { $Type: 'UI.DataField', Value: ShippingCondition,       Label: 'Shipping Condition' },
            { $Type: 'UI.DataField', Value: HeaderGrossWeight,       Label: 'Gross Weight' },
            { $Type: 'UI.DataField', Value: HeaderNetWeight,         Label: 'Net Weight' },
            { $Type: 'UI.DataField', Value: ShippingLocationTimezone,Label: 'Timezone' }
        ]
    }
);
```

- [ ] **Step 2: Add import to `app/services.cds`**

Open `app/services.cds` and add a second line:

```cds
using from './routes/annotations';
using from './deliveries/annotations';
```

- [ ] **Step 3: Verify CDS compiles cleanly**

```bash
cds compile app/services.cds
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/deliveries/annotations.cds app/services.cds
git commit -m "feat: add Fiori annotations for EWM deliveries list and object page"
```

---

## Task 7: Create Config.js utility for the deliveries app

**Files:**
- Create: `app/deliveries/webapp/utils/Config.js`

- [ ] **Step 1: Create the file**

```js
// app/deliveries/webapp/utils/Config.js
sap.ui.define([], function () {
    "use strict";
    return {
        getApiKey: function () {
            return window.GOOGLE_MAPS_API_KEY ||
                   "AIzaSyBnJ6XNmu3vQE6Uay9BX7q1HV-Qz_N5eP4";
        }
    };
});
```

- [ ] **Step 2: Commit**

```bash
git add app/deliveries/webapp/utils/Config.js
git commit -m "feat: add Config.js API key helper for deliveries app"
```

---

## Task 8: Create DeliveryMap fragment XML

**Files:**
- Create: `app/deliveries/webapp/ext/fragment/DeliveryMap.fragment.xml`

- [ ] **Step 1: Create the fragment**

```xml
<core:FragmentDefinition
    xmlns:core="sap.ui.core"
    xmlns="sap.m"
    xmlns:l="sap.ui.layout">

    <VBox id="deliveryMapContainer"
          core:require="{ handler: 'ewm/deliveries/ext/fragment/DeliveryMap' }">

        <!-- Action buttons -->
        <HBox id="mapActionBar" class="sapUiSmallMarginBottom" alignItems="Center">
            <Button id="btnViewMap"
                    text="View on Map"
                    icon="sap-icon://map"
                    type="Emphasized"
                    press="handler.onViewMap"
                    class="sapUiTinyMarginEnd"/>
            <Button id="btnGetDirections"
                    text="Get Directions"
                    icon="sap-icon://navigation-right-arrow"
                    type="Default"
                    press="handler.onGetDirections"/>
        </HBox>

        <!-- Loading indicator -->
        <BusyIndicator id="mapBusyIndicator" visible="false" size="Medium" class="sapUiSmallMarginBottom"/>

        <!-- Error message -->
        <MessageStrip id="mapErrorStrip" visible="false" type="Error"
                      showCloseButton="true" class="sapUiSmallMarginBottom"/>

        <!-- IconTabBar: Map | Directions -->
        <IconTabBar id="deliveryTabBar" visible="false" expanded="true"
                    backgroundDesign="Transparent" tabDensityMode="Compact">

            <items>
                <IconTabFilter id="tabMap" icon="sap-icon://map" text="Map" key="map">
                    <VBox id="mapTabContent">
                        <!-- Stats bar: distance + duration -->
                        <HBox id="routeStatsBar" visible="false" class="sapUiTinyMarginBottom">
                            <ObjectStatus id="routeDistance" icon="sap-icon://journey-arrive" class="sapUiSmallMarginEnd"/>
                            <ObjectStatus id="routeDuration" icon="sap-icon://time-entry-request"/>
                        </HBox>
                        <!-- Google Map HTML container -->
                        <core:HTML id="googleMapHtml"
                            content='&lt;div id="deliveryGoogleMap" style="width:100%;height:450px;min-height:450px;border:1px solid #d9d9d9;background:#e5e3df;position:relative;"&gt;&lt;div id="deliveryMapPlaceholder" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#888;"&gt;&lt;p&gt;Click &amp;quot;View on Map&amp;quot; to load the route map.&lt;/p&gt;&lt;/div&gt;&lt;/div&gt;'/>
                    </VBox>
                </IconTabFilter>

                <IconTabFilter id="tabDirections" icon="sap-icon://navigation-right-arrow" text="Directions" key="directions">
                    <VBox id="directionsTabContent">
                        <Title id="directionsTitle" text="Step-by-Step Directions"
                               level="H5" visible="false" class="sapUiTinyMarginBottom"/>
                        <List id="directionsList" visible="false"
                              showSeparators="Inner" backgroundDesign="Transparent"/>
                        <Text id="directionsPlaceholder"
                              text="Click 'Get Directions' to load turn-by-turn directions."
                              class="sapUiSmallMarginTop"
                              style="color:#888;font-style:italic;"/>
                    </VBox>
                </IconTabFilter>
            </items>
        </IconTabBar>

    </VBox>
</core:FragmentDefinition>
```

- [ ] **Step 2: Commit**

```bash
git add app/deliveries/webapp/ext/fragment/DeliveryMap.fragment.xml
git commit -m "feat: add DeliveryMap fragment XML with IconTabBar map/directions tabs"
```

---

## Task 9: Create DeliveryMap.js fragment controller

**Files:**
- Create: `app/deliveries/webapp/ext/fragment/DeliveryMap.js`

- [ ] **Step 1: Create the controller**

```js
// app/deliveries/webapp/ext/fragment/DeliveryMap.js
sap.ui.define([
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/StandardListItem",
    "ewm/deliveries/utils/Config"
], function (MessageBox, MessageToast, StandardListItem, Config) {
    "use strict";

    // Google Maps script state (module-level, shared across renders)
    let _mapsLoaded   = false;
    let _mapsLoading  = false;
    const _mapsQueue  = [];

    const MANEUVER_ICONS = {
        "turn-right":        "sap-icon://navigation-right-arrow",
        "turn-left":         "sap-icon://navigation-left-arrow",
        "turn-slight-right": "sap-icon://navigation-right-arrow",
        "turn-slight-left":  "sap-icon://navigation-left-arrow",
        "turn-sharp-right":  "sap-icon://navigation-right-arrow",
        "turn-sharp-left":   "sap-icon://navigation-left-arrow",
        "straight":          "sap-icon://arrow-top",
        "ramp-right":        "sap-icon://navigation-right-arrow",
        "ramp-left":         "sap-icon://navigation-left-arrow",
        "merge":             "sap-icon://arrow-top",
        "fork-right":        "sap-icon://navigation-right-arrow",
        "fork-left":         "sap-icon://navigation-left-arrow",
        "ferry":             "sap-icon://ship",
        "roundabout-right":  "sap-icon://navigation-right-arrow",
        "keep-left":         "sap-icon://navigation-left-arrow",
        "keep-right":        "sap-icon://navigation-right-arrow"
    };

    const handler = {

        // ── Button handlers ──────────────────────────────────────────────

        onViewMap: function (oEvent) {
            handler._triggerRoute(oEvent, "map");
        },

        onGetDirections: function (oEvent) {
            handler._triggerRoute(oEvent, "directions");
        },

        // ── Core flow ────────────────────────────────────────────────────

        _triggerRoute: function (oEvent, targetTab) {
            const oSource = oEvent.getSource();
            const oCtx    = oSource.getBindingContext();
            if (!oCtx) { MessageToast.show("No delivery selected"); return; }

            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) { MessageToast.show("No delivery document found"); return; }

            // Disable buttons, show busy
            handler._setButtonsEnabled(false);
            handler._showBusy(true);
            handler._hideError();

            // Call OData bound action getDeliveryRoute
            const oModel   = oCtx.getModel();
            const sPath    = `/OutboundDeliveries('${deliveryDoc}')/EwmService.getDeliveryRoute(deliveryDoc='${deliveryDoc}')`;
            const oBinding = oModel.bindContext(sPath, oCtx);

            oBinding.execute().then(() => {
                const oResult = oBinding.getBoundContext().getObject({
                    $select: "origin,destination,distance,duration,bounds_northeast_lat,bounds_northeast_lng,bounds_southwest_lat,bounds_southwest_lng,rawData",
                    $expand: "steps($orderby=stepNumber asc;$select=stepNumber,instruction,distance,duration,maneuver)"
                });

                if (!oResult) {
                    handler._showError("No route data returned.");
                    return;
                }

                // Show the tab bar and switch to selected tab
                handler._showTabBar(targetTab);

                if (targetTab === "map") {
                    handler._renderMap(oResult);
                } else {
                    handler._renderDirections(oResult.steps || []);
                }
            }).catch(err => {
                const msg = err.message || "Failed to load route";
                handler._showError(msg);
            }).finally(() => {
                handler._setButtonsEnabled(true);
                handler._showBusy(false);
            });
        },

        // ── Map rendering ────────────────────────────────────────────────

        _renderMap: function (oDir) {
            handler._loadMapsScript(Config.getApiKey()).then(() => {
                setTimeout(() => handler._drawMap(oDir), 300);
            }).catch(err => {
                handler._showError("Failed to load Google Maps: " + err.message);
            });

            // Show stats bar immediately
            const oStats = handler._find("routeStatsBar");
            if (oStats) {
                oStats.setVisible(true);
                const items = oStats.getItems();
                if (items[0]) items[0].setText(oDir.distance || "");
                if (items[1]) items[1].setText(oDir.duration || "");
            }
        },

        _drawMap: function (oDir) {
            const mapDiv = document.getElementById("deliveryGoogleMap");
            if (!mapDiv || !window.google || !window.google.maps) {
                handler._showError("Map container or Google Maps API not available.");
                return;
            }

            const neLat = oDir.bounds_northeast_lat, neLng = oDir.bounds_northeast_lng;
            const swLat = oDir.bounds_southwest_lat, swLng = oDir.bounds_southwest_lng;
            const centerLat = (neLat + swLat) / 2, centerLng = (neLng + swLng) / 2;

            const map = new google.maps.Map(mapDiv, {
                center: { lat: centerLat, lng: centerLng },
                zoom: 10,
                mapTypeId: "roadmap"
            });

            map.fitBounds(new google.maps.LatLngBounds(
                { lat: swLat, lng: swLng },
                { lat: neLat, lng: neLng }
            ));
            setTimeout(() => google.maps.event.trigger(map, "resize"), 100);

            if (oDir.rawData) {
                let parsed = null;
                try { parsed = JSON.parse(oDir.rawData); } catch (e) { /* ignore */ }
                if (parsed && parsed.routes && parsed.routes.length > 0) {
                    const renderer = new google.maps.DirectionsRenderer({
                        map,
                        suppressMarkers: false,
                        polylineOptions: { strokeColor: "#0854A0", strokeWeight: 5 }
                    });
                    renderer.setDirections({
                        routes: parsed.routes,
                        request: {
                            origin: oDir.origin,
                            destination: oDir.destination,
                            travelMode: google.maps.TravelMode.DRIVING
                        }
                    });
                    new google.maps.InfoWindow({
                        content: `<div style="padding:6px;font-family:sans-serif;max-width:220px;">
                            <strong>${oDir.origin}</strong><br/>→ <strong>${oDir.destination}</strong><br/>
                            <span style="color:#555">📏 ${oDir.distance}&nbsp; ⏱ ${oDir.duration}</span>
                        </div>`,
                        position: { lat: centerLat, lng: centerLng }
                    }).open(map);
                    return;
                }
            }

            // Fallback: straight-line polyline
            new google.maps.Marker({ position: { lat: swLat, lng: swLng }, map, label: "A", title: oDir.origin });
            new google.maps.Marker({ position: { lat: neLat, lng: neLng }, map, label: "B", title: oDir.destination });
            new google.maps.Polyline({
                path: [{ lat: swLat, lng: swLng }, { lat: neLat, lng: neLng }],
                geodesic: true, strokeColor: "#0854A0", strokeWeight: 4
            }).setMap(map);
        },

        // ── Directions rendering ─────────────────────────────────────────

        _renderDirections: function (steps) {
            const oList        = handler._find("directionsList");
            const oTitle       = handler._find("directionsTitle");
            const oPlaceholder = handler._find("directionsPlaceholder");

            if (!oList) return;

            oList.destroyItems();

            steps.forEach(step => {
                const icon = MANEUVER_ICONS[step.maneuver] || "sap-icon://navigation-right-arrow";
                const desc = [step.distance, step.duration ? `(${step.duration})` : ""]
                    .filter(Boolean).join("  ");
                oList.addItem(new StandardListItem({
                    title:       step.instruction,
                    description: desc,
                    icon:        icon,
                    iconInset:   false,
                    info:        String(step.stepNumber),
                    infoState:   "None"
                }));
            });

            oList.setVisible(true);
            if (oTitle)       oTitle.setVisible(true);
            if (oPlaceholder) oPlaceholder.setVisible(false);
        },

        // ── UI helpers ───────────────────────────────────────────────────

        _showTabBar: function (activeKey) {
            const oTabBar = handler._find("deliveryTabBar");
            if (!oTabBar) return;
            oTabBar.setVisible(true);
            oTabBar.setSelectedKey(activeKey);
        },

        _setButtonsEnabled: function (enabled) {
            const b1 = handler._find("btnViewMap");
            const b2 = handler._find("btnGetDirections");
            if (b1) b1.setEnabled(enabled);
            if (b2) b2.setEnabled(enabled);
        },

        _showBusy: function (show) {
            const o = handler._find("mapBusyIndicator");
            if (o) o.setVisible(show);
        },

        _showError: function (msg) {
            const o = handler._find("mapErrorStrip");
            if (o) { o.setText(msg); o.setVisible(true); }
        },

        _hideError: function () {
            const o = handler._find("mapErrorStrip");
            if (o) o.setVisible(false);
        },

        _find: function (sLocalId) {
            const elements = sap.ui.getCore().mElements || {};
            const match = Object.keys(elements).find(k =>
                k.endsWith("--" + sLocalId) || k === sLocalId
            );
            return match ? sap.ui.getCore().byId(match) : null;
        },

        // ── Google Maps script loader ────────────────────────────────────

        _loadMapsScript: function (apiKey) {
            return new Promise((resolve, reject) => {
                if (_mapsLoaded && window.google && window.google.maps) { resolve(); return; }
                if (_mapsLoading) { _mapsQueue.push(resolve); return; }
                _mapsLoading = true;
                const s = document.createElement("script");
                s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async`;
                s.async = true;
                s.defer = true;
                s.onload = () => {
                    _mapsLoaded = true; _mapsLoading = false;
                    resolve();
                    _mapsQueue.forEach(cb => cb());
                    _mapsQueue.length = 0;
                };
                s.onerror = () => { _mapsLoading = false; reject(new Error("Failed to load Google Maps")); };
                document.head.appendChild(s);
            });
        }
    };

    return handler;
});
```

- [ ] **Step 2: Commit**

```bash
git add app/deliveries/webapp/ext/fragment/DeliveryMap.js
git commit -m "feat: add DeliveryMap fragment controller with map and directions rendering"
```

---

## Task 10: Register deliveries app in root package.json workspaces and test end-to-end

**Files:**
- Modify: `package.json` (sapux array)

- [ ] **Step 1: Add deliveries app to sapux array in package.json**

Find the `"sapux"` key and add the new app:

```json
"sapux": [
  "app/routes",
  "app/deliveries"
]
```

- [ ] **Step 2: Install dependencies for the new app**

```bash
npm install
```

- [ ] **Step 3: Start the dev server**

```bash
npm run watch-routes
```

- [ ] **Step 4: Open the deliveries app in the browser**

Navigate to: `http://localhost:4004/deliveries/webapp/index.html`

Expected:
- List Report page loads with columns: Delivery, Route, Shipping Point, Ship-To Party, Sales Org, Shipping Cond., Gross Weight, Net Weight
- Filter bar shows: Delivery Document, Actual Delivery Route, Sales Organization, Ship-To Party, Shipping Point

- [ ] **Step 5: Test filtering**

In the filter bar enter `SalesOrganization = 1710` and press Go.

Expected: list refreshes with filtered results from EWM sandbox API.

- [ ] **Step 6: Test row selection → Object Page**

Click any delivery row.

Expected:
- Column 2 opens with delivery header details
- "View on Map" and "Get Directions" buttons visible
- IconTabBar hidden initially

- [ ] **Step 7: Test "View on Map"**

Click "View on Map" button.

Expected:
- Buttons become disabled, busy indicator appears
- Google Map renders in the Map tab with route polyline, origin (A) and destination (B) markers
- Stats bar shows distance and duration
- Buttons re-enabled

- [ ] **Step 8: Test "Get Directions"**

Click "Get Directions" button.

Expected:
- Directions tab activates
- Step-by-step list renders with maneuver icons, instruction, distance/duration per step

- [ ] **Step 9: Final commit**

```bash
git add package.json
git commit -m "feat: register ewm.deliveries in sapux workspaces"
```
