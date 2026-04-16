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

    // Truck tracking state
    let _truckMarker        = null;
    let _trackingInterval   = null;
    let _currentDeliveryDoc = null;

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

        // Auto-called when section DOM renders (invisible HTML control afterRendering)
        onSectionRendered: function (oEvent) {
            const oHtml = oEvent.getSource ? oEvent.getSource() : null;
            const oVBox = oHtml && oHtml.getParent ? oHtml.getParent() : null;
            handler._loadDriverStatusWithRetry(oVBox, 0);
        },

        _loadDriverStatusWithRetry: function (oVBox, attempt) {
            const oCtx = oVBox && oVBox.getBindingContext ? oVBox.getBindingContext() : null;
            if (!oCtx) {
                if (attempt < 20) {
                    setTimeout(() => handler._loadDriverStatusWithRetry(oVBox, attempt + 1), 300);
                }
                return;
            }
            const deliveryDoc = oCtx.getObject && oCtx.getObject().DeliveryDocument;
            if (deliveryDoc) handler._loadDriverStatus(deliveryDoc);
        },

        _loadDriverStatus: function (deliveryDoc) {
            fetch(`/odata/v4/tracking/DriverAssignment?$filter=DeliveryDocument eq '${deliveryDoc}' and Status ne 'DELIVERED'&$top=1&$orderby=AssignedAt desc`, {
                headers: { "Authorization": "Basic " + btoa("alice:alice") }
            }).then(r => r.json()).then(data => {
                const a = data && data.value && data.value[0];
                const bar = handler._find("driverStatusBar");
                if (!bar) return;
                if (!a) { bar.setVisible(false); return; }

                const label  = a.TruckRegistration || a.MobileNumber;
                const status = a.Status === 'IN_TRANSIT' ? 'In Transit' : a.Status === 'ASSIGNED' ? 'Assigned' : a.Status;
                const state  = a.Status === 'IN_TRANSIT' ? 'Warning' : 'Success';

                const txt1 = handler._find("driverStatusText");
                const txt2 = handler._find("driverTruckText");
                const txt3 = handler._find("driverStatusState");
                if (txt1) txt1.setText(a.MobileNumber || "");
                if (txt2) txt2.setText(label);
                if (txt3) { txt3.setText(status); txt3.setState(state); }
                bar.setVisible(true);
            }).catch(() => { /* silent — no assignment */ });
        },

        // ── Core flow ────────────────────────────────────────────────────

        _triggerRoute: function (oEvent, targetTab) {
            const oSource = oEvent.getSource();
            const oCtx    = oSource.getBindingContext();
            if (!oCtx) { MessageToast.show("No delivery selected"); return; }

            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) { MessageToast.show("No delivery document found"); return; }
            _currentDeliveryDoc = deliveryDoc;

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

            const map = new google.maps.Map(mapDiv, {
                center: { lat: (neLat + swLat) / 2, lng: (neLng + swLng) / 2 },
                zoom: 10,
                mapTypeId: "roadmap"
            });

            map.fitBounds(new google.maps.LatLngBounds(
                { lat: swLat, lng: swLng },
                { lat: neLat, lng: neLng }
            ));
            setTimeout(() => google.maps.event.trigger(map, "resize"), 100);

            // ── Parse stored rawData and draw route manually ──────────────
            // DirectionsRenderer.setDirections() only works with live DirectionsResult
            // objects returned by the JS SDK — it cannot accept plain JSON from a DB.
            // Instead: decode the overview_polyline for the route line, and place
            // explicit A/B markers at the leg's actual start/end coordinates.
            let routeDrawn = false;
            if (oDir.rawData) {
                let parsed = null;
                try { parsed = JSON.parse(oDir.rawData); } catch (e) { /* ignore */ }

                const route = parsed && parsed.routes && parsed.routes[0];
                const leg   = route && route.legs && route.legs[0];

                if (leg) {
                    const originLatLng = new google.maps.LatLng(
                        leg.start_location.lat, leg.start_location.lng
                    );
                    const destLatLng = new google.maps.LatLng(
                        leg.end_location.lat, leg.end_location.lng
                    );

                    // A marker at origin
                    new google.maps.Marker({
                        position: originLatLng,
                        map,
                        label: { text: "A", color: "white", fontWeight: "bold" },
                        title: leg.start_address
                    });

                    // B marker at destination
                    new google.maps.Marker({
                        position: destLatLng,
                        map,
                        label: { text: "B", color: "white", fontWeight: "bold" },
                        title: leg.end_address
                    });

                    // Decode overview_polyline for the route line
                    const encodedPath = route.overview_polyline && route.overview_polyline.points;
                    if (encodedPath && google.maps.geometry && google.maps.geometry.encoding) {
                        const path = google.maps.geometry.encoding.decodePath(encodedPath);
                        new google.maps.Polyline({
                            path,
                            geodesic: true,
                            strokeColor: "#0854A0",
                            strokeWeight: 5,
                            strokeOpacity: 0.85
                        }).setMap(map);
                    } else {
                        // geometry library not loaded — draw straight line as fallback
                        new google.maps.Polyline({
                            path: [originLatLng, destLatLng],
                            geodesic: true,
                            strokeColor: "#0854A0",
                            strokeWeight: 4
                        }).setMap(map);
                    }

                    // Info window at midpoint
                    const midLat = (leg.start_location.lat + leg.end_location.lat) / 2;
                    const midLng = (leg.start_location.lng + leg.end_location.lng) / 2;
                    new google.maps.InfoWindow({
                        content: `<div style="padding:6px;font-family:sans-serif;max-width:240px;">
                            <strong>${leg.start_address}</strong><br/>
                            ↓ <strong>${leg.end_address}</strong><br/>
                            <span style="color:#555">📏 ${oDir.distance}&nbsp;&nbsp;⏱ ${oDir.duration}</span>
                        </div>`,
                        position: { lat: midLat, lng: midLng }
                    }).open(map);

                    routeDrawn = true;
                }
            }

            if (!routeDrawn) {
                // Last-resort fallback using stored bounds corners
                new google.maps.Marker({ position: { lat: swLat, lng: swLng }, map, label: "A", title: oDir.origin });
                new google.maps.Marker({ position: { lat: neLat, lng: neLng }, map, label: "B", title: oDir.destination });
                new google.maps.Polyline({
                    path: [{ lat: swLat, lng: swLng }, { lat: neLat, lng: neLng }],
                    geodesic: true, strokeColor: "#0854A0", strokeWeight: 4
                }).setMap(map);
            }

            // Start live truck marker polling if a driver is assigned
            if (_currentDeliveryDoc) {
                if (_trackingInterval) { clearInterval(_trackingInterval); _trackingInterval = null; }
                _truckMarker = null;
                handler._startTruckTracking(_currentDeliveryDoc, map);
            }
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

        // ── Driver assignment & truck tracking ───────────────────────────

        _startTruckTracking: function (deliveryDoc, map) {
            fetch(`/odata/v4/tracking/DriverAssignment?$filter=DeliveryDocument eq '${deliveryDoc}' and Status ne 'DELIVERED'&$top=1&$orderby=AssignedAt desc`, {
                headers: { "Authorization": "Basic " + btoa("alice:alice") }
            }).then(r => r.json()).then(data => {
                const a = data && data.value && data.value[0];
                if (!a) return;
                const label = a.TruckRegistration || a.MobileNumber;
                handler._updateTruckMarker(a.ID, label, map);
                _trackingInterval = setInterval(function () {
                    handler._updateTruckMarker(a.ID, label, map);
                }, 30000);
            }).catch(() => { /* no active assignment, silent */ });
        },

        _updateTruckMarker: function (assignmentId, label, map) {
            fetch(`/odata/v4/tracking/latestGps(assignmentId=${assignmentId})`, {
                headers: { "Authorization": "Basic " + btoa("alice:alice") }
            }).then(r => r.json()).then(gps => {
                if (!gps || !gps.Latitude) return;
                const pos = { lat: gps.Latitude, lng: gps.Longitude };
                if (_truckMarker) {
                    _truckMarker.setPosition(pos);
                } else {
                    _truckMarker = new google.maps.Marker({
                        position: pos,
                        map,
                        label: { text: label, color: "white", fontWeight: "bold" },
                        icon: {
                            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                            scale: 6,
                            fillColor: "#E8581C",
                            fillOpacity: 1,
                            strokeColor: "white",
                            strokeWeight: 2
                        },
                        title: "Truck: " + label
                    });
                    // Extend map bounds to show truck marker
                    var bounds = map.getBounds();
                    if (bounds) {
                        bounds.extend(pos);
                        map.fitBounds(bounds);
                    }
                }
            }).catch(() => { /* GPS not yet available */ });
        },

        // ── Google Maps script loader ────────────────────────────────────

        _loadMapsScript: function (apiKey) {
            return new Promise((resolve, reject) => {
                if (_mapsLoaded && window.google && window.google.maps) { resolve(); return; }
                if (_mapsLoading) { _mapsQueue.push(resolve); return; }
                _mapsLoading = true;
                const s = document.createElement("script");
                s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&loading=async`;
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
