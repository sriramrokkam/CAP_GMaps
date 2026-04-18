# CF Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the `cap-iot/` CAP application to Cloud Foundry on BTP with HANA, XSUAA, Destination service, and the two external API destinations (Google Maps + SAP API Sandbox).

**Architecture:** Single MTA deployment (`cap-iot/mta.yaml`) covering: Node.js srv module, HDI DB deployer, HTML5 app content (routes + deliveries), and an App Router. XSUAA secures all OData endpoints; the Destination service holds `GoogleAPI-SR` and `EWM-API` for external API calls. Hybrid testing validates the wiring before full CF push.

**Tech Stack:** CAP (Node.js), MBT, Cloud Foundry CLI (`cf`), BTP Destination service, XSUAA, HANA HDI, SAP HTML5 Apps Repo.

---

## Destinations Required

Two BTP Destinations must be created manually in the BTP Cockpit before deployment:

| Name | Type | URL | Auth | Header |
|------|------|-----|------|--------|
| `GoogleAPI-SR` | HTTP | `https://maps.googleapis.com` | NoAuthentication | — |
| `EWM-API` | HTTP | `https://sandbox.api.sap.com` | NoAuthentication | `APIKey: <SAP_SANDBOX_API_KEY>` |

> `EWM-API` needs `Additional Properties → URL.headers.APIKey = <key>` set in the Destination cockpit, OR kept as env var `SAP_SANDBOX_API_KEY` in the srv module's CF environment.

---

## Files Modified in This Plan

| File | Change |
|------|--------|
| `cap-iot/xs-security.json` | Add `Transport_Admin` scope + role-template + role-collection |
| `cap-iot/package.json` | Add `Transport_Admin` mock user `alice`, add hybrid profile |
| `cap-iot/mta.yaml` | Add `GoogleAPI-SR` + `EWM-API` destinations to Destination service init_data |
| `cap-iot/.cdsrc-private.json` | Populated during hybrid profile bind step |

---

## Task 1: CF Login and Target

- [ ] **Step 1: Login to CF**
```bash
cf login -a https://api.cf.us10.hana.ondemand.com
# Enter SAP BTP credentials when prompted
# Select org and space
```

- [ ] **Step 2: Verify target**
```bash
cf target
# Expected output shows correct Org and Space
```

- [ ] **Step 3: Commit nothing** (no file changes in this task)

---

## Task 2: Add Transport_Admin Role to xs-security.json

**Files:**
- Modify: `cap-iot/xs-security.json`

- [ ] **Step 1: Add scope, role-template, and role-collection**

Replace the contents of `cap-iot/xs-security.json` with:

```json
{
  "xsappname": "gmaps-app",
  "tenant-mode": "dedicated",
  "description": "Security profile of called application",
  "scopes": [
    {
      "name": "$XSAPPNAME.gmaps_user",
      "description": "User can access and use the Google Maps application"
    },
    {
      "name": "$XSAPPNAME.Transport_Admin",
      "description": "Transport Admin — can assign drivers, view all deliveries and tracking"
    },
    {
      "name": "$XSAPPNAME.emcallback",
      "description": "Enterprise-Messaging Callback Access",
      "grant-as-authority-to-apps": [
        "$XSSERVICENAME(gmaps-app-messaging)"
      ]
    },
    {
      "name": "$XSAPPNAME.emmanagement",
      "description": "Enterprise-Messaging Management Access"
    }
  ],
  "role-templates": [
    {
      "name": "gmaps_user",
      "description": "Google Maps User",
      "scope-references": [
        "$XSAPPNAME.gmaps_user"
      ]
    },
    {
      "name": "Transport_Admin",
      "description": "Transport Administrator",
      "scope-references": [
        "$XSAPPNAME.Transport_Admin",
        "$XSAPPNAME.gmaps_user"
      ]
    }
  ],
  "attributes": [],
  "role-collections": [
    {
      "name": "GmapsUser",
      "description": "Google Maps Application User",
      "role-template-references": [
        "$XSAPPNAME.gmaps_user"
      ]
    },
    {
      "name": "TransportAdmin",
      "description": "Transport Administrator — full access",
      "role-template-references": [
        "$XSAPPNAME.Transport_Admin"
      ]
    }
  ],
  "authorities": [
    "$XSAPPNAME.emmanagement",
    "$XSAPPNAME.mtcallback"
  ]
}
```

- [ ] **Step 2: Commit**
```bash
cd cap-iot
git add xs-security.json
git commit -m "feat: add Transport_Admin scope and role-collection to xs-security.json"
```

---

## Task 3: Add Transport_Admin Mock User + Hybrid Profile to package.json

**Files:**
- Modify: `cap-iot/package.json`

- [ ] **Step 1: Add alice as Transport_Admin in mocked auth and add hybrid profile**

In `cap-iot/package.json`, update the `cds.requires` section — add `Transport_Admin` to alice's roles and add a `[hybrid]` profile:

