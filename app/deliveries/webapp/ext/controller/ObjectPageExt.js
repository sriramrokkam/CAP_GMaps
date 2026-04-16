sap.ui.define([
    "sap/m/MessageToast"
], function (MessageToast) {
    "use strict";

    return {
        onAssignDriver: function (oBindingContext, aSelectedContexts) {
            if (!oBindingContext) { MessageToast.show("No delivery selected"); return; }
            var deliveryDoc = oBindingContext.getProperty("DeliveryDocument");
            if (!deliveryDoc) { MessageToast.show("No delivery document found"); return; }

            sap.ui.require(["ewm/deliveries/ext/fragment/DriverAssign"], function (DriverAssign) {
                DriverAssign.openDialog(deliveryDoc, null);
            });
        },

        onShowQR: function (oBindingContext, aSelectedContexts) {
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
        }
    };
});
