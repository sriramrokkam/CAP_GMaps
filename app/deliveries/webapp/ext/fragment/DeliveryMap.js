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

            // Call OData unbound action getDeliveryRoute
            const oModel   = oCtx.getModel();
            const oBinding = oModel.bindContext("/getDeliveryRoute(...)");
            oBinding.setParameter("deliveryDoc", deliveryDoc);

            oBinding.execute().then(() => {
                const oBoundCtx = oBinding.getBoundContext();
                if (!oBoundCtx) { throw new Error("No route data returned."); }
                return oBoundCtx.requestObject();
            }).then(oResult => {
                if (!oResult) { throw new Error("No route data returned."); }

                // Show the tab bar and switch to selected tab
                handler._showTabBar(targetTab);

                if (targetTab === "map") {
                    handler._renderMap(oResult);
                } else {
                    // steps are a nav property on RouteDirections — fetch via GmapsService
                    const routeId = oResult.route_ID;
                    fetch(`/odata/v4/gmaps/RouteDirections(route_ID=${routeId})?$expand=steps($orderby=stepNumber asc)`, {
                        headers: { "Authorization": "Basic " + btoa("alice:alice") }
                    }).then(r => r.json()).then(data => {
                        handler._renderDirections((data && data.steps) || []);
                    }).catch(() => {
                        handler._renderDirections([]);
                    });
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
                    // DirectionsRenderer.setDirections() requires geocoded_waypoints to
                    // render the A/B markers — synthesise two entries (origin + destination)
                    // if the stored rawData doesn't already include them.
                    const geocodedWaypoints = parsed.geocoded_waypoints && parsed.geocoded_waypoints.length >= 2
                        ? parsed.geocoded_waypoints
                        : [
                            { geocoder_status: "OK", types: ["route"] },
                            { geocoder_status: "OK", types: ["route"] }
                          ];
                    renderer.setDirections({
                        geocoded_waypoints: geocodedWaypoints,
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

            // Fallback: explicit A/B markers + straight-line polyline
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
            // Find the full generated ID via DOM, then resolve the UI5 control
            const el = document.querySelector(`[id$="--${sLocalId}"]`);
            if (!el) return null;
            // Strip the sap-ui-invisible- placeholder prefix if present
            const fullId = el.id.replace(/^sap-ui-invisible-/, "");
            return sap.ui.getCore().byId(fullId) || null;
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