```json
"auth": {
  "kind": "mocked",
  "users": {
    "alice": {
      "roles": ["gmaps_user", "Transport_Admin"]
    }
  }
},
```

And add the hybrid profile block alongside `[production]`:

```json
"[hybrid]": {
  "db": { "kind": "hana" },
  "auth": { "kind": "xsuaa" },
  "GoogleAPI-SR": {
    "kind": "rest",
    "credentials": { "destination": "GoogleAPI-SR" }
  },
  "EWM-API": {
    "kind": "rest",
    "credentials": { "destination": "EWM-API" }
  },
  "BP-API": {
    "kind": "rest",
    "credentials": { "destination": "EWM-API" }
  }
}
```

- [ ] **Step 2: Verify mock auth still works locally**
```bash
cd cap-iot && npm start
# Open app, login as alice — should have both gmaps_user and Transport_Admin roles
```

- [ ] **Step 3: Commit**
```bash
git add package.json
git commit -m "feat: add Transport_Admin to alice mock user, add hybrid CDS profile"
```

---

## Task 4: Add External API Destinations to mta.yaml

**Files:**
- Modify: `cap-iot/mta.yaml`

- [ ] **Step 1: Add GoogleAPI-SR and EWM-API to Destination service init_data**

In `cap-iot/mta.yaml`, find the `gmaps-app-destination` resource and update `init_data.instance.destinations` to add the two external destinations:

```yaml
- name: gmaps-app-destination
  type: org.cloudfoundry.managed-service
  parameters:
    config:
      HTML5Runtime_enabled: true
      init_data:
        instance:
          destinations:
            - Authentication: NoAuthentication
              Name: ui5
              ProxyType: Internet
              Type: HTTP
              URL: https://ui5.sap.com
            - Authentication: NoAuthentication
              Name: srv-api
              ProxyType: Internet
              Type: HTTP
              URL: ~{srv-api/srv-url}
              HTML5.DynamicDestination: true
              HTML5.ForwardAuthToken: true
            - Authentication: NoAuthentication
              Name: GoogleAPI-SR
              ProxyType: Internet
              Type: HTTP
              URL: https://maps.googleapis.com
            - Authentication: NoAuthentication
              Name: EWM-API
              ProxyType: Internet
              Type: HTTP
              URL: https://sandbox.api.sap.com
          existing_destinations_policy: update
      version: 1.0.0
    service: destination
    service-plan: lite
  requires:
    - name: srv-api
```

> Note: `EWM-API` APIKey header cannot be set via `mta.yaml` init_data. After deployment, go to BTP Cockpit → Destination service instance → `EWM-API` → add Additional Property: `URL.headers.APIKey` = `<your SAP_SANDBOX_API_KEY value>`. Alternatively keep `SAP_SANDBOX_API_KEY` as a CF env var on the srv module (see Task 5).

- [ ] **Step 2: Commit**
```bash
git add mta.yaml
git commit -m "feat: add GoogleAPI-SR and EWM-API destinations to mta.yaml"
```

---

## Task 5: Set CF Environment Variables After Deploy (Manual)

Sensitive keys and runtime config are set directly on the CF app — not in `mta.yaml`.

- [ ] **Step 1: Set env vars on gmaps-app-srv**
```bash
cf set-env gmaps-app-srv GOOGLE_MAPS_API_KEY     <your-google-maps-key>
cf set-env gmaps-app-srv SAP_SANDBOX_API_KEY      <your-sap-sandbox-key>
cf set-env gmaps-app-srv TEAMS_WEBHOOK_URL        <your-teams-webhook-url>
cf set-env gmaps-app-srv APP_BASE_URL             https://<approuter-url>
cf set-env gmaps-app-srv GPS_POLL_INTERVAL_MS     60000
```

- [ ] **Step 2: Restage to apply**
```bash
cf restage gmaps-app-srv
```

> Alternatively set via BTP Cockpit → Cloud Foundry → Spaces → your space → `gmaps-app-srv` → Environment Variables tab.

---

## Task 6: CDS Build (Generate gen/ artifacts)

- [ ] **Step 1: Run CDS build for production**
```bash
cd cap-iot
npx cds build --production
```
Expected: `cap-iot/gen/srv/` and `cap-iot/gen/db/` created with compiled CSN + SQL artifacts.

- [ ] **Step 2: Verify gen/ contents**
```bash
ls cap-iot/gen/srv/srv/
# Should show: ewm_srv.js, gmap_srv.js, tracking_srv.js, teams_notify.js etc.
ls cap-iot/gen/db/src/
# Should show: .hdbcds or .hdbtable files
```

- [ ] **Step 3: Add gen/ to .gitignore if not already there**
```bash
grep "gen/" cap-iot/.gitignore || echo "gen/" >> cap-iot/.gitignore
```

---

## Task 7: Hybrid Testing (Local CAP → CF HANA + XSUAA)

