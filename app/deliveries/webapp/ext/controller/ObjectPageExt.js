sap.ui.define([
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (MessageToast, MessageBox) {
    "use strict";

    return {
        onAssignDriver: function (oBindingContext) {
            if (!oBindingContext) { MessageToast.show("No delivery selected"); return; }
            var deliveryDoc = oBindingContext.getProperty("DeliveryDocument");
            if (!deliveryDoc) { MessageToast.show("No delivery document found"); return; }

            sap.ui.require(["ewm/deliveries/ext/fragment/DriverAssign"], function (DriverAssign) {
                DriverAssign.openDialog(deliveryDoc, null);
            });
        },

        onShowQR: function (oBindingContext) {
            if (!oBindingContext) { MessageToast.show("No delivery selected"); return; }
            var deliveryDoc = oBindingContext.getProperty("DeliveryDocument");
            if (!deliveryDoc) return;

            fetch("/odata/v4/tracking/getQRCode", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Basic " + btoa("alice:alice")
                },
                body: JSON.stringify({ deliveryDoc: deliveryDoc })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (!data || !data.QRCodeImage) {
                    MessageToast.show("No active assignment found for this delivery.");
                    return;
                }
                sap.ui.require(["ewm/deliveries/ext/fragment/DriverAssign"], function (DriverAssign) {
                    DriverAssign.openDialog(deliveryDoc, data.QRCodeImage);
                });
            }).catch(function () {
                MessageToast.show("Failed to retrieve QR code.");
            });
        },

        onCloseTrip: function (oBindingContext) {
            if (!oBindingContext) { MessageToast.show("No delivery selected"); return; }
            var deliveryDoc = oBindingContext.getProperty("DeliveryDocument");
            if (!deliveryDoc) return;

            // 1. Find the active assignment for this delivery
            fetch("/odata/v4/tracking/DriverAssignment?$filter=DeliveryDocument eq '" + deliveryDoc + "' and Status ne 'DELIVERED'&$top=1&$orderby=AssignedAt desc", {
                headers: { "Authorization": "Basic " + btoa("alice:alice") }
            }).then(function (r) { return r.json(); }).then(function (data) {
                var assignment = data && data.value && data.value[0];
                if (!assignment) {
                    MessageToast.show("No active trip found for this delivery.");
                    return;
                }

                var label = assignment.TruckRegistration || assignment.MobileNumber;
                // 2. Show confirmation dialog
                MessageBox.confirm(
                    "Close trip for delivery " + deliveryDoc + " (" + label + ")?\n\nThis will mark the delivery as completed and stop GPS tracking.",
                    {
                        title: "Close Trip",
                        onClose: function (sAction) {
                            if (sAction !== MessageBox.Action.OK) return;

                            // 3. Call confirmDelivery
                            fetch("/odata/v4/tracking/confirmDelivery", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    "Authorization": "Basic " + btoa("alice:alice")
                                },
                                body: JSON.stringify({ assignmentId: assignment.ID })
                            }).then(function (r) {
                                if (!r.ok) throw new Error("Failed to close trip");
                                MessageToast.show("Trip closed for delivery " + deliveryDoc);
                            }).catch(function (err) {
                                MessageToast.show(err.message || "Failed to close trip");
                            });
                        }
                    }
                );
            }).catch(function () {
                MessageToast.show("Failed to check assignment status.");
            });
        }
    };
});