Hybrid testing binds local CAP to CF services without a full deploy — validates DB schema + auth wiring.

- [ ] **Step 1: Bind CF services to local project**
```bash
cd cap-iot
cds bind -2 gmaps-app-xsuaa-service,gmaps-app-db
# This writes credentials to .cdsrc-private.json (gitignored)
```
Expected: `.cdsrc-private.json` updated with HANA + XSUAA credentials.

- [ ] **Step 2: Run in hybrid mode**
```bash
cds watch --profile hybrid
```
Expected: CAP starts, connects to CF HANA, uses CF XSUAA for auth.

- [ ] **Step 3: Test OData endpoint**
```bash
curl -u alice:alice http://localhost:4004/odata/v4/ewm/OutboundDeliveries
# Should return delivery list from CF HANA (empty is fine — schema is correct)
```

- [ ] **Step 4: Fix any schema issues**

If errors like `no such table`, redeploy schema:
```bash
cds deploy --to hana --profile hybrid
```

---

## Task 8: MTA Build

- [ ] **Step 1: Install mbt if not present**
```bash
npm list -g mbt || npm install -g mbt
```

- [ ] **Step 2: Run MTA build from cap-iot/**
```bash
cd cap-iot
mbt build --mtar archive
```
Expected: `cap-iot/mta_archives/archive.mtar` created.

- [ ] **Step 3: Verify archive**
```bash
ls -lh cap-iot/mta_archives/archive.mtar
# Should be > 1MB
```

---

## Task 9: CF Deploy

- [ ] **Step 1: Deploy MTA**
```bash
cd cap-iot
cf deploy mta_archives/archive.mtar --retries 1
```
Expected: All modules and services created/updated. Final line: `Process finished.`

- [ ] **Step 2: Check running apps**
```bash
cf apps
# gmaps-app-srv        started
# gmaps-app-approuter  started
```

- [ ] **Step 3: Check service instances**
```bash
cf services
# gmaps-app-db            hana          hdi-shared   create succeeded
# gmaps-app-xsuaa-service xsuaa         application  create succeeded
# gmaps-app-destination   destination   lite         create succeeded
# gmaps-app-html5-service html5-apps-repo app-host   create succeeded
```

- [ ] **Step 4: Get approuter URL**
```bash
cf app gmaps-app-approuter | grep routes
# routes: gmaps-app-approuter-<space>.cfapps.us10.hana.ondemand.com
```

---

## Task 10: Post-Deploy — BTP Cockpit Role Assignment

- [ ] **Step 1: Assign TransportAdmin role-collection to your BTP user**

  BTP Cockpit → Security → Role Collections → `TransportAdmin` → Edit → Add your email.

- [ ] **Step 2: Assign GmapsUser role-collection if needed for other users**

  BTP Cockpit → Security → Role Collections → `GmapsUser` → Edit → Add users.

- [ ] **Step 3: Update APP_BASE_URL env var on srv**
```bash
cf set-env gmaps-app-srv APP_BASE_URL https://<approuter-url>
cf restage gmaps-app-srv
```

---

## Task 11: Smoke Test on CF

- [ ] **Step 1: Open the deliveries app**
```
https://<approuter-url>/gmaps/deliveries/index.html
```
Expected: Login with BTP user → delivery list loads.

- [ ] **Step 2: Test assignDriver action**

  Open a delivery → Assign Driver → enter mobile + truck → QR code appears.

- [ ] **Step 3: Test GPS tracking**

  Scan QR or open tracking URL → start tracking → Teams alert appears in channel.

- [ ] **Step 4: Test Google Maps route**

  Open Routes app → trigger `getDirections` → map renders with route.

- [ ] **Step 5: Commit final state**
```bash
git add cap-iot/mta.yaml cap-iot/xs-security.json cap-iot/package.json
git commit -m "feat: CF deployment config complete — HANA, XSUAA, destinations, Transport_Admin role"
git push origin feature_odo_iot_teams_agents
```

---

## Summary of What Gets Created in BTP

| BTP Service | Instance Name | Purpose |
|-------------|--------------|---------|
| HANA HDI | `gmaps-app-db` | Persistent data (deliveries, GPS, routes) |
| XSUAA | `gmaps-app-xsuaa-service` | Auth + roles |
| Destination | `gmaps-app-destination` | Routes to srv-api, GoogleAPI-SR, EWM-API |
| HTML5 Apps Repo | `gmaps-app-html5-service` | Hosts Fiori apps |
| Enterprise Messaging | `gmaps-app-messaging` | Kafka-equivalent on BTP (future) |

## Destinations Needed in BTP Cockpit

| Name | URL | Notes |
|------|-----|-------|
| `GoogleAPI-SR` | `https://maps.googleapis.com` | Created via mta.yaml init_data |
| `EWM-API` | `https://sandbox.api.sap.com` | Created via mta.yaml; add `URL.headers.APIKey` manually in cockpit |
